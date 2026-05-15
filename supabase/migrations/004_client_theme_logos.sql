alter table if exists public.clients
  add column if not exists logo_url_light text,
  add column if not exists logo_url_dark text;
