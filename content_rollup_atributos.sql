-- ============================================================================
-- content_rollup: colunas de ATRIBUTOS por conteúdo (óculos/pelos/cabelo)
-- ----------------------------------------------------------------------------
-- Adiciona contagens por categoria (jsonb) e atualiza a função de upsert.
-- Seguro rodar mesmo com a tabela já existindo. Supabase → SQL Editor → Run.
-- ============================================================================

ALTER TABLE content_rollup ADD COLUMN IF NOT EXISTS glasses_counts   jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE content_rollup ADD COLUMN IF NOT EXISTS facial_counts    jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE content_rollup ADD COLUMN IF NOT EXISTS haircolor_counts jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE content_rollup ADD COLUMN IF NOT EXISTS hairtype_counts  jsonb NOT NULL DEFAULT '{}'::jsonb;

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
    g_male, g_female, g_unknown, age_counts, hour_counts, sum_attention, cnt_attention,
    glasses_counts, facial_counts, haircolor_counts, hairtype_counts
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
    COALESCE((r->>'cnt_attention')::bigint, 0),
    COALESCE(r->'glasses_counts', '{}'::jsonb),
    COALESCE(r->'facial_counts', '{}'::jsonb),
    COALESCE(r->'haircolor_counts', '{}'::jsonb),
    COALESCE(r->'hairtype_counts', '{}'::jsonb)
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
    glasses_counts = EXCLUDED.glasses_counts,
    facial_counts = EXCLUDED.facial_counts,
    haircolor_counts = EXCLUDED.haircolor_counts,
    hairtype_counts = EXCLUDED.hairtype_counts,
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_content_rollup(jsonb) TO anon, authenticated, service_role;
