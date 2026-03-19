export default CampaignUpload;
// src/pages/CampaignUpload.tsx
// Rota sugerida: /clientes/:id/campanhas
// Adicionar no App.tsx:
//   import { CampaignUpload } from './pages/CampaignUpload';
//   <Route path="clientes/:id/campanhas" element={<CampaignUpload />} />

import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, ArrowLeft, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
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
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(Date.UTC(d.y, d.m-1, d.d, d.H||0, d.M||0, d.S||0)).toISOString();
  }
  if (typeof val === 'string') {
    // DD/MM/YYYY HH:MM:SS ou ISO
    const iso = val.replace(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/, '$3-$2-$1T$4:$5:$6');
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

// ── Mapeia colunas do Excel para campos internos ─────────────────────────────
const COL_MAP: Record<string, string> = {
  // MIDIA_VALIDADA / Nome
  midiavalidada: 'name', midiavalidada2: 'name', campanha: 'name', nome: 'name', midia: 'name',
  // INICIO_EXIBIÇÃO
  inicioexibicao: 'start_date', inicio: 'start_date', startdate: 'start_date',
  // FIM_EXIBIÇÃO
  fimexibicao: 'end_date', fim: 'end_date', enddate: 'end_date',
  // Tempo Dias
  tempodias: 'duration_days', dias: 'duration_days',
  // Tempo hh:mm:ss
  tempohhmmss: 'duration_hms', tempohms: 'duration_hms', tempo: 'duration_hms',
  // VISITANTES
  visitantes: 'visitors', visitors: 'visitors',
  // TEMPO_MED ATENÇÃO
  tempeomedatencaommss: 'avg_attention', tempmedatencao: 'avg_attention',
  atencaommss: 'avg_attention', atencao: 'avg_attention', avgattention: 'avg_attention',
  tempomedatencao: 'avg_attention',
};

function parseRows(sheet: XLSX.WorkSheet): any[] {
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
  if (raw.length < 2) return [];

  // Encontra linha de cabeçalho (primeira linha com pelo menos 3 células não vazias)
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

    // Ignora linhas sem nome de campanha
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

export function CampaignUpload() {
  const { id: clientId } = useParams();
  const navigate = useNavigate();

  const [dragging, setDragging]   = useState(false);
  const [status,   setStatus]     = useState<'idle' | 'parsing' | 'uploading' | 'done' | 'error'>('idle');
  const [preview,  setPreview]    = useState<any[]>([]);
  const [message,  setMessage]    = useState('');
  const [_upserted, setUpserted]   = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setStatus('parsing');
    setMessage('');
    try {
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array', cellDates: false });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = parseRows(ws);

      if (rows.length === 0) {
        setStatus('error');
        setMessage('Nenhuma linha válida encontrada. Verifique o formato do arquivo.');
        return;
      }

      setPreview(rows.slice(0, 5));
      setStatus('uploading');
      setMessage(`${rows.length} campanhas encontradas. Salvando...`);

      // Upsert no Supabase
      const payload = rows.map(r => ({
        ...r,
        client_id:  clientId,
        updated_at: new Date().toISOString(),
      }));

      let saved = 0;
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100);
        const { error, data } = await supabase
          .from('campaigns')
          .upsert(chunk, { onConflict: 'client_id,name,start_date', ignoreDuplicates: false })
          .select('id');
        if (error) throw error;
        saved += data?.length ?? chunk.length;
      }

      setUpserted(saved);
      setStatus('done');
      setMessage(`✅ ${saved} campanhas salvas com sucesso!`);
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
            Upload de Campanhas
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Arraste o relatório Excel da Displayforce para importar as campanhas automaticamente
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
          <Upload size={48} className={`mb-4 ${dragging ? 'text-emerald-400' : 'text-gray-600'}`} />
          <p className="text-lg font-medium text-gray-300">Arraste o arquivo aqui</p>
          <p className="text-sm text-gray-500 mt-1">ou clique para selecionar</p>
          <p className="text-xs text-gray-600 mt-3">.xlsx, .xls, .csv</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onInput} />
        </div>
      )}

      {/* Parsing / Uploading */}
      {(status === 'parsing' || status === 'uploading') && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Loader2 size={40} className="text-emerald-400 animate-spin" />
          <p className="text-gray-300">{status === 'parsing' ? 'Lendo arquivo...' : message}</p>
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

          {/* Preview */}
          {preview.length > 0 && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">Prévia (primeiras linhas)</h3>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-gray-900 text-gray-400 uppercase">
                    <tr>
                      <th className="px-4 py-2">Campanha</th>
                      <th className="px-4 py-2">Início</th>
                      <th className="px-4 py-2">Fim</th>
                      <th className="px-4 py-2">Visitantes</th>
                      <th className="px-4 py-2">Atenção</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {preview.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-900">
                        <td className="px-4 py-2 text-white font-medium">{r.name || '—'}</td>
                        <td className="px-4 py-2 text-gray-400">{r.start_date ? new Date(r.start_date).toLocaleDateString('pt-BR') : '—'}</td>
                        <td className="px-4 py-2 text-gray-400">{r.end_date   ? new Date(r.end_date).toLocaleDateString('pt-BR')   : '—'}</td>
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