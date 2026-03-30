-- ============================================================
-- EXECUTE NO SUPABASE > SQL EDITOR
-- Limpa registros errados da tabela campaigns
-- (nomes de arquivos no lugar de nomes de campanhas)
-- ============================================================

-- 1. Ver o que vai ser deletado antes de executar
SELECT id, name, tipo_midia, loja, visitors
FROM campaigns
WHERE name LIKE '%.png'
   OR name LIKE '%.jpg'
   OR name LIKE '%.mp4'
   OR name LIKE '%.xlsx'
   OR name LIKE '%imagem_%';

-- 2. Deletar registros com nome = filename (errados)
DELETE FROM campaigns
WHERE name LIKE '%.png'
   OR name LIKE '%.jpg'
   OR name LIKE '%.mp4'
   OR name LIKE '%.xlsx'
   OR name LIKE '%imagem_%';

-- 3. Também limpa registros com loja = nome da campanha (mapeamento errado antigo)
-- Só deleta se o loja for igual ao name (sinal de mapeamento errado)
DELETE FROM campaigns
WHERE loja = name
  AND loja != '';

-- 4. Verificar o que ficou
SELECT name, tipo_midia, loja, start_date::date, end_date::date, visitors, avg_attention_sec
FROM campaigns
ORDER BY name, loja;
