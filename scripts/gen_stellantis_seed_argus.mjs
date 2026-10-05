// ============================================================================
// Gera o seed fictício do Stellantis usando a CURVA POR HORA da API ARGUS (ao vivo)
// e a QUANTIDADE diária da planilha.
//
// - Forma por hora (%/hora) + permanência média por hora: vêm da ARGUS
//   (/analytics/linha-do-tempo?granularidade=hora), agregadas por hora-do-dia.
// - Volume diário (MAX_CLIENTES), % gênero e faixa etária: vêm da planilha.
// - Tempo de atenção = ~65% da permanência da ARGUS.
// - Devices: Avenger > Renegade > Compass > Commander (+ entradas). Café/Atendimento 0%.
//
// USO (PowerShell, na raiz do projeto):
//   $env:ARGUS_KEY="fa_live_SUA_CHAVE"; node scripts/gen_stellantis_seed_argus.mjs
// Saída: SEED_STELLANTIS_FICTICIO.sql  (rode no SQL Editor do Supabase)
// ============================================================================

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const ARGUS_KEY = process.env.ARGUS_KEY || process.argv[2];
if (!ARGUS_KEY || !ARGUS_KEY.startsWith('fa_live_')) {
  console.error('Faltou a chave ARGUS. Rode:  $env:ARGUS_KEY="fa_live_..."; node scripts/gen_stellantis_seed_argus.mjs');
  process.exit(1);
}
const ARGUS_BASE = 'https://argus.globalia.com.br/api/v1';
const CLIENT_ID = '8b32886d-9cda-4423-b075-62c868254526';

// Devices (external_id) — POC JEEP - THE LED
const DEV = { avenger:21787, renegade:21780, compass:21781, commander:21782, ent1:21785, ent2:21786 };
// Pool ponderado (ordem do Valber). Café(21784)/Atendimento(21783) ficam fora = 0%.
const POOL = [
  ...Array(34).fill(DEV.avenger), ...Array(26).fill(DEV.renegade),
  ...Array(18).fill(DEV.compass), ...Array(10).fill(DEV.commander),
  ...Array(6).fill(DEV.ent1), ...Array(6).fill(DEV.ent2),
];

// Planilha (dias úteis; domingo sem dados). [data, max, %masc, [<18,18-24,25-34,35-44,45-54,55-64]]
const DAYS = [
  ['2026-09-22',63,0.73,[0.02,0.08,0.24,0.47,0.14,0.05]],
  ['2026-09-23',42,0.69,[0.01,0.13,0.32,0.37,0.11,0.06]],
  ['2026-09-24',55,0.68,[0.01,0.06,0.30,0.43,0.12,0.08]],
  ['2026-09-25',62,0.74,[0.01,0.03,0.39,0.39,0.16,0.02]],
  ['2026-09-26',113,0.71,[0.01,0.04,0.43,0.41,0.10,0.01]],
  ['2026-09-28',42,0.73,[0.01,0.04,0.43,0.41,0.10,0.01]],
  ['2026-09-29',66,0.69,[0.01,0.06,0.30,0.43,0.12,0.08]],
  ['2026-09-30',45,0.64,[0.01,0.06,0.30,0.43,0.12,0.08]],
  ['2026-10-01',58,0.73,[0.02,0.08,0.24,0.47,0.14,0.05]],
  ['2026-10-02',65,0.70,[0.01,0.03,0.39,0.39,0.16,0.02]],
  ['2026-10-03',116,0.71,[0.02,0.08,0.23,0.47,0.14,0.06]],
  ['2026-10-05',46,0.67,[0.02,0.08,0.24,0.47,0.14,0.05]],
  ['2026-10-06',70,0.71,[0.01,0.03,0.39,0.39,0.16,0.02]],
  ['2026-10-07',49,0.72,[0.02,0.08,0.23,0.47,0.14,0.06]],
  ['2026-10-08',62,0.65,[0.01,0.06,0.30,0.43,0.12,0.08]],
  ['2026-10-09',69,0.71,[0.01,0.04,0.43,0.41,0.10,0.01]],
  ['2026-10-10',120,0.67,[0.01,0.06,0.30,0.43,0.12,0.08]],
  ['2026-10-12',43,0.74,[0.01,0.06,0.30,0.43,0.12,0.08]],
  ['2026-10-13',67,0.66,[0.02,0.08,0.23,0.47,0.14,0.06]],
  ['2026-10-14',46,0.65,[0.01,0.04,0.43,0.41,0.10,0.01]],
  ['2026-10-15',59,0.72,[0.01,0.03,0.39,0.39,0.16,0.02]],
  ['2026-10-16',66,0.71,[0.01,0.06,0.30,0.43,0.12,0.08]],
  ['2026-10-17',117,0.69,[0.02,0.08,0.23,0.47,0.14,0.06]],
  ['2026-10-19',36,0.71,[0.01,0.03,0.39,0.39,0.16,0.02]],
  ['2026-10-20',60,0.69,[0.01,0.04,0.43,0.41,0.10,0.01]],
  ['2026-10-21',39,0.67,[0.02,0.08,0.24,0.47,0.14,0.05]],
  ['2026-10-22',52,0.72,[0.01,0.06,0.30,0.43,0.12,0.08]],
];
const AGE_RANGES = [[15,17],[18,24],[25,34],[35,44],[45,54],[55,64]];

const rnd = (a,b)=>a+Math.random()*(b-a);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];
function esc(s){ return String(s).replace(/'/g,"''"); }

async function argus(path){
  const res = await fetch(`${ARGUS_BASE}${path}`, { headers:{ Authorization:`Bearer ${ARGUS_KEY}` } });
  if(!res.ok){ throw new Error(`ARGUS ${path} -> ${res.status} ${await res.text()}`); }
  return res.json();
}

// Busca a curva de PASSANTES por hora (/analytics/passantes), dia a dia, e agrega
// por hora-do-dia. Usamos passantes porque é a curva cheia (a plataforma só tem
// detecção de corpo; "pessoas" vem 0). Permanência também vem da ARGUS.
async function buildHourlyShape(){
  const agg = Array.from({length:24},()=>0);
  let permSum=0, permW=0;
  for(const [date] of DAYS){
    let j;
    try { j = await argus(`/analytics/passantes?de=${date}&ate=${date}`); }
    catch(e){ console.warn('  aviso:', e.message.slice(0,120)); continue; }
    const dados = j?.dados || {};
    const perm = Number(dados.permanencia_media_seg)||0;
    const pts = Array.isArray(dados.linha_do_tempo) ? dados.linha_do_tempo : [];
    let dayTotal=0;
    for(const p of pts){
      const m = String(p.quando||'').match(/(\d{2}):/);
      if(!m) continue;
      const h = Number(m[1]); if(!(h>=0&&h<24)) continue;
      const pass = Number(p.passantes)||0;
      agg[h] += pass; dayTotal += pass;
    }
    if(perm>0 && dayTotal>0){ permSum += perm*dayTotal; permW += dayTotal; }
  }
  const total = agg.reduce((s,a)=>s+a,0);
  const permBase = permW>0 ? Math.max(2, Math.round(permSum/permW)) : 6;
  // Fallback: se ARGUS não trouxe nada, usa curva comercial simples.
  if(total<=0){
    console.warn('ARGUS sem dados no período — usando curva comercial padrão.');
    const base = {9:2,10:4,11:6,12:9,13:7,14:6,15:10,16:8,17:9,18:6,19:3};
    let tot=0; for(const h in base) tot+=base[h];
    return { shape: Array.from({length:24},(_,h)=>(base[h]||0)/tot), permBase: 6 };
  }
  return { shape: agg.map(a=>a/total), permBase };
}

function hourFromShape(shape){
  const r=Math.random(); let acc=0;
  for(let h=0;h<24;h++){ acc+=shape[h]; if(r<=acc && shape[h]>0) return h; }
  let best=12,bw=-1; shape.forEach((w,h)=>{ if(w>bw){bw=w;best=h;} }); return best;
}

async function main(){
  console.log('Buscando curva de PASSANTES por hora na ARGUS (ao vivo)...');
  const { shape, permBase } = await buildHourlyShape();
  const used = shape.map((w,h)=>w>0?`${h}h:${(w*100).toFixed(1)}%`:null).filter(Boolean);
  console.log('Forma por hora (ARGUS passantes):', used.join('  '));
  console.log('Permanência base (ARGUS):', permBase, 's');

  const rows = [];
  for(const [date,max,masc,ages] of DAYS){
    const males = Math.round(max*masc);
    for(let i=0;i<max;i++){
      const g = i<males ? 1 : 2;
      // idade
      let r=Math.random(), acc=0, bi=5;
      for(let k=0;k<6;k++){ acc+=ages[k]; if(r<acc){bi=k;break;} }
      const [lo,hi]=AGE_RANGES[bi]; const age=Math.round(rnd(lo,hi+1-1e-9));
      // hora pela forma da ARGUS (passantes)
      const h = hourFromShape(shape);
      // Permanência (visita) e atenção ~ a permanência da ARGUS (~6s). Atenção
      // fica igual/levemente abaixo da visita, mas na mesma faixa (~6s).
      const dur = Math.max(3, Math.round(permBase + rnd(-1.5,2)));   // visita ~ARGUS (~6s)
      const att = Math.max(2, Math.round(permBase + rnd(-1.5,1.5))); // atenção ~ARGUS (~6s)
      const mi=Math.floor(Math.random()*60), se=Math.floor(Math.random()*60);
      const ts = `${date}T${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:${String(se).padStart(2,'0')}Z`;
      const teMs = Date.parse(ts)+dur*1000; const te = new Date(teMs).toISOString().replace('.000','');
      const dev = pick(POOL);
      const glasses = Math.random()<0.12?'dark':'none';
      const facial = (g===1 && Math.random()<0.5)?'beard':'none';
      const hair = pick(['black','brown','blond','gray']);
      const attrs = `{"glasses":"${glasses}","facial_hair":"${facial}","hair_color":"${hair}"}`;
      const raw = `{"tracks_duration":${dur},"content_view_duration":${att},"sex":${g},"age":${age},"devices":[${dev}],"start":"${ts}","end":"${te}"}`;
      rows.push(`('${esc(randomUUID())}','${CLIENT_ID}',${dev},'${ts}','${te}',${age},${g},'${attrs}'::jsonb,${dur},${dur},${att},'${raw}'::jsonb)`);
    }
  }

  const header = `-- SEED Stellantis — curva por hora da ARGUS (ao vivo) + volume da planilha
-- Gerado em ${new Date().toISOString()} | ${rows.length} visitas
delete from visitor_analytics        where client_id = '${CLIENT_ID}';
delete from visitor_analytics_rollups where client_id = '${CLIENT_ID}';
delete from visitor_total_cache       where client_id = '${CLIENT_ID}';

insert into visitor_analytics
  (visit_uid, client_id, device_id, timestamp, end_timestamp, age, gender,
   attributes, visit_time_seconds, dwell_time_seconds, contact_time_seconds, raw_data)
values
`;
  const sql = header + rows.join(',\n') + `;\n\nselect count(*) total,
  round((100.0*sum((gender=1)::int)/count(*))::numeric,1) pct_masc,
  round(avg(visit_time_seconds)::numeric,1) visita_s,
  round(avg(contact_time_seconds)::numeric,1) atencao_s
from visitor_analytics where client_id='${CLIENT_ID}';\n`;

  fs.writeFileSync('SEED_STELLANTIS_FICTICIO.sql', sql);
  console.log(`OK -> SEED_STELLANTIS_FICTICIO.sql (${rows.length} visitas, ${sql.length} bytes)`);
}
main().catch(e=>{ console.error('ERRO:', e.message); process.exit(1); });
