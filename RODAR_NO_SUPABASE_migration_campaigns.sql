-- ============================================================
-- MIGRAÇÃO COMPLETA DA TABELA CAMPAIGNS
-- Execute ESTE arquivo no Supabase > SQL Editor
-- É seguro rodar múltiplas vezes (usa IF NOT EXISTS / IF EXISTS)
-- ============================================================

-- 1. Adiciona colunas que podem estar faltando
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS tipo_midia    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS loja          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_name  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS display_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uploaded_at   TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status        TEXT,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ;

-- 2. Normaliza valores NULL nas colunas NOT NULL (para dados antigos)
UPDATE public.campaigns
SET
  tipo_midia   = COALESCE(NULLIF(tipo_midia,   ''), ''),
  loja         = COALESCE(NULLIF(loja,         ''), ''),
  content_name = COALESCE(NULLIF(content_name, ''), ''),
  display_count = COALESCE(display_count, 0)
WHERE
  tipo_midia IS NULL
  OR loja IS NULL
  OR content_name IS NULL
  OR display_count IS NULL;

-- 3. Remove índices únicos antigos (podem conflitar)
DROP INDEX IF EXISTS idx_campaigns_unique;
DROP INDEX IF EXISTS idx_campaigns_client_name;

-- 4. Cria índice único correto para upsert do bot
--    (client_id + name + content_name + tipo_midia + loja)
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_unique_full
  ON public.campaigns (client_id, name, content_name, tipo_midia, loja);

-- 5. Garante RLS com acesso total
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Select"     ON public.campaigns;
DROP POLICY IF EXISTS "Public Insert"     ON public.campaigns;
DROP POLICY IF EXISTS "Public Update"     ON public.campaigns;
DROP POLICY IF EXISTS "Public Delete"     ON public.campaigns;
DROP POLICY IF EXISTS "Campaigns Select"  ON public.campaigns;
DROP POLICY IF EXISTS "Campaigns Insert"  ON public.campaigns;
DROP POLICY IF EXISTS "Campaigns Update"  ON public.campaigns;
DROP POLICY IF EXISTS "Campaigns Delete"  ON public.campaigns;

CREATE POLICY "Campaigns Select" ON public.campaigns FOR SELECT USING (true);
CREATE POLICY "Campaigns Insert" ON public.campaigns FOR INSERT WITH CHECK (true);
CREATE POLICY "Campaigns Update" ON public.campaigns FOR UPDATE USING (true);
CREATE POLICY "Campaigns Delete" ON public.campaigns FOR DELETE USING (true);

-- 6. Verifica resultado
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'campaigns'
ORDER BY ordinal_position;
