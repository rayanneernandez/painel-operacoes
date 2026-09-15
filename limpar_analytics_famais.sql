-- ============================================================================
-- Zera o Famais de vez — cria índice (delete rápido) e apaga a visitor_analytics
-- id do Famais: a48d30c4-9ea6-4189-903e-c0fa563f650e
-- Rode tudo de uma vez. Supabase → SQL Editor → Run.
-- ============================================================================

-- 1) Índice por client_id (faz o delete usar índice em vez de varrer 1M de linhas).
--    Também acelera o painel no dia a dia. Roda uma vez só.
CREATE INDEX IF NOT EXISTS idx_visitor_analytics_client_id
  ON visitor_analytics (client_id);

-- 2) Agora apaga as linhas do Famais (rápido, com o índice acima).
DELETE FROM visitor_analytics         WHERE client_id = 'a48d30c4-9ea6-4189-903e-c0fa563f650e';

-- 3) Reforça a limpeza dos resumos/cache (eles são recriados a partir da
--    visitor_analytics, então apaga DEPOIS que ela já está limpa).
DELETE FROM visitor_analytics_rollups WHERE client_id = 'a48d30c4-9ea6-4189-903e-c0fa563f650e';
DELETE FROM visitor_daily             WHERE client_id = 'a48d30c4-9ea6-4189-903e-c0fa563f650e';
DELETE FROM visitor_total_cache       WHERE client_id = 'a48d30c4-9ea6-4189-903e-c0fa563f650e';
