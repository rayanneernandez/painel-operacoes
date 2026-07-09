-- ============================================================
-- PASSO 2: Ajusta content_name para NOT NULL DEFAULT ''
-- Execute NO SUPABASE > SQL Editor APÓS a migration anterior
-- ============================================================

-- 1. Preenche NULLs existentes com string vazia
UPDATE public.campaigns
SET content_name = ''
WHERE content_name IS NULL;

-- 2. Torna NOT NULL com default vazio (igual a tipo_midia e loja)
ALTER TABLE public.campaigns
  ALTER COLUMN content_name SET DEFAULT '',
  ALTER COLUMN content_name SET NOT NULL;

-- 3. Também garante display_count NOT NULL
UPDATE public.campaigns
SET display_count = 0
WHERE display_count IS NULL;

ALTER TABLE public.campaigns
  ALTER COLUMN display_count SET NOT NULL;

-- 4. Confirma resultado
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'campaigns'
  AND column_name IN ('content_name', 'tipo_midia', 'loja', 'display_count', 'uploaded_at')
ORDER BY column_name;
