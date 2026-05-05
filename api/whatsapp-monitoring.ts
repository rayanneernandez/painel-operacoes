import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getZapResponderConfigFromEnv, sendZapTextMessage } from "./_lib/zapresponder.js";

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

  if (action !== "test") {
    return res.status(400).json({ error: "Acao invalida" });
  }

  const number = String(body.number || "").trim();
  if (!number) {
    return res.status(400).json({ error: "Numero obrigatorio" });
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
