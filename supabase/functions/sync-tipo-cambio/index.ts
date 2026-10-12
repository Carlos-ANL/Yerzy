// Edge Function: descarga el tipo de cambio SBS (compra y venta) y lo guarda en `tipo_cambio`.
// Despliegue:  supabase functions deploy sync-tipo-cambio --no-verify-jwt
// Secretos:    supabase secrets set SYNC_SECRET=<clave-larga-al-azar>
// Uso:         GET  .../functions/v1/sync-tipo-cambio                      (últimos 21 días)
//              GET  .../functions/v1/sync-tipo-cambio?desde=2024-01-01&hasta=2026-10-11   (histórico)
// Cabecera obligatoria: x-sync-secret: <SYNC_SECRET>
import { createClient } from "npm:@supabase/supabase-js@2";
import { parsearRespuestaBCRP, urlBCRP } from "./bcrp.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const secreto = Deno.env.get("SYNC_SECRET");
  if (!secreto || req.headers.get("x-sync-secret") !== secreto) {
    return new Response("No autorizado", { status: 401 });
  }

  const url = new URL(req.url);
  const hoy = new Date();
  const hasta = url.searchParams.get("hasta") ?? iso(hoy);
  const desde = url.searchParams.get("desde") ?? iso(new Date(hoy.getTime() - 21 * 86400000));
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  if (!fecha.test(desde) || !fecha.test(hasta)) {
    return new Response("Formato de fecha inválido (usa YYYY-MM-DD)", { status: 400 });
  }

  const resp = await fetch(urlBCRP(desde, hasta));
  if (!resp.ok) return new Response(`BCRP respondió ${resp.status}`, { status: 502 });
  const filas = parsearRespuestaBCRP(await resp.json());

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (filas.length > 0) {
    const { error } = await supabase
      .from("tipo_cambio")
      .upsert(filas.map((f) => ({ ...f, actualizado_en: new Date().toISOString() })), { onConflict: "fecha" });
    if (error) return new Response(`Error guardando: ${error.message}`, { status: 500 });
  }

  // Completa las operaciones que estaban esperando el dato de su fecha
  const { data: actualizadas, error: e2 } = await supabase.rpc("actualizar_tc_pendientes");
  if (e2) return new Response(`Error actualizando pendientes: ${e2.message}`, { status: 500 });

  return Response.json({
    desde, hasta,
    dias_guardados: filas.length,
    ultima_fecha: filas.at(-1)?.fecha ?? null,
    operaciones_revisadas: actualizadas,
  });
});
