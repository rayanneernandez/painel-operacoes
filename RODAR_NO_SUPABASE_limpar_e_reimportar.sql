-- ============================================================
-- LIMPAR dados com mapeamento errado (loja vinha do Device)
-- Rodar ANTES de executar reimportar_agora.bat
-- ============================================================

-- Apaga todos os registros da Panvel para reimportar corretamente
DELETE FROM campaigns
WHERE client_id = 'c6999bd9-14c0-4e26-abb1-d4b852d34421';

-- Confirma
SELECT COUNT(*) AS registros_restantes FROM campaigns
WHERE client_id = 'c6999bd9-14c0-4e26-abb1-d4b852d34421';
