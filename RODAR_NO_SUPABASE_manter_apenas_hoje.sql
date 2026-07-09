-- ============================================================
-- Apaga registros antigos (mapeamento errado)
-- Mantém APENAS os importados hoje (junho e julho corretos)
-- ============================================================

-- Visualiza o que será apagado antes de confirmar
SELECT COUNT(*) AS registros_antigos
FROM campaigns
WHERE client_id = 'c6999bd9-14c0-4e26-abb1-d4b852d34421'
  AND DATE(uploaded_at) < CURRENT_DATE;

-- Execute a linha abaixo separadamente depois de confirmar o número acima:
DELETE FROM campaigns
WHERE client_id = 'c6999bd9-14c0-4e26-abb1-d4b852d34421'
  AND DATE(uploaded_at) < CURRENT_DATE;

-- Confirma o que ficou
SELECT COUNT(*) AS registros_mantidos, MIN(uploaded_at) AS mais_antigo
FROM campaigns
WHERE client_id = 'c6999bd9-14c0-4e26-abb1-d4b852d34421';
