-- Tabela para armazenar logs de auditoria
create table if not exists logs (
  id uuid default gen_random_uuid() primary key,
  user_email text not null,
  action text not null, -- LOGIN, CREATE, UPDATE, DELETE
  description text,
  scope text default 'network', -- network, store, user
  target text, -- O que foi alterado (ex: Cliente X, Loja Y)
  ip_address text,
  metadata jsonb, -- Detalhes extras (ex: campos alterados)
  created_at timestamptz default now()
);

-- Habilitar RLS
alter table logs enable row level security;

-- Permitir que todos leiam e escrevam logs (para simplificar desenvolvimento)
-- Em produção, restringir leitura para Admin e escrita para Authenticated
create policy "Public Access Logs" on logs for all using (true) with check (true);