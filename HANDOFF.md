# HANDOFF — continuar el proyecto con otra IA

Última actualización: 11/10/2026. Autor del encargo: Eduardo (Lima, Perú). Idioma: **español**.
Preferencia del usuario: **consultar antes de tomar acciones autónomas grandes**.

## 1. Qué se quiere construir

App **personal y privada** (repositorio privado, un solo usuario) para controlar:

1. **Tarjetas:** crédito (corte día 10, pago día 5 del mes siguiente, múltiples tarjetas a futuro),
   débito, y cuentas de alto rendimiento (tasa variable, interés compuesto mensual, hoy en soles y a
   futuro también en dólares).
2. **ETFs:** compras, ventas y dividendos. Él ingresa nombre, valor, cantidad y broker. Cada operación
   guarda fecha y **tipo de cambio SBS (compra y venta) del día**, con precisión porque lo usa para declarar.
3. **Dividendos:** cada ETF es *distributivo* o *acumulativo*. Si es distributivo, al registrar el
   dividendo se descuenta el **5 %** (SUNAT) y se muestra bruto, impuesto y neto.
4. **Ventas de ETF:** SUNAT aplica un porcentaje que él dice que va de 8 % a 30 %: la app solo debe
   ofrecer campos para que **él ingrese** la tasa y el impuesto (no calcular solo).
5. **Ingresos y transferencias:** agregar saldo (sueldo, DEHSE, contratos, otros) a débito, alto
   rendimiento y broker; transferir entre cuentas propias; pagar tarjeta de crédito (total o parcial).
6. **Telegram:** el bot hace lo mismo que los formularios de la página, como **flujo guiado paso a paso**
   con botones (elegir tarjeta/broker, monto, moneda, categoría, confirmar Guardar/Cancelar). Debe
   permitir consultar (`/deuda`, `/resumen`) y enviar el **Excel adjunto**. Aviso de pago de tarjeta
   **3 días antes, a las 7:00 pm hora de Perú**. Solo responde al ID de Telegram de Eduardo.
7. **Excel organizado** exportable desde la página y por Telegram.
8. **Frontend y autenticación con Supabase.** Repositorio de GitHub **privado**.

## 2. Qué ya está hecho (carpeta `inversiones-app/`)

| Archivo | Qué es | Verificado |
|---|---|---|
| `supabase/migrations/0001_esquema_base.sql` | Tablas, triggers, funciones, vistas y RLS | Sí, en Postgres 16 local con datos de prueba |
| `supabase/functions/sync-tipo-cambio/` | Edge Function (Deno) que baja el TC SBS del BCRP y lo guarda | Parser probado con respuesta real; la función no se desplegó |
| `supabase/cron.ejemplo.sql` | Programa diaria 8 pm Perú + carga de histórico | No ejecutado |
| `web/` | React + Vite + TS: login, Resumen, Registrar, Movimientos, Cuentas | Compila (`npm run build`); no se probó contra un Supabase real |

### Decisiones de diseño importantes
- **Libro único `movimientos`**: saldo = `saldo_inicial` + suma de `efecto` (columna generada). En tarjetas
  de crédito el saldo es negativo (deuda). Tipos con efecto positivo: ingreso, pago_tarjeta,
  transferencia_entrada, interes, deposito, venta_etf, dividendo. Los demás restan.
- `movimientos.moneda` puede diferir de la moneda de la cuenta (ej. gasto en USD con tarjeta en soles):
  `monto_cuenta` se calcula por trigger con `tc_manual` o, si no hay, TC venta (USD→PEN) o compra (PEN→USD).
- **TC por trigger** (`asignar_tipo_cambio`): toma el último dato ≤ fecha. Si la fecha es posterior al
  último dato publicado y la operación es en USD, queda `tc_pendiente = true`;
  `actualizar_tc_pendientes()` (la llama la Edge Function) lo completa.
- **Ciclo de tarjeta:** `fecha_cierre_ciclo`, `fecha_pago_ciclo`, vista `v_tarjetas_resumen`
  (supone que los pagos se aplican primero a la deuda más antigua).
- **Dividendos y operaciones de ETF** generan solos su movimiento en el broker (triggers).
- **Seguridad:** RLS por `user_id` en todas las tablas; `tipo_cambio` solo lectura para usuarios;
  `bot_sesiones` y `avisos_enviados` sin políticas (solo `service_role`).
- Fuente del TC: API BCRP, series **PD04639PD (compra)** y **PD04640PD (venta)**, "Sistema bancario SBS":
  `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04639PD-PD04640PD/json/AAAA-MM-DD/AAAA-MM-DD/esp`
  (los días sin dato vienen como "n.d."; el BCRP se retrasa 2–3 días). La página de la SBS carga con
  JavaScript y no se pudo leer directamente.

### Supuestos que tomé (el usuario no los respondió; confirmar o cambiar)
- Saldo inicial por cuenta con fecha. Brokers son cuentas en USD con saldo en efectivo.
- Categorías de gasto: comida, transporte, servicios, salud, ocio, compras, otros.
- Orígenes de ingreso: sueldo, DEHSE, contratos, otros.
- Pagos de tarjeta totales o parciales.
- Hora 7:00 pm = hora de Perú (UTC-5; el cron corre a la 01:00 UTC).
- Aviso de corte (día 10): quedó sin confirmar; el pedido explícito es solo 3 días antes del pago.

## 3. Qué falta (en orden)

1. **Probar la fase 1 contra un Supabase real:** aplicar la migración, crear el usuario, desactivar el
   registro público, desplegar `sync-tipo-cambio`, cargar histórico y probar la página.
2. **Pantallas de ETFs (página):** alta de ETF (ticker, nombre, distributivo/acumulativo), registrar
   compra/venta (broker, cantidad, precio, comisión; en ventas: tasa e impuesto manuales), registrar
   dividendo (el bruto; el resto lo calculan los triggers), posiciones (`v_posiciones_etf`) y
   dividendos. Mostrar TC usado y la marca "provisional".
3. **Alto rendimiento:** pantalla con saldo, tasa vigente (`tasas_cuenta`), interés ganado por mes
   (movimientos tipo `interes`) y un estimado para comparar. El usuario registra el interés real.
4. **Bot de Telegram** (Edge Function con webhook, `bot_sesiones` para el estado de cada flujo):
   - Validar `chat.id == configuracion.telegram_chat_id`; ignorar a cualquier otro.
   - Flujos guiados: `/gasto`, `/ingreso`, `/interes`, `/transferir` (incluye pago de tarjeta),
     `/compra`, `/venta`, `/dividendo`; consultas `/deuda`, `/resumen`, `/proximos`; `/excel`; `/cancelar`.
   - Resumen con botones Guardar/Cancelar antes de insertar; usar `origen_registro = 'telegram'`.
   - Las inserciones deben reutilizar las mismas tablas y funciones (`registrar_transferencia`, etc.).
5. **Aviso de pago:** función programada (pg_cron + pg_net) a las 7 pm Perú que lea `v_avisos_pago`
   (tarjetas con deuda cerrada y `dias_para_pago = dias_aviso_pago`) y envíe por Telegram, registrando en
   `avisos_enviados` para no repetir.
6. **Excel** (hojas, con encabezados de color, filtros, fila fija, formatos de moneda y totales con
   fórmulas): Resumen · Tarjetas · Gastos (crédito y débito, con TC) · Alto Rendimiento · ETFs
   (posiciones) · Operaciones · Dividendos · Tipo de Cambio · **Para Declarar** (todo en soles por año).
   Generarlo en una Edge Function (p. ej. con exceljs) y enviarlo como adjunto por Telegram; en la
   página, botón de descarga. Opción por módulo o por año.
7. **Dashboard y pulido:** patrimonio en PEN y USD, ganancias del mes, próximos vencimientos; edición y
   anulación de movimientos (hoy solo se insertan); TC manual para fechas que el BCRP aún no publica.
8. **Publicar** la página (Vercel/Netlify/Cloudflare Pages) con las variables `VITE_*`; repositorio privado.

## 4. Pendientes y cuidados
- La conversión tributaria (compra o venta, qué día) debe confirmarla un contador. Hay fuentes que
  dicen "promedio ponderado venta del día de la operación" y otras "del día anterior". La app guarda
  compra, venta y fecha del dato para poder elegir; no fijar la regla sin confirmación.
- No guardar claves en el repositorio. Token del bot, `SUPABASE_SERVICE_ROLE_KEY` y `SYNC_SECRET`
  solo como secretos de Supabase.
- No hay edición ni borrado de movimientos todavía: al agregarlos, mantener la integridad de las dos
  patas de una transferencia (`transferencia_id`).

## 5. Prompt para pegar en otra IA

```text
Eres un ingeniero de software senior. Continúa un proyecto existente: una app personal y privada
de control de inversiones para Eduardo (Lima, Perú). Responde y comenta en español. Antes de hacer
cambios grandes o irreversibles, consúltame.

Contexto: tengo una carpeta "inversiones-app" con README.md, HANDOFF.md, supabase/migrations/
0001_esquema_base.sql (esquema Postgres con RLS, triggers de tipo de cambio SBS, ciclos de tarjeta
de crédito, transferencias, dividendos y vistas), supabase/functions/sync-tipo-cambio (Edge Function
Deno que baja el tipo de cambio SBS de la API del BCRP, series PD04639PD y PD04640PD) y web/
(React + Vite + TypeScript con login de Supabase, Resumen, Registrar, Movimientos y Cuentas).
Lee primero HANDOFF.md completo y luego el SQL; respeta sus decisiones de diseño.

Reglas del negocio:
- Tarjeta de crédito: corte día 10, pago día 5 del mes siguiente; deben poder agregarse más tarjetas.
  También hay tarjetas de débito y cuentas de alto rendimiento (tasa variable, interés compuesto
  mensual; hoy en soles, a futuro también en dólares) y brokers (cuentas en dólares).
- Cada operación en dólares guarda fecha y tipo de cambio SBS (compra y venta) del día; si el dato aún
  no existe queda provisional y se completa luego. Es para declarar impuestos, así que la precisión importa.
- ETFs: él ingresa nombre, valor, cantidad y broker. Cada ETF es distributivo o acumulativo. Los
  dividendos de ETFs distributivos descuentan 5 % para SUNAT (tasa configurable); los acumulativos no.
  En ventas, la tasa de impuesto la ingresa él manualmente.
- Se pueden agregar ingresos, transferencias entre cuentas y pagos (totales o parciales) de tarjeta.
- Todo lo de la página debe poder hacerse también por Telegram como flujo guiado con botones y
  confirmación, y el bot debe enviar el Excel adjunto. Solo responde a mi ID de Telegram.
- Aviso de pago de tarjeta por Telegram 3 días antes a las 7:00 pm hora de Perú.

Tareas pendientes, en este orden (detalle en la sección 3 de HANDOFF.md): 1) probar la fase 1 contra
un proyecto Supabase real; 2) pantallas de ETFs, ventas y dividendos; 3) pantalla de alto rendimiento;
4) bot de Telegram (Edge Function + tabla bot_sesiones); 5) aviso de pago programado; 6) exportación a
Excel organizada (hojas: Resumen, Tarjetas, Gastos, Alto Rendimiento, ETFs, Operaciones, Dividendos,
Tipo de Cambio, Para Declarar); 7) dashboard, edición/anulación de movimientos; 8) despliegue.

Empieza confirmando que entendiste el estado actual y propón el plan de la tarea 1. No pegues claves en
el código ni en el repositorio.
```
