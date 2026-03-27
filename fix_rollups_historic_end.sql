-- ============================================================
-- FIX: Rollups históricos com end fixo no futuro
-- Execute este script no SQL Editor do Supabase
--
-- PROBLEMA: Rollups antigos tinham end = timestamp do momento
-- do sync (ex: 2026-03-27T15:00:00Z). No dia seguinte, o
-- dashboard buscava rollups com end >= hoje 00:00 e não
-- encontrava — exibindo zero.
--
-- SOLUÇÃO: Criar/atualizar o rollup histórico de cada cliente
-- com end = 9999-12-31 (fixo). Assim ele sempre é encontrado
-- independentemente da data em que o usuário acessar.
-- ============================================================

-- 1. Criar rollup histórico com end fixo para todos os clientes
--    que já têm dados em visitor_analytics
INSERT INTO visitor_analytics_rollups (
  client_id,
  start,
  "end",
  total_visitors,
  avg_visitors_per_day,
  visitors_per_day,
  visitors_per_hour_avg,
  age_pyramid_percent,
  gender_percent,
  attributes_percent,
  avg_visit_time_seconds,
  avg_contact_time_seconds,
  updated_at
)
SELECT
  r.client_id,
  COALESCE(cfg.collection_start, '2025-01-01T00:00:00.000Z')::TIMESTAMPTZ AS start,
  '9999-12-31T23:59:59.999Z'::TIMESTAMPTZ AS "end",
  (r.data->>'total_visitors')::BIGINT,
  (r.data->>'avg_visitors_per_day')::NUMERIC,
  (r.data->'visitors_per_day'),
  (r.data->'visitors_per_hour_avg'),
  (r.data->'age_pyramid_percent'),
  (r.data->'gender_percent'),
  (r.data->'attributes_percent'),
  (r.data->>'avg_visit_time_seconds')::NUMERIC,
  (r.data->>'avg_contact_time_seconds')::NUMERIC,
  NOW()
FROM (
  SELECT
    client_id,
    build_visitor_rollup(
      client_id,
      COALESCE(cfg2.collection_start, '2025-01-01T00:00:00.000Z')::TIMESTAMPTZ,
      NOW()
    ) AS data
  FROM (
    SELECT DISTINCT client_id FROM visitor_analytics
  ) va
  LEFT JOIN client_api_configs cfg2 ON cfg2.client_id = va.client_id
) r
LEFT JOIN client_api_configs cfg ON cfg.client_id = r.client_id
WHERE (r.data->>'total_visitors')::BIGINT > 0
ON CONFLICT (client_id, start, "end")
DO UPDATE SET
  total_visitors          = EXCLUDED.total_visitors,
  avg_visitors_per_day    = EXCLUDED.avg_visitors_per_day,
  visitors_per_day        = EXCLUDED.visitors_per_day,
  visitors_per_hour_avg   = EXCLUDED.visitors_per_hour_avg,
  age_pyramid_percent     = EXCLUDED.age_pyramid_percent,
  gender_percent          = EXCLUDED.gender_percent,
  attributes_percent      = EXCLUDED.attributes_percent,
  avg_visit_time_seconds  = EXCLUDED.avg_visit_time_seconds,
  avg_contact_time_seconds = EXCLUDED.avg_contact_time_seconds,
  updated_at              = NOW();

-- 2. Criar rollup do dia atual para todos os clientes
INSERT INTO visitor_analytics_rollups (
  client_id,
  start,
  "end",
  total_visitors,
  avg_visitors_per_day,
  visitors_per_day,
  visitors_per_hour_avg,
  age_pyramid_percent,
  gender_percent,
  attributes_percent,
  avg_visit_time_seconds,
  avg_contact_time_seconds,
  updated_at
)
SELECT
  va.client_id,
  DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') AS start,
  (DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '23 hours 59 minutes 59 seconds 999 milliseconds') AS "end",
  (r->>'total_visitors')::BIGINT,
  (r->>'avg_visitors_per_day')::NUMERIC,
  (r->'visitors_per_day'),
  (r->'visitors_per_hour_avg'),
  (r->'age_pyramid_percent'),
  (r->'gender_percent'),
  (r->'attributes_percent'),
  (r->>'avg_visit_time_seconds')::NUMERIC,
  (r->>'avg_contact_time_seconds')::NUMERIC,
  NOW()
FROM (
  SELECT DISTINCT client_id FROM visitor_analytics
) va
CROSS JOIN LATERAL (
  SELECT build_visitor_rollup(
    va.client_id,
    DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC'),
    NOW()
  ) AS r
) sub
WHERE (r->>'total_visitors')::BIGINT > 0
ON CONFLICT (client_id, start, "end")
DO UPDATE SET
  total_visitors          = EXCLUDED.total_visitors,
  avg_visitors_per_day    = EXCLUDED.avg_visitors_per_day,
  visitors_per_day        = EXCLUDED.visitors_per_day,
  visitors_per_hour_avg   = EXCLUDED.visitors_per_hour_avg,
  age_pyramid_percent     = EXCLUDED.age_pyramid_percent,
  gender_percent          = EXCLUDED.gender_percent,
  attributes_percent      = EXCLUDED.attributes_percent,
  avg_visit_time_seconds  = EXCLUDED.avg_visit_time_seconds,
  avg_contact_time_seconds = EXCLUDED.avg_contact_time_seconds,
  updated_at              = NOW();

-- 3. Verificar resultado
SELECT
  client_id,
  start::DATE AS data_inicio,
  CASE WHEN "end" > '2099-01-01'::TIMESTAMPTZ THEN 'HISTÓRICO (fixo)' ELSE "end"::TEXT END AS data_fim,
  total_visitors,
  updated_at
FROM visitor_analytics_rollups
ORDER BY updated_at DESC
LIMIT 30;
