-- ============================================================
-- Criação da tabela CAMPAIGNS para o Painel de Operações
-- Execute este SQL no Supabase > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.campaigns (
    id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id      uuid REFERENCES public.clients(id) ON DELETE CASCADE,
    name           text NOT NULL,                     -- MIDIA_VALIDADA
    start_date     timestamptz,                       -- INICIO_EXIBIÇÃO
    end_date       timestamptz,                       -- FIM_EXIBIÇÃO
    duration_days  numeric,                           -- Tempo (Dias)
    duration_hms   text,                              -- Tempo (hh:mm:ss)
    visitors       integer DEFAULT 0,                 -- VISITANTES
    avg_attention_sec integer DEFAULT 0,              -- TEMPO_MED ATENÇÃO (em segundos)
    synced_at      timestamptz DEFAULT now(),
    created_at     timestamptz DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_campaigns_client_id  ON public.campaigns(client_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_start_date ON public.campaigns(start_date DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_name       ON public.campaigns(name);

-- Constraint única para evitar duplicatas por cliente + campanha + período
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_unique
    ON public.campaigns(client_id, name, start_date, end_date)
    WHERE start_date IS NOT NULL AND end_date IS NOT NULL;

-- Habilitar RLS
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso
CREATE POLICY "Public Select"  ON public.campaigns FOR SELECT USING (true);
CREATE POLICY "Public Insert"  ON public.campaigns FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update"  ON public.campaigns FOR UPDATE USING (true);
CREATE POLICY "Public Delete"  ON public.campaigns FOR DELETE USING (true);
