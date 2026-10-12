-- =====================================================================
-- Control de inversiones personal — esquema base
-- Supabase (Postgres). Un solo usuario (tú). Todo protegido con RLS.
-- Convención: montos > 0; el "efecto" en el saldo lo da el tipo de movimiento.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type tipo_cuenta as enum ('credito', 'debito', 'alto_rendimiento', 'broker');
create type moneda as enum ('PEN', 'USD');
create type tipo_movimiento as enum (
  'gasto',                 -- consumo con tarjeta de crédito o débito
  'ingreso',               -- sueldo, DEHSE, contratos, otros
  'pago_tarjeta',          -- entrada en la tarjeta de crédito (reduce la deuda)
  'transferencia_salida',
  'transferencia_entrada',
  'interes',               -- interés ganado (cuentas de alto rendimiento)
  'deposito',
  'retiro',
  'comision',
  'compra_etf',            -- sale efectivo del broker
  'venta_etf',             -- entra efectivo al broker
  'dividendo'              -- entra el neto al broker
);
create type distribucion_etf as enum ('distributivo', 'acumulativo');

-- ---------------------------------------------------------------------
-- Utilidades de fecha (zona horaria de Perú)
-- ---------------------------------------------------------------------
create or replace function hoy_lima() returns date
language sql stable as $$ select (now() at time zone 'America/Lima')::date $$;

-- Cierre del ciclo en el mes de "mes_ref" (corta el día al último día del mes)
create or replace function cierre_en_mes(mes_ref date, corte int) returns date
language sql immutable as $$
  select (date_trunc('month', mes_ref)::date
          + (least(corte, extract(day from (date_trunc('month', mes_ref) + interval '1 month - 1 day'))::int) - 1))
$$;

-- Fecha de cierre del ciclo al que pertenece un gasto hecho en "f".
-- Un gasto hecho el día de corte entra al ciclo que cierra ese día;
-- desde el día siguiente empieza el ciclo nuevo.
create or replace function fecha_cierre_ciclo(f date, corte int) returns date
language plpgsql immutable as $$
declare c date;
begin
  c := cierre_en_mes(f, corte);
  if f <= c then return c; end if;
  return cierre_en_mes((date_trunc('month', f) + interval '1 month')::date, corte);
end $$;

-- Fecha de pago del ciclo que cierra en "cierre".
-- Si el día de pago es mayor que el de corte, se paga en el mismo mes; si no, el mes siguiente.
create or replace function fecha_pago_ciclo(cierre date, corte int, pago int) returns date
language plpgsql immutable as $$
declare base date;
begin
  if pago > corte then base := date_trunc('month', cierre)::date;
  else base := (date_trunc('month', cierre) + interval '1 month')::date;
  end if;
  return base + (least(pago, extract(day from (base + interval '1 month - 1 day'))::int) - 1);
end $$;

-- ---------------------------------------------------------------------
-- Configuración del usuario
-- ---------------------------------------------------------------------
create table configuracion (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tasa_impuesto_dividendos numeric(6,4) not null default 0.05,  -- 5% para SUNAT (configurable)
  hora_aviso time not null default '19:00',                      -- hora de Perú
  dias_aviso_pago int not null default 3,
  telegram_chat_id bigint,                                       -- el bot solo responde a este ID
  actualizado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Tipo de cambio SBS (global; solo escribe el servicio, leen los usuarios)
-- Fuente: BCRP API series PD04639PD (compra) y PD04640PD (venta), "Sistema bancario SBS"
-- ---------------------------------------------------------------------
create table tipo_cambio (
  fecha date primary key,
  compra numeric(8,4) not null,
  venta numeric(8,4) not null,
  fuente text not null default 'SBS vía BCRP (PD04639PD/PD04640PD)',
  actualizado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Cuentas (tarjetas de crédito, débito, alto rendimiento y brokers)
-- ---------------------------------------------------------------------
create table cuentas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo tipo_cuenta not null,
  nombre text not null,
  banco text,
  moneda moneda not null default 'PEN',
  dia_corte int check (dia_corte between 1 and 31),
  dia_pago int check (dia_pago between 1 and 31),
  linea_credito numeric(18,2),
  saldo_inicial numeric(18,2) not null default 0,   -- en tarjetas de crédito: deuda inicial en negativo
  fecha_saldo_inicial date not null default current_date,
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  check (tipo <> 'credito' or (dia_corte is not null and dia_pago is not null))
);

create table tasas_cuenta (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cuenta_id uuid not null references cuentas(id) on delete cascade,
  vigente_desde date not null,
  tea numeric(7,4) not null,                         -- ej. 0.0450 = 4.50 %
  unique (cuenta_id, vigente_desde)
);

-- ---------------------------------------------------------------------
-- Libro de movimientos (única fuente de verdad de saldos)
-- ---------------------------------------------------------------------
create table movimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cuenta_id uuid not null references cuentas(id),
  tipo tipo_movimiento not null,
  fecha date not null default hoy_lima(),
  monto numeric(18,4) not null check (monto > 0),
  moneda moneda not null,                            -- moneda del monto (puede diferir de la de la cuenta)
  monto_cuenta numeric(18,4),                        -- monto expresado en la moneda de la cuenta (lo calcula el trigger)
  tc_manual numeric(8,4),                            -- tipo de cambio realmente aplicado por el banco (opcional)
  -- tipo de cambio SBS asignado automáticamente
  tc_fecha_dato date,
  tc_compra numeric(8,4),
  tc_venta numeric(8,4),
  tc_pendiente boolean not null default false,       -- true si aún no se publica el TC SBS de esa fecha
  categoria text,                                    -- gastos: comida, transporte, ...
  origen text,                                       -- ingresos: sueldo, DEHSE, contratos, otros
  descripcion text,
  transferencia_id uuid,                             -- une las dos patas de una transferencia/pago
  origen_registro text not null default 'web' check (origen_registro in ('web', 'telegram')),
  creado_en timestamptz not null default now(),
  efecto numeric(18,4) generated always as (
    case when tipo in ('ingreso','pago_tarjeta','transferencia_entrada','interes','deposito','venta_etf','dividendo')
         then monto_cuenta else -monto_cuenta end
  ) stored
);
create index on movimientos (cuenta_id, fecha);
create index on movimientos (transferencia_id);

-- ---------------------------------------------------------------------
-- ETFs, operaciones y dividendos
-- ---------------------------------------------------------------------
create table etfs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null,
  nombre text,
  distribucion distribucion_etf not null,
  moneda moneda not null default 'USD',
  unique (user_id, ticker)
);

create table operaciones_etf (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  etf_id uuid not null references etfs(id),
  cuenta_id uuid not null references cuentas(id),    -- broker
  tipo text not null check (tipo in ('compra', 'venta')),
  fecha date not null default hoy_lima(),
  cantidad numeric(18,6) not null check (cantidad > 0),
  precio numeric(18,6) not null check (precio > 0),
  comision numeric(18,4) not null default 0,
  moneda moneda not null default 'USD',
  tc_fecha_dato date,
  tc_compra numeric(8,4),
  tc_venta numeric(8,4),
  tc_pendiente boolean not null default false,
  -- ventas: la tasa y el impuesto los ingresas tú (la tasa de SUNAT varía)
  tasa_impuesto numeric(6,4),
  impuesto numeric(18,4),
  notas text,
  origen_registro text not null default 'web' check (origen_registro in ('web', 'telegram')),
  creado_en timestamptz not null default now()
);

create table dividendos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  etf_id uuid not null references etfs(id),
  cuenta_id uuid not null references cuentas(id),    -- broker donde se acredita
  fecha date not null default hoy_lima(),
  bruto numeric(18,4) not null check (bruto > 0),
  tasa_impuesto numeric(6,4) not null default 0,     -- se llena sola: 5 % si el ETF es distributivo
  impuesto numeric(18,4) not null default 0,
  neto numeric(18,4) not null default 0,
  moneda moneda not null default 'USD',
  tc_fecha_dato date,
  tc_compra numeric(8,4),
  tc_venta numeric(8,4),
  tc_pendiente boolean not null default false,
  origen_registro text not null default 'web' check (origen_registro in ('web', 'telegram')),
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Estado de las conversaciones del bot y avisos enviados (solo servicio)
-- ---------------------------------------------------------------------
create table bot_sesiones (
  chat_id bigint primary key,
  user_id uuid references auth.users(id) on delete cascade,
  flujo text,
  paso text,
  datos jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);

create table avisos_enviados (
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,
  referencia text not null,
  enviado_en timestamptz not null default now(),
  primary key (user_id, tipo, referencia)
);

-- =====================================================================
-- Triggers
-- =====================================================================

-- 1) Asigna el TC SBS (compra y venta) de la fecha de la operación.
--    Si la fecha no tiene dato (fin de semana o feriado) usa el último día hábil publicado.
--    Si la fecha es posterior al último dato publicado, queda pendiente y se completa luego.
create or replace function asignar_tipo_cambio() returns trigger
language plpgsql as $$
declare r tipo_cambio%rowtype; ultimo date;
begin
  select * into r from tipo_cambio where fecha <= NEW.fecha order by fecha desc limit 1;
  select max(fecha) into ultimo from tipo_cambio;
  if found then
    NEW.tc_fecha_dato := r.fecha;
    NEW.tc_compra := r.compra;
    NEW.tc_venta := r.venta;
  end if;
  -- Solo importa como "pendiente" si la operación es en dólares
  NEW.tc_pendiente := NEW.moneda = 'USD'
                      and (ultimo is null or NEW.fecha > ultimo)
                      and (NEW.tc_fecha_dato is distinct from NEW.fecha);
  return NEW;
end $$;

create trigger tc_movimientos before insert or update of fecha on movimientos
  for each row execute function asignar_tipo_cambio();
create trigger tc_operaciones before insert or update of fecha on operaciones_etf
  for each row execute function asignar_tipo_cambio();
create trigger tc_dividendos before insert or update of fecha on dividendos
  for each row execute function asignar_tipo_cambio();

-- 2) Calcula monto_cuenta (monto en la moneda de la cuenta).
--    USD -> PEN: usa tc_manual si lo pones; si no, TC SBS de venta.
--    PEN -> USD: usa tc_manual si lo pones; si no, TC SBS de compra.
create or replace function calcular_monto_cuenta() returns trigger
language plpgsql as $$
declare mc moneda;
begin
  select c.moneda into mc from cuentas c where c.id = NEW.cuenta_id;
  if mc is null then raise exception 'Cuenta no encontrada'; end if;
  if NEW.moneda = mc then
    NEW.monto_cuenta := NEW.monto;
  elsif NEW.moneda = 'USD' and mc = 'PEN' then
    NEW.monto_cuenta := round(NEW.monto * coalesce(NEW.tc_manual, NEW.tc_venta), 4);
  else
    NEW.monto_cuenta := round(NEW.monto / coalesce(NEW.tc_manual, NEW.tc_compra), 4);
  end if;
  if NEW.monto_cuenta is null then
    raise exception 'No hay tipo de cambio disponible para convertir este movimiento';
  end if;
  return NEW;
end $$;

-- Se ejecuta después del trigger de TC (los triggers corren por orden alfabético)
create trigger zz_monto_cuenta before insert or update on movimientos
  for each row execute function calcular_monto_cuenta();

-- 3) Dividendos: calcula impuesto/neto y genera el movimiento en el broker.
create or replace function procesar_dividendo() returns trigger
language plpgsql as $$
declare dist distribucion_etf; tasa numeric; tick text;
begin
  select e.distribucion, e.ticker into dist, tick from etfs e where e.id = NEW.etf_id;
  if dist = 'distributivo' then
    select coalesce(c.tasa_impuesto_dividendos, 0.05) into tasa
      from configuracion c where c.user_id = NEW.user_id;
    NEW.tasa_impuesto := coalesce(tasa, 0.05);
  else
    NEW.tasa_impuesto := 0;
  end if;
  NEW.impuesto := round(NEW.bruto * NEW.tasa_impuesto, 4);
  NEW.neto := NEW.bruto - NEW.impuesto;
  return NEW;
end $$;
create trigger a_procesar_dividendo before insert on dividendos
  for each row execute function procesar_dividendo();

create or replace function dividendo_a_movimiento() returns trigger
language plpgsql as $$
begin
  insert into movimientos (user_id, cuenta_id, tipo, fecha, monto, moneda, descripcion, origen_registro)
  values (NEW.user_id, NEW.cuenta_id, 'dividendo', NEW.fecha, NEW.neto, NEW.moneda,
          'Dividendo neto ' || (select ticker from etfs where id = NEW.etf_id), NEW.origen_registro);
  return NEW;
end $$;
create trigger b_dividendo_mov after insert on dividendos
  for each row execute function dividendo_a_movimiento();

-- 4) Operaciones de ETF: mueven el efectivo del broker.
create or replace function operacion_etf_a_movimiento() returns trigger
language plpgsql as $$
declare total numeric;
begin
  total := NEW.cantidad * NEW.precio;
  if NEW.tipo = 'compra' then
    insert into movimientos (user_id, cuenta_id, tipo, fecha, monto, moneda, descripcion, origen_registro)
    values (NEW.user_id, NEW.cuenta_id, 'compra_etf', NEW.fecha, total + NEW.comision, NEW.moneda,
            'Compra ' || (select ticker from etfs where id = NEW.etf_id), NEW.origen_registro);
  else
    insert into movimientos (user_id, cuenta_id, tipo, fecha, monto, moneda, descripcion, origen_registro)
    values (NEW.user_id, NEW.cuenta_id, 'venta_etf', NEW.fecha, greatest(total - NEW.comision, 0.0001), NEW.moneda,
            'Venta ' || (select ticker from etfs where id = NEW.etf_id), NEW.origen_registro);
  end if;
  return NEW;
end $$;
create trigger b_operacion_mov after insert on operaciones_etf
  for each row execute function operacion_etf_a_movimiento();

-- 5) Completa los TC pendientes cuando la SBS ya publicó el dato (lo llama la función sync).
create or replace function actualizar_tc_pendientes() returns int
language plpgsql security definer as $$
declare n int := 0; k int;
begin
  update movimientos m set fecha = m.fecha where m.tc_pendiente;       -- reactiva los triggers
  get diagnostics k = row_count; n := n + k;
  update operaciones_etf o set fecha = o.fecha where o.tc_pendiente;
  get diagnostics k = row_count; n := n + k;
  update dividendos d set fecha = d.fecha where d.tc_pendiente;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- =====================================================================
-- Funciones de negocio
-- =====================================================================

-- Transferencia entre cuentas propias, o pago de tarjeta de crédito.
-- Crea dos movimientos enlazados (salida y entrada). No cuenta como gasto ni ingreso.
-- Si las monedas difieren, pasa monto_destino (lo que realmente llegó) y se guarda el TC implícito.
create or replace function registrar_transferencia(
  p_origen uuid, p_destino uuid, p_monto_origen numeric,
  p_monto_destino numeric default null, p_fecha date default hoy_lima(),
  p_descripcion text default null, p_origen_registro text default 'web',
  p_user_id uuid default auth.uid()
) returns uuid
language plpgsql as $$
declare
  co cuentas%rowtype; cd cuentas%rowtype; tid uuid := gen_random_uuid();
  md numeric; tc_imp numeric; tipo_entrada tipo_movimiento;
begin
  select * into co from cuentas where id = p_origen and user_id = p_user_id;
  select * into cd from cuentas where id = p_destino and user_id = p_user_id;
  if co.id is null or cd.id is null then raise exception 'Cuenta de origen o destino no válida'; end if;
  if co.id = cd.id then raise exception 'Origen y destino no pueden ser la misma cuenta'; end if;
  md := coalesce(p_monto_destino, p_monto_origen);
  if co.moneda <> cd.moneda and p_monto_destino is null then
    raise exception 'Las cuentas tienen distinta moneda: indica el monto que llegó al destino';
  end if;
  if co.moneda <> cd.moneda then
    tc_imp := round(greatest(p_monto_origen, md) / least(p_monto_origen, md), 4);
  end if;
  tipo_entrada := case when cd.tipo = 'credito' then 'pago_tarjeta' else 'transferencia_entrada' end;

  insert into movimientos (user_id, cuenta_id, tipo, fecha, monto, moneda, tc_manual, descripcion, transferencia_id, origen_registro)
  values (p_user_id, co.id, 'transferencia_salida', p_fecha, p_monto_origen, co.moneda, tc_imp,
          coalesce(p_descripcion, 'Transferencia a ' || cd.nombre), tid, p_origen_registro);
  insert into movimientos (user_id, cuenta_id, tipo, fecha, monto, moneda, tc_manual, descripcion, transferencia_id, origen_registro)
  values (p_user_id, cd.id, tipo_entrada, p_fecha, md, cd.moneda, tc_imp,
          coalesce(p_descripcion, case when cd.tipo = 'credito' then 'Pago desde ' else 'Transferencia desde ' end || co.nombre),
          tid, p_origen_registro);
  return tid;
end $$;

-- =====================================================================
-- Vistas (security_invoker: respetan el RLS del usuario que consulta)
-- =====================================================================

create or replace view v_saldos with (security_invoker = true) as
select c.id as cuenta_id, c.user_id, c.tipo, c.nombre, c.banco, c.moneda,
       c.saldo_inicial + coalesce(sum(m.efecto) filter (where m.fecha >= c.fecha_saldo_inicial), 0) as saldo
from cuentas c
left join movimientos m on m.cuenta_id = c.id
where c.activa
group by c.id;

-- Resumen de tarjetas de crédito: ciclo abierto, ciclo cerrado y próximas fechas
create or replace view v_tarjetas_resumen with (security_invoker = true) as
with base as (
  select c.id, c.user_id, c.nombre, c.moneda, c.dia_corte, c.dia_pago, c.linea_credito,
         fecha_cierre_ciclo(hoy_lima(), c.dia_corte) as cierre_abierto,
         -(c.saldo_inicial + coalesce((select sum(m.efecto) from movimientos m
              where m.cuenta_id = c.id and m.fecha >= c.fecha_saldo_inicial), 0)) as deuda_total
  from cuentas c where c.tipo = 'credito' and c.activa
), g as (
  select b.*,
         coalesce((select sum(m.monto_cuenta) from movimientos m
                   where m.cuenta_id = b.id and m.tipo in ('gasto','comision')
                     and fecha_cierre_ciclo(m.fecha, b.dia_corte) = b.cierre_abierto), 0) as gasto_ciclo_abierto
  from base b
)
select id as cuenta_id, user_id, nombre, moneda, linea_credito,
       deuda_total,
       gasto_ciclo_abierto,
       greatest(deuda_total - gasto_ciclo_abierto, 0) as deuda_ciclo_cerrado,
       cierre_abierto as proximo_corte,
       fecha_pago_ciclo(cierre_abierto, dia_corte, dia_pago) as pago_ciclo_abierto,
       fecha_cierre_ciclo((cierre_abierto - interval '1 month')::date, dia_corte) as ultimo_corte,
       fecha_pago_ciclo(fecha_cierre_ciclo((cierre_abierto - interval '1 month')::date, dia_corte), dia_corte, dia_pago) as pago_ciclo_cerrado,
       fecha_pago_ciclo(fecha_cierre_ciclo((cierre_abierto - interval '1 month')::date, dia_corte), dia_corte, dia_pago) - hoy_lima() as dias_para_pago
from g;

-- Posición por ETF (costo promedio ponderado de las compras; referencial)
create or replace view v_posiciones_etf with (security_invoker = true) as
select e.id as etf_id, e.user_id, e.ticker, e.nombre, e.distribucion,
       coalesce(sum(case when o.tipo = 'compra' then o.cantidad else -o.cantidad end), 0) as cantidad,
       case when coalesce(sum(o.cantidad) filter (where o.tipo = 'compra'), 0) > 0
            then sum(o.cantidad * o.precio + o.comision) filter (where o.tipo = 'compra')
                 / sum(o.cantidad) filter (where o.tipo = 'compra') end as costo_promedio_usd,
       coalesce(sum(o.cantidad * o.precio * o.tc_venta) filter (where o.tipo = 'compra'), 0) as costo_total_compras_pen
from etfs e left join operaciones_etf o on o.etf_id = e.id
group by e.id;

-- Avisos que toca enviar hoy: tarjetas con pago dentro de N días y deuda cerrada
create or replace view v_avisos_pago with (security_invoker = true) as
select t.user_id, t.cuenta_id, t.nombre, t.moneda, t.deuda_ciclo_cerrado, t.pago_ciclo_cerrado as fecha_pago, t.dias_para_pago
from v_tarjetas_resumen t
join configuracion cfg on cfg.user_id = t.user_id
where t.deuda_ciclo_cerrado > 0 and t.dias_para_pago = cfg.dias_aviso_pago;

-- =====================================================================
-- Seguridad (RLS)
-- =====================================================================
alter table configuracion   enable row level security;
alter table tipo_cambio     enable row level security;
alter table cuentas         enable row level security;
alter table tasas_cuenta    enable row level security;
alter table movimientos     enable row level security;
alter table etfs            enable row level security;
alter table operaciones_etf enable row level security;
alter table dividendos      enable row level security;
alter table bot_sesiones    enable row level security;   -- sin políticas: solo service role
alter table avisos_enviados enable row level security;   -- sin políticas: solo service role

create policy propio on configuracion for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy propio on cuentas for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy propio on etfs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy propio on tasas_cuenta for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from cuentas c where c.id = cuenta_id and c.user_id = auth.uid()));
create policy propio on movimientos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from cuentas c where c.id = cuenta_id and c.user_id = auth.uid()));
create policy propio on operaciones_etf for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from cuentas c where c.id = cuenta_id and c.user_id = auth.uid())
    and exists (select 1 from etfs e where e.id = etf_id and e.user_id = auth.uid()));
create policy propio on dividendos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from cuentas c where c.id = cuenta_id and c.user_id = auth.uid())
    and exists (select 1 from etfs e where e.id = etf_id and e.user_id = auth.uid()));

-- Tipo de cambio: lectura para usuarios autenticados; escritura solo service role
create policy lectura on tipo_cambio for select to authenticated using (true);

-- Funciones que solo debe usar el servicio
revoke all on function actualizar_tc_pendientes() from public, anon, authenticated;
