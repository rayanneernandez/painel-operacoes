-- ============================================================
-- ATUALIZA tabela campaigns com dados do arquivo
-- "Views of visitors_20260330_152902.csv" (Assai)
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Remove registros antigos do Assai para reinserir corretamente
DELETE FROM campaigns
WHERE client_id = 'b1c05e4d-0417-4853-9af9-8c0725df1880';

-- 2. Insere os 3 registros corretos extraídos do Views of visitors
INSERT INTO campaigns (client_id, name, tipo_midia, loja, start_date, end_date, duration_days, duration_hms, visitors, avg_attention_sec, uploaded_at)
VALUES
  (
    'b1c05e4d-0417-4853-9af9-8c0725df1880',
    'Assai - Imagem Ficticia',
    'Entrada',
    'Aricanduva',
    '2026-03-02T04:29:54+00:00',
    '2026-03-30T12:22:30+00:00',
    28.33,
    '679:52:36',
    61835,
    8,
    NOW()
  ),
  (
    'b1c05e4d-0417-4853-9af9-8c0725df1880',
    'Assai - Imagem Ficticia',
    'Gôndola Virada Açougue',
    'Barueri',
    '2026-03-01T01:15:35+00:00',
    '2026-03-30T12:22:50+00:00',
    29.46,
    '707:07:15',
    57506,
    16,
    NOW()
  ),
  (
    'b1c05e4d-0417-4853-9af9-8c0725df1880',
    'Assai - Imagem Ficticia',
    'Gôndola Virada Cafeteria',
    'Barueri',
    '2026-03-01T03:30:44+00:00',
    '2026-03-30T12:22:21+00:00',
    29.37,
    '704:51:37',
    45359,
    4,
    NOW()
  );

-- Verifica resultado
SELECT name, tipo_midia, loja, visitors, avg_attention_sec, start_date, end_date
FROM campaigns
WHERE client_id = 'b1c05e4d-0417-4853-9af9-8c0725df1880'
ORDER BY loja, tipo_midia;
