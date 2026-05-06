import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { dispatchPendingOfflineAlerts } from "./_lib/offlineMonitoring.js";
import { getZapResponderConfigFromEnv, sendZapTextMessage } from "./_lib/zapresponder.js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function setCommonHeaders(res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function buildTestMessage(body: any) {
  const responsibleName = String(body?.responsibleName || "Responsavel").trim();
  const clientName = String(body?.clientName || "Rede monitorada").trim();
  const storeName = String(body?.storeName || "Escopo de teste").trim();

  return [
    "Teste de integracao do monitoramento Global IA",
    "",
    `Contato: ${responsibleName}`,
    `Rede: ${clientName}`,
    `Escopo: ${storeName}`,
    "",
    "Se voce recebeu esta mensagem, o canal do ZapResponder esta pronto para os alertas automaticos de dispositivos offline.",
  ].join("\n");
}

function badRequest(res: VercelResponse, message: string) {
  return res.status(400).json({ ok: false, error: message });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCommonHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    const config = getZapResponderConfigFromEnv();
    return res.status(200).json({
      configured: config.configured,
      missing: config.missing,
      departmentId: config.departmentId || null,
      departmentName: config.departmentName,
      phoneLabel: config.phoneLabel,
      apiBaseUrl: config.apiBaseUrl,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = req.body || {};
  const action = String(body.action || "test").trim().toLowerCase();

  if (action === "test") {
    const number = String(body.number || "").trim();
    if (!number) {
      return badRequest(res, "Numero obrigatorio");
    }

    try {
      const result = await sendZapTextMessage({
        number,
        message: buildTestMessage(body),
      });

      return res.status(200).json({
        ok: true,
        status: result.status,
        data: result.data,
      });
    } catch (error: any) {
      return res.status(500).json({
        ok: false,
        error: error?.message || "Falha ao enviar teste de WhatsApp",
      });
    }
  }

  if (action === "dispatch_pending" || action === "send_offline_now") {
    const clientId = String(body.clientId || body.client_id || "").trim();
    if (!clientId) {
      return badRequest(res, "clientId obrigatorio");
    }

    try {
      const summary = await dispatchPendingOfflineAlerts({
        supabase,
        clientId,
        alertId: String(body.alertId || "").trim(),
        force: action === "send_offline_now" || Boolean(body.force),
        contactId: String(body.contactId || "").trim(),
        manualNumber: String(body.manualNumber || "").trim(),
        manualResponsibleName: String(body.manualResponsibleName || "").trim(),
      });

      return res.status(200).json({
        ok: true,
        summary,
      });
    } catch (error: any) {
      return res.status(500).json({
        ok: false,
        error: error?.message || "Falha ao processar os alertas offline",
      });
    }
  }

  return badRequest(res, "Acao invalida");
}
