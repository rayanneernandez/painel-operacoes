import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function buildSystemPrompt(context: any): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Voce e a Lia, assistente de analise de dados integrada ao dashboard "${context?.dashboardName || "Dashboard"}".
Responda sempre em portugues, com linguagem natural, direta e amigavel.
Nao retorne JSON nem dados brutos. Interprete os numeros e escreva frases completas.

Hoje e ${today}.

DADOS ATUALMENTE EXIBIDOS NO DASHBOARD:
${JSON.stringify(context?.data || {}, null, 2)}

Use apenas os dados fornecidos. Se faltar informacao, diga isso de forma objetiva.`;
}

function localEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value?.trim()) return value.trim();
  }

  try {
    const envPath = path.join(process.cwd(), ".env");
    const content = fs.readFileSync(envPath, "utf8");
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = content.match(new RegExp(`^\\s*${escaped}\\s*=\\s*(.+)\\s*$`, "m"));
      const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  } catch {
    // .env local e opcional; em producao vem de process.env.
  }

  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const apiKey = localEnvValue("ANTHROPIC_API_KEY", "VITE_ANTHROPIC_API_KEY");
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY ausente no ambiente" });

  const { context, messages } = req.body || {};
  const cleanMessages = Array.isArray(messages)
    ? messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-12)
    : [];

  if (cleanMessages.length === 0) {
    return res.status(400).json({ error: "messages vazio" });
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 900,
      system: buildSystemPrompt(context),
      messages: cleanMessages,
    });

    const text = message.content
      .filter((block) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n")
      .trim();

    return res.status(200).json({ text: text || "Nao consegui gerar uma resposta agora." });
  } catch (error: any) {
    console.error("[lia-chat]", error?.message || error);
    return res.status(502).json({ error: "Erro ao conectar com a Lia", details: error?.message || String(error) });
  }
}
