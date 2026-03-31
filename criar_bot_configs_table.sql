-- ============================================================
-- CRIA tabela bot_configs para agendamento do bot
-- Execute no SQL Editor do Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bot_configs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horario_execucao  text    NOT NULL DEFAULT '07:00',   -- HH:MM horário diário
  timeout_email_seg integer NOT NULL DEFAULT 1200,       -- segundos aguardando e-mail
  updated_at        timestamptz DEFAULT now()
);

-- Garante apenas 1 linha de configuração global
CREATE UNIQUE INDEX IF NOT EXISTS bot_configs_single_row
  ON public.bot_configs ((true));

-- RLS: service_role (bot) lê e escreve; admins também
ALTER TABLE public.bot_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all"        ON public.bot_configs;
DROP POLICY IF EXISTS "service_role_all" ON public.bot_configs;

CREATE POLICY "service_role_all" ON public.bot_configs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "admin_all" ON public.bot_configs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Insere linha inicial se não existir
INSERT INTO public.bot_configs (horario_execucao, timeout_email_seg)
SELECT '07:00', 1200
WHERE NOT EXISTS (SELECT 1 FROM public.bot_configs);

-- Verifica
SELECT id, horario_execucao, timeout_email_seg, updated_at
FROM public.bot_configs;
