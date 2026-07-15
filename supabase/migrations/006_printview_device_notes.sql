-- Editable description/notes on printview_devices, plus letting the dashboard
-- rename a device (name was already anon-updatable; description/notes need
-- the same column-level grant added).
alter table printview_devices add column if not exists description text;
alter table printview_devices add column if not exists notes text;

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
  d.description,
  d.notes,
  d.status,
  d.last_heartbeat_at,
  d.last_capture_at,
  d.capture_count,
  d.created_at,
  f.name as folder_name,
  (d.last_heartbeat_at is null or now() - d.last_heartbeat_at > interval '15 minutes') as is_offline
from printview_devices d
left join printview_folders f on f.id = d.folder_id;

grant update (name, folder_id, status, description, notes) on printview_devices to anon;
