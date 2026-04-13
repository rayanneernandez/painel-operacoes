// src/pages/CampaignUpload.tsx
import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, ArrowLeft, Loader2, FileArchive } from 'lucide-react';
import * as XLSX from 'xlsx';
import { unzip } from 'fflate';
import supabase from '../lib/supabase';

// ── Normaliza nome de coluna (remove acentos, espaços, case) ─────────────────
function normCol(s: string) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Converte hh:mm:ss ou mm:ss para segundos ──────────────────────────────────
function hmsToSec(s: string): number {
  if (!s) return 0;
  const parts = String(s).trim().split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60   + parts[1];
  return Number(s) || 0;
}

// ── Parseia data do Excel (pode vir como número serial ou string) ─────────────
function parseDate(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(Date.UTC(d.y, d.m-1, d.d, d.H||0, d.M||0, d.S||0)).toISOString();
  }
  if (typeof val === 'string') {
    const iso = val.replace(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/, '$3-$2-$1T$4:$5:$6');
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function cleanViewsContentName(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const months = '(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)';

  return value
    .replace(/\.mp4$/i, '')
    .replace(/\s*\(\d+\)\s*$/i, '')
    .replace(/\s*\([^)]*(?:vertical|horizontal|vert|horiz|ventical)[^)]*\)\s*$/i, '')
    .replace(/[_\s-]+v\d+\s*$/i, '')
    .replace(/[_\-\s]*\d{3,4}\s*[xX]\s*\d{3,4}.*$/i, '')
    .replace(new RegExp(`[_\\-\\s]+\\d{1,2}${months}.*$`, 'i'), '')
    .replace(/[_\-]{2,}/g, '-')
    .replace(/[\s_-]+$/g, '')
    .trim();
}

// ── Mapeia colunas do Excel (formato resumo) para campos internos ─────────────
const COL_MAP: Record<string, string> = {
  midiavalidada: 'name', midiavalidada2: 'name', campanha: 'name', nome: 'name', midia: 'name',
  inicioexibicao: 'start_date', inicio: 'start_date', startdate: 'start_date',
  fimexibicao: 'end_date', fim: 'end_date', enddate: 'end_date',
  tempodias: 'duration_days', dias: 'duration_days',
  tempohhmmss: 'duration_hms', tempohms: 'duration_hms', tempo: 'duration_hms',
  visitantes: 'visitors', visitors: 'visitors',
  tempeomedatencaommss: 'avg_attention', tempmedatencao: 'avg_attention',
  atencaommss: 'avg_attention', atencao: 'avg_attention', avgattention: 'avg_attention',
  tempomedatencao: 'avg_attention',
};

// ── Parse Excel/CSV resumo ────────────────────────────────────────────────────
function parseRowsExcel(sheet: XLSX.WorkSheet): any[] {
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
  if (raw.length < 2) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    const nonEmpty = raw[i].filter((c: any) => String(c).trim().length > 0).length;
    if (nonEmpty >= 3) { headerIdx = i; break; }
  }

  const headers = raw[headerIdx].map((h: any) => normCol(String(h)));
  const rows: any[] = [];

  for (let r = headerIdx + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!row || row.every((c: any) => !String(c).trim())) continue;

    const obj: any = {};
    headers.forEach((h, i) => {
      const field = COL_MAP[h];
      if (field) obj[field] = row[i];
    });

    if (!obj.name || !String(obj.name).trim()) continue;

    rows.push({
      name:             String(obj.name).trim(),
      start_date:       parseDate(obj.start_date),
      end_date:         parseDate(obj.end_date),
      duration_days:    Number(obj.duration_days) || null,
      duration_hms:     String(obj.duration_hms || '').trim() || null,
      visitors:         Number(String(obj.visitors || '').replace(/\./g, '').replace(',', '.')) || 0,
      avg_attention_sec: hmsToSec(String(obj.avg_attention || '')),
    });
  }

  return rows;
}

// ── Detecta se CSV é do formato "Views of visitors" da DisplayForce ───────────
function isViewsCsvFormat(headers: string[]): boolean {
  const h = headers.map(s => s.toLowerCase());
  return h.some(c => c.includes('campaign')) && h.some(c => c.includes('device'));
}

// ── Parse CSV "Views of visitors" da DisplayForce ────────────────────────────
// Agrupa por (Campaign + Device) e calcula visitantes, atenção, datas
function parseViewsCsv(csvText: string): any[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];

  // Pula linha de cabeçalho extra (às vezes tem 2 linhas de cabeçalho)
  let headerLine = 0;
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    if (lines[i].includes(',') && lines[i].toLowerCase().includes('campaign')) {
      headerLine = i;
      break;
    }
  }

  const sep = lines[headerLine].includes(';') ? ';' : ',';
  const parseRow = (line: string) => {
    const parts: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === sep && !inQ) { parts.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur.trim());
    return parts;
  };

  const headers = parseRow(lines[headerLine]);
  const find = (...names: string[]) => {
    for (const n of names) {
      const idx = headers.findIndex(h => h.toLowerCase().includes(n.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const iCampaign   = find('Campaign', 'Campanha');
  const iContent    = find('Content', 'Conteúdo', 'Conteudo');
  const iDevice     = find('Device', 'Dispositivo');
  const iVisitor    = find('Visitor ID', 'VisitorID');
  const iContactId  = find('Contact ID', 'ContactID');
  const iContactDur = find('Contact Duration');
  const iStart      = find('Content View Start', 'Contact Start');
  const iEnd        = find('Content View End', 'Contact End');

  if (iCampaign < 0 || iDevice < 0) return [];

  // Acumula por (campaign, device)
  const map = new Map<string, {
    visitors: Set<string>;
    contactIds: Map<string, number>;
    startDates: Date[];
    endDates: Date[];
    displayCount: number;
  }>();

  for (let i = headerLine + 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    if (row.length < 3) continue;

    const campaign = row[iCampaign]?.trim();
    const device   = row[iDevice]?.trim();
    if (!campaign || !device) continue;

    const content = iContent >= 0 ? cleanViewsContentName(row[iContent]?.trim() || '') : '';
    const key = `${campaign}|||${content}|||${device}`;
    if (!map.has(key)) map.set(key, { visitors: new Set(), contactIds: new Map(), startDates: [], endDates: [], displayCount: 0 });
    const agg = map.get(key)!;
    agg.displayCount += 1;

    const visId = iVisitor >= 0 ? row[iVisitor]?.trim() : null;
    if (visId) agg.visitors.add(visId);

    if (iContactId >= 0 && iContactDur >= 0) {
      const cid = row[iContactId]?.trim();
      const dur = parseFloat(row[iContactDur]) || 0;
      if (cid && !agg.contactIds.has(cid)) agg.contactIds.set(cid, dur);
    }

    if (iStart >= 0 && row[iStart]) {
      const d = new Date(row[iStart]);
      if (!isNaN(d.getTime())) agg.startDates.push(d);
    }
    if (iEnd >= 0 && row[iEnd]) {
      const d = new Date(row[iEnd]);
      if (!isNaN(d.getTime())) agg.endDates.push(d);
    }
  }

  const results: any[] = [];
  for (const [key, agg] of map) {
    const [campaign, content_name, device] = key.split('|||');

    // Extrai loja e tipo_midia do device (formato: "Loja Name - TipoMidia" ou "Loja: Name - TipoMidia")
    let loja = device;
    let tipo_midia = '';
    const devClean = device.includes(': ') ? device.split(': ').slice(1).join(': ') : device;
    if (devClean.includes(' - ')) {
      const parts = devClean.split(' - ');
      loja = parts.slice(0, -1).join(' - ').trim();
      tipo_midia = parts[parts.length - 1].trim();
    } else {
      loja = devClean;
    }

    const visitors = agg.visitors.size || agg.contactIds.size;

    let avg_attention_sec = 0;
    if (agg.contactIds.size > 0) {
      const total = [...agg.contactIds.values()].reduce((a, b) => a + b, 0);
      avg_attention_sec = Math.round(total / agg.contactIds.size);
    }

    const start_date = agg.startDates.length > 0
      ? new Date(Math.min(...agg.startDates.map(d => d.getTime()))).toISOString()
      : null;
    const end_date = agg.endDates.length > 0
      ? new Date(Math.max(...agg.endDates.map(d => d.getTime()))).toISOString()
      : null;

    let duration_days: number | null = null;
    let duration_hms: string | null = null;
    if (start_date && end_date) {
      const delta = (new Date(end_date).getTime() - new Date(start_date).getTime()) / 1000;
      duration_days = Math.round(delta / 86400 * 100) / 100;
      const hh = Math.floor(delta / 3600);
      const mm = Math.floor((delta % 3600) / 60);
      const ss = Math.floor(delta % 60);
      duration_hms = `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    }

    results.push({
      name: campaign,
      content_name: content_name || null,
      tipo_midia,
      loja,
      start_date,
      end_date,
      duration_days,
      duration_hms,
      display_count: agg.displayCount,
      visitors,
      avg_attention_sec,
    });
  }

  return results;
}

// ── Extrai ZIP e retorna lista de {filename, bytes} ───────────────────────────
async function extractZip(buf: ArrayBuffer): Promise<{name: string; bytes: Uint8Array}[]> {
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buf), (err, files) => {
      if (err) { reject(err); return; }
      const result: {name: string; bytes: Uint8Array}[] = [];
      for (const [name, bytes] of Object.entries(files)) {
        // ignora diretórios e arquivos ocultos
        if (name.endsWith('/') || name.startsWith('__MACOSX')) continue;
        result.push({ name, bytes });
      }
      resolve(result);
    });
  });
}

function processWorkbookBytes(bytes: Uint8Array | ArrayBuffer): any[] {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
  const prioritizedSheets = [
    ...wb.SheetNames.filter((sheetName) => /views of visitors/i.test(sheetName)),
    ...wb.SheetNames.filter((sheetName) => !/views of visitors/i.test(sheetName)),
  ];

  for (const sheetName of prioritizedSheets) {
    const rows = parseRowsExcel(wb.Sheets[sheetName]);
    if (rows.length > 0) return rows;
  }

  return [];
}

function buildCampaignMatchVariants(record: any) {
  const norm = (value: any) => String(value || '').trim() || null;
  const clientId = norm(record.client_id);
  const name = norm(record.name);
  const contentName = norm(record.content_name);
  const loja = norm(record.loja);
  const tipoMidia = norm(record.tipo_midia);
  const startDate = norm(record.start_date);
  const variants: Record<string, string>[] = [];
  const seen = new Set<string>();

  const push = (candidate: Record<string, string | null>) => {
    const normalized = Object.fromEntries(
      Object.entries(candidate).filter(([, value]) => value)
    ) as Record<string, string>;
    if (!clientId) return;
    normalized.client_id = clientId;
    if (Object.keys(normalized).length <= 1) return;
    const marker = JSON.stringify(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)));
    if (seen.has(marker)) return;
    seen.add(marker);
    variants.push(normalized);
  };

  push({ name, content_name: contentName, loja, tipo_midia: tipoMidia, start_date: startDate });
  push({ content_name: contentName, loja, tipo_midia: tipoMidia, start_date: startDate });
  push({ name, loja, tipo_midia: tipoMidia, start_date: startDate });
  push({ name, content_name: contentName, loja, tipo_midia: tipoMidia });
  push({ content_name: contentName, loja, tipo_midia: tipoMidia });
  push({ name, loja, tipo_midia: tipoMidia });
  if (!loja && !tipoMidia) {
    push({ name, start_date: startDate });
    push({ content_name: contentName, start_date: startDate });
    push({ name, content_name: contentName });
  }

  return variants;
}

async function findExistingCampaignId(record: any) {
  for (const variant of buildCampaignMatchVariants(record)) {
    let query: any = supabase
      .from('campaigns')
      .select('id, uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(1);

    for (const [key, value] of Object.entries(variant)) {
      query = query.eq(key, value);
    }

    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      return data[0].id as string;
    }
  }

  return null;
}

async function saveCampaignRows(rows: any[]) {
  let saved = 0;

  for (const row of rows) {
    const existingId = await findExistingCampaignId(row);
    if (existingId) {
      const { error } = await supabase
        .from('campaigns')
        .update(row)
        .eq('id', existingId);
      if (error) throw error;
      saved += 1;
      continue;
    }

    const { error } = await supabase.from('campaigns').insert(row);
    if (error) throw error;
    saved += 1;
  }

  return saved;
}

function isViewsSource(name: string, rows: any[]) {
  return /views of visitors|views/i.test(name.toLowerCase()) && rows.length > 0 && rows.some((row) => row.display_count != null);
}

// ── Processa um arquivo (bytes + nome) → linhas para Supabase ─────────────────
function processFileBytes(name: string, bytes: Uint8Array): { rows: any[]; source: 'views' | 'summary' } {
  const lowerName = name.toLowerCase();

  if (lowerName.endsWith('.csv')) {
    const text = new TextDecoder('utf-8').decode(bytes);
    const firstLine = text.split('\n')[0] || '';
    const headers = firstLine.split(/[,;]/).map(h => h.trim().replace(/^"|"$/g, ''));
    if (isViewsCsvFormat(headers)) {
      return { rows: parseViewsCsv(text), source: 'views' };
    }
    // CSV resumo → converte para sheet e usa parseRowsExcel
    return { rows: processWorkbookBytes(bytes), source: 'summary' };
  }

  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    return { rows: processWorkbookBytes(bytes), source: 'summary' };
  }

  return { rows: [], source: 'summary' };
}

// ── Componente principal ──────────────────────────────────────────────────────
export function CampaignUpload() {
  const { id: clientId } = useParams();
  const navigate = useNavigate();

  const [dragging, setDragging]   = useState(false);
  const [status,   setStatus]     = useState<'idle' | 'parsing' | 'uploading' | 'done' | 'error'>('idle');
  const [preview,  setPreview]    = useState<any[]>([]);
  const [message,  setMessage]    = useState('');
  const [_upserted, setUpserted]  = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setStatus('parsing');
    setMessage('');
    try {
      const buf = await file.arrayBuffer();
      const lowerName = file.name.toLowerCase();
      let allRows: any[] = [];

      if (lowerName.endsWith('.zip')) {
        setMessage('Extraindo ZIP...');
        const files = await extractZip(buf);
        const procFiles = files.filter(f => /\.(csv|xlsx|xls)$/i.test(f.name));
        if (procFiles.length === 0) {
          setStatus('error');
          setMessage('ZIP não contém arquivos .csv, .xlsx ou .xls reconhecíveis.');
          return;
        }
        const viewsRows: any[] = [];
        const summaryRows: any[] = [];
        for (const f of procFiles) {
          const parsed = processFileBytes(f.name, f.bytes);
          if (parsed.source === 'views' || isViewsSource(f.name, parsed.rows)) {
            viewsRows.push(...parsed.rows);
          } else {
            summaryRows.push(...parsed.rows);
          }
        }
        allRows = viewsRows.length > 0 ? viewsRows : summaryRows;
      } else if (lowerName.endsWith('.csv')) {
        const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
        const firstLine = text.split('\n')[0] || '';
        const headers = firstLine.split(/[,;]/).map(h => h.trim().replace(/^"|"$/g, ''));
        if (isViewsCsvFormat(headers)) {
          allRows = parseViewsCsv(text);
        } else {
          allRows = processWorkbookBytes(buf);
        }
      } else {
        allRows = processWorkbookBytes(buf);
      }

      if (allRows.length === 0) {
        setStatus('error');
        setMessage('Nenhuma linha válida encontrada. Verifique o formato do arquivo.');
        return;
      }

      setPreview(allRows.slice(0, 5));
      setStatus('uploading');
      setMessage(`${allRows.length} registros encontrados. Salvando...`);

      const payload = allRows.map(r => ({
        ...r,
        client_id:  clientId,
        uploaded_at: new Date().toISOString(),
      }));

      const saved = await saveCampaignRows(payload);

      setUpserted(saved);
      setStatus('done');
      setMessage(`✅ ${saved} registros salvos com sucesso!`);
    } catch (e: any) {
      console.error(e);
      setStatus('error');
      setMessage(`Erro: ${e?.message || String(e)}`);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const reset = () => {
    setStatus('idle'); setPreview([]); setMessage(''); setUpserted(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-gray-800 pb-6">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-400" />
        </button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="text-emerald-500" />
            Upload de Dados DisplayForce
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Arraste o arquivo <strong>attachments.zip</strong> do e-mail da DisplayForce, ou qualquer Excel/CSV de campanhas
          </p>
        </div>
      </div>

      {/* Drop zone */}
      {status === 'idle' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-16 flex flex-col items-center justify-center cursor-pointer transition-all ${
            dragging ? 'border-emerald-400 bg-emerald-900/10' : 'border-gray-700 hover:border-gray-500 hover:bg-gray-900'
          }`}
        >
          <div className="flex gap-3 mb-4">
            <FileArchive size={40} className={dragging ? 'text-emerald-400' : 'text-gray-500'} />
            <Upload size={40} className={dragging ? 'text-emerald-400' : 'text-gray-600'} />
          </div>
          <p className="text-lg font-medium text-gray-300">Arraste o arquivo aqui</p>
          <p className="text-sm text-gray-500 mt-1">ou clique para selecionar</p>
          <p className="text-xs text-gray-600 mt-3">.zip · .xlsx · .xls · .csv</p>
          <input ref={fileRef} type="file" accept=".zip,.xlsx,.xls,.csv" className="hidden" onChange={onInput} />
        </div>
      )}

      {/* Instrução rápida */}
      {status === 'idle' && (
        <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-4 text-sm text-blue-300 space-y-1">
          <p className="font-semibold text-blue-200">📧 Como importar do e-mail da DisplayForce:</p>
          <p>1. Abra o e-mail "Relatório de visitantes" recebido da DisplayForce</p>
          <p>2. Baixe o arquivo <code className="bg-blue-900/40 px-1 rounded">attachments.zip</code></p>
          <p>3. Arraste o ZIP aqui (não precisa extrair)</p>
          <p>4. Os dados aparecerão automaticamente no widget "Engajamento em Campanhas"</p>
        </div>
      )}

      {/* Parsing / Uploading */}
      {(status === 'parsing' || status === 'uploading') && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Loader2 size={40} className="text-emerald-400 animate-spin" />
          <p className="text-gray-300">{status === 'parsing' ? (message || 'Lendo arquivo...') : message}</p>
        </div>
      )}

      {/* Done */}
      {status === 'done' && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 bg-emerald-900/20 border border-emerald-700 rounded-xl p-4">
            <CheckCircle size={24} className="text-emerald-400 flex-shrink-0" />
            <div>
              <p className="font-medium text-emerald-300">{message}</p>
              <p className="text-sm text-gray-400 mt-1">Os dados já estão disponíveis no widget de campanhas do dashboard.</p>
            </div>
          </div>

          {preview.length > 0 && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">Prévia (primeiras linhas)</h3>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-gray-900 text-gray-400 uppercase">
                    <tr>
                      <th className="px-4 py-2">Campanha</th>
                      <th className="px-4 py-2">Loja</th>
                      <th className="px-4 py-2">Início</th>
                      <th className="px-4 py-2">Visitantes</th>
                      <th className="px-4 py-2">Atenção</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {preview.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-900">
                        <td className="px-4 py-2 text-white font-medium">{r.name || '—'}</td>
                        <td className="px-4 py-2 text-gray-300">{r.loja || '—'}</td>
                        <td className="px-4 py-2 text-gray-400">{r.start_date ? new Date(r.start_date).toLocaleDateString('pt-BR') : '—'}</td>
                        <td className="px-4 py-2 text-emerald-400">{Number(r.visitors).toLocaleString('pt-BR')}</td>
                        <td className="px-4 py-2 text-blue-400">
                          {r.avg_attention_sec > 0
                            ? `${String(Math.floor(r.avg_attention_sec/60)).padStart(2,'0')}:${String(r.avg_attention_sec%60).padStart(2,'0')}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={reset} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors">
              Importar outro arquivo
            </button>
            <button onClick={() => navigate(-1)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm transition-colors">
              Voltar ao Dashboard
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-red-900/20 border border-red-700 rounded-xl p-4">
            <XCircle size={24} className="text-red-400 flex-shrink-0" />
            <p className="text-red-300">{message}</p>
          </div>
          <button onClick={reset} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors">
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}

export default CampaignUpload;
