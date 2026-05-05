import { getZapResponderConfigFromEnv, normalizeBrazilPhone, sendZapTextMessage } from "./zapresponder.js";

const SAO_PAULO_TIMEZONE = "America/Sao_Paulo";

function safeTrim(value) {
  return String(value ?? "").trim();
}

function parsePositiveInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: SAO_PAULO_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return safeTrim(value);
  }
}

function minutesBetween(startValue, endValue) {
  const startMs = Date.parse(String(startValue));
  const endMs = Date.parse(String(endValue));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 60000);
}

function buildOfflineAlertMessage({
  clientName,
  storeName,
  deviceName,
  macAddress,
  offlineSince,
  delayMinutes,
  offlineReason,
}) {
  const lines = [
    "ALERTA: dispositivo offline",
    "",
    `Rede: ${clientName || "Nao informada"}`,
    `Loja: ${storeName || "Nao informada"}`,
    `Dispositivo: ${deviceName || "Sem nome"}`,
  ];

  if (macAddress) {
    lines.push(`MAC/ID: ${macAddress}`);
  }

  lines.push(`Offline desde: ${formatDateTime(offlineSince)}`);
  lines.push(`Tempo minimo confirmado: ${delayMinutes} minutos`);
  if (safeTrim(offlineReason)) {
    lines.push(`Motivo informado: ${safeTrim(offlineReason)}`);
  }
  lines.push("");
  lines.push("O dispositivo segue offline apos a janela de validacao do monitoramento.");
  lines.push("Monitoramento Global IA");

  return lines.join("\n");
}

function buildOfflineReasonUpdateMessage({
  clientName,
  storeName,
  deviceName,
  offlineReason,
}) {
  return [
    "ATUALIZACAO DO ALERTA OFFLINE",
    "",
    `Rede: ${clientName || "Nao informada"}`,
    `Loja: ${storeName || "Nao informada"}`,
    `Dispositivo: ${deviceName || "Sem nome"}`,
    `Motivo informado: ${safeTrim(offlineReason) || "Nao informado"}`,
    "",
    "Monitoramento Global IA",
  ].join("\n");
}

function buildResolvedMessage({
  clientName,
  storeName,
  deviceName,
  resolvedAt,
}) {
  return [
    "RESOLVIDO: dispositivo voltou online",
    "",
    `Rede: ${clientName || "Nao informada"}`,
    `Loja: ${storeName || "Nao informada"}`,
    `Dispositivo: ${deviceName || "Sem nome"}`,
    `Normalizado em: ${formatDateTime(resolvedAt)}`,
    "",
    "Monitoramento Global IA",
  ].join("\n");
}

function dedupeContacts(rawContacts) {
  const seen = new Set();
  const deduped = [];

  for (const contact of rawContacts || []) {
    const normalized = normalizeBrazilPhone(contact.phone_e164 || contact.phone_number);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push({
      ...contact,
      phone_e164: normalized,
    });
  }

  return deduped;
}

function resolveRecipients(contacts, storeId) {
  const normalizedStoreId = safeTrim(storeId);
  const allContacts = dedupeContacts(contacts);
  const storeContacts = allContacts.filter((contact) => safeTrim(contact.store_id) === normalizedStoreId);
  if (storeContacts.length > 0) return storeContacts;
  return allContacts.filter((contact) => !safeTrim(contact.store_id));
}

async function sendMessageToRecipients(recipients, message) {
  let sentCount = 0;
  const failures = [];

  for (const recipient of recipients) {
    try {
      await sendZapTextMessage({
        number: recipient.phone_e164 || recipient.phone_number,
        message,
      });
      sentCount += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${safeTrim(recipient.responsible_name) || "Contato"}: ${reason}`);
    }
  }

  return {
    sentCount,
    failures,
  };
}

async function loadClientName(supabase, clientId) {
  const { data, error } = await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    console.warn("[monitoring] Erro ao buscar nome do cliente:", error.message || error);
    return "";
  }

  return safeTrim(data?.name);
}

export async function processOfflineMonitoring({
  supabase,
  clientId,
  clientName = "",
  storesPayload = [],
  devicesPayload = [],
}) {
  const zapConfig = getZapResponderConfigFromEnv();
  const offlineDelayMinutes = parsePositiveInt(
    process.env.MONITORING_OFFLINE_DELAY_MINUTES,
    30
  );
  const resolutionEnabled =
    safeTrim(process.env.MONITORING_SEND_RESOLUTION || "true").toLowerCase() !== "false";

  if (!clientId || !supabase || !Array.isArray(devicesPayload) || devicesPayload.length === 0) {
    return { skipped: true, reason: "missing-input" };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const resolvedClientName = safeTrim(clientName) || (await loadClientName(supabase, clientId));
  const storeNameById = new Map(
    (storesPayload || []).map((store) => [safeTrim(store.id), safeTrim(store.name)])
  );

  const { data: contactsData, error: contactsError } = await supabase
    .from("monitoring_whatsapp_contacts")
    .select("id, client_id, store_id, responsible_name, phone_number, phone_e164, enabled, receive_offline_alerts")
    .eq("client_id", clientId)
    .eq("enabled", true)
    .eq("receive_offline_alerts", true);

  if (contactsError) {
    const message = contactsError.message || "";
    if (message.toLowerCase().includes("does not exist")) {
      console.warn("[monitoring] Tabelas de monitoramento ainda nao criadas.");
      return { skipped: true, reason: "missing-tables" };
    }
    throw contactsError;
  }

  const deviceIds = devicesPayload
    .map((device) => safeTrim(device.id))
    .filter(Boolean);

  const { data: activeAlerts, error: activeAlertsError } = await supabase
    .from("device_offline_alerts")
    .select("*")
    .eq("client_id", clientId)
    .eq("alert_type", "offline")
    .is("resolved_at", null)
    .in("device_id", deviceIds);

  if (activeAlertsError) {
    const message = activeAlertsError.message || "";
    if (message.toLowerCase().includes("does not exist")) {
      console.warn("[monitoring] Tabelas de monitoramento ainda nao criadas.");
      return { skipped: true, reason: "missing-tables" };
    }
    throw activeAlertsError;
  }

  const alertByDeviceId = new Map(
    (activeAlerts || []).map((alert) => [safeTrim(alert.device_id), alert])
  );

  const inserts = [];
  const updates = [];
  const summary = {
    opened: 0,
    notified: 0,
    resolved: 0,
    cancelled: 0,
    errors: [],
    configured: zapConfig.configured,
    missingEnv: zapConfig.missing,
    offlineDelayMinutes,
  };

  for (const rawDevice of devicesPayload) {
    const deviceId = safeTrim(rawDevice.id);
    if (!deviceId) continue;

    const rawStatus = safeTrim(rawDevice.status).toLowerCase();
    const currentStatus =
      rawStatus === "online"
        ? "online"
        : rawStatus === "not_connected" || rawStatus === "not connected"
          ? "not_connected"
          : "offline";
    const storeId = safeTrim(rawDevice.store_id);
    const alert = alertByDeviceId.get(deviceId);
    const storeName = storeNameById.get(storeId) || safeTrim(alert?.store_name) || "Loja sem nome";
    const deviceName = safeTrim(rawDevice.name) || safeTrim(alert?.device_name) || "Dispositivo sem nome";
    const macAddress = safeTrim(rawDevice.mac_address) || safeTrim(rawDevice.macAddress) || safeTrim(alert?.mac_address);
    const offlineReason = safeTrim(alert?.offline_reason);

    if (currentStatus === "offline") {
      if (!alert) {
        inserts.push({
          client_id: clientId,
          store_id: storeId || null,
          device_id: deviceId,
          alert_type: "offline",
          status: "pending",
          device_name: deviceName,
          store_name: storeName,
          client_name: resolvedClientName || null,
          mac_address: macAddress || null,
          offline_reason: null,
          offline_reason_updated_at: null,
          offline_reason_sent_at: null,
          first_detected_at: nowIso,
          last_seen_offline_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        });
        summary.opened += 1;
        continue;
      }

      const update = {
        id: alert.id,
        client_id: clientId,
        store_id: storeId || null,
        device_id: deviceId,
        alert_type: "offline",
        status: alert.notified_at ? "notified" : "pending",
        device_name: deviceName,
        store_name: storeName,
        client_name: resolvedClientName || null,
        mac_address: macAddress || null,
        first_detected_at: alert.first_detected_at,
        last_seen_offline_at: nowIso,
        notified_at: alert.notified_at || null,
        notification_attempts: Number(alert.notification_attempts || 0),
        notified_contact_count: Number(alert.notified_contact_count || 0),
        resolution_sent_at: alert.resolution_sent_at || null,
        resolution_contact_count: Number(alert.resolution_contact_count || 0),
        last_notification_error: alert.last_notification_error || null,
        offline_reason: offlineReason || null,
        offline_reason_updated_at: alert.offline_reason_updated_at || null,
        offline_reason_sent_at: alert.offline_reason_sent_at || null,
        created_at: alert.created_at || nowIso,
        updated_at: nowIso,
      };

      const shouldNotify =
        !alert.notified_at &&
        minutesBetween(alert.first_detected_at, nowIso) >= offlineDelayMinutes;

      if (shouldNotify) {
        const recipients = resolveRecipients(contactsData || [], storeId);
        update.notification_attempts += 1;

        if (!zapConfig.configured) {
          update.last_notification_error = `Configuracao pendente: ${zapConfig.missing.join(", ")}`;
          summary.errors.push(update.last_notification_error);
        } else if (recipients.length === 0) {
          update.last_notification_error = "Nenhum contato ativo para a loja/rede";
          summary.errors.push(update.last_notification_error);
        } else {
          const sendResult = await sendMessageToRecipients(
            recipients,
            buildOfflineAlertMessage({
              clientName: resolvedClientName,
              storeName,
              deviceName,
              macAddress,
              offlineSince: alert.first_detected_at,
              delayMinutes: offlineDelayMinutes,
              offlineReason,
            })
          );

          if (sendResult.sentCount > 0) {
            update.status = "notified";
            update.notified_at = nowIso;
            update.notified_contact_count = sendResult.sentCount;
            update.offline_reason_sent_at = offlineReason ? nowIso : update.offline_reason_sent_at;
            update.last_notification_error =
              sendResult.failures.length > 0 ? sendResult.failures.join(" | ").slice(0, 800) : null;
            summary.notified += 1;
          } else {
            update.last_notification_error =
              sendResult.failures.join(" | ").slice(0, 800) || "Falha ao enviar alerta";
            summary.errors.push(update.last_notification_error);
          }
        }
      }

      const shouldSendReasonUpdate =
        Boolean(alert.notified_at) &&
        Boolean(offlineReason) &&
        Boolean(alert.offline_reason_updated_at) &&
        (!alert.offline_reason_sent_at ||
          Date.parse(String(alert.offline_reason_updated_at)) > Date.parse(String(alert.offline_reason_sent_at)));

      if (shouldSendReasonUpdate) {
        const recipients = resolveRecipients(contactsData || [], storeId);

        if (!zapConfig.configured) {
          update.last_notification_error = `Configuracao pendente: ${zapConfig.missing.join(", ")}`;
          summary.errors.push(update.last_notification_error);
        } else if (recipients.length === 0) {
          update.last_notification_error = "Nenhum contato ativo para enviar o motivo do offline";
          summary.errors.push(update.last_notification_error);
        } else {
          const sendResult = await sendMessageToRecipients(
            recipients,
            buildOfflineReasonUpdateMessage({
              clientName: resolvedClientName,
              storeName,
              deviceName,
              offlineReason,
            })
          );

          if (sendResult.sentCount > 0) {
            update.offline_reason_sent_at = nowIso;
            update.last_notification_error =
              sendResult.failures.length > 0 ? sendResult.failures.join(" | ").slice(0, 800) : null;
          } else {
            update.last_notification_error =
              sendResult.failures.join(" | ").slice(0, 800) || "Falha ao enviar atualizacao de motivo";
            summary.errors.push(update.last_notification_error);
          }
        }
      }

      updates.push(update);
      continue;
    }

    if (!alert) continue;

    const movedBackOnline = currentStatus === "online";
    const update = {
      id: alert.id,
      client_id: clientId,
      store_id: storeId || alert.store_id || null,
      device_id: deviceId,
      alert_type: "offline",
      status: movedBackOnline && alert.notified_at ? "resolved" : "cancelled",
      device_name: deviceName,
      store_name: storeName,
      client_name: resolvedClientName || null,
      mac_address: macAddress || null,
      first_detected_at: alert.first_detected_at,
      last_seen_offline_at: alert.last_seen_offline_at || alert.first_detected_at,
      last_seen_online_at: nowIso,
      notified_at: alert.notified_at || null,
      notification_attempts: Number(alert.notification_attempts || 0),
      notified_contact_count: Number(alert.notified_contact_count || 0),
      resolution_sent_at: alert.resolution_sent_at || null,
      resolution_contact_count: Number(alert.resolution_contact_count || 0),
      last_notification_error: alert.last_notification_error || null,
      offline_reason: offlineReason || null,
      offline_reason_updated_at: alert.offline_reason_updated_at || null,
      offline_reason_sent_at: alert.offline_reason_sent_at || null,
      resolved_at: nowIso,
      created_at: alert.created_at || nowIso,
      updated_at: nowIso,
    };

    if (movedBackOnline && resolutionEnabled && alert.notified_at && !alert.resolution_sent_at && zapConfig.configured) {
      const recipients = resolveRecipients(contactsData || [], storeId || alert.store_id);
      if (recipients.length > 0) {
        const sendResult = await sendMessageToRecipients(
          recipients,
          buildResolvedMessage({
            clientName: resolvedClientName,
            storeName,
            deviceName,
            resolvedAt: nowIso,
          })
        );

        if (sendResult.sentCount > 0) {
          update.resolution_sent_at = nowIso;
          update.resolution_contact_count = sendResult.sentCount;
        }

        if (sendResult.failures.length > 0) {
          update.last_notification_error = sendResult.failures.join(" | ").slice(0, 800);
          summary.errors.push(update.last_notification_error);
        }
      }
    }

    updates.push(update);
    if (movedBackOnline && alert.notified_at) summary.resolved += 1;
    else summary.cancelled += 1;
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("device_offline_alerts").insert(inserts);
    if (error) throw error;
  }

  if (updates.length > 0) {
    const { error } = await supabase
      .from("device_offline_alerts")
      .upsert(updates, { onConflict: "id" });
    if (error) throw error;
  }

  return summary;
}
