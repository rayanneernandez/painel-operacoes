create extension if not exists pgcrypto;

create table if not exists public.monitoring_whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  store_id uuid,
  scope_type text not null default 'network',
  responsible_name text not null,
  phone_number text not null,
  phone_e164 text not null,
  enabled boolean not null default true,
  receive_offline_alerts boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitoring_whatsapp_contacts_scope_check
    check (scope_type in ('network', 'store'))
);

create index if not exists monitoring_whatsapp_contacts_client_idx
  on public.monitoring_whatsapp_contacts (client_id, enabled, receive_offline_alerts);

create index if not exists monitoring_whatsapp_contacts_store_idx
  on public.monitoring_whatsapp_contacts (store_id);

create table if not exists public.device_offline_alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  store_id uuid,
  device_id uuid not null,
  alert_type text not null default 'offline',
  status text not null default 'pending',
  client_name text,
  store_name text,
  device_name text not null,
  mac_address text,
  first_detected_at timestamptz not null default now(),
  last_seen_offline_at timestamptz,
  last_seen_online_at timestamptz,
  notified_at timestamptz,
  notified_contact_count integer not null default 0,
  resolution_sent_at timestamptz,
  resolution_contact_count integer not null default 0,
  resolved_at timestamptz,
  notification_attempts integer not null default 0,
  last_notification_error text,
  offline_reason text,
  offline_reason_updated_at timestamptz,
  offline_reason_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_offline_alerts_type_check
    check (alert_type in ('offline')),
  constraint device_offline_alerts_status_check
    check (status in ('pending', 'notified', 'resolved', 'cancelled'))
);

create unique index if not exists device_offline_alerts_active_unique_idx
  on public.device_offline_alerts (device_id, alert_type)
  where resolved_at is null;

create index if not exists device_offline_alerts_client_idx
  on public.device_offline_alerts (client_id, created_at desc);

create index if not exists device_offline_alerts_status_idx
  on public.device_offline_alerts (status, notified_at, resolved_at);

alter table public.monitoring_whatsapp_contacts enable row level security;
alter table public.device_offline_alerts enable row level security;

drop policy if exists "Public Access Monitoring WhatsApp Contacts" on public.monitoring_whatsapp_contacts;
create policy "Public Access Monitoring WhatsApp Contacts"
  on public.monitoring_whatsapp_contacts
  for all
  using (true)
  with check (true);

drop policy if exists "Public Access Device Offline Alerts" on public.device_offline_alerts;
create policy "Public Access Device Offline Alerts"
  on public.device_offline_alerts
  for all
  using (true)
  with check (true);
