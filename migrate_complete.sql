-- ============================================================
-- MIGRAÇÃO COMPLETA — Painel de Operações
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- ── 1. visitor_analytics: adicionar colunas faltantes ─────────────────────
ALTER TABLE visitor_analytics
  ADD COLUMN IF NOT EXISTS visit_uid        TEXT,
  ADD COLUMN IF NOT EXISTS end_timestamp    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS visit_time_seconds    NUMERIC,
  ADD COLUMN IF NOT EXISTS dwell_time_seconds    NUMERIC,
  ADD COLUMN IF NOT EXISTS contact_time_seconds  NUMERIC;

-- Popular visit_uid para linhas existentes (usando hash das colunas atuais)
UPDATE visitor_analytics
SET visit_uid = encode(
  digest(
    COALESCE(client_id::text,'') || ':' ||
    COALESCE(device_id::text,'') || ':' ||
    COALESCE(timestamp::text,''),
    'sha256'
  ), 'hex'
)
WHERE visit_uid IS NULL;

-- Constraint unique em visit_uid (necessária para upsert com onConflict: 'visit_uid')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visitor_analytics_visit_uid_key'
  ) THEN
    -- Remove duplicatas de visit_uid antes de adicionar constraint
    DELETE FROM visitor_analytics a
    USING visitor_analytics b
    WHERE a.id > b.id
      AND a.visit_uid = b.visit_uid
      AND a.visit_uid IS NOT NULL;

    ALTER TABLE visitor_analytics ADD CONSTRAINT visitor_analytics_visit_uid_key UNIQUE (visit_uid);
  END IF;
END $$;

-- Índice de performance
CREATE INDEX IF NOT EXISTS idx_visitor_analytics_client_ts
  ON visitor_analytics (client_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_visitor_analytics_client_device
  ON visitor_analytics (client_id, device_id);

-- ── 2. visitor_analytics_rollups ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_analytics_rollups (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  start                   TIMESTAMPTZ NOT NULL,
  "end"                   TIMESTAMPTZ NOT NULL,
  total_visitors          BIGINT NOT NULL DEFAULT 0,
  avg_visitors_per_day    NUMERIC,
  visitors_per_day        JSONB DEFAULT '{}'::jsonb,
  visitors_per_hour_avg   JSONB DEFAULT '{}'::jsonb,
  age_pyramid_percent     JSONB DEFAULT '{}'::jsonb,
  gender_percent          JSONB DEFAULT '{}'::jsonb,
  attributes_percent      JSONB DEFAULT '{}'::jsonb,
  avg_visit_time_seconds  NUMERIC,
  avg_dwell_time_seconds  NUMERIC,
  avg_contact_time_seconds NUMERIC,
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Constraint única para upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visitor_analytics_rollups_client_start_end_key'
  ) THEN
    ALTER TABLE visitor_analytics_rollups
      ADD CONSTRAINT visitor_analytics_rollups_client_start_end_key
      UNIQUE (client_id, start, "end");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rollups_client_range
  ON visitor_analytics_rollups (client_id, start, "end");

CREATE INDEX IF NOT EXISTS idx_rollups_updated_at
  ON visitor_analytics_rollups (updated_at DESC);

ALTER TABLE visitor_analytics_rollups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rollups_public_select" ON visitor_analytics_rollups;
DROP POLICY IF EXISTS "rollups_public_insert" ON visitor_analytics_rollups;
DROP POLICY IF EXISTS "rollups_public_update" ON visitor_analytics_rollups;
DROP POLICY IF EXISTS "rollups_public_delete" ON visitor_analytics_rollups;
CREATE POLICY "rollups_public_select" ON visitor_analytics_rollups FOR SELECT USING (true);
CREATE POLICY "rollups_public_insert" ON visitor_analytics_rollups FOR INSERT WITH CHECK (true);
CREATE POLICY "rollups_public_update" ON visitor_analytics_rollups FOR UPDATE USING (true);
CREATE POLICY "rollups_public_delete" ON visitor_analytics_rollups FOR DELETE USING (true);

-- ── 3. client_sync_state ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_sync_state (
  client_id       UUID NOT NULL PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  last_synced_at  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sync_state_public_select" ON client_sync_state;
DROP POLICY IF EXISTS "sync_state_public_insert" ON client_sync_state;
DROP POLICY IF EXISTS "sync_state_public_update" ON client_sync_state;
CREATE POLICY "sync_state_public_select" ON client_sync_state FOR SELECT USING (true);
CREATE POLICY "sync_state_public_insert" ON client_sync_state FOR INSERT WITH CHECK (true);
CREATE POLICY "sync_state_public_update" ON client_sync_state FOR UPDATE USING (true);

-- ── 4. dashboard_configs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboard_configs (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
  layout_name    TEXT NOT NULL DEFAULT 'global',
  widgets_config JSONB DEFAULT '[]'::jsonb,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_configs_client
  ON dashboard_configs (client_id, layout_name);

ALTER TABLE dashboard_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dash_cfg_public_select" ON dashboard_configs;
DROP POLICY IF EXISTS "dash_cfg_public_insert" ON dashboard_configs;
DROP POLICY IF EXISTS "dash_cfg_public_update" ON dashboard_configs;
DROP POLICY IF EXISTS "dash_cfg_public_delete" ON dashboard_configs;
CREATE POLICY "dash_cfg_public_select" ON dashboard_configs FOR SELECT USING (true);
CREATE POLICY "dash_cfg_public_insert" ON dashboard_configs FOR INSERT WITH CHECK (true);
CREATE POLICY "dash_cfg_public_update" ON dashboard_configs FOR UPDATE USING (true);
CREATE POLICY "dash_cfg_public_delete" ON dashboard_configs FOR DELETE USING (true);

-- ── 5. Função RPC: build_visitor_rollup ───────────────────────────────────
-- Reconstrói os dados de rollup (métricas agregadas) a partir dos registros brutos.
-- Retorna JSONB com o mesmo formato esperado pelo frontend.
CREATE OR REPLACE FUNCTION build_visitor_rollup(
  p_client_id UUID,
  p_start     TIMESTAMPTZ,
  p_end       TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total          BIGINT;
  v_days           NUMERIC;
  v_vpd            JSONB;
  v_vph            JSONB;
  v_gender         JSONB;
  v_age            JSONB;
  v_glasses        JSONB;
  v_facial         JSONB;
  v_headwear       JSONB;
  v_hair_color     JSONB;
  v_hair_type      JSONB;
  v_avg_visit      NUMERIC;
  v_avg_contact    NUMERIC;
BEGIN
  -- Contagem total
  SELECT COUNT(*) INTO v_total
  FROM visitor_analytics
  WHERE client_id = p_client_id
    AND timestamp  >= p_start
    AND timestamp  <= p_end;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('total_visitors', 0);
  END IF;

  -- Dias no período
  v_days := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p_end - p_start)) / 86400.0));

  -- Visitantes por dia
  SELECT COALESCE(
    jsonb_object_agg(day_key, cnt),
    '{}'::jsonb
  ) INTO v_vpd
  FROM (
    SELECT TO_CHAR(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day_key,
           COUNT(*) AS cnt
    FROM visitor_analytics
    WHERE client_id = p_client_id
      AND timestamp >= p_start
      AND timestamp <= p_end
    GROUP BY day_key
  ) t;

  -- Visitantes por hora (média por dia)
  SELECT COALESCE(
    jsonb_object_agg(h::TEXT, ROUND(COALESCE(cnt, 0)::NUMERIC / v_days, 2)),
    '{}'::jsonb
  ) INTO v_vph
  FROM generate_series(0, 23) AS h
  LEFT JOIN (
    SELECT EXTRACT(HOUR FROM timestamp AT TIME ZONE 'UTC')::INT AS hr,
           COUNT(*) AS cnt
    FROM visitor_analytics
    WHERE client_id = p_client_id
      AND timestamp >= p_start
      AND timestamp <= p_end
    GROUP BY hr
  ) t ON t.hr = h;

  -- Gênero em %
  SELECT jsonb_build_object(
    'male',    ROUND(COUNT(*) FILTER (WHERE gender = 1) * 100.0 / v_total, 2),
    'female',  ROUND(COUNT(*) FILTER (WHERE gender = 2) * 100.0 / v_total, 2),
    'unknown', ROUND(COUNT(*) FILTER (WHERE gender IS NULL OR gender NOT IN (1,2)) * 100.0 / v_total, 2)
  ) INTO v_gender
  FROM visitor_analytics
  WHERE client_id = p_client_id
    AND timestamp >= p_start
    AND timestamp <= p_end;

  -- Pirâmide etária em %
  SELECT COALESCE(
    jsonb_object_agg(bucket, ROUND(cnt * 100.0 / v_total, 2)),
    '{}'::jsonb
  ) INTO v_age
  FROM (
    SELECT
      CASE
        WHEN age IS NULL OR age < 0 THEN 'unknown'
        WHEN age <= 9  THEN '0-9'
        WHEN age <= 17 THEN '10-17'
        WHEN age <= 24 THEN '18-24'
        WHEN age <= 34 THEN '25-34'
        WHEN age <= 44 THEN '35-44'
        WHEN age <= 54 THEN '45-54'
        WHEN age <= 64 THEN '55-64'
        WHEN age <= 74 THEN '65-74'
        ELSE '75+'
      END AS bucket,
      COUNT(*) AS cnt
    FROM visitor_analytics
    WHERE client_id = p_client_id
      AND timestamp >= p_start
      AND timestamp <= p_end
    GROUP BY bucket
  ) t;

  -- Óculos
  SELECT COALESCE(
    jsonb_object_agg(norm_val, ROUND(cnt * 100.0 / SUM(cnt) OVER (), 2)),
    '{}'::jsonb
  ) INTO v_glasses
  FROM (
    SELECT
      CASE
        WHEN LOWER(TRIM(attributes->>'glasses')) IN ('true','yes','1','on') THEN 'usual'
        WHEN LOWER(TRIM(attributes->>'glasses')) IN ('false','no','0','off') THEN 'none'
        ELSE LOWER(TRIM(attributes->>'glasses'))
      END AS norm_val,
      COUNT(*) AS cnt
    FROM visitor_analytics
    WHERE client_id = p_client_id
      AND timestamp >= p_start
      AND timestamp <= p_end
      AND attributes->>'glasses' IS NOT NULL
      AND TRIM(attributes->>'glasses') <> ''
    GROUP BY norm_val
  ) t;

  -- Barba/pelo facial
  SELECT COALESCE(
    jsonb_object_agg(norm_val, ROUND(cnt * 100.0 / SUM(cnt) OVER (), 2)),
    '{}'::jsonb
  ) INTO v_facial
  FROM (
    SELECT
      CASE
        WHEN LOWER(TRIM(attributes->>'facial_hair')) = 'true'  THEN 'beard'
        WHEN LOWER(TRIM(attributes->>'facial_hair')) = 'false' THEN 'shaved'
        ELSE LOWER(TRIM(attributes->>'facial_hair'))
      END AS norm_val,
      COUNT(*) AS cnt
    FROM visitor_analytics
    WHERE client_id = p_client_id
      AND timestamp >= p_start
      AND timestamp <= p_end
      AND attributes->>'facial_hair' IS NOT NULL
      AND TRIM(attributes->>'facial_hair') <> ''
    GROUP BY norm_val
  ) t;

  -- Chapéu/boné
  SELECT COALESCE(
    jsonb_object_agg(norm_val, ROUND(cnt * 100.0 / SUM(cnt) OVER (), 2)),
    '{}'::jsonb
  ) INTO v_headwear
  FROM (
    SELECT
      CASE
        WHEN LOWER(TRIM(attributes->>'headwear')) IN ('true','yes','1','on') THEN 'true'
        WHEN LOWER(TRIM(attributes->>'headwear')) IN ('false','no','0','off','none') THEN 'false'
        WHEN TRIM(attributes->>'headwear') <> '' THEN 'true'
        ELSE 'false'
      END AS norm_val,
      COUNT(*) AS cnt
    FROM visitor_analytics
    WHERE client_id = p_client_id
      AND timestamp >= p_start
      AND timestamp <= p_end
      AND attributes->>'headwear' IS NOT NULL
      AND TRIM(attributes->>'headwear') <> ''
    GROUP BY norm_val
  ) t;

  -- Cor do cabelo
  SELECT COALESCE(
    jsonb_object_agg(norm_val, ROUND(cnt * 100.0 / SUM(cnt) OVER (), 2)),
    '{}'::jsonb
  ) INTO v_hair_color
  FROM (
    SELECT LOWER(TRIM(attributes->>'hair_color')) AS norm_val, COUNT(*) AS cnt
    FROM visitor_analytics
    WHERE client_id = p_client_id
      AND timestamp >= p_start
      AND timestamp <= p_end
      AND attributes->>'hair_color' IS NOT NULL
      AND TRIM(attributes->>'hair_color') <> ''
    GROUP BY norm_val
  ) t;

  -- Tipo de cabelo
  SELECT COALESCE(
    jsonb_object_agg(norm_val, ROUND(cnt * 100.0 / SUM(cnt) OVER (), 2)),
    '{}'::jsonb
  ) INTO v_hair_type
  FROM (
    SELECT LOWER(TRIM(attributes->>'hair_type')) AS norm_val, COUNT(*) AS cnt
    FROM visitor_analytics
    WHERE client_id = p_client_id
      AND timestamp >= p_start
      AND timestamp <= p_end
      AND attributes->>'hair_type' IS NOT NULL
      AND TRIM(attributes->>'hair_type') <> ''
    GROUP BY norm_val
  ) t;

  -- Tempos médios
  SELECT AVG(visit_time_seconds) INTO v_avg_visit
  FROM visitor_analytics
  WHERE client_id = p_client_id
    AND timestamp >= p_start
    AND timestamp <= p_end
    AND visit_time_seconds IS NOT NULL
    AND visit_time_seconds > 0;

  SELECT AVG(contact_time_seconds) INTO v_avg_contact
  FROM visitor_analytics
  WHERE client_id = p_client_id
    AND timestamp >= p_start
    AND timestamp <= p_end
    AND contact_time_seconds IS NOT NULL
    AND contact_time_seconds > 0;

  RETURN jsonb_build_object(
    'total_visitors',          v_total,
    'avg_visitors_per_day',    ROUND(v_total / v_days, 2),
    'visitors_per_day',        COALESCE(v_vpd, '{}'),
    'visitors_per_hour_avg',   COALESCE(v_vph, '{}'),
    'gender_percent',          COALESCE(v_gender, '{}'),
    'age_pyramid_percent',     COALESCE(v_age, '{}'),
    'attributes_percent',      jsonb_build_object(
      'glasses',    COALESCE(v_glasses,    '{}'),
      'facial_hair', COALESCE(v_facial,   '{}'),
      'headwear',   COALESCE(v_headwear,  '{}'),
      'hair_color', COALESCE(v_hair_color,'{}'),
      'hair_type',  COALESCE(v_hair_type, '{}')
    ),
    'avg_visit_time_seconds',   v_avg_visit,
    'avg_contact_time_seconds', v_avg_contact
  );
END;
$$;

-- Permissão para service_role e anon usarem a função
GRANT EXECUTE ON FUNCTION build_visitor_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION build_visitor_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION build_visitor_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
