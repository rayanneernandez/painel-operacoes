-- Monitoramento de telas (PrintView agent) -- screenshot-monitoring devices
-- for employee workstations. Prefixed `printview_` throughout: this project
-- already has an unrelated `public.devices` table (DisplayForce signage
-- players, keyed by store_id/mac_address) that must not be touched.
--
-- No Supabase Auth session exists in this app (custom users-table login via
-- anon key), so access here follows the same model as the rest of this
-- project: RLS grants to `anon`, with real authorization handled by the
-- app's own permission flag (`view_monitoring`) gating the route/menu.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists printview_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists printview_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  folder_id uuid references printview_folders(id) on delete set null,
  hostname text not null,
  os_user text not null,
  last_ip text,
  local_ip text,
  connection_type text,
  latest_screenshot_path text,
  token_hash text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_heartbeat_at timestamptz,
  last_capture_at timestamptz,
  capture_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists printview_devices_folder_id_idx on printview_devices (folder_id);
create index if not exists printview_devices_last_heartbeat_at_idx on printview_devices (last_heartbeat_at);
create index if not exists printview_devices_name_trgm_idx on printview_devices using gin (name gin_trgm_ops);
create unique index if not exists printview_devices_hostname_active_idx on printview_devices (hostname) where status = 'active';

create table if not exists printview_enroll_events (
  id uuid primary key default gen_random_uuid(),
  device_name text,
  hostname text,
  os_user text,
  ip text,
  success boolean not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists printview_ingest_failures (
  id uuid primary key default gen_random_uuid(),
  device_id uuid,
  reason text,
  ip text,
  created_at timestamptz not null default now()
);

drop view if exists printview_device_status;
create view printview_device_status
with (security_invoker = true) as
select
  d.id,
  d.name,
  d.folder_id,
  d.hostname,
  d.os_user,
  d.last_ip,
  d.local_ip,
  d.connection_type,
  d.latest_screenshot_path,
  d.status,
  d.last_heartbeat_at,
  d.last_capture_at,
  d.capture_count,
  d.created_at,
  f.name as folder_name,
  (d.last_heartbeat_at is null or now() - d.last_heartbeat_at > interval '15 minutes') as is_offline
from printview_devices d
left join printview_folders f on f.id = d.folder_id;

alter table printview_folders enable row level security;
alter table printview_devices enable row level security;
alter table printview_enroll_events enable row level security;
alter table printview_ingest_failures enable row level security;

drop policy if exists "anon read folders" on printview_folders;
create policy "anon read folders" on printview_folders for select to anon using (true);
drop policy if exists "anon write folders" on printview_folders;
create policy "anon write folders" on printview_folders for insert to anon with check (true);
drop policy if exists "anon update folders" on printview_folders;
create policy "anon update folders" on printview_folders for update to anon using (true) with check (true);
drop policy if exists "anon delete folders" on printview_folders;
create policy "anon delete folders" on printview_folders for delete to anon using (true);

drop policy if exists "anon read devices" on printview_devices;
create policy "anon read devices" on printview_devices for select to anon using (true);
drop policy if exists "anon update devices" on printview_devices;
create policy "anon update devices" on printview_devices for update to anon using (true) with check (true);
-- Column-level privilege: the app's UI can move a device between folders,
-- rename it, or revoke/reactivate it -- never touch token_hash, counters,
-- or heartbeat timestamps (those only change via the enroll/ingest
-- functions, which run as service_role and bypass RLS entirely).
revoke update on printview_devices from anon;
grant select, update (name, folder_id, status) on printview_devices to anon;
grant insert, delete on printview_folders to anon;
grant update on printview_folders to anon;

drop policy if exists "anon read enroll_events" on printview_enroll_events;
create policy "anon read enroll_events" on printview_enroll_events for select to anon using (true);
drop policy if exists "anon read ingest_failures" on printview_ingest_failures;
create policy "anon read ingest_failures" on printview_ingest_failures for select to anon using (true);

insert into storage.buckets (id, name, public)
values ('printview_screenshots', 'printview_screenshots', false)
on conflict (id) do nothing;

drop policy if exists "anon read printview screenshot objects" on storage.objects;
create policy "anon read printview screenshot objects"
on storage.objects for select
to anon
using (bucket_id = 'printview_screenshots');
