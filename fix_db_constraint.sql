-- 1. Garante que não existem device_id nulos (necessário para a restrição funcionar bem)
UPDATE visitor_analytics SET device_id = 0 WHERE device_id IS NULL;

-- 2. Remove duplicatas existentes (mantendo o ID mais recente) para permitir a criação da constraint
DELETE FROM visitor_analytics a 
USING visitor_analytics b 
WHERE a.id < b.id 
  AND a.timestamp = b.timestamp 
  AND a.device_id = b.device_id 
  AND a.client_id = b.client_id;

-- 3. Adiciona a restrição única necessária para o código funcionar (upsert)
ALTER TABLE visitor_analytics 
ADD CONSTRAINT unique_visit_event UNIQUE (client_id, timestamp, device_id);