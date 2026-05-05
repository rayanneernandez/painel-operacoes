alter table if exists public.device_offline_alerts
  add column if not exists offline_reason text,
  add column if not exists offline_reason_updated_at timestamptz,
  add column if not exists offline_reason_sent_at timestamptz;
