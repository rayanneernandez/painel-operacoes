-- ============================================================================
-- BACKFILL do resumo diário — Panvel (janeiro a julho/2026)
-- ----------------------------------------------------------------------------
-- Preenche a tabela visitor_daily com o histórico. O cálculo pesado roda AQUI,
-- uma vez só. Depois o painel só soma o resumo (instantâneo).
--
-- COMO RODAR: uma linha por vez. Selecione UMA linha, clique "Run selected".
-- Rode a próxima só quando a anterior terminar. (Se um mês estourar o tempo,
-- veja o bloco "POR SEMANA" mais abaixo.)
--
-- O número que cada linha retorna = quantos dias foram gravados no resumo.
-- ============================================================================

-- Panvel = c6999bd9-14c0-4e26-abb1-d4b852d34421

SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-01-01', '2026-01-31');
SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-02-01', '2026-02-28');
SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-03-01', '2026-03-31');
SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-04-01', '2026-04-30');
SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-05-01', '2026-05-31');
SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-06-01', '2026-06-30');
SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-07-01', '2026-07-31');


-- ============================================================================
-- SE ALGUM MÊS ESTOURAR O TEMPO ("upstream timeout"), use POR SEMANA no lugar
-- daquele mês. Exemplo para julho — rode uma linha por vez:
-- ============================================================================
-- SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-07-01', '2026-07-07');
-- SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-07-08', '2026-07-14');
-- SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-07-15', '2026-07-21');
-- SELECT refresh_visitor_daily('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-07-22', '2026-07-31');


-- ============================================================================
-- CONFERÊNCIA: depois do backfill, veja se o resumo bate com o total.
-- Deve voltar rápido. Compare com o painel.
-- ============================================================================
-- Total Jan→Jul pelo resumo:
-- SELECT get_visitor_rollup('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-01-01T00:00:00Z', '2026-07-23T23:59:59Z') ->> 'total_visitors';
--
-- Total junho e julho separados (a soma tem que bater com jun+jul junto):
-- SELECT get_visitor_rollup('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z') ->> 'total_visitors';
-- SELECT get_visitor_rollup('c6999bd9-14c0-4e26-abb1-d4b852d34421', '2026-07-01T00:00:00Z', '2026-07-31T23:59:59Z') ->> 'total_visitors';
