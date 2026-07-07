"""
Importa arquivo 'Views of visitors' CSV para o Supabase (tabela campaigns).
Uso:
    python importar_views_csv.py caminho_do_arquivo.csv [client_id]

Exemplo:
    python importar_views_csv.py "downloads_displayforce\Views of visitors_20260707_120145.csv"
    python importar_views_csv.py "downloads_displayforce\Views of visitors_20260707_120145.csv" c6999bd9-14c0-4e26-abb1-d4b852d34421
"""
import csv, re, sys, os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ── Carrega .env ────────────────────────────────────────────────────────────
def _load_env(path=".env.local"):
    for p in [".env.local", ".env"]:
        if os.path.exists(p):
            with open(p, encoding="utf-8-sig", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, _, v = line.partition("=")
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k:
                            os.environ[k] = v

_load_env()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_KEY")
    or ""
)

# client_id padrão = Panvel (pode ser passado como 2° argumento)
PANVEL_CLIENT_ID = "c6999bd9-14c0-4e26-abb1-d4b852d34421"

# ── Helpers ─────────────────────────────────────────────────────────────────
def clean_name(raw):
    name = str(raw).strip()
    name = re.sub(r"\.mp4$", "", name, flags=re.IGNORECASE)
    meses = r"(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)"
    name = re.sub(rf"(?:[_\-\s]+\d{{1,2}}{meses})+(?:[_\-]\d{{2,4}})?", "", name, flags=re.IGNORECASE)
    name = re.sub(r"[_\-\s]*\d{3,4}\s*[xX]\s*\d{3,4}", "", name)
    name = re.sub(r"\s*\([^)]*(?:vertical|horizontal)[^)]*\)", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s*\(\d+\)\s*$", "", name)
    return re.sub(r"[_\-\s]+$", "", name).strip()

def parse_device(device_name):
    if " - " in device_name:
        loja, tipo = device_name.rsplit(" - ", 1)
        return loja.strip(), tipo.strip()
    return device_name.strip(), ""

def parse_date(s):
    if not s or s == "-": return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except: pass
    return None

# ── Processar CSV ────────────────────────────────────────────────────────────
def processar_csv(csv_path, client_id):
    agr = defaultdict(lambda: {
        "visitors": set(), "display_count": 0,
        "attn": 0.0, "attn_n": 0, "start": None, "end": None
    })
    agora = datetime.now(timezone.utc).isoformat()

    with open(csv_path, encoding="utf-8-sig", errors="replace") as f:
        primeira = f.readline()
        if primeira.strip().strip('"').lower() != "sep=,":
            f.seek(0)
        reader = csv.DictReader(f)
        n = 0
        for row in reader:
            campaign = (row.get("Campaign") or "").strip()
            content  = (row.get("Content") or "").strip()
            device   = (row.get("Device") or "").strip()
            visitor  = (row.get("Visitor ID") or "").strip()
            dur_raw  = (row.get("Content View Duration") or "").strip()
            start_s  = (row.get("Content View Start") or "").strip()
            end_s    = (row.get("Content View End") or "").strip()

            name = campaign or clean_name(content) or content
            if not name: continue

            content_clean = clean_name(content) if content else None
            loja, tipo_midia = parse_device(device) if device else ("", "")

            key = (name, content_clean or "", tipo_midia, loja)
            rec = agr[key]
            if visitor: rec["visitors"].add(visitor)
            rec["display_count"] += 1
            try:
                d = float(dur_raw)
                if d > 0:
                    rec["attn"] += d
                    rec["attn_n"] += 1
            except: pass
            s = parse_date(start_s)
            e = parse_date(end_s)
            if s and (rec["start"] is None or s < rec["start"]): rec["start"] = s
            if e and (rec["end"] is None or e > rec["end"]): rec["end"] = e
            n += 1

    print(f"✅ Linhas processadas: {n:,}  |  Registros únicos: {len(agr)}")

    registros = []
    for (name, content_name, tipo_midia, loja), rec in agr.items():
        registros.append({
            "client_id": client_id,
            "name": name,
            "content_name": content_name or None,
            "tipo_midia": tipo_midia or None,
            "loja": loja or None,
            "start_date": rec["start"],
            "end_date": rec["end"],
            "duration_days": None,
            "duration_hms": None,
            "display_count": rec["display_count"],
            "visitors": len(rec["visitors"]),
            "avg_attention_sec": int(rec["attn"] / rec["attn_n"]) if rec["attn_n"] else 0,
            "uploaded_at": agora,
        })
    return registros

# ── Inserir no Supabase ──────────────────────────────────────────────────────
def inserir_supabase(registros, client_id):
    import requests

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    print(f"\n🗑️  Removendo campanhas antigas do cliente...")
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/campaigns",
        headers=headers,
        params={"client_id": f"eq.{client_id}"},
        timeout=30
    )
    print(f"   DELETE: {r.status_code}")

    print(f"\n📤 Inserindo {len(registros)} registros...")
    ok = 0
    for i in range(0, len(registros), 100):
        chunk = registros[i:i+100]
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/campaigns",
            headers=headers,
            json=chunk,
            timeout=30
        )
        if r.status_code in (200, 201):
            ok += len(chunk)
            print(f"   Lote {i//100+1}: ✅ {len(chunk)} registros")
        else:
            print(f"   Lote {i//100+1}: ❌ {r.status_code} — {r.text[:150]}")

    print(f"\n🎉 Concluído: {ok}/{len(registros)} registros inseridos!")
    return ok

# ── Main ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        # Tenta encontrar o arquivo mais recente na pasta downloads
        pasta = Path("downloads_displayforce")
        candidatos = sorted(pasta.glob("Views of visitors*.csv"), reverse=True) if pasta.exists() else []
        if candidatos:
            csv_path = str(candidatos[0])
            print(f"Usando arquivo mais recente: {csv_path}")
        else:
            print("Uso: python importar_views_csv.py <caminho_do_csv> [client_id]")
            print("Exemplo: python importar_views_csv.py \"downloads_displayforce\\Views of visitors_20260707.csv\"")
            sys.exit(1)
    else:
        csv_path = sys.argv[1]

    client_id = sys.argv[2] if len(sys.argv) > 2 else PANVEL_CLIENT_ID

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ SUPABASE_URL ou SUPABASE_KEY não configurados no .env")
        sys.exit(1)

    print(f"📂 Arquivo: {csv_path}")
    print(f"🏢 Cliente: Panvel ({client_id})")
    print()

    registros = processar_csv(csv_path, client_id)
    inserir_supabase(registros, client_id)
