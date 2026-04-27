-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ Bloqueio de acesso agendado — usuários e clientes                    │
-- │                                                                       │
-- │ Estende `status` (active/inactive) com janela de tempo:              │
-- │   block_starts_at — quando o bloqueio começa a valer (NULL = imediato│
-- │                     se status='inactive')                             │
-- │   block_ends_at   — quando o bloqueio expira automaticamente         │
-- │                     (NULL = bloqueio indefinido)                     │
-- │   block_reason    — motivo (opcional, audit/admin)                    │
-- │   blocked_at      — quando foi marcado como bloqueado                │
-- │   blocked_by      — quem bloqueou (user.id do admin)                 │
-- │                                                                       │
-- │ A checagem em runtime fica no AuthContext.assertAccessAllowed:       │
-- │   bloqueado = status='inactive' OU (now() entre starts_at e ends_at) │
-- │                                                                       │
-- │ Rode este script no SQL Editor do Supabase. É idempotente.           │
-- └──────────────────────────────────────────────────────────────────────┘

-- ── users ────────────────────────────────────────────────────────────────
-- Em users só usamos a janela block_starts_at / block_ends_at — não exigimos
-- coluna `status` porque o controle de bloqueio é feito 100% pelas datas
-- (Bloquear Agora = janela começa agora; Programar = janela com início futuro).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS block_starts_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS block_ends_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS block_reason    TEXT        NULL,
  ADD COLUMN IF NOT EXISTS blocked_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS blocked_by      UUID        NULL;

-- Força o Supabase a recarregar o schema cache imediatamente.
NOTIFY pgrst, 'reload schema';

COMMENT ON COLUMN public.users.block_starts_at IS 'Janela: a partir de quando o bloqueio passa a valer.';
COMMENT ON COLUMN public.users.block_ends_at   IS 'Janela: quando o bloqueio expira automaticamente (NULL = indefinido).';
COMMENT ON COLUMN public.users.block_reason    IS 'Motivo do bloqueio (ex: inadimplência). Opcional, para auditoria/admin.';
COMMENT ON COLUMN public.users.blocked_at      IS 'Timestamp do momento em que o admin marcou o bloqueio.';
COMMENT ON COLUMN public.users.blocked_by      IS 'ID do admin que aplicou o bloqueio.';

CREATE INDEX IF NOT EXISTS idx_users_block_window
  ON public.users (block_starts_at, block_ends_at)
  WHERE block_starts_at IS NOT NULL OR block_ends_at IS NOT NULL;

-- ── clients ──────────────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS status          TEXT        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS block_starts_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS block_ends_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS block_reason    TEXT        NULL,
  ADD COLUMN IF NOT EXISTS blocked_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS blocked_by      UUID        NULL;

COMMENT ON COLUMN public.clients.status          IS 'active | inactive — bloqueio imediato. Se inactive, bloqueio vigente independente da janela.';
COMMENT ON COLUMN public.clients.block_starts_at IS 'Janela: a partir de quando o cliente passa a estar bloqueado.';
COMMENT ON COLUMN public.clients.block_ends_at   IS 'Janela: quando o bloqueio do cliente expira automaticamente.';
COMMENT ON COLUMN public.clients.block_reason    IS 'Motivo do bloqueio (ex: inadimplência).';
COMMENT ON COLUMN public.clients.blocked_at      IS 'Timestamp do momento em que o admin marcou o bloqueio.';
COMMENT ON COLUMN public.clients.blocked_by      IS 'ID do admin que aplicou o bloqueio.';

CREATE INDEX IF NOT EXISTS idx_clients_block_window
  ON public.clients (block_starts_at, block_ends_at)
  WHERE block_starts_at IS NOT NULL OR block_ends_at IS NOT NULL;

-- ── helper view (opcional): usuários efetivamente bloqueados agora ──────
CREATE OR REPLACE VIEW public.users_blocked_now AS
SELECT
  u.id,
  u.email,
  u.name,
  u.role,
  u.client_id,
  u.status                 AS user_status,
  u.block_starts_at        AS user_block_starts_at,
  u.block_ends_at          AS user_block_ends_at,
  u.block_reason           AS user_block_reason,
  c.status                 AS client_status,
  c.block_starts_at        AS client_block_starts_at,
  c.block_ends_at          AS client_block_ends_at,
  c.block_reason           AS client_block_reason,
  CASE
    WHEN LOWER(COALESCE(u.status, 'active')) IN ('inactive','inativo','blocked','bloqueado','suspended','suspenso')
      THEN TRUE
    WHEN u.block_starts_at IS NOT NULL
         AND NOW() >= u.block_starts_at
         AND (u.block_ends_at IS NULL OR NOW() < u.block_ends_at)
      THEN TRUE
    WHEN u.role = 'client' AND c.id IS NOT NULL AND (
           LOWER(COALESCE(c.status, 'active')) IN ('inactive','inativo','blocked','bloqueado','suspended','suspenso')
        OR (c.block_starts_at IS NOT NULL
            AND NOW() >= c.block_starts_at
            AND (c.block_ends_at IS NULL OR NOW() < c.block_ends_at))
      )
      THEN TRUE
    ELSE FALSE
  END AS is_blocked_now
FROM public.users u
LEFT JOIN public.clients c ON c.id = u.client_id;

COMMENT ON VIEW public.users_blocked_now IS 'Snapshot de quem está efetivamente bloqueado agora — útil para relatórios e auditoria.';
