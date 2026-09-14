-- ============================================================================
-- client_api_configs.folder_filter — restringe quais pastas entram no painel
-- ----------------------------------------------------------------------------
-- Quando preenchido (ex.: "POC Farmais"), a sincronização de lojas/dispositivos
-- traz SOMENTE as pastas com esses nomes (e os dispositivos dentro delas).
-- Vazio/nulo = traz todas as pastas (comportamento atual). Aceita vários nomes
-- separados por vírgula.
--
-- Seguro rodar: só adiciona a coluna (nada é apagado).
-- Supabase → SQL Editor → cola tudo → Run.
-- ============================================================================

ALTER TABLE public.client_api_configs
  ADD COLUMN IF NOT EXISTS folder_filter text;
