-- ============================================================
-- Execute no Supabase > SQL Editor
-- Objetivo:
-- 1. Salvar status de campanha de forma consistente
-- 2. Normalizar display_count para não ficar nulo
-- 3. Expor uma view pronta para o dashboard
-- ============================================================

alter table public.campaigns
  add column if not exists status text,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz;

alter table public.campaigns
  alter column display_count set default 0;

update public.campaigns
set
  display_count = coalesce(display_count, 0),
  first_seen_at = coalesce(first_seen_at, start_date, uploaded_at, now()),
  last_seen_at = coalesce(last_seen_at, end_date, uploaded_at, now())
where
  display_count is null
  or first_seen_at is null
  or last_seen_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'campaigns_status_check'
  ) then
    alter table public.campaigns
      add constraint campaigns_status_check
      check (status in ('Ativa', 'Agendada', 'Encerrada') or status is null);
  end if;
end $$;

create or replace function public.compute_campaign_status(
  p_start timestamptz,
  p_end timestamptz,
  p_last_seen timestamptz,
  p_uploaded timestamptz
)
returns text
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_reference timestamptz := greatest(
    coalesce(p_last_seen, to_timestamp(0)),
    coalesce(p_end, to_timestamp(0)),
    coalesce(p_uploaded, to_timestamp(0))
  );
begin
  if p_start is not null and p_start > v_now + interval '1 hour' then
    return 'Agendada';
  end if;

  if v_reference >= v_now - interval '36 hours' then
    return 'Ativa';
  end if;

  return 'Encerrada';
end;
$$;

create or replace function public.campaigns_fill_derived_fields()
returns trigger
language plpgsql
as $$
begin
  new.display_count := coalesce(new.display_count, 0);
  new.first_seen_at := coalesce(new.first_seen_at, new.start_date, new.uploaded_at, now());
  new.last_seen_at := coalesce(new.last_seen_at, new.end_date, new.uploaded_at, new.first_seen_at, now());
  new.status := public.compute_campaign_status(new.start_date, new.end_date, new.last_seen_at, new.uploaded_at);
  return new;
end;
$$;

drop trigger if exists trg_campaigns_fill_derived_fields on public.campaigns;

create trigger trg_campaigns_fill_derived_fields
before insert or update on public.campaigns
for each row
execute function public.campaigns_fill_derived_fields();

update public.campaigns
set
  display_count = coalesce(display_count, 0),
  first_seen_at = coalesce(first_seen_at, start_date, uploaded_at, now()),
  last_seen_at = coalesce(last_seen_at, end_date, uploaded_at, now()),
  status = public.compute_campaign_status(start_date, end_date, coalesce(last_seen_at, end_date, uploaded_at), uploaded_at);

create index if not exists idx_campaigns_client_uploaded_at
  on public.campaigns (client_id, uploaded_at desc);

create index if not exists idx_campaigns_client_status
  on public.campaigns (client_id, status);

create index if not exists idx_campaigns_client_content
  on public.campaigns (client_id, content_name);

create or replace view public.campaigns_dashboard_vw as
select distinct on (
  c.client_id,
  coalesce(nullif(c.content_name, ''), nullif(c.name, '')),
  coalesce(nullif(c.loja, ''), '—'),
  coalesce(nullif(c.tipo_midia, ''), '—')
)
  c.id,
  c.client_id,
  c.name,
  c.content_name,
  c.loja,
  c.tipo_midia,
  c.start_date,
  c.end_date,
  c.duration_days,
  c.duration_hms,
  coalesce(c.display_count, 0) as display_count,
  coalesce(c.visitors, 0) as visitors,
  coalesce(c.avg_attention_sec, 0) as avg_attention_sec,
  coalesce(c.status, public.compute_campaign_status(c.start_date, c.end_date, c.last_seen_at, c.uploaded_at)) as status,
  coalesce(c.first_seen_at, c.start_date, c.uploaded_at) as first_seen_at,
  coalesce(c.last_seen_at, c.end_date, c.uploaded_at) as last_seen_at,
  c.uploaded_at
from public.campaigns c
order by
  c.client_id,
  coalesce(nullif(c.content_name, ''), nullif(c.name, '')),
  coalesce(nullif(c.loja, ''), '—'),
  coalesce(nullif(c.tipo_midia, ''), '—'),
  coalesce(c.last_seen_at, c.end_date, c.uploaded_at) desc,
  c.uploaded_at desc;

grant select on public.campaigns_dashboard_vw to anon, authenticated, service_role;
