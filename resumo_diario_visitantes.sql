-- ============================================================================
-- RESUMO DIÁRIO DE VISITANTES  (painel rápido em cima de milhões de registros)
-- ----------------------------------------------------------------------------
-- Guarda UMA linha por dia por cliente, com as contagens já somadas. Qualquer
-- período vira a soma de ~50 linhas (instantâneo) em vez de reprocessar 1M+
-- registros. E é sempre aditivo: junho + julho = junho+julho junto, sempre.
--
--   1) tabela   visitor_daily              (o resumo por dia)
--   2) função   refresh_visitor_daily(...) (preenche/atualiza o resumo)
--   3) função   get_visitor_rollup(...)    (soma o resumo p/ o painel, rápido)
--
-- Dias calculados em 'America/Sao_Paulo' (igual ao painel).
-- Seguro rodar: cria tabela/funções, NÃO apaga dados de visitor_analytics.
-- Supabase → SQL Editor → cola tudo → Run.
-- ============================================================================

-- ── 1. Tabela resumo ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_daily (
  client_id    UUID  NOT NULL,
  day          DATE  NOT NULL,
  total        BIGINT  NOT NULL DEFAULT 0,
  g_male       BIGINT  NOT NULL DEFAULT 0,
  g_female     BIGINT  NOT NULL DEFAULT 0,
  g_unknown    BIGINT  NOT NULL DEFAULT 0,
  age_counts   JSONB   NOT NULL DEFAULT '{}',   -- faixa etária -> contagem
  hour_counts  JSONB   NOT NULL DEFAULT '{}',   -- hora (0-23)  -> contagem
  sum_visit    NUMERIC NOT NULL DEFAULT 0,
  cnt_visit    BIGINT  NOT NULL DEFAULT 0,
  sum_contact  NUMERIC NOT NULL DEFAULT 0,
  cnt_contact  BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, day)
);

GRANT SELECT ON visitor_daily TO anon, authenticated, service_role;

-- ── 2. Preenche o resumo de um período (recalcula do bruto) ─────────────────
CREATE OR REPLACE FUNCTION refresh_visitor_daily(
  p_client UUID,
  p_from   DATE,
  p_to     DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  DELETE FROM visitor_daily
  WHERE client_id = p_client AND day BETWEEN p_from AND p_to;

  WITH src AS (
    SELECT
      (timestamp AT TIME ZONE 'America/Sao_Paulo')::date               AS day,
      EXTRACT(HOUR FROM timestamp AT TIME ZONE 'America/Sao_Paulo')::int AS hr,
      gender, age, visit_time_seconds, contact_time_seconds
    FROM visitor_analytics
    WHERE client_id = p_client
      AND timestamp >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND timestamp <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
  ),
  by_day AS (
    SELECT
      day,
      COUNT(*)                                                       AS total,
      COUNT(*) FILTER (WHERE gender = 1)                             AS g_male,
      COUNT(*) FILTER (WHERE gender = 2)                             AS g_female,
      COUNT(*) FILTER (WHERE gender IS NULL OR gender NOT IN (1,2))  AS g_unknown,
      jsonb_build_object(
        'unknown', COUNT(*) FILTER (WHERE age IS NULL OR age < 0),
        '0-9',     COUNT(*) FILTER (WHERE age BETWEEN 0 AND 9),
        '10-17',   COUNT(*) FILTER (WHERE age BETWEEN 10 AND 17),
        '18-24',   COUNT(*) FILTER (WHERE age BETWEEN 18 AND 24),
        '25-34',   COUNT(*) FILTER (WHERE age BETWEEN 25 AND 34),
        '35-44',   COUNT(*) FILTER (WHERE age BETWEEN 35 AND 44),
        '45-54',   COUNT(*) FILTER (WHERE age BETWEEN 45 AND 54),
        '55-64',   COUNT(*) FILTER (WHERE age BETWEEN 55 AND 64),
        '65-74',   COUNT(*) FILTER (WHERE age BETWEEN 65 AND 74),
        '75+',     COUNT(*) FILTER (WHERE age >= 75)
      )                                                              AS age_counts,
      COALESCE(SUM(visit_time_seconds)   FILTER (WHERE visit_time_seconds   > 0), 0) AS sum_visit,
      COUNT(*) FILTER (WHERE visit_time_seconds   > 0)                               AS cnt_visit,
      COALESCE(SUM(contact_time_seconds) FILTER (WHERE contact_time_seconds > 0), 0) AS sum_contact,
      COUNT(*) FILTER (WHERE contact_time_seconds > 0)                               AS cnt_contact
    FROM src
    GROUP BY day
  ),
  by_hour AS (
    SELECT day, jsonb_object_agg(hr::text, c) AS hour_counts
    FROM (SELECT day, hr, COUNT(*) AS c FROM src GROUP BY day, hr) h
    GROUP BY day
  )
  INSERT INTO visitor_daily (
    client_id, day, total, g_male, g_female, g_unknown,
    age_counts, hour_counts, sum_visit, cnt_visit, sum_contact, cnt_contact
  )
  SELECT
    p_client, d.day, d.total, d.g_male, d.g_female, d.g_unknown,
    d.age_counts, COALESCE(h.hour_counts, '{}'::jsonb),
    d.sum_visit, d.cnt_visit, d.sum_contact, d.cnt_contact
  FROM by_day d
  LEFT JOIN by_hour h USING (day);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_visitor_daily(UUID, DATE, DATE) TO anon, authenticated, service_role;

-- ── 3. Soma o resumo do período p/ o painel (RÁPIDO) ────────────────────────
CREATE OR REPLACE FUNCTION get_visitor_rollup(
  p_client UUID,
  p_start  TIMESTAMPTZ,
  p_end    TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
WITH bounds AS (
  SELECT (p_start AT TIME ZONE 'America/Sao_Paulo')::date AS d0,
         (p_end   AT TIME ZONE 'America/Sao_Paulo')::date AS d1
),
d AS (
  SELECT vd.*
  FROM visitor_daily vd, bounds b
  WHERE vd.client_id = p_client
    AND vd.day BETWEEN b.d0 AND b.d1
),
tot AS (
  SELECT
    COALESCE(SUM(total), 0)                              AS total,
    GREATEST((SELECT (d1 - d0 + 1) FROM bounds), 1)      AS days,
    COALESCE(SUM(g_male), 0)                             AS g_male,
    COALESCE(SUM(g_female), 0)                           AS g_female,
    COALESCE(SUM(g_unknown), 0)                          AS g_unknown,
    COALESCE(SUM(sum_visit), 0)                          AS sum_visit,
    COALESCE(SUM(cnt_visit), 0)                          AS cnt_visit,
    COALESCE(SUM(sum_contact), 0)                        AS sum_contact,
    COALESCE(SUM(cnt_contact), 0)                        AS cnt_contact
  FROM d
),
vpd AS (
  SELECT COALESCE(jsonb_object_agg(TO_CHAR(day, 'YYYY-MM-DD'), total), '{}'::jsonb) AS j FROM d
),
hour_tot AS (
  SELECT key AS hr, SUM(value::numeric) AS c
  FROM d, LATERAL jsonb_each_text(hour_counts)
  GROUP BY key
),
vph AS (
  SELECT COALESCE(
    jsonb_object_agg(h::text, ROUND(COALESCE(ht.c, 0) / (SELECT days FROM tot), 2)),
    '{}'::jsonb
  ) AS j
  FROM generate_series(0, 23) AS h
  LEFT JOIN hour_tot ht ON ht.hr = h::text
),
age_tot AS (
  SELECT key AS bucket, SUM(value::numeric) AS c
  FROM d, LATERAL jsonb_each_text(age_counts)
  GROUP BY key
),
age AS (
  SELECT COALESCE(jsonb_object_agg(bucket, ROUND(c * 100.0 / NULLIF((SELECT total FROM tot), 0), 2)), '{}'::jsonb) AS j
  FROM age_tot
)
SELECT CASE WHEN (SELECT total FROM tot) = 0 THEN jsonb_build_object('total_visitors', 0)
ELSE jsonb_build_object(
  'total_visitors',        (SELECT total FROM tot),
  'avg_visitors_per_day',  ROUND((SELECT total FROM tot)::numeric / (SELECT days FROM tot), 2),
  'visitors_per_day',      (SELECT j FROM vpd),
  'visitors_per_hour_avg', (SELECT j FROM vph),
  'gender_percent', jsonb_build_object(
    'male',    ROUND((SELECT g_male    FROM tot) * 100.0 / (SELECT total FROM tot), 2),
    'female',  ROUND((SELECT g_female  FROM tot) * 100.0 / (SELECT total FROM tot), 2),
    'unknown', ROUND((SELECT g_unknown FROM tot) * 100.0 / (SELECT total FROM tot), 2)
  ),
  'age_pyramid_percent',      (SELECT j FROM age),
  'attributes_percent',       '{}'::jsonb,
  'avg_visit_time_seconds',   CASE WHEN (SELECT cnt_visit   FROM tot) > 0 THEN ROUND((SELECT sum_visit   FROM tot) / (SELECT cnt_visit   FROM tot), 2) END,
  'avg_contact_time_seconds', CASE WHEN (SELECT cnt_contact FROM tot) > 0 THEN ROUND((SELECT sum_contact FROM tot) / (SELECT cnt_contact FROM tot), 2) END
) END;
$$;

GRANT EXECUTE ON FUNCTION get_visitor_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;
