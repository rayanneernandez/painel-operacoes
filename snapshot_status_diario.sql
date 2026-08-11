-- ============================================================================
-- SNAPSHOT DIÁRIO DE STATUS DOS DISPOSITIVOS
-- ----------------------------------------------------------------------------
-- O banco só guarda o status ATUAL dos dispositivos (sem histórico). Esta tabela
-- passa a guardar um RETRATO por dia (por loja): quantos online/offline/não
-- conectado. Assim a página de Evolução fica exata de hoje em diante.
--
--   1) tabela   device_status_daily
--   2) função   snapshot_device_status_today()  -> grava o retrato de hoje
--
-- A página chama a função ao abrir; dá pra agendar também (1x/dia).
-- Dia calculado em 'America/Sao_Paulo'. Dedup por MAC (pior status prevalece).
-- Seguro rodar: cria tabela/função, não apaga dados.
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_status_daily (
  client_id     UUID NOT NULL,
  store_id      UUID NOT NULL,
  date          DATE NOT NULL,
  total         INT  NOT NULL DEFAULT 0,
  online        INT  NOT NULL DEFAULT 0,
  offline       INT  NOT NULL DEFAULT 0,
  not_connected INT  NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (store_id, date)
);

CREATE INDEX IF NOT EXISTS idx_device_status_daily_client_date
  ON device_status_daily (client_id, date);

GRANT SELECT, INSERT, UPDATE ON device_status_daily TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION snapshot_device_status_today()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows  INT;
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  WITH norm AS (
    SELECT
      d.store_id,
      s.client_id,
      COALESCE(NULLIF(TRIM(d.mac_address), ''), d.id::text) AS dedup_key,
      CASE
        WHEN LOWER(TRIM(d.status)) = 'online' THEN 'online'
        WHEN LOWER(TRIM(d.status)) IN ('not_connected', 'not connected') THEN 'not_connected'
        ELSE 'offline'
      END AS st
    FROM devices d
    JOIN stores s ON s.id = d.store_id
  ),
  dedup AS (
    -- 1 linha por (loja, MAC), mantendo o PIOR status: offline > not_connected > online
    SELECT DISTINCT ON (store_id, dedup_key) store_id, client_id, st
    FROM norm
    ORDER BY store_id, dedup_key,
      CASE st WHEN 'offline' THEN 3 WHEN 'not_connected' THEN 2 ELSE 1 END DESC
  )
  INSERT INTO device_status_daily (client_id, store_id, date, total, online, offline, not_connected, updated_at)
  SELECT
    client_id, store_id, v_today,
    COUNT(*),
    COUNT(*) FILTER (WHERE st = 'online'),
    COUNT(*) FILTER (WHERE st = 'offline'),
    COUNT(*) FILTER (WHERE st = 'not_connected'),
    now()
  FROM dedup
  GROUP BY client_id, store_id
  ON CONFLICT (store_id, date) DO UPDATE SET
    client_id     = EXCLUDED.client_id,
    total         = EXCLUDED.total,
    online        = EXCLUDED.online,
    offline       = EXCLUDED.offline,
    not_connected = EXCLUDED.not_connected,
    updated_at    = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION snapshot_device_status_today() TO anon, authenticated, service_role;
