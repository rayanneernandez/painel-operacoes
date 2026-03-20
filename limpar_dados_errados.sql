-- ============================================================
-- EXECUTE NO SUPABASE > SQL EDITOR
-- Remove dados de campanha salvos com o client_id errado.
-- Causa: bot processava e-mail do Assai ao aguardar relatório
-- da Panvel, salvando dados do Assai com client_id da Panvel.
-- ============================================================

-- 1. Ver os dados antes de apagar (para confirmar)
SELECT c.id, c.client_id, cl.name AS cliente_nome, c.name AS campanha,
       c.tipo_midia, c.loja, c.visitors, c.uploaded_at
FROM campaigns c
JOIN clients cl ON cl.id = c.client_id
ORDER BY c.uploaded_at DESC;

-- 2. Apaga TODOS os registros da tabela campaigns
--    (dados de teste e dados com client_id errado)
--    Execute esta linha somente se quiser limpar tudo:
DELETE FROM campaigns;

-- OU, se quiser apagar apenas os dados do Assai salvos
-- com o client_id da Panvel (substitua pelo UUID correto da Panvel):
-- DELETE FROM campaigns
-- WHERE client_id = 'c6999bd9-14c0-4e26-abb1-d4b852d34421';
