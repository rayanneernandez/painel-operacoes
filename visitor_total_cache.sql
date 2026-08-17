-- ============================================================================
-- visitor_total_cache — cache do "Total de Visitantes (Alcance)" por período
-- ----------------------------------------------------------------------------
-- Guarda o total exato que a API DisplayForce devolve (pagination.total) para
-- cada cliente + período + conjunto de devices. O painel lê daqui (instantâneo);
-- o backend (count_only) só chama a API quando o período está faltando no cache
-- ou quando toca o dia de hoje e o cache passou de 30 min (dados ainda mudam).
-- Meses fechados (fim < hoje) nunca ficam velhos: o número não muda mais.
--
-- Seguro rodar: só cria a tabela. Supabase → SQL Editor → cola tudo → Run
-- (escolha "Run without RLS" / sem habilitar RLS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS visitor_total_cache (
  client_id    uuid        NOT NULL,
  period_start date        NOT NULL,
  period_end   date        NOT NULL,
  device_key   text        NOT NULL DEFAULT '',   -- '' = rede toda; senão devices ordenados por vírgula
  total        bigint      NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, period_start, period_end, device_key)
);

-- Garante que o backend (service role) escreva sem depender de RLS.
ALTER TABLE visitor_total_cache DISABLE ROW LEVEL SECURITY;
