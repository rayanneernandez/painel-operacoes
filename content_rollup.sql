-- ============================================================================
-- content_rollup — resumo de demografia POR CONTEÚDO e por dia
-- ----------------------------------------------------------------------------
-- Alimentada pelo import do "Views of visitors" (que tem, por visualização,
-- o conteúdo + gênero + idade + atenção). Permite filtrar o dashboard inteiro
-- por conteúdo (Total, Gênero, Idade, Fluxo por hora, Tempo de atenção).
--
-- Seguro rodar: cria a tabela e a função. Supabase → SQL Editor → cola tudo → Run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_rollup (
  client_id     uuid        NOT NULL,
  content_name  text        NOT NULL,
  day           date        NOT NULL,
  visitors      bigint      NOT NULL DEFAULT 0,
  display_count bigint      NOT NULL DEFAULT 0,
  g_male        bigint      NOT NULL DEFAULT 0,
  g_female      bigint      NOT NULL DEFAULT 0,
  g_unknown     bigint      NOT NULL DEFAULT 0,
  age_counts    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  hour_counts   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sum_attention numeric     NOT NULL DEFAULT 0,
  cnt_attention bigint      NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, content_name, day)
);

ALTER TABLE content_rollup DISABLE ROW LEVEL SECURITY;

-- Upsert em lote (chamado pelo import do painel)
CREATE OR REPLACE FUNCTION upsert_content_rollup(p_rows jsonb)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO content_rollup (
    client_id, content_name, day, visitors, display_count,
    g_male, g_female, g_unknown, age_counts, hour_counts, sum_attention, cnt_attention
  )
  SELECT
    (r->>'client_id')::uuid,
    r->>'content_name',
    (r->>'day')::date,
    COALESCE((r->>'visitors')::bigint, 0),
    COALESCE((r->>'display_count')::bigint, 0),
    COALESCE((r->>'g_male')::bigint, 0),
    COALESCE((r->>'g_female')::bigint, 0),
    COALESCE((r->>'g_unknown')::bigint, 0),
    COALESCE(r->'age_counts', '{}'::jsonb),
    COALESCE(r->'hour_counts', '{}'::jsonb),
    COALESCE((r->>'sum_attention')::numeric, 0),
    COALESCE((r->>'cnt_attention')::bigint, 0)
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (client_id, content_name, day) DO UPDATE SET
    visitors = EXCLUDED.visitors,
    display_count = EXCLUDED.display_count,
    g_male = EXCLUDED.g_male,
    g_female = EXCLUDED.g_female,
    g_unknown = EXCLUDED.g_unknown,
    age_counts = EXCLUDED.age_counts,
    hour_counts = EXCLUDED.hour_counts,
    sum_attention = EXCLUDED.sum_attention,
    cnt_attention = EXCLUDED.cnt_attention,
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_content_rollup(jsonb) TO anon, authenticated, service_role;
