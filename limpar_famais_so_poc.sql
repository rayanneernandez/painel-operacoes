-- ============================================================================
-- Deixa no cliente FAMAIS apenas a pasta "POC Farmais"
-- ----------------------------------------------------------------------------
-- Apaga as demais lojas/pastas (Vianense, GTHOLDING, teste, STAND...) e os
-- dispositivos delas, mantendo só a POC Farmais e o "POC Farmais The Led".
--
-- ATENÇÃO: isto APAGA dados (só do cliente Famais e só das pastas que NÃO são
-- POC Farmais). Rode as duas etapas na ordem. Supabase → SQL Editor → Run.
--
-- Obs.: sem o deploy do filtro de pasta, uma nova sincronização pode trazer as
-- pastas de volta. Pra ficar permanente, publique ClientsNew.tsx e sync-analytics.ts.
-- ============================================================================

-- 1) Apaga os dispositivos das pastas que NÃO são POC Farmais
DELETE FROM devices
WHERE store_id IN (
  SELECT s.id FROM stores s
  JOIN clients c ON c.id = s.client_id
  WHERE lower(c.name) = 'famais'
    AND lower(s.name) NOT LIKE '%poc farmais%'
);

-- 2) Apaga as pastas/lojas que NÃO são POC Farmais
DELETE FROM stores
WHERE id IN (
  SELECT s.id FROM stores s
  JOIN clients c ON c.id = s.client_id
  WHERE lower(c.name) = 'famais'
    AND lower(s.name) NOT LIKE '%poc farmais%'
);
