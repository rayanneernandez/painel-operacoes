-- ============================================================
-- EXECUTE NO SUPABASE > SQL EDITOR
-- Corrige o índice único da tabela campaigns para funcionar
-- corretamente com o upsert do bot.
-- O índice condicional (WHERE start_date IS NOT NULL) causa
-- erro silencioso no upsert do Supabase Python client.
-- ============================================================

-- 1. Remove o índice condicional antigo
DROP INDEX IF EXISTS idx_campaigns_unique;

-- 2. Cria índice único INCONDICIONAL em (client_id, name)
--    Isso permite que o upsert com on_conflict="client_id,name"
--    funcione corretamente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_client_name
    ON public.campaigns(client_id, name);

-- 3. Garante RLS com acesso total (leitura e escrita)
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Select"  ON public.campaigns;
DROP POLICY IF EXISTS "Public Insert"  ON public.campaigns;
DROP POLICY IF EXISTS "Public Update"  ON public.campaigns;
DROP POLICY IF EXISTS "Public Delete"  ON public.campaigns;
DROP POLICY IF EXISTS "Campaigns Select" ON public.campaigns;
DROP POLICY IF EXISTS "Campaigns Insert" ON public.campaigns;
DROP POLICY IF EXISTS "Campaigns Update" ON public.campaigns;

CREATE POLICY "Campaigns Select" ON public.campaigns FOR SELECT USING (true);
CREATE POLICY "Campaigns Insert" ON public.campaigns FOR INSERT WITH CHECK (true);
CREATE POLICY "Campaigns Update" ON public.campaigns FOR UPDATE USING (true);
