// pages/api/sync-analytics.ts
// Vercel/Next API Route: Puxa dados da DisplayForce, grava RAW no Supabase e gera agregados do dashboard
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { supabaseAdmin as supabase } from "../src/lib/supabaseAdmin";

type ClientApiConfig = {
  api_endpoint: string;
  analytics_endpoint: string;
  api_key: string;
  custom_header_key?: string | null;
  custom_header_value?: string | null;
  collection_start?: string | null;
  collection_end?: string | null;
  collect_tracks?: boolean;
  collect_face_quality?: boolean;
  collect_glasses?: boolean;
  collect_beard?: boolean;
  collect_hair_color?: boolean;
  collect_hair_type?: boolean;
  collect_headwear?: boolean;
};

function ok(res: NextApiResponse, data: any) {
  res.status(200).json(data);
}
function bad(res: NextApiResponse, status: number, data: any) {
  res.status(status).json(data);
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function asISODateUTC(d: Date) {
  // YYYY-MM-DD em UTC
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeNumber(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tenta inferir timestamps/duração sem depender 100% do formato.
 * - Preferência: start/end -> duração
 * - Fallbacks comuns: duration, duration_seconds, visit_time, dwell_time, contact_time
 */
function extractTimes(visit: any): {
  startTs: string | null;
  endTs: string | null;
  visitTimeSeconds: number | null;
  dwellTimeSeconds: number | null;
  contactTimeSeconds: number | null;
} {
  const startRaw = visit.start ?? visit.timestamp ?? visit.start_time ?? visit.begin ?? null;
  const endRaw = visit.end ?? visit.end_time ?? visit.finish ?? null;

  const startTs = typeof startRaw === "string" ? startRaw : null;
  const endTs = typeof endRaw === "string" ? endRaw : null;

  let durationFromStartEnd: number | null = null;
  if (startTs && endTs) {
    const s = Date.parse(startTs);
    const e = Date.parse(endTs);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      durationFromStartEnd = Math.round((e - s) / 1000);
    }
  }

  const visitTimeSeconds =
    safeNumber(visit.visit_time_seconds) ??
    safeNumber(visit.visit_time) ??
    safeNumber(visit.duration_seconds) ??
    safeNumber(visit.duration) ??
    durationFromStartEnd ??
    null;

  const dwellTimeSeconds =
    safeNumber(visit.dwell_time_seconds) ??
    safeNumber(visit.dwell_time) ??
    safeNumber(visit.time_in_frame_seconds) ??
    null;

  const contactTimeSeconds =
    safeNumber(visit.contact_time_seconds) ??
    safeNumber(visit.contact_time) ??
    null;

  return { startTs, endTs, visitTimeSeconds, dwellTimeSeconds, contactTimeSeconds };
}

function normalizeGenderFromSex(visit: any): number {
  // Você disse: gênero vem de "sex"
  // Mantendo numérico: 1 male, 2 female, 0 unknown (ajuste se a DisplayForce usar outro padrão)
  if (typeof visit.sex === "number") return visit.sex;
  if (typeof visit.sex === "string") {
    const s = visit.sex.toLowerCase();
    if (s === "male" || s === "m" || s === "1") return 1;
    if (s === "female" || s === "f" || s === "2") return 2;
  }
  // fallback
  if (visit.gender === "male") return 1;
  if (visit.gender === "female") return 2;
  return 0;
}

function bucketAge(age: number): string {
  // pirâmide por faixa (em %)
  if (age < 0) return "unknown";
  if (age <= 9) return "0-9";
  if (age <= 17) return "10-17";
  if (age <= 24) return "18-24";
  if (age <= 34) return "25-34";
  if (age <= 44) return "35-44";
  if (age <= 54) return "45-54";
  if (age <= 64) return "55-64";
  if (age <= 74) return "65-74";
  return "75+";
}

function percentMap(countMap: Record<string, number>, total: number) {
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const [k, v] of Object.entries(countMap)) {
    out[k] = Number(((v / total) * 100).toFixed(2));
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return bad(res, 405, { error: "Method Not Allowed" });

    const { client_id, start, end, devices, auth } = req.body ?? {};

    // Se você quiser travar com senha do painel:
    // Ex: enviar { auth: "painel@2026*" } no body ou Header Authorization
    const authHeader = req.headers.authorization;
    const providedAuth = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : auth;

    if (providedAuth && providedAuth !== "painel@2026*") {
      return bad(res, 401, { error: "Não autorizado" });
    }

    if (!client_id) return bad(res, 400, { error: "client_id é obrigatório" });

    // 1) Carregar config da API do cliente
    const { data: apiCfg, error: apiCfgErr } = await supabase
      .from("client_api_configs")
      .select(
        `
        api_endpoint,
        analytics_endpoint,
        api_key,
        custom_header_key,
        custom_header_value,
        collection_start,
        collection_end,
        collect_tracks,
        collect_face_quality,
        collect_glasses,
        collect_beard,
        collect_hair_color,
        collect_hair_type,
        collect_headwear
      `
      )
      .eq("client_id", client_id)
      .single();

    if (apiCfgErr || !apiCfg) {
      return bad(res, 400, { error: "Config da API não encontrada para este cliente", details: apiCfgErr });
    }

    const cfg = apiCfg as ClientApiConfig;
    const baseUrl = cfg.api_endpoint || "https://api.displayforce.ai";
    const analyticsPath = cfg.analytics_endpoint || "/public/v1/stats/visitor/list";
    const analyticsUrl = `${baseUrl}${analyticsPath}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.custom_header_key && cfg.custom_header_value) {
      headers[cfg.custom_header_key] = cfg.custom_header_value;
    } else if (cfg.api_key) {
      headers["X-API-Token"] = cfg.api_key;
    }

    const now = new Date();
    const defaultStart = cfg.collection_start || new Date("2024-01-01T00:00:00Z").toISOString();
    const defaultEnd = cfg.collection_end || now.toISOString();

    const rangeStart = (start || defaultStart) as string;
    const rangeEnd = (end || defaultEnd) as string;

    const baseBody: any = {
      start: rangeStart,
      end: rangeEnd,
      tracks: cfg.collect_tracks ?? true,
      face_quality: cfg.collect_face_quality ?? true,
      glasses: cfg.collect_glasses ?? true,
      facial_hair: cfg.collect_beard ?? true,
      hair_color: cfg.collect_hair_color ?? true,
      hair_type: cfg.collect_hair_type ?? true,
      headwear: cfg.collect_headwear ?? true,
      additional_attributes: ["smile", "pitch", "yaw", "x", "y", "height"],
    };

    if (Array.isArray(devices) && devices.length > 0) {
      baseBody.devices = devices;
    }

    // 2) Paginar na DisplayForce (mínimo de chamadas)
    const limit = 1000;
    let offset = 0;
    let total = 0;
    const combined: any[] = [];

    while (true) {
      const bodyPayload = { ...baseBody, limit, offset };
      const resp = await fetch(analyticsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        return bad(res, resp.status, { error: "Erro na API externa", details: txt });
      }

      const json = await resp.json();
      const pagePayload = json?.payload || [];
      const pageTotal = json?.pagination?.total ?? pagePayload.length;
      total = pageTotal;

      combined.push(...pagePayload);

      if (pagePayload.length < limit || combined.length >= total) break;
      offset += limit;
    }

    if (combined.length === 0) {
      return ok(res, {
        message: "Sem dados no período/filtro informado",
        start: rangeStart,
        end: rangeEnd,
        totalFetched: 0,
        inserted: 0,
        rollup: null,
      });
    }

    // 3) Mapear e UPSERT no Supabase (RAW)
    const deviceCandidates = ["device", "device_id", "source_id", "camera_id"];

    const toUpsert = combined.map((visit: any) => {
      let deviceId: number | null = null;

      if (Array.isArray(visit.devices) && visit.devices.length > 0) {
        const n = Number(visit.devices[0]);
        deviceId = Number.isFinite(n) ? n : null;
      } else {
        for (const k of deviceCandidates) {
          if (k in visit) {
            const n = Number(visit[k]);
            if (Number.isFinite(n)) {
              deviceId = n;
              break;
            }
          }
        }
      }

      const { startTs, endTs, visitTimeSeconds, dwellTimeSeconds, contactTimeSeconds } = extractTimes(visit);

      const attrs: any = {
        face_quality: visit.face_quality ?? null,
        glasses: visit.glasses ?? null,
        facial_hair: visit.facial_hair ?? null,
        hair_color: visit.hair_color ?? null,
        hair_type: visit.hair_type ?? null,
        headwear: visit.headwear ?? null,
      };

      // UID para evitar duplicidade (mesmo se rodar sync várias vezes)
      const uidPayload = {
        client_id,
        device_id: deviceId,
        start: startTs ?? null,
        end: endTs ?? null,
        age: visit.age ?? null,
        sex: visit.sex ?? null,
      };
      const visit_uid = sha256(JSON.stringify(uidPayload));

      return {
        visit_uid,
        client_id,
        device_id: deviceId,
        timestamp: startTs, // início do evento/visita
        end_timestamp: endTs,
        age: typeof visit.age === "number" ? Math.round(visit.age) : null,
        gender: normalizeGenderFromSex(visit),
        attributes: attrs,
        visit_time_seconds: visitTimeSeconds,
        dwell_time_seconds: dwellTimeSeconds,
        contact_time_seconds: contactTimeSeconds,
        raw_data: visit,
      };
    });

    let upserted = 0;
    const chunkSize = 200;

    for (let i = 0; i < toUpsert.length; i += chunkSize) {
      const chunk = toUpsert.slice(i, i + chunkSize);

      const { error, data } = await supabase
        .from("visitor_analytics")
        .upsert(chunk, { onConflict: "visit_uid", ignoreDuplicates: true })
        .select("visit_uid");

      if (error) {
        console.error("Erro ao upsert chunk:", error);
      } else {
        upserted += data?.length ?? 0;
      }
    }

    // 4) Gerar agregados DO DASHBOARD usando os dados já puxados (sem novas chamadas na DisplayForce)

    // Total visitantes
    const totalVisitors = combined.length;

    // Datas do período para média por dia
    const startMs = Date.parse(rangeStart);
    const endMs = Date.parse(rangeEnd);
    const daysInRange =
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
        ? Math.max(1, Math.ceil((endMs - startMs + 1) / (24 * 60 * 60 * 1000)))
        : 1;

    // Visitantes por dia (contagem) e média por dia
    const perDayCount: Record<string, number> = {};
    // Visitantes por hora (total) -> depois vira média por hora no período
    const perHourTotal: Record<string, number> = {};
    for (let h = 0; h < 24; h++) perHourTotal[String(h)] = 0;

    // Idade (faixa) e gênero
    const ageCounts: Record<string, number> = {
      "0-9": 0,
      "10-17": 0,
      "18-24": 0,
      "25-34": 0,
      "35-44": 0,
      "45-54": 0,
      "55-64": 0,
      "65-74": 0,
      "75+": 0,
      unknown: 0,
    };
    let ageTotalValid = 0;

    const genderCounts: Record<string, number> = { male: 0, female: 0, unknown: 0 };

    // Atributos (percentual sobre os que têm valor conhecido)
    const attrCounts: Record<string, Record<string, number>> = {
      glasses: { true: 0, false: 0, unknown: 0 },
      facial_hair: { true: 0, false: 0, unknown: 0 },
      headwear: { true: 0, false: 0, unknown: 0 },
      hair_color: {},
      hair_type: {},
    };
    let glassesKnown = 0;
    let facialHairKnown = 0;
    let headwearKnown = 0;
    let hairColorKnown = 0;
    let hairTypeKnown = 0;

    // Médias de tempo separadas
    let sumVisitTime = 0;
    let cntVisitTime = 0;

    let sumDwellTime = 0;
    let cntDwellTime = 0;

    let sumContactTime = 0;
    let cntContactTime = 0;

    for (const visit of combined) {
      const { startTs, visitTimeSeconds, dwellTimeSeconds, contactTimeSeconds } = extractTimes(visit);

      // dia/hora
      if (startTs) {
        const d = new Date(startTs);
        if (!Number.isNaN(d.getTime())) {
          const dayKey = asISODateUTC(d);
          perDayCount[dayKey] = (perDayCount[dayKey] ?? 0) + 1;

          const hour = d.getUTCHours();
          perHourTotal[String(hour)] = (perHourTotal[String(hour)] ?? 0) + 1;
        }
      }

      // idade
      if (typeof visit.age === "number" && Number.isFinite(visit.age)) {
        const b = bucketAge(Math.round(visit.age));
        ageCounts[b] = (ageCounts[b] ?? 0) + 1;
        ageTotalValid += 1;
      } else {
        ageCounts.unknown += 1;
      }

      // gênero via sex
      const g = normalizeGenderFromSex(visit);
      if (g === 1) genderCounts.male += 1;
      else if (g === 2) genderCounts.female += 1;
      else genderCounts.unknown += 1;

      // atributos
      const gl = visit.glasses;
      if (typeof gl === "boolean") {
        attrCounts.glasses[String(gl)] += 1;
        glassesKnown += 1;
      } else {
        attrCounts.glasses.unknown += 1;
      }

      const fh = visit.facial_hair;
      if (typeof fh === "boolean") {
        attrCounts.facial_hair[String(fh)] += 1;
        facialHairKnown += 1;
      } else {
        attrCounts.facial_hair.unknown += 1;
      }

      const hw = visit.headwear;
      if (typeof hw === "boolean") {
        attrCounts.headwear[String(hw)] += 1;
        headwearKnown += 1;
      } else {
        attrCounts.headwear.unknown += 1;
      }

      const hc = visit.hair_color;
      if (typeof hc === "string" && hc.trim()) {
        attrCounts.hair_color[hc] = (attrCounts.hair_color[hc] ?? 0) + 1;
        hairColorKnown += 1;
      }

      const ht = visit.hair_type;
      if (typeof ht === "string" && ht.trim()) {
        attrCounts.hair_type[ht] = (attrCounts.hair_type[ht] ?? 0) + 1;
        hairTypeKnown += 1;
      }

      // tempos
      if (typeof visitTimeSeconds === "number" && Number.isFinite(visitTimeSeconds)) {
        sumVisitTime += visitTimeSeconds;
        cntVisitTime += 1;
      }
      if (typeof dwellTimeSeconds === "number" && Number.isFinite(dwellTimeSeconds)) {
        sumDwellTime += dwellTimeSeconds;
        cntDwellTime += 1;
      }
      if (typeof contactTimeSeconds === "number" && Number.isFinite(contactTimeSeconds)) {
        sumContactTime += contactTimeSeconds;
        cntContactTime += 1;
      }
    }

    const avgVisitorsPerDay = Number((totalVisitors / daysInRange).toFixed(2));

    // Média por hora = total daquela hora / número de dias do período
    const perHourAvg: Record<string, number> = {};
    for (let h = 0; h < 24; h++) {
      const key = String(h);
      perHourAvg[key] = Number(((perHourTotal[key] ?? 0) / daysInRange).toFixed(2));
    }

    // Pirâmide etária em % (sobre total visitantes)
    const agePercent = percentMap(ageCounts, totalVisitors);

    // Gênero em %
    const genderPercent = percentMap(genderCounts, totalVisitors);

    // Atributos em %
    const attributesPercent = {
      glasses: glassesKnown > 0 ? percentMap({ true: attrCounts.glasses.true, false: attrCounts.glasses.false }, glassesKnown) : {},
      facial_hair:
        facialHairKnown > 0 ? percentMap({ true: attrCounts.facial_hair.true, false: attrCounts.facial_hair.false }, facialHairKnown) : {},
      headwear:
        headwearKnown > 0 ? percentMap({ true: attrCounts.headwear.true, false: attrCounts.headwear.false }, headwearKnown) : {},
      hair_color: hairColorKnown > 0 ? percentMap(attrCounts.hair_color, hairColorKnown) : {},
      hair_type: hairTypeKnown > 0 ? percentMap(attrCounts.hair_type, hairTypeKnown) : {},
    };

    const avgVisitTimeSeconds = cntVisitTime > 0 ? Number((sumVisitTime / cntVisitTime).toFixed(2)) : null;
    const avgDwellTimeSeconds = cntDwellTime > 0 ? Number((sumDwellTime / cntDwellTime).toFixed(2)) : null;
    const avgContactTimeSeconds = cntContactTime > 0 ? Number((sumContactTime / cntContactTime).toFixed(2)) : null;

    // 5) Salvar snapshot do rollup (upsert)
    const rollupRow = {
      client_id,
      start: rangeStart,
      end: rangeEnd,
      total_visitors: totalVisitors,
      avg_visitors_per_day: avgVisitorsPerDay,
      visitors_per_day: perDayCount,
      visitors_per_hour_avg: perHourAvg,
      age_pyramid_percent: agePercent,
      gender_percent: genderPercent,
      attributes_percent: attributesPercent,
      avg_visit_time_seconds: avgVisitTimeSeconds,
      avg_dwell_time_seconds: avgDwellTimeSeconds,
      avg_contact_time_seconds: avgContactTimeSeconds,
      updated_at: new Date().toISOString(),
    };

    const { error: rollupErr } = await supabase
      .from("visitor_analytics_rollups")
      .upsert(rollupRow, { onConflict: "client_id,start,end" });

    if (rollupErr) console.error("Erro ao salvar rollup:", rollupErr);

    // 6) Resposta pronta pro dashboard
    // Você pediu para “tirar contato”: então devolvo também sem contato em um bloco “dashboard”
    return ok(res, {
      message: "Sincronização concluída",
      start: rangeStart,
      end: rangeEnd,
      externalFetched: combined.length,
      raw_upserted_new: upserted,
      dashboard: {
        total_visitors: totalVisitors,
        avg_visitors_per_day: avgVisitorsPerDay,
        visitors_per_day: perDayCount, // para gráfico diário
        visitors_per_hour_avg: perHourAvg, // para gráfico por hora (média no período)
        age_pyramid_percent: agePercent, // pirâmide em %
        gender_percent: genderPercent, // gênero em %
        attributes_percent: attributesPercent, // óculos/barba/boné + tipo/cor de cabelo em %
        avg_times_seconds: {
          avg_visit_time_seconds: avgVisitTimeSeconds,
          avg_dwell_time_seconds: avgDwellTimeSeconds,
          // avg_contact_time_seconds propositalmente omitido do “dashboard” se você quer tirar contato
        },
      },
      stored_rollup: !rollupErr,
    });
  } catch (err: any) {
    console.error("Erro inesperado:", err);
    return bad(res, 500, { error: "Erro inesperado", details: err?.message || String(err) });
  }
}