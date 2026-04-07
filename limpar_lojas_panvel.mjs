/**
 * limpar_lojas_panvel.mjs
 * Compara as lojas da Panvel no banco (Supabase) com as pastas reais da API Displayforce
 * e remove automaticamente as lojas que não existem mais na API.
 *
 * Como rodar: node limpar_lojas_panvel.mjs
 */

import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PANVEL_ID    = 'c6999bd9-14c0-4e26-abb1-d4b852d34421';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Credenciais Supabase não encontradas no .env');
  process.exit(1);
}

const sbHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`Supabase GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbDelete(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'DELETE', headers: sbHeaders });
  if (!r.ok) throw new Error(`Supabase DELETE ${path}: ${r.status} ${await r.text()}`);
  return r.status;
}

async function main() {
  console.log('🔍 Buscando configuração da API Panvel no banco...');
  const [cfg] = await sbGet(
    `client_api_configs?client_id=eq.${PANVEL_ID}&select=api_endpoint,api_key,custom_header_key,custom_header_value`
  );
  if (!cfg) { console.error('❌ Config da API não encontrada para a Panvel'); process.exit(1); }

  const base = (cfg.api_endpoint || 'https://api.displayforce.ai').replace(/\/$/, '');
  const apiHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (cfg.custom_header_key?.trim() && cfg.custom_header_value?.trim()) {
    apiHeaders[cfg.custom_header_key.trim()] = cfg.custom_header_value.trim();
  } else if (cfg.api_key?.trim()) {
    apiHeaders['X-API-Token'] = cfg.api_key.trim();
  }

  console.log('📡 Buscando pastas (lojas) na API Displayforce...');
  let folders = [];
  for (const endpoint of ['/public/v1/device-folder/list', '/public/v1/folder/list']) {
    const r = await fetch(`${base}${endpoint}?recursive=true&limit=500`, { headers: apiHeaders });
    if (r.ok) {
      const json = await r.json();
      const arr = Array.isArray(json) ? json
        : Array.isArray(json?.payload) ? json.payload
        : Array.isArray(json?.data) ? json.data
        : Array.isArray(json?.results) ? json.results : [];
      if (arr.length > 0) { folders = arr; break; }
    }
  }
  console.log(`✅ API retornou ${folders.length} pasta(s)/loja(s)`);
  folders.forEach(f => console.log(`   • [${f.id}] ${f.name}`));

  console.log('\n🗄️  Buscando lojas da Panvel no banco...');
  const dbStores = await sbGet(
    `stores?client_id=eq.${PANVEL_ID}&select=id,name,city&order=name.asc`
  );
  console.log(`✅ Banco tem ${dbStores.length} loja(s):`);
  dbStores.forEach(s => console.log(`   • [${s.id}] ${s.name} | ${s.city || 'sem cidade'}`));

  // Compara: nomes das pastas da API (lowercase) vs nomes no banco (lowercase)
  const apiNames = new Set(folders.map(f => String(f.name || '').trim().toLowerCase()));
  const orphans  = dbStores.filter(s => !apiNames.has(String(s.name || '').trim().toLowerCase()));

  if (orphans.length === 0) {
    console.log('\n✅ Nenhuma loja órfã encontrada. O banco já está correto!');
    return;
  }

  console.log(`\n⚠️  ${orphans.length} loja(s) no banco NÃO existem mais na API:`);
  orphans.forEach(s => console.log(`   ❌ [${s.id}] ${s.name}`));

  console.log('\n🗑️  Removendo lojas órfãs do banco...');
  for (const s of orphans) {
    console.log(`   Removendo dispositivos de "${s.name}"...`);
    await sbDelete(`devices?store_id=eq.${s.id}`);
    console.log(`   Removendo loja "${s.name}"...`);
    await sbDelete(`stores?id=eq.${s.id}`);
    console.log(`   ✅ "${s.name}" removida.`);
  }

  const remaining = await sbGet(`stores?client_id=eq.${PANVEL_ID}&select=id,name&order=name.asc`);
  console.log(`\n✅ Concluído! Banco agora tem ${remaining.length} loja(s) — igual à API.`);
}

main().catch(e => { console.error('❌ Erro:', e.message); process.exit(1); });
