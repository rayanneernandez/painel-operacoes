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

function formatDelayLabel(delayMinutes) {
  const minutes = parsePositiveInt(delayMinutes, 60);
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} dia${days > 1 ? "s" : ""}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours}h`;
  }
  return `${minutes} minutos`;
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
  lines.push(`Tempo minimo confirmado: ${formatDelayLabel(delayMinutes)}`);
  lines.push("");
  lines.push("O dispositivo segue offline apos a janela de validacao do monitoramento.");
  lines.push("Monitoramento Global IA");

  return lines.join("\n");
}

function buildGroupedOfflineAlertMessage({
  clientName,
  storeName,
  alerts,
  delayMinutes,
}) {
  const normalizedAlerts = Array.isArray(alerts) ? alerts : [];
  const lines = [
    normalizedAlerts.length > 1 ? "ALERTA: dispositivos offline" : "ALERTA: dispositivo offline",
    "",
    `Rede: ${clientName || "Nao informada"}`,
    `Loja: ${storeName || "Nao informada"}`,
    "",
  ];

  normalizedAlerts.forEach((alert, index) => {
    lines.push(`Dispositivo: ${safeTrim(alert.device_name) || "Sem nome"}`);
    if (safeTrim(alert.mac_address)) {
      lines.push(`MAC/ID: ${safeTrim(alert.mac_address)}`);
    }
    lines.push(`Offline desde: ${formatDateTime(alert.first_detected_at)}`);
    if (index < normalizedAlerts.length - 1) {
      lines.push("");
    }
  });

  lines.push("");
  lines.push(`Tempo minimo confirmado: ${formatDelayLabel(delayMinutes)}`);
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

async function loadActiveMonitoringContacts(supabase, clientId) {
  const { data, error } = await supabase
    .from("monitoring_whatsapp_contacts")
    .select("id, client_id, store_id, responsible_name, phone_number, phone_e164, enabled, receive_offline_alerts")
    .eq("client_id", clientId)
    .eq("enabled", true)
    .eq("receive_offline_alerts", true);

  if (error) {
    const message = error.message || "";
    if (message.toLowerCase().includes("does not exist")) {
      return {
        missingTables: true,
        contacts: [],
      };
    }
    throw error;
  }

  return {
    missingTables: false,
    contacts: data || [],
  };
}

function buildAlertUpsertPayload({
  alert,
  nowIso,
  overrides = {},
}) {
  return {
    id: alert.id,
    client_id: alert.client_id,
    store_id: alert.store_id || null,
    device_id: alert.device_id,
    alert_type: "offline",
    status: alert.status || "pending",
    device_name: alert.device_name,
    store_name: alert.store_name,
    client_name: alert.client_name || null,
    mac_address: alert.mac_address || null,
    first_detected_at: alert.first_detected_at,
    last_seen_offline_at: alert.last_seen_offline_at || alert.first_detected_at,
    last_seen_online_at: alert.last_seen_online_at || null,
    notified_at: alert.notified_at || null,
    last_notification_sent_at: alert.last_notification_sent_at || null,
    notification_attempts: Number(alert.notification_attempts || 0),
    notified_contact_count: Number(alert.notified_contact_count || 0),
    resolution_sent_at: alert.resolution_sent_at || null,
    resolution_contact_count: Number(alert.resolution_contact_count || 0),
    last_notification_error: alert.last_notification_error || null,
    offline_reason: safeTrim(alert.offline_reason) || null,
    offline_reason_updated_at: alert.offline_reason_updated_at || null,
    offline_reason_sent_at: alert.offline_reason_sent_at || null,
    resolved_at: alert.resolved_at || null,
    created_at: alert.created_at || nowIso,
    updated_at: nowIso,
    ...overrides,
  };
}

function getSuccessfulNotificationCount(alert) {
  if (!alert?.notified_at) return 0;
  const attempts = Number(alert?.notification_attempts || 0);
  return attempts > 0 ? attempts : 1;
}

function getLastNotificationSentAt(alert) {
  return safeTrim(alert?.last_notification_sent_at) || safeTrim(alert?.notified_at) || "";
}

function getNextNotificationIntervalMinutes(sentCount, offlineDelayMinutes) {
  if (sentCount <= 0) return offlineDelayMinutes;
  if (sentCount === 1 || sentCount === 2) return 24 * 60;
  return 3 * 24 * 60;
}

function isAlertDueForDispatch(alert, nowIso, offlineDelayMinutes) {
  const sentCount = getSuccessfulNotificationCount(alert);
  if (sentCount <= 0) {
    return minutesBetween(alert.first_detected_at, nowIso) >= offlineDelayMinutes;
  }

  const lastSentAt = getLastNotificationSentAt(alert);
  if (!lastSentAt) return false;
  return (
    minutesBetween(lastSentAt, nowIso) >=
    getNextNotificationIntervalMinutes(sentCount, offlineDelayMinutes)
  );
}

function buildAlertGroupKey(alert) {
  return safeTrim(alert?.store_id) || "__network__";
}

function groupAlertsByStore(alerts) {
  const groups = new Map();

  for (const alert of Array.isArray(alerts) ? alerts : []) {
    const key = buildAlertGroupKey(alert);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        storeId: safeTrim(alert?.store_id) || null,
        storeName: safeTrim(alert?.store_name) || "Rede inteira",
        clientName: safeTrim(alert?.client_name) || "",
        alerts: [alert],
      });
      continue;
    }

    existing.alerts.push(alert);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    alerts: [...group.alerts].sort(
      (a, b) => Date.parse(String(a.first_detected_at || "")) - Date.parse(String(b.first_detected_at || ""))
    ),
  }));
}

export async function dispatchPendingOfflineAlerts({
  supabase,
  clientId,
  clientName = "",
  alertId = "",
  force = false,
  contactId = "",
  manualNumber = "",
  manualResponsibleName = "",
}) {
  const zapConfig = getZapResponderConfigFromEnv();
  const offlineDelayMinutes = parsePositiveInt(
    process.env.MONITORING_OFFLINE_DELAY_MINUTES,
    60
  );

  if (!clientId || !supabase) {
    return { skipped: true, reason: "missing-input" };
  }

  const nowIso = new Date().toISOString();
  const resolvedClientName = safeTrim(clientName) || (await loadClientName(supabase, clientId));

  const contactsResult = await loadActiveMonitoringContacts(supabase, clientId);
  if (contactsResult.missingTables) {
    console.warn("[monitoring] Tabelas de monitoramento ainda nao criadas.");
    return { skipped: true, reason: "missing-tables" };
  }

  const allContacts = contactsResult.contacts || [];
  const explicitContactId = safeTrim(contactId);
  const explicitManualNumber = normalizeBrazilPhone(manualNumber);
  const explicitContact = explicitContactId
    ? allContacts.find((contact) => safeTrim(contact.id) === explicitContactId)
    : null;

  if (!explicitManualNumber && explicitContactId && !explicitContact) {
    return {
      skipped: true,
      reason: "contact-not-found",
      errors: ["Contato selecionado nao esta ativo para esta rede."],
    };
  }

  let alertsQuery = supabase
    .from("device_offline_alerts")
    .select("*")
    .eq("client_id", clientId)
    .eq("alert_type", "offline")
    .is("resolved_at", null)
    .order("first_detected_at", { ascending: true })
    .limit(500);

  if (safeTrim(alertId)) {
    alertsQuery = alertsQuery.eq("id", safeTrim(alertId));
  }

  const { data: pendingAlerts, error: pendingAlertsError } = await alertsQuery;
  if (pendingAlertsError) {
    const message = pendingAlertsError.message || "";
    if (message.toLowerCase().includes("does not exist")) {
      console.warn("[monitoring] Tabelas de monitoramento ainda nao criadas.");
      return { skipped: true, reason: "missing-tables" };
    }
    throw pendingAlertsError;
  }

  const summary = {
    processed: 0,
    eligible: 0,
    sent: 0,
    skippedWaiting: 0,
    errors: [],
    configured: zapConfig.configured,
    missingEnv: zapConfig.missing,
    offlineDelayMinutes,
  };

  if (!Array.isArray(pendingAlerts) || pendingAlerts.length === 0) {
    return summary;
  }

  let groupedAlerts = groupAlertsByStore(pendingAlerts);
  if (safeTrim(alertId)) {
    const targetAlert = pendingAlerts.find((alert) => safeTrim(alert.id) === safeTrim(alertId));
    if (!targetAlert) {
      return summary;
    }

    const targetGroupKey = buildAlertGroupKey(targetAlert);
    groupedAlerts = groupedAlerts.filter((group) => group.key === targetGroupKey);
  }

  const updates = [];

  for (const group of groupedAlerts) {
    const alertsForSend = (force ? group.alerts : group.alerts.filter((alert) => isAlertDueForDispatch(alert, nowIso, offlineDelayMinutes))).sort(
      (a, b) => Date.parse(String(a.first_detected_at || "")) - Date.parse(String(b.first_detected_at || ""))
    );

    summary.processed += group.alerts.length;

    if (alertsForSend.length === 0) {
      summary.skippedWaiting += group.alerts.length;
      continue;
    }

    summary.eligible += alertsForSend.length;

    const recipients = explicitManualNumber
      ? dedupeContacts([
          {
            id: "manual",
            client_id: clientId,
            store_id: group.storeId,
            responsible_name: safeTrim(manualResponsibleName) || "Contato avulso",
            phone_number: explicitManualNumber,
            phone_e164: explicitManualNumber,
            enabled: true,
            receive_offline_alerts: true,
          },
        ])
      : explicitContact
        ? dedupeContacts([explicitContact])
        : resolveRecipients(allContacts, group.storeId);

    if (!zapConfig.configured) {
      const errorMessage = `Configuracao pendente: ${zapConfig.missing.join(", ")}`;
      summary.errors.push(errorMessage);
      for (const alert of alertsForSend) {
        updates.push(
          buildAlertUpsertPayload({
            alert,
            nowIso,
            overrides: {
              status: getSuccessfulNotificationCount(alert) > 0 ? "notified" : "pending",
              last_notification_error: errorMessage,
            },
          })
        );
      }
      continue;
    }

    if (recipients.length === 0) {
      const errorMessage = "Nenhum contato ativo para a loja/rede";
      summary.errors.push(errorMessage);
      for (const alert of alertsForSend) {
        updates.push(
          buildAlertUpsertPayload({
            alert,
            nowIso,
            overrides: {
              status: getSuccessfulNotificationCount(alert) > 0 ? "notified" : "pending",
              last_notification_error: errorMessage,
            },
          })
        );
      }
      continue;
    }

    const sendResult = await sendMessageToRecipients(
      recipients,
      buildGroupedOfflineAlertMessage({
        clientName: resolvedClientName || group.clientName,
        storeName: group.storeName,
        alerts: alertsForSend,
        delayMinutes: offlineDelayMinutes,
      })
    );

    const errorMessage =
      sendResult.failures.length > 0
        ? sendResult.failures.join(" | ").slice(0, 800)
        : null;

    if (sendResult.sentCount > 0) {
      summary.sent += 1;
    } else {
      summary.errors.push(errorMessage || "Falha ao enviar alerta");
    }

    for (const alert of alertsForSend) {
      const previousSentCount = getSuccessfulNotificationCount(alert);
      updates.push(
        buildAlertUpsertPayload({
          alert,
          nowIso,
          overrides: {
            status:
              sendResult.sentCount > 0 || previousSentCount > 0 ? "notified" : "pending",
            notified_at: sendResult.sentCount > 0 ? alert.notified_at || nowIso : alert.notified_at || null,
            last_notification_sent_at:
              sendResult.sentCount > 0 ? nowIso : alert.last_notification_sent_at || null,
            notification_attempts:
              sendResult.sentCount > 0 ? previousSentCount + 1 : previousSentCount,
            notified_contact_count:
              sendResult.sentCount > 0 ? sendResult.sentCount : Number(alert.notified_contact_count || 0),
            last_notification_error:
              sendResult.sentCount > 0 ? errorMessage : errorMessage || "Falha ao enviar alerta",
          },
        })
      );
    }
  }

  if (updates.length > 0) {
    const { error } = await supabase
      .from("device_offline_alerts")
      .upsert(updates, { onConflict: "id" });
    if (error) throw error;
  }

  return summary;
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
    60
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

  const contactsResult = await loadActiveMonitoringContacts(supabase, clientId);
  if (contactsResult.missingTables) {
    console.warn("[monitoring] Tabelas de monitoramento ainda nao criadas.");
    return { skipped: true, reason: "missing-tables" };
  }
  const contactsData = contactsResult.contacts || [];

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
          last_notification_sent_at: null,
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
        last_notification_sent_at: alert.last_notification_sent_at || null,
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

      const shouldSendReasonUpdate =
        Boolean(alert.notified_at) &&
        Boolean(offlineReason) &&
        Boolean(alert.offline_reason_updated_at) &&
        Date.parse(String(alert.offline_reason_updated_at)) >= Date.parse(String(alert.notified_at)) &&
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
      last_notification_sent_at: alert.last_notification_sent_at || null,
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

  const dispatchSummary = await dispatchPendingOfflineAlerts({
    supabase,
    clientId,
    clientName: resolvedClientName,
  });

  summary.notified = Number(dispatchSummary?.sent || 0);
  if (Array.isArray(dispatchSummary?.errors) && dispatchSummary.errors.length > 0) {
    summary.errors.push(...dispatchSummary.errors);
  }

  return summary;
}
