alter table if exists public.device_offline_alerts
  add column if not exists last_notification_sent_at timestamptz;

update public.device_offline_alerts
set last_notification_sent_at = coalesce(last_notification_sent_at, notified_at)
where notified_at is not null
  and last_notification_sent_at is null;

create index if not exists device_offline_alerts_last_notification_sent_idx
  on public.device_offline_alerts (client_id, resolved_at, last_notification_sent_at);
