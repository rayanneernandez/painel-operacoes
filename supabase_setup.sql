-- Tabela para armazenar o histórico de visitantes (Analytics)
create table if not exists visitor_analytics (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references clients(id) on delete cascade,
  device_id bigint, -- ID numérico do dispositivo na API (DisplayForce)
  timestamp timestamptz not null,
  age int,
  gender int, -- 1=Masculino, 2=Feminino
  attributes jsonb, -- Armazena óculos, barba, etc.
  raw_data jsonb, -- Backup do payload original
  created_at timestamptz default now()
);

-- Habilitar RLS (Segurança)
alter table visitor_analytics enable row level security;

-- Políticas de Acesso (Permitir leitura/escrita para usuários autenticados e anonimos para teste)
create policy "Public Select" on visitor_analytics for select using (true);
create policy "Public Insert" on visitor_analytics for insert with check (true);
create policy "Public Update" on visitor_analytics for update using (true);
create policy "Public Delete" on visitor_analytics for delete using (true);