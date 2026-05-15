-- ============================================================
-- BRF Vision Architecture
-- Módulos: Ruptura, Operação, Fila
-- ============================================================

-- 1. Planogramas
create table if not exists brf_planograms (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid,
  client_id     uuid,
  name          text not null,
  section       text not null,
  total_columns int  not null default 20,
  total_shelves int  not null default 3,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- 2. Posições do planograma (cada slot = 1 produto esperado)
create table if not exists brf_planogram_positions (
  id              uuid primary key default gen_random_uuid(),
  planogram_id    uuid not null,
  column_number   int  not null,
  shelf_number    int  not null,
  product_code    text not null,
  product_name    text not null,
  product_image_url text,
  created_at      timestamptz not null default now(),
  unique(planogram_id, column_number, shelf_number)
);

-- 3. Câmeras vinculadas por função
create table if not exists brf_cameras (
  id                   uuid primary key default gen_random_uuid(),
  device_id            uuid,
  store_id             uuid,
  client_id            uuid,
  function             text not null check (function in ('ruptura', 'operacao', 'fila')),
  planogram_id         uuid,
  location_description text,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

-- 4. Snapshots (cada frame enviado ao Sonnet gera um registro)
create table if not exists brf_vision_snapshots (
  id             uuid primary key default gen_random_uuid(),
  camera_id      uuid not null,
  store_id       uuid not null,
  client_id      uuid not null,
  function       text not null check (function in ('ruptura', 'operacao', 'fila')),
  image_url      text not null,
  analyzed_at    timestamptz not null default now(),
  model_used     text not null default 'claude-sonnet-4-6',
  processing_ms  int,
  raw_response   jsonb
);

create index if not exists idx_snapshots_function_time on brf_vision_snapshots(function, analyzed_at desc);
create index if not exists idx_snapshots_store        on brf_vision_snapshots(store_id, function, analyzed_at desc);

-- 5. Status da gôndola por posição (upsert a cada análise)
create table if not exists brf_gondola_status (
  id                     uuid primary key default gen_random_uuid(),
  planogram_position_id  uuid not null,
  snapshot_id            uuid,
  store_id               uuid not null,
  client_id              uuid,
  status                 text not null check (status in ('ok', 'warning', 'rupture')),
  confidence             float,
  updated_at             timestamptz not null default now()
);

create index if not exists idx_gondola_status_pos on brf_gondola_status(planogram_position_id, updated_at desc);

-- 6. Alertas de ruptura
create table if not exists brf_rupture_alerts (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null,
  store_id               uuid,
  device_id              uuid,
  severity               text not null check (severity in ('orange', 'red')),
  planogram_position_id  uuid,
  snapshot_id            uuid,
  product_code           text,
  product_name           text,
  confidence             float,
  resolved_at            timestamptz,
  created_at             timestamptz not null default now()
);

create index if not exists idx_rupture_alerts_client on brf_rupture_alerts(client_id, created_at desc);

-- 7. Detecções de operação (atendentes no stand)
create table if not exists brf_operation_detections (
  id               uuid primary key default gen_random_uuid(),
  snapshot_id      uuid,
  store_id         uuid not null,
  client_id        uuid not null,
  attendant_count  int not null default 0,
  is_preparing     boolean not null default false,
  details          jsonb,
  detected_at      timestamptz not null default now()
);

create index if not exists idx_op_detections_store on brf_operation_detections(store_id, detected_at desc);

-- 8. Sessões de preparo
create table if not exists brf_prep_sessions (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null,
  client_id           uuid not null,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  attendant_count_avg float,
  first_snapshot_id   uuid,
  last_snapshot_id    uuid
);

create index if not exists idx_prep_sessions_store on brf_prep_sessions(store_id, started_at desc);

-- 9. Detecções de fila (pessoas aguardando)
create table if not exists brf_queue_detections (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid,
  store_id      uuid not null,
  client_id     uuid not null,
  people_count  int not null default 0,
  details       jsonb,
  detected_at   timestamptz not null default now()
);

create index if not exists idx_queue_detections_store on brf_queue_detections(store_id, detected_at desc);

-- 10. Sessões individuais de espera na fila
create table if not exists brf_queue_sessions (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null,
  client_id    uuid not null,
  entered_at   timestamptz not null default now(),
  exited_at    timestamptz,
  wait_seconds int,
  tracking_id  text
);

create index if not exists idx_queue_sessions_store on brf_queue_sessions(store_id, entered_at desc);

-- 11. Views para o dashboard

-- Último status de cada posição (alimenta gôndola 3D)
create or replace view brf_gondola_current as
select distinct on (gs.planogram_position_id)
  gs.planogram_position_id,
  pp.column_number,
  pp.shelf_number,
  pp.product_code,
  pp.product_name,
  pp.product_image_url,
  gs.status,
  gs.confidence,
  gs.updated_at,
  gs.store_id,
  gs.client_id,
  pp.planogram_id
from brf_gondola_status gs
join brf_planogram_positions pp on pp.id = gs.planogram_position_id
order by gs.planogram_position_id, gs.updated_at desc;

-- Pessoas na fila nos últimos 5 min (Pessoas Agora)
create or replace view brf_queue_now as
select store_id, client_id, people_count, detected_at
from brf_queue_detections
where detected_at > now() - interval '5 minutes'
order by detected_at desc;

-- Métricas horárias de fila (gráfico)
create or replace view brf_queue_hourly as
select
  store_id, client_id,
  date_trunc('hour', detected_at) as hour,
  round(avg(people_count)::numeric, 1) as avg_people,
  max(people_count) as max_people,
  count(*) as sample_count
from brf_queue_detections
group by store_id, client_id, date_trunc('hour', detected_at);

-- Métricas horárias de operação (gráfico)
create or replace view brf_operation_hourly as
select
  store_id, client_id,
  date_trunc('hour', detected_at) as hour,
  round(avg(attendant_count)::numeric, 1) as avg_attendants,
  count(*) filter (where is_preparing) as preparing_samples,
  count(*) as total_samples
from brf_operation_detections
group by store_id, client_id, date_trunc('hour', detected_at);
