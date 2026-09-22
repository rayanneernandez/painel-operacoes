-- ============================================================================
-- campaign_import_log — registro (imutável) de cada importação de campanhas
-- ----------------------------------------------------------------------------
-- Cada import vira uma linha própria: quando foi importado + período importado
-- + quantos registros. Nunca é sobrescrito, então o histórico sempre cresce
-- (reimportar o mesmo período gera uma nova linha).
--
-- Seguro rodar: só cria a tabela. Supabase → SQL Editor → cola tudo → Run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS campaign_import_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid        NOT NULL,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  period_start date,
  period_end   date,
  records      integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_campaign_import_log_client
  ON campaign_import_log (client_id, imported_at DESC);

ALTER TABLE campaign_import_log DISABLE ROW LEVEL SECURITY;
