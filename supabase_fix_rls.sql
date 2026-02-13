-- EXECUTE ESTE SCRIPT NO SQL EDITOR DO SUPABASE PARA CORRIGIR O ERRO "row-level security policy"

-- 1. Habilita RLS (garantia)
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_api_configs ENABLE ROW LEVEL SECURITY;

-- 2. Remove políticas antigas para evitar conflitos
DROP POLICY IF EXISTS "Public Access Clients" ON clients;
DROP POLICY IF EXISTS "Public Access Stores" ON stores;
DROP POLICY IF EXISTS "Public Access Devices" ON devices;
DROP POLICY IF EXISTS "Public Access Permissions" ON client_permissions;
DROP POLICY IF EXISTS "Public Access API Configs" ON client_api_configs;

-- 3. Cria novas permissões de leitura e escrita TOTAL (Público) para todas as tabelas
-- ATENÇÃO: Em produção real, você deve restringir isso. Para desenvolvimento rápido, isso libera tudo.

CREATE POLICY "Public Access Clients" ON clients FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public Access Stores" ON stores FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public Access Devices" ON devices FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public Access Permissions" ON client_permissions FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public Access API Configs" ON client_api_configs FOR ALL USING (true) WITH CHECK (true);