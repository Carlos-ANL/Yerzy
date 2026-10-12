# Mis inversiones

Aplicación **personal y privada** para controlar tarjetas (crédito y débito), cuentas de alto
rendimiento, ETFs y dividendos, con el tipo de cambio SBS guardado en cada operación.

- **Base de datos y login:** Supabase (Postgres + Auth + RLS).
- **Página:** React + Vite + TypeScript (carpeta `web/`).
- **Tipo de cambio SBS:** Edge Function de Supabase (`supabase/functions/sync-tipo-cambio`).
- **Telegram y Excel:** pendientes (fase 3). Ver `HANDOFF.md`.

> Mantén el repositorio de GitHub **privado**. Las claves nunca van en el código.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Esquema SQL, seguridad, tipo de cambio SBS, página base (login, resumen, registrar, movimientos, cuentas) | Hecha y probada |
| 2 | Pantallas de ETFs, dividendos, ventas e interés por mes | Pendiente (la base de datos ya está lista) |
| 3 | Bot de Telegram (avisos 7 pm, comandos guiados, Excel) | Pendiente |
| 4 | Dashboard y pulido | Pendiente |

## Puesta en marcha

1. **Crear el proyecto en Supabase** y copiar la URL y la `anon key`.
2. **Aplicar el esquema:** pega `supabase/migrations/0001_esquema_base.sql` en el SQL Editor y ejecútalo.
3. **Crear tu usuario** en Authentication > Users (correo y contraseña) y luego **apagar el registro
   público** (Authentication > Sign In / Providers > desactivar "Allow new users to sign up").
4. **Tipo de cambio SBS:**
   ```bash
   supabase secrets set SYNC_SECRET=<clave-larga-al-azar>
   supabase functions deploy sync-tipo-cambio --no-verify-jwt
   ```
   Luego programa la ejecución diaria y la carga del histórico con `supabase/cron.ejemplo.sql`.
5. **Página:**
   ```bash
   cd web
   cp .env.example .env.local     # completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
   npm install
   npm run dev
   ```
   Para publicarla, usa Vercel, Netlify o Cloudflare Pages con esas dos variables de entorno.

## Cómo funciona (resumen)

- **Un solo libro de movimientos** (`movimientos`): el saldo de cada cuenta siempre se calcula sumando
  sus movimientos, así la página, el Excel y Telegram muestran las mismas cifras.
- **Tarjeta de crédito:** un gasto hasta el día de corte (inclusive) entra al ciclo que cierra ese día;
  desde el día siguiente empieza el ciclo nuevo. La fecha de pago es el día de pago del mes siguiente
  (o del mismo mes si el día de pago es mayor que el de corte). La vista `v_tarjetas_resumen` muestra
  la deuda del ciclo cerrado, el gasto del ciclo abierto y las fechas.
- **Transferencias y pagos de tarjeta:** `registrar_transferencia(...)` crea dos movimientos enlazados.
  No cuentan como gasto ni como ingreso. Si las monedas difieren, se indica el monto que llegó y se
  guarda el tipo de cambio implícito.
- **Tipo de cambio:** cada movimiento, operación de ETF y dividendo en dólares guarda la compra y la
  venta SBS de su fecha, y la fecha del dato usado. Fin de semana o feriado: usa el último día
  publicado. Si el dato aún no existe, queda **provisional** y se completa solo cuando se publica.
- **Dividendos:** ETF distributivo descuenta la tasa configurada (5 %) y guarda bruto, impuesto y neto;
  acumulativo no descuenta. El neto entra al saldo del broker.
- **Ventas de ETF:** la tasa de impuesto y el monto los ingresas tú (varían según tu caso).

## Advertencias

- El tipo de cambio sale de la API pública del BCRP (series de "Sistema bancario SBS"), que publica con
  **2 a 3 días de retraso**. Por eso existe el estado "provisional".
- Qué tipo de cambio (compra o venta) y de qué día corresponde usar para declarar debe confirmarlo tu
  contador. La app guarda ambos y la fecha del dato para que puedas elegir.
- Los saldos y reportes son de control personal, no sustituyen la declaración tributaria.
