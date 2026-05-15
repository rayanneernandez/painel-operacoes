alter table if exists public.campaigns
  add column if not exists content_id bigint,
  add column if not exists campaign_id bigint,
  add column if not exists device_id bigint,
  add column if not exists total_play_seconds integer default 0,
  add column if not exists gender_breakdown jsonb default '{}'::jsonb,
  add column if not exists age_breakdown jsonb default '{}'::jsonb,
  add column if not exists sync_range_start timestamptz,
  add column if not exists sync_range_end timestamptz,
  add column if not exists source text default 'displayforce_api';

create index if not exists idx_campaigns_displayforce_range
  on public.campaigns (client_id, sync_range_start, sync_range_end);

create index if not exists idx_campaigns_displayforce_content
  on public.campaigns (client_id, content_id, campaign_id, device_id);

create or replace view public.campaigns_dashboard_vw as
select
  id,
  client_id,
  name,
  content_name,
  tipo_midia,
  loja,
  start_date,
  end_date,
  duration_days,
  duration_hms,
  display_count,
  visitors,
  avg_attention_sec,
  uploaded_at,
  status,
  first_seen_at,
  last_seen_at,
  content_id,
  campaign_id,
  device_id,
  total_play_seconds,
  gender_breakdown,
  age_breakdown,
  sync_range_start,
  sync_range_end,
  source
from public.campaigns;
