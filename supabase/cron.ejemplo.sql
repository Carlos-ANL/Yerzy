-- Programación diaria del tipo de cambio SBS (ejecutar en el SQL Editor de Supabase, UNA vez).
-- Requiere las extensiones pg_cron y pg_net (Database > Extensions).
-- Reemplaza <PROYECTO> y <SYNC_SECRET> (el mismo que pusiste con `supabase secrets set`).
--
-- 01:00 UTC = 8:00 pm en Perú (UTC-5). Corre todos los días: cuando el BCRP publica un día
-- atrasado, las operaciones "pendientes" se completan solas.

select cron.schedule(
  'sync-tipo-cambio-diario',
  '0 1 * * *',
  $$
  select net.http_get(
    url := 'https://<PROYECTO>.supabase.co/functions/v1/sync-tipo-cambio',
    headers := jsonb_build_object('x-sync-secret', '<SYNC_SECRET>')
  );
  $$
);

-- Carga inicial del histórico (una sola vez), por ejemplo desde 2024:
-- select net.http_get(
--   url := 'https://<PROYECTO>.supabase.co/functions/v1/sync-tipo-cambio?desde=2024-01-01',
--   headers := jsonb_build_object('x-sync-secret', '<SYNC_SECRET>')
-- );
