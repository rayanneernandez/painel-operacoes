-- ============================================================
-- EXECUTE NO SUPABASE > SQL EDITOR
-- Adiciona colunas tipo_midia e loja na tabela campaigns
-- para refletir o formato real do relatório DisplayForce
-- ============================================================

-- 1. Apaga dados de teste inseridos manualmente
DELETE FROM campaigns
WHERE name IN ('Campanha Natal 2024', 'Campanha Verão 2025', 'Campanha Páscoa 2025');

-- 2. Adiciona colunas tipo_midia e loja
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS tipo_midia TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS loja       TEXT NOT NULL DEFAULT '';

-- 3. Remove índices antigos
DROP INDEX IF EXISTS idx_campaigns_unique;
DROP INDEX IF EXISTS idx_campaigns_client_name;

-- 4. Novo índice único com tipo_midia e loja
CREATE UNIQUE INDEX idx_campaigns_unique
    ON public.campaigns(client_id, name, tipo_midia, loja);

-- 5. Garante RLS e políticas de acesso
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Campaigns Select" ON public.campaigns;
DROP POLICY IF EXISTS "Campaigns Insert" ON public.campaigns;
DROP POLICY IF EXISTS "Campaigns Update" ON public.campaigns;
DROP POLICY IF EXISTS "Public Select"    ON public.campaigns;
DROP POLICY IF EXISTS "Public Insert"    ON public.campaigns;
DROP POLICY IF EXISTS "Public Update"    ON public.campaigns;
DROP POLICY IF EXISTS "Public Delete"    ON public.campaigns;

CREATE POLICY "Campaigns Select" ON public.campaigns FOR SELECT USING (true);
CREATE POLICY "Campaigns Insert" ON public.campaigns FOR INSERT WITH CHECK (true);
CREATE POLICY "Campaigns Update" ON public.campaigns FOR UPDATE USING (true);
