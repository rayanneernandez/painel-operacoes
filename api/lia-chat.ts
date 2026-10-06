import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function buildSystemPrompt(context: any, hasTool = false): string {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" }).format(now);
  return `Voce e a Lia, assistente de analise de dados integrada ao dashboard "${context?.dashboardName || "Dashboard"}".
Responda sempre em portugues, com linguagem natural, direta e amigavel.
Nao retorne JSON nem dados brutos. Interprete os numeros e escreva frases completas.

Hoje e ${today} (${weekday}). O ano das datas citadas sem ano e o ano de hoje.

DADOS ATUALMENTE EXIBIDOS NO DASHBOARD (periodo selecionado na tela):
${JSON.stringify(context?.data || {}, null, 2)}

${hasTool
    ? `Voce tem a ferramenta consultar_periodo, que busca no banco os dados de QUALQUER periodo (totais, visitantes por dia, fluxo por hora, genero, idade, tempo medio de visita e atencao, e areas/dispositivos mais acessados).
- Se a pergunta for sobre um periodo diferente do exibido na tela (ex.: "semana passada", "28/09 a 03/10", "dia anterior", "esse mes"), CHAME a ferramenta antes de responder. Nunca diga que nao tem acesso a outros periodos sem tentar a ferramenta.
- Para comparar periodos, chame a ferramenta uma vez para cada periodo.
- Horarios estao no fuso de Sao Paulo. "Area" corresponde aos dispositivos/pontos de captura (por_area).
- Se a pergunta for vaga (ex.: "anterior", "semana passada") sem datas, consulte os 7 dias que antecedem o inicio do periodo exibido na tela.
- Use sempre o campo dia_da_semana fornecido pela ferramenta; nunca calcule o dia da semana por conta propria.
- O fluxo por hora do dia de maior movimento esta em dia_de_maior_movimento.fluxo_por_hora; fluxo_medio_por_hora e a media do periodo todo.
- Se a ferramenta retornar zero visitantes, use dados_disponiveis (primeiro e ultimo dia com dados) para tentar um periodo valido ou explicar que nao ha dados.`
    : "Use apenas os dados fornecidos. Se faltar informacao, diga isso de forma objetiva."}`;
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

// ── Consulta de periodos (ferramenta da Lia) ────────────────────────────────
const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "consultar_periodo",
      description:
        "Busca no banco os dados de visitantes da rede do cliente em um periodo (datas no fuso de Sao Paulo, inclusive). " +
        "Retorna total, media por dia, visitantes por dia, fluxo medio por hora, genero, idade, tempos medios e areas/dispositivos mais acessados.",
      parameters: {
        type: "object",
        properties: {
          data_inicio: { type: "string", description: "Primeiro dia do periodo, formato YYYY-MM-DD" },
          data_fim: { type: "string", description: "Ultimo dia do periodo (inclusive), formato YYYY-MM-DD" },
        },
        required: ["data_inicio", "data_fim"],
      },
    },
  },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_SAMPLE_CAP = 20000;

function weekdayPt(day: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" }).format(new Date(`${day}T12:00:00-03:00`));
}

function hoursMap(raw: Record<string, any> | undefined) {
  const out: Record<string, number> = {};
  for (const [h, v] of Object.entries<any>(raw || {})) {
    const n = Number(v);
    if (n > 0) out[`${String(h).padStart(2, "0")}h`] = Math.round(n * 10) / 10;
  }
  return out;
}

async function availableRange(sb: any, clientId: string) {
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
  const first = await sb.from("visitor_analytics").select("timestamp").eq("client_id", clientId).order("timestamp", { ascending: true }).limit(1);
  const last = await sb.from("visitor_analytics").select("timestamp").eq("client_id", clientId).order("timestamp", { ascending: false }).limit(1);
  const a = first?.data?.[0]?.timestamp;
  const b = last?.data?.[0]?.timestamp;
  return a && b ? { primeiro_dia: fmt(a), ultimo_dia: fmt(b) } : null;
}

function getSupabase() {
  const url = localEnvValue("SUPABASE_URL", "VITE_SUPABASE_URL");
  // Leitura apenas: prefere a chave publica (anon); cai para as demais se ela nao existir.
  const key = localEnvValue("VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function topEntry(obj: Record<string, any> | undefined) {
  let bestKey: string | null = null;
  let bestVal = -Infinity;
  for (const [k, v] of Object.entries(obj || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n > bestVal) { bestVal = n; bestKey = k; }
  }
  return bestKey === null ? null : { chave: bestKey, valor: bestVal };
}

async function consultarPeriodo(clientId: string, dataInicio: string, dataFim: string) {
  if (!DATE_RE.test(dataInicio) || !DATE_RE.test(dataFim)) return { erro: "Datas devem estar no formato YYYY-MM-DD." };
  if (dataInicio > dataFim) return { erro: "data_inicio nao pode ser depois de data_fim." };
  const sb = getSupabase();
  if (!sb) return { erro: "Banco de dados indisponivel para consulta." };

  // Sao Paulo esta em UTC-3 o ano todo (sem horario de verao desde 2019).
  const startIso = new Date(`${dataInicio}T00:00:00-03:00`).toISOString();
  const endIso = new Date(`${dataFim}T23:59:59.999-03:00`).toISOString();

  const { data: roll, error } = await sb.rpc("build_visitor_rollup", { p_client_id: clientId, p_start: startIso, p_end: endIso });
  if (error) return { erro: `Falha ao consultar o periodo: ${error.message}` };
  const total = Number((roll as any)?.total_visitors ?? 0);
  if (!total) {
    const disponiveis = await availableRange(sb, clientId).catch(() => null);
    return { periodo: { inicio: dataInicio, fim: dataFim }, total_visitantes: 0, aviso: "Sem dados nesse periodo.", dados_disponiveis: disponiveis };
  }

  const r: any = roll;
  const porDia: Record<string, number> = r.visitors_per_day || {};
  const porHoraMedia = hoursMap(r.visitors_per_hour_avg);
  const diaPico = topEntry(porDia);
  const horaPico = topEntry(porHoraMedia);

  let fluxoDiaPico: Record<string, number> | null = null;
  let horaPicoDia: { hora: string; visitantes: number } | null = null;
  if (diaPico) {
    const dayStart = new Date(`${diaPico.chave}T00:00:00-03:00`).toISOString();
    const dayEnd = new Date(`${diaPico.chave}T23:59:59.999-03:00`).toISOString();
    const { data: dayRoll } = await sb.rpc("build_visitor_rollup", { p_client_id: clientId, p_start: dayStart, p_end: dayEnd });
    fluxoDiaPico = hoursMap((dayRoll as any)?.visitors_per_hour_avg);
    const topHora = topEntry(fluxoDiaPico);
    horaPicoDia = topHora ? { hora: topHora.chave, visitantes: topHora.valor } : null;
  }

  // Areas/dispositivos mais acessados (amostra limitada para nao pesar em redes grandes).
  let porArea: { area: string; visitantes: number; percentual: number }[] = [];
  let amostraLimitada = false;
  try {
    const { data: stores } = await sb.from("stores").select("id").eq("client_id", clientId);
    const storeIds = (stores || []).map((s: any) => s.id);
    const nameByDevice = new Map<string, string>();
    for (let i = 0; i < storeIds.length; i += 40) {
      const { data: devs } = await sb.from("devices").select("external_id,name").in("store_id", storeIds.slice(i, i + 40));
      for (const d of devs || []) nameByDevice.set(String((d as any).external_id), String((d as any).name || (d as any).external_id));
    }
    const counts = new Map<string, number>();
    let sampled = 0;
    for (let from = 0; from < DEVICE_SAMPLE_CAP; from += 1000) {
      const { data: rows, error: rowsErr } = await sb
        .from("visitor_analytics")
        .select("device_id")
        .eq("client_id", clientId)
        .gte("timestamp", startIso)
        .lte("timestamp", endIso)
        .order("timestamp", { ascending: true })
        .range(from, from + 999);
      if (rowsErr || !rows || rows.length === 0) break;
      for (const row of rows) {
        const key = String((row as any).device_id);
        counts.set(key, (counts.get(key) || 0) + 1);
        sampled++;
      }
      if (rows.length < 1000) break;
      if (from + 1000 >= DEVICE_SAMPLE_CAP) amostraLimitada = true;
    }
    porArea = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([id, n]) => ({
        area: nameByDevice.get(id) || `Dispositivo ${id}`,
        visitantes: n,
        percentual: sampled ? Math.round((n / sampled) * 1000) / 10 : 0,
      }));
  } catch (err: any) {
    console.warn("[lia-chat] por_area indisponivel:", err?.message || err);
  }

  return {
    periodo: { inicio: dataInicio, fim: dataFim },
    total_visitantes: total,
    media_por_dia: r.avg_visitors_per_day,
    visitantes_por_dia: Object.entries(porDia)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dia, visitantes]) => ({ dia, dia_da_semana: weekdayPt(dia), visitantes })),
    dia_de_maior_movimento: diaPico
      ? { dia: diaPico.chave, dia_da_semana: weekdayPt(diaPico.chave), visitantes: diaPico.valor, hora_de_pico_do_dia: horaPicoDia, fluxo_por_hora: fluxoDiaPico }
      : null,
    fluxo_medio_por_hora: porHoraMedia,
    hora_de_pico: horaPico ? { hora: horaPico.chave, media_visitantes: horaPico.valor } : null,
    genero_percentual: r.gender_percent,
    faixa_etaria_percentual: r.age_pyramid_percent,
    tempo_medio_visita_segundos: r.avg_visit_time_seconds != null ? Math.round(Number(r.avg_visit_time_seconds)) : null,
    tempo_medio_atencao_segundos: r.avg_contact_time_seconds != null ? Math.round(Number(r.avg_contact_time_seconds)) : null,
    por_area: porArea,
    observacao_por_area: amostraLimitada ? `baseado nos primeiros ${DEVICE_SAMPLE_CAP} registros do periodo` : undefined,
  };
}

async function runTool(name: string, rawArgs: string, clientId: string) {
  try {
    if (name !== "consultar_periodo") return { erro: `Ferramenta desconhecida: ${name}` };
    const args = JSON.parse(rawArgs || "{}");
    const result: any = await consultarPeriodo(clientId, String(args.data_inicio || ""), String(args.data_fim || ""));
    if (result?.erro) console.warn("[lia-chat] consultar_periodo:", result.erro, rawArgs);
    return result;
  } catch (err: any) {
    console.warn("[lia-chat] consultar_periodo excecao:", err?.message || err);
    return { erro: err?.message || String(err) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const openaiKey = localEnvValue("OPENAI_API_KEY");
  const anthropicKey = openaiKey ? "" : localEnvValue("ANTHROPIC_API_KEY", "VITE_ANTHROPIC_API_KEY");
  if (!openaiKey && !anthropicKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY (ou ANTHROPIC_API_KEY) ausente no ambiente" });
  }

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
    if (openaiKey) {
      const clientId = typeof context?.clientId === "string" ? context.clientId : "";
      const convo: any[] = [{ role: "system", content: buildSystemPrompt(context, Boolean(clientId)) }, ...cleanMessages];

      for (let step = 0; step < 5; step++) {
        const body: any = {
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          max_completion_tokens: 1200,
          messages: convo,
        };
        if (clientId) body.tools = OPENAI_TOOLS;

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify(body),
        });
        const openaiJson: any = await openaiRes.json().catch(() => ({}));
        if (!openaiRes.ok) {
          const details = openaiJson?.error?.message || `HTTP ${openaiRes.status}`;
          console.error("[lia-chat][openai]", details);
          return res.status(502).json({ error: "Erro ao conectar com a Lia", details });
        }

        const msg = openaiJson?.choices?.[0]?.message;
        const toolCalls = msg?.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0 && clientId) {
          convo.push(msg);
          for (const call of toolCalls) {
            const result = await runTool(call?.function?.name, call?.function?.arguments, clientId);
            convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
          }
          continue;
        }

        const text = String(msg?.content ?? "").trim();
        return res.status(200).json({ text: text || "Nao consegui gerar uma resposta agora." });
      }
      return res.status(200).json({ text: "Nao consegui concluir essa analise agora. Tente reformular a pergunta." });
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });
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
