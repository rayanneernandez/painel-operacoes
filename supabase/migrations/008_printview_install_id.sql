-- Cloned/imaged machines (common on POS terminals) can share the same
-- Windows hostname even though they're physically different computers --
-- the old uniqueness check on `hostname` incorrectly blocked enrolling a
-- second distinct machine that happened to clone the same hostname.
--
-- Fix: enroll() now generates a random install_id client-side (persisted
-- locally alongside device_id/token) and that's what uniqueness is checked
-- against instead. hostname stays as informational metadata only.
alter table printview_devices add column if not exists install_id uuid;

drop index if exists printview_devices_hostname_active_idx;

create unique index if not exists printview_devices_install_id_active_idx
  on printview_devices (install_id) where status = 'active';
