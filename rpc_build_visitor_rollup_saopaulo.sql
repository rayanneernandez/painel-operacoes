-- ============================================================================
-- build_visitor_rollup — agregação de visitantes no BANCO (versão RÁPIDA)
-- ----------------------------------------------------------------------------
-- Calcula as métricas principais SEM ler o campo JSON `attributes` (que é o
-- gargalo: são 1M+ registros e cada JSON é caro de abrir).
--
-- Retorna: total, média/dia, por dia, por hora, gênero, idade e tempos médios.
-- Os atributos (óculos/barba/cabelo) NÃO vêm daqui — o painel reaproveita a
-- distribuição do último rollup salvo (eles praticamente não mudam), o que
-- mantém o total e os gráficos principais rápidos e exatos.
--
-- Agrupa dia/hora em 'America/Sao_Paulo' (a versão antiga usava UTC).
--
-- É seguro rodar: apaga e recria só a FUNÇÃO, NÃO apaga dados.
-- Supabase → SQL Editor → cola tudo → Run.
-- ============================================================================

DROP FUNCTION IF EXISTS build_visitor_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION build_visitor_rollup(
  p_client_id UUID,
  p_start     TIMESTAMPTZ,
  p_end       TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
WITH base AS MATERIALIZED (
  SELECT
    (timestamp AT TIME ZONE 'America/Sao_Paulo') AS ts_local,
    gender,
    age,
    visit_time_seconds,
    contact_time_seconds
  FROM visitor_analytics
  WHERE client_id = p_client_id
    AND timestamp >= p_start
    AND timestamp <= p_end
),
agg AS (
  SELECT
    COUNT(*)                                                          AS total,
    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p_end - p_start)) / 86400.0)) AS days,
    COUNT(*) FILTER (WHERE gender = 1)                                AS g_male,
    COUNT(*) FILTER (WHERE gender = 2)                                AS g_female,
    COUNT(*) FILTER (WHERE gender IS NULL OR gender NOT IN (1,2))     AS g_unknown,
    AVG(visit_time_seconds)   FILTER (WHERE visit_time_seconds   > 0) AS avg_visit,
    AVG(contact_time_seconds) FILTER (WHERE contact_time_seconds > 0) AS avg_contact
  FROM base
),
per_day AS (
  SELECT COALESCE(jsonb_object_agg(d, c), '{}'::jsonb) AS j
  FROM (
    SELECT TO_CHAR(ts_local, 'YYYY-MM-DD') AS d, COUNT(*) AS c
    FROM base GROUP BY 1
  ) x
),
per_hour AS (
  SELECT COALESCE(
    jsonb_object_agg(h::TEXT, ROUND(COALESCE(c, 0)::NUMERIC / (SELECT days FROM agg), 2)),
    '{}'::jsonb
  ) AS j
  FROM generate_series(0, 23) AS h
  LEFT JOIN (
    SELECT EXTRACT(HOUR FROM ts_local)::INT AS hr, COUNT(*) AS c
    FROM base GROUP BY 1
  ) t ON t.hr = h
),
age_b AS (
  SELECT COALESCE(jsonb_object_agg(bucket, ROUND(c * 100.0 / NULLIF((SELECT total FROM agg), 0), 2)), '{}'::jsonb) AS j
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
      COUNT(*) AS c
    FROM base GROUP BY 1
  ) x
)
SELECT CASE WHEN (SELECT total FROM agg) = 0 THEN jsonb_build_object('total_visitors', 0)
ELSE jsonb_build_object(
  'total_visitors',        (SELECT total FROM agg),
  'avg_visitors_per_day',  ROUND((SELECT total FROM agg)::NUMERIC / (SELECT days FROM agg), 2),
  'visitors_per_day',      (SELECT j FROM per_day),
  'visitors_per_hour_avg', (SELECT j FROM per_hour),
  'gender_percent', jsonb_build_object(
    'male',    ROUND((SELECT g_male    FROM agg) * 100.0 / (SELECT total FROM agg), 2),
    'female',  ROUND((SELECT g_female  FROM agg) * 100.0 / (SELECT total FROM agg), 2),
    'unknown', ROUND((SELECT g_unknown FROM agg) * 100.0 / (SELECT total FROM agg), 2)
  ),
  'age_pyramid_percent',      (SELECT j FROM age_b),
  'attributes_percent',       '{}'::jsonb,
  'avg_visit_time_seconds',   (SELECT avg_visit   FROM agg),
  'avg_contact_time_seconds', (SELECT avg_contact FROM agg)
) END;
$$;

-- Permissões (necessário para o painel chamar a função)
GRANT EXECUTE ON FUNCTION build_visitor_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION build_visitor_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION build_visitor_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
