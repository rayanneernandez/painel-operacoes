-- ============================================================================
-- devices.activation_date — data de instalação/ativação do dispositivo
-- ----------------------------------------------------------------------------
-- A API da DisplayForce (/device/list) devolve "activation_date". A partir do
-- próximo sync de lojas/dispositivos, o painel grava essa data aqui e mostra na
-- expansão de cada device na tela de Evolução (Semanal por Loja).
--
-- Seguro rodar: só adiciona a coluna (nada é apagado).
-- Supabase → SQL Editor → cola tudo → Run.
-- ============================================================================

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS activation_date timestamptz;
