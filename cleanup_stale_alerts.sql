-- ============================================================
-- LIMPEZA DE ALERTAS "STALE" (resolved_at IS NULL inconsistente)
--
-- Problema: registros antigos com resolved_at IS NULL mas que
-- claramente foram resolvidos (existe queda POSTERIOR para o
-- mesmo dispositivo na mesma loja).
--
-- Solução: inferir resolved_at = first_detected_at do próximo
-- evento (o menor timestamp posterior ao registro stale).
--
-- Agrupa por device_name + store_id + client_id para cobrir
-- casos onde o device_id mudou por renomeação.
--
-- SEGURO: só atualiza registros que têm um evento mais novo —
-- dispositivos genuinamente offline não são tocados.
-- ============================================================

-- 1. PREVIEW — veja quais registros serão afetados antes de executar
SELECT
  a.id,
  a.client_id,
  a.store_name,
  a.device_name,
  a.first_detected_at AS queda_original,
  MIN(b.first_detected_at) AS retorno_inferido,
  a.status AS status_atual
FROM device_offline_alerts a
JOIN device_offline_alerts b ON (
  b.device_name = a.device_name
  AND b.client_id = a.client_id
  AND b.store_id  = a.store_id
  AND b.first_detected_at > a.first_detected_at
)
WHERE a.resolved_at IS NULL
GROUP BY a.id, a.client_id, a.store_name, a.device_name, a.first_detected_at, a.status
ORDER BY a.store_name, a.device_name, a.first_detected_at;


-- ============================================================
-- 2. EXECUTAR A CORREÇÃO (rode após confirmar o preview acima)
-- ============================================================

WITH stale_records AS (
  SELECT
    a.id,
    MIN(b.first_detected_at) AS inferred_resolved_at
  FROM device_offline_alerts a
  JOIN device_offline_alerts b ON (
    b.device_name       = a.device_name
    AND b.client_id     = a.client_id
    AND b.store_id      = a.store_id
    AND b.first_detected_at > a.first_detected_at
  )
  WHERE a.resolved_at IS NULL
  GROUP BY a.id
)
UPDATE device_offline_alerts
SET
  resolved_at         = stale_records.inferred_resolved_at,
  last_seen_online_at = stale_records.inferred_resolved_at,
  status              = 'resolved',
  updated_at          = NOW()
FROM stale_records
WHERE device_offline_alerts.id = stale_records.id;


-- ============================================================
-- 3. CONFERÊNCIA — quantos foram corrigidos
-- ============================================================
SELECT COUNT(*) AS alertas_ainda_abertos_sem_evento_posterior
FROM device_offline_alerts
WHERE resolved_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM device_offline_alerts b
    WHERE b.device_name     = device_offline_alerts.device_name
      AND b.client_id       = device_offline_alerts.client_id
      AND b.store_id        = device_offline_alerts.store_id
      AND b.first_detected_at > device_offline_alerts.first_detected_at
  );
-- Esses são os alertas genuinamente em aberto (device ainda offline)
