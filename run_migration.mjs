import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_URL = 'https://zkzpvaabjchwnnvuwuls.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprenB2YWFiamNod25udnV3dWxzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU3OTYyOSwiZXhwIjoyMDg3MTU1NjI5fQ.udqmu2DaEN_WsW1f02UOfb8G8ScshrpMSJKlWM7W11I';

const sql = readFileSync(
  join(__dirname, 'supabase/migrations/001_brf_vision_architecture.sql'),
  'utf8'
);

// Split into statements, skip empty ones
const statements = sql
  .split(/;\s*\n/)
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

async function execSQL(query) {
  const res = await fetch(`${PROJECT_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ sql: query + ';' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res;
}

// First, create the exec_sql helper function using the internal pg endpoint
async function bootstrap() {
  const bootstrapSQL = `
    create or replace function exec_sql(sql text) returns void
    language plpgsql security definer as $$
    begin execute sql; end;
    $$;
  `;

  const res = await fetch(`${PROJECT_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ query: bootstrapSQL }),
  });

  console.log('Bootstrap status:', res.status);
  if (!res.ok) {
    const txt = await res.text();
    console.log('Bootstrap response:', txt);
    return false;
  }
  return true;
}

async function main() {
  console.log('Tentando bootstrap via /pg/query ...');
  const ok = await bootstrap();

  if (!ok) {
    console.log('\n/pg/query não disponível. Tentando via Management API...');
    const res = await fetch(
      `https://api.supabase.com/v1/projects/zkzpvaabjchwnnvuwuls/database/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ query: sql }),
      }
    );
    console.log('Management API status:', res.status);
    const body = await res.text();
    console.log('Response:', body.slice(0, 500));
    return;
  }

  console.log('\nBootstrap ok. Executando', statements.length, 'statements...\n');
  let ok_count = 0;
  let err_count = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 80).replace(/\n/g, ' ');
    process.stdout.write(`[${i + 1}/${statements.length}] ${preview}... `);
    try {
      await execSQL(stmt);
      console.log('OK');
      ok_count++;
    } catch (e) {
      console.log('ERRO:', e.message.slice(0, 150));
      err_count++;
    }
  }

  console.log(`\nConcluído: ${ok_count} ok, ${err_count} erros`);
}

main().catch(console.error);
