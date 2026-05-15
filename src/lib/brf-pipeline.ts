import Anthropic from '@anthropic-ai/sdk';
import supabase from './supabase';

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY ?? '',
  dangerouslyAllowBrowser: true,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type RupturePosition = {
  column_number: number;
  shelf_number: number;
  status: 'ok' | 'warning' | 'rupture';
  confidence: number;
};

export type RuptureAnalysis = {
  positions: RupturePosition[];
  summary: string;
};

export type OperationAnalysis = {
  attendant_count: number;
  is_preparing: boolean;
  summary: string;
};

export type QueueAnalysis = {
  people_count: number;
  summary: string;
};

// ─── Prompts ──────────────────────────────────────────────────────────────────

const RUPTURE_PROMPT = (columns: number[], shelves: number) => `
Você é um sistema de visão computacional para varejo. Analise a imagem desta gôndola de supermercado.

Verifique o status de estoque nas posições abaixo (colunas ${columns.join(', ')}, prateleiras 1 a ${shelves}):
- "ok": prateleira bem abastecida (mais de 50% preenchida)
- "warning": estoque baixo (menos de 50% preenchida, mas há produtos)
- "rupture": sem produto (prateleira vazia ou quase vazia)

Responda SOMENTE com JSON válido neste formato, sem markdown, sem texto extra:
{
  "positions": [
    { "column_number": <N>, "shelf_number": <N>, "status": "ok|warning|rupture", "confidence": <0.0 a 1.0> }
  ],
  "summary": "<descrição breve do estado geral>"
}
`.trim();

const OPERATION_PROMPT = `
Você é um sistema de visão computacional para varejo. Analise a imagem deste stand/balcão de atendimento.

Identifique:
1. Quantas pessoas (atendentes/funcionários) estão DENTRO ou ATRÁS do balcão
2. Se algum deles está em atividade de preparo (manuseando produtos, equipamentos, etc.)

Responda SOMENTE com JSON válido neste formato, sem markdown, sem texto extra:
{
  "attendant_count": <número de atendentes visíveis>,
  "is_preparing": <true se algum está em preparo, false caso contrário>,
  "summary": "<descrição breve do que está acontecendo>"
}
`.trim();

const QUEUE_PROMPT = `
Você é um sistema de visão computacional para varejo. Analise a imagem desta fila de atendimento.

Conte quantas pessoas estão aguardando na fila (não contar atendentes atrás do balcão).

Responda SOMENTE com JSON válido neste formato, sem markdown, sem texto extra:
{
  "people_count": <número de pessoas na fila>,
  "summary": "<descrição breve da situação da fila>"
}
`.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function imageToBase64(imageUrl: string): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }> {
  const res = await fetch(imageUrl);
  const buf = await res.arrayBuffer();
  const mime = res.headers.get('content-type') || 'image/jpeg';
  const data = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const mediaType = mime.startsWith('image/png') ? 'image/png'
    : mime.startsWith('image/webp') ? 'image/webp'
    : 'image/jpeg';
  return { data, mediaType };
}

async function callSonnet(prompt: string, imageUrl: string): Promise<string> {
  const { data, mediaType } = await imageToBase64(imageUrl);
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const block = msg.content.find((b: { type: string }) => b.type === 'text');
  return block ? (block as any).text : '';
}

async function saveSnapshot(params: {
  camera_id: string;
  store_id: string;
  client_id: string;
  function: 'ruptura' | 'operacao' | 'fila';
  image_url: string;
  processing_ms: number;
  raw_response: unknown;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('brf_vision_snapshots')
    .insert({ ...params, raw_response: params.raw_response as any })
    .select('id')
    .single();
  if (error) { console.error('[BRF pipeline] snapshot error:', error); return null; }
  return data.id;
}

// ─── Ruptura ──────────────────────────────────────────────────────────────────

export async function analyzeRupture(params: {
  camera_id: string;
  store_id: string;
  client_id: string;
  planogram_id: string;
  image_url: string;
  columns: number[];
  shelves: number;
}): Promise<RuptureAnalysis | null> {
  const t0 = Date.now();
  let raw: string;
  try {
    raw = await callSonnet(RUPTURE_PROMPT(params.columns, params.shelves), params.image_url);
  } catch (e) {
    console.error('[BRF ruptura] Sonnet error:', e);
    return null;
  }
  const ms = Date.now() - t0;

  let analysis: RuptureAnalysis;
  try {
    analysis = JSON.parse(raw);
  } catch {
    console.error('[BRF ruptura] JSON parse error:', raw);
    return null;
  }

  const snapshot_id = await saveSnapshot({
    camera_id: params.camera_id,
    store_id: params.store_id,
    client_id: params.client_id,
    function: 'ruptura',
    image_url: params.image_url,
    processing_ms: ms,
    raw_response: analysis,
  });

  if (!snapshot_id) return analysis;

  // Busca posições do planograma para associar
  const { data: positions } = await supabase
    .from('brf_planogram_positions')
    .select('id, column_number, shelf_number')
    .eq('planogram_id', params.planogram_id);

  const posMap = new Map(
    (positions || []).map((p: any) => [`${p.column_number}_${p.shelf_number}`, p.id])
  );

  // Upsert status na gôndola + cria alertas para warning/rupture
  for (const pos of analysis.positions) {
    const planogram_position_id = posMap.get(`${pos.column_number}_${pos.shelf_number}`);

    // Salva status
    await supabase.from('brf_gondola_status').insert({
      planogram_position_id,
      snapshot_id,
      store_id: params.store_id,
      client_id: params.client_id,
      status: pos.status,
      confidence: pos.confidence,
    });

    // Alerta para warning e rupture
    if (pos.status !== 'ok') {
      const { data: planPos } = planogram_position_id
        ? await supabase.from('brf_planogram_positions').select('product_code, product_name').eq('id', planogram_position_id).single()
        : { data: null };

      await supabase.from('brf_rupture_alerts').insert({
        client_id: params.client_id,
        store_id: params.store_id,
        severity: pos.status === 'rupture' ? 'red' : 'orange',
        planogram_position_id,
        snapshot_id,
        product_code: planPos?.product_code ?? null,
        product_name: planPos?.product_name ?? null,
        confidence: pos.confidence,
      });
    }
  }

  return analysis;
}

// ─── Operação ─────────────────────────────────────────────────────────────────

export async function analyzeOperation(params: {
  camera_id: string;
  store_id: string;
  client_id: string;
  image_url: string;
}): Promise<OperationAnalysis | null> {
  const t0 = Date.now();
  let raw: string;
  try {
    raw = await callSonnet(OPERATION_PROMPT, params.image_url);
  } catch (e) {
    console.error('[BRF operação] Sonnet error:', e);
    return null;
  }
  const ms = Date.now() - t0;

  let analysis: OperationAnalysis;
  try {
    analysis = JSON.parse(raw);
  } catch {
    console.error('[BRF operação] JSON parse error:', raw);
    return null;
  }

  const snapshot_id = await saveSnapshot({
    camera_id: params.camera_id,
    store_id: params.store_id,
    client_id: params.client_id,
    function: 'operacao',
    image_url: params.image_url,
    processing_ms: ms,
    raw_response: analysis,
  });

  if (snapshot_id) {
    await supabase.from('brf_operation_detections').insert({
      snapshot_id,
      store_id: params.store_id,
      client_id: params.client_id,
      attendant_count: analysis.attendant_count,
      is_preparing: analysis.is_preparing,
      details: { summary: analysis.summary },
    });
  }

  return analysis;
}

// ─── Fila ─────────────────────────────────────────────────────────────────────

export async function analyzeQueue(params: {
  camera_id: string;
  store_id: string;
  client_id: string;
  image_url: string;
}): Promise<QueueAnalysis | null> {
  const t0 = Date.now();
  let raw: string;
  try {
    raw = await callSonnet(QUEUE_PROMPT, params.image_url);
  } catch (e) {
    console.error('[BRF fila] Sonnet error:', e);
    return null;
  }
  const ms = Date.now() - t0;

  let analysis: QueueAnalysis;
  try {
    analysis = JSON.parse(raw);
  } catch {
    console.error('[BRF fila] JSON parse error:', raw);
    return null;
  }

  const snapshot_id = await saveSnapshot({
    camera_id: params.camera_id,
    store_id: params.store_id,
    client_id: params.client_id,
    function: 'fila',
    image_url: params.image_url,
    processing_ms: ms,
    raw_response: analysis,
  });

  if (snapshot_id) {
    await supabase.from('brf_queue_detections').insert({
      snapshot_id,
      store_id: params.store_id,
      client_id: params.client_id,
      people_count: analysis.people_count,
      details: { summary: analysis.summary },
    });
  }

  return analysis;
}
