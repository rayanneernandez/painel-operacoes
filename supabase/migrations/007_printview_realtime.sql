-- Realtime never worked for the Monitoramento tables -- they were never
-- added to the `supabase_realtime` publication, so postgres_changes
-- subscriptions in the dashboard silently received nothing. Actions like
-- "Revogar acesso" wrote to the DB fine but only showed up after a manual
-- page reload. Wrapped in DO blocks so re-running this migration is safe
-- even if a table is already a publication member.
alter table printview_devices replica identity full;

do $$
begin
  alter publication supabase_realtime add table printview_devices;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table printview_folders;
exception
  when duplicate_object then null;
end $$;
