-- ============================================================================
-- upsert_visitor_daily — grava o resumo diário de VISITANTES ÚNICOS
-- ----------------------------------------------------------------------------
-- O import do painel (arquivo "Visitors" da DisplayForce) agrega por dia e chama
-- esta função pra gravar em visitor_daily (a tabela que o painel já soma via
-- get_visitor_rollup). Assim o "Total de Visitantes" = visitantes únicos (alcance),
-- batendo com a DisplayForce.
--
-- SECURITY DEFINER: permite o painel gravar sem depender de RLS.
-- Seguro rodar: só cria a função. Supabase → SQL Editor → cola tudo → Run.
-- ============================================================================

CREATE OR REPLACE FUNCTION upsert_visitor_daily(p_rows jsonb)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO visitor_daily (
    client_id, day, total, g_male, g_female, g_unknown,
    age_counts, hour_counts, sum_visit, cnt_visit, sum_contact, cnt_contact
  )
  SELECT
    (r->>'client_id')::uuid,
    (r->>'day')::date,
    COALESCE((r->>'total')::bigint, 0),
    COALESCE((r->>'g_male')::bigint, 0),
    COALESCE((r->>'g_female')::bigint, 0),
    COALESCE((r->>'g_unknown')::bigint, 0),
    COALESCE(r->'age_counts', '{}'::jsonb),
    COALESCE(r->'hour_counts', '{}'::jsonb),
    COALESCE((r->>'sum_visit')::numeric, 0),
    COALESCE((r->>'cnt_visit')::bigint, 0),
    COALESCE((r->>'sum_contact')::numeric, 0),
    COALESCE((r->>'cnt_contact')::bigint, 0)
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (client_id, day) DO UPDATE SET
    total = EXCLUDED.total,
    g_male = EXCLUDED.g_male,
    g_female = EXCLUDED.g_female,
    g_unknown = EXCLUDED.g_unknown,
    age_counts = EXCLUDED.age_counts,
    hour_counts = EXCLUDED.hour_counts,
    sum_visit = EXCLUDED.sum_visit,
    cnt_visit = EXCLUDED.cnt_visit,
    sum_contact = EXCLUDED.sum_contact,
    cnt_contact = EXCLUDED.cnt_contact;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_visitor_daily(jsonb) TO anon, authenticated, service_role;
