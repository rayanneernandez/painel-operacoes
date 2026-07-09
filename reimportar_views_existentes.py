"""
Reprocessa todos os CSVs 'Views of visitors' já baixados na pasta
downloads_displayforce/ e reimporta para o Supabase com os campos:
  - total_play_seconds
  - gender_breakdown  {"male": N, "female": N, "unknown": N}
  - age_breakdown     {"18-24": N, "25-34": N, ...}

Uso:
    python reimportar_views_existentes.py
"""
import csv, re, os, sys, json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ── Carrega .env — força override de variáveis do sistema ────────────────────
for p in [".env.local", ".env"]:
    if os.path.exists(p):
        with open(p, encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    k, v = k.strip(), v.strip().strip('"').strip("'")
                    if k: os.environ[k] = v  # força override (não usa setdefault)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
PANVEL_CLIENT_ID = "c6999bd9-14c0-4e26-abb1-d4b852d34421"

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ SUPABASE_URL ou SUPABASE_KEY não configurados no .env"); sys.exit(1)

import requests

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

# ── Helpers ──────────────────────────────────────────────────────────────────
def clean_name(raw):
    name = str(raw).strip()
    name = re.sub(r"\.mp4$", "", name, flags=re.IGNORECASE)
    meses = r"(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)"
    name = re.sub(rf"(?:[_\-\s]+\d{{1,2}}{meses})+(?:[_\-]\d{{2,4}})?", "", name, flags=re.IGNORECASE)
    name = re.sub(r"[_\-\s]*\d{{3,4}}\s*[xX]\s*\d{{3,4}}", "", name)
    name = re.sub(r"\s*\([^)]*(?:vertical|horizontal)[^)]*\)", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s*\(\d+\)\s*$", "", name)
    return re.sub(r"[_\-\s]+$", "", name).strip()

def parse_device(d):
    if " - " in d:
        loja, tipo = d.rsplit(" - ", 1)
        return loja.strip(), tipo.strip()
    return d.strip(), ""

def parse_date(s):
    if not s or s in ("-", ""): return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try: return datetime.strptime(s, fmt).isoformat()
        except: pass
    return None

def age_label(raw):
    try:
        a = int(float(raw))
        if a <= 0: return None
        if a < 18:  return "0-17"
        if a < 25:  return "18-24"
        if a < 35:  return "25-34"
        if a < 45:  return "35-44"
        if a < 55:  return "45-54"
        return "55+"
    except: return None

# ── Processa CSV ─────────────────────────────────────────────────────────────
def processar(csv_path, client_id):
    with open(csv_path, encoding="utf-8-sig", errors="replace") as f:
        primeira = f.readline()
        if primeira.strip().strip('"').lower() != "sep=,":
            f.seek(0)
        reader = csv.DictReader(f)
        linhas = list(reader)

    if not linhas:
        print(f"  ⚠️  Arquivo vazio: {csv_path}"); return []

    headers = list(linhas[0].keys())

    def find(col):
        hl = {h.lower().strip(): h for h in headers if h}
        # exact first
        if col.lower() in hl: return hl[col.lower()]
        # partial
        for h_low, h_orig in hl.items():
            if col.lower() in h_low: return h_orig
        return None

    col_campaign = find("campaign") or find("campanha")
    col_content  = find("content") or find("conteudo")
    col_device   = find("device") or find("dispositivo")
    col_duration = find("content view duration") or find("duration")
    col_visitor  = find("visitor id") or find("visitor")
    col_start    = find("content view start") or find("start")
    col_end      = find("content view end") or find("end")
    col_gender   = find("gender") or find("genero")
    col_age      = find("age") or find("idade")

    if not col_campaign and not col_content:
        print(f"  ⚠️  Sem colunas Campaign/Content — pulando: {Path(csv_path).name}"); return []

    print(f"  Colunas: campaign={col_campaign}, content={col_content}, gender={col_gender}, age={col_age}")

    agr = defaultdict(lambda: {
        "visitors": set(), "display_count": 0,
        "attn_sum": 0.0, "attn_count": 0,
        "start": None, "end": None,
        "gender": {"male": 0, "female": 0, "unknown": 0},
        "age": {},
    })
    agora = datetime.now(timezone.utc).isoformat()

    for row in linhas:
        campaign   = str(row.get(col_campaign) or "").strip() if col_campaign else ""
        content    = str(row.get(col_content)  or "").strip() if col_content  else ""
        device     = str(row.get(col_device)   or "").strip() if col_device   else ""
        visitor    = str(row.get(col_visitor)  or "").strip() if col_visitor  else ""
        dur_raw    = str(row.get(col_duration) or "").strip() if col_duration else ""
        start_s    = str(row.get(col_start)    or "").strip() if col_start    else ""
        end_s      = str(row.get(col_end)      or "").strip() if col_end      else ""
        gender_raw = str(row.get(col_gender)   or "").strip().lower() if col_gender else ""
        age_raw    = str(row.get(col_age)      or "").strip() if col_age else ""

        if not campaign and not content: continue

        content_clean = clean_name(content) if content else ""
        loja, tipo_midia = parse_device(device) if device else ("", "")
        name = campaign or content_clean or content

        key = (name, content_clean, tipo_midia, loja)
        rec = agr[key]

        if visitor: rec["visitors"].add(visitor)
        rec["display_count"] += 1

        try:
            d = float(dur_raw)
            if d > 0:
                rec["attn_sum"] += d
                rec["attn_count"] += 1
        except: pass

        # Gênero
        if "male" in gender_raw or gender_raw == "m":
            rec["gender"]["male"] += 1
        elif "female" in gender_raw or "fem" in gender_raw or gender_raw == "f":
            rec["gender"]["female"] += 1
        else:
            rec["gender"]["unknown"] += 1

        # Idade
        lbl = age_label(age_raw)
        if lbl:
            rec["age"][lbl] = rec["age"].get(lbl, 0) + 1

        s = parse_date(start_s)
        e = parse_date(end_s)
        if s and (rec["start"] is None or s < rec["start"]): rec["start"] = s
        if e and (rec["end"] is None or e > rec["end"]): rec["end"] = e

    registros = []
    for (name, content_name, tipo_midia, loja), rec in agr.items():
        registros.append({
            "client_id": client_id,
            "name": name,
            "content_name": content_name or "",
            "tipo_midia": tipo_midia or "",
            "loja": loja or "",
            "start_date": rec["start"],
            "end_date": rec["end"],
            "duration_days": None,
            "duration_hms": None,
            "display_count": rec["display_count"],
            "total_play_seconds": int(rec["attn_sum"]),
            "visitors": len(rec["visitors"]),
            "avg_attention_sec": int(rec["attn_sum"] / rec["attn_count"]) if rec["attn_count"] else 0,
            "gender_breakdown": rec["gender"],
            "age_breakdown": rec["age"] if rec["age"] else None,
            "uploaded_at": agora,
        })

    print(f"  {len(registros)} registros agregados de {Path(csv_path).name}")
    return registros

# ── Upsert no Supabase ────────────────────────────────────────────────────────
def upsert(registros):
    ok = 0
    for i in range(0, len(registros), 200):
        chunk = registros[i:i+200]
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/campaigns",
            headers=SB_HEADERS,
            params={"on_conflict": "client_id,name,content_name,tipo_midia,loja"},
            json=chunk,
            timeout=30,
        )
        if r.ok:
            ok += len(chunk)
            print(f"  ✅ Lote {i//200+1}: {len(chunk)} registros salvos")
        else:
            print(f"  ❌ Lote {i//200+1}: {r.status_code} — {r.text[:200]}")
    return ok

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    pasta = Path("downloads_displayforce")
    csvs = sorted(pasta.glob("Views of visitors*.csv"), reverse=True) if pasta.exists() else []

    if not csvs:
        print("❌ Nenhum CSV encontrado em downloads_displayforce/"); sys.exit(1)

    print(f"📂 {len(csvs)} arquivo(s) Views encontrado(s):\n")
    for i, p in enumerate(csvs, 1):
        print(f"  {i}. {p.name}")

    print(f"\n🏢 Cliente: Panvel ({PANVEL_CLIENT_ID})\n")

    total_ok = 0
    for csv_path in csvs:
        print(f"\n─── Processando: {csv_path.name}")
        regs = processar(str(csv_path), PANVEL_CLIENT_ID)
        if regs:
            total_ok += upsert(regs)

    print(f"\n🎉 Concluído! {total_ok} registros atualizados no Supabase.")
    print("   Recarregue o painel para ver TEMPO TOTAL, GÊNERO e IDADE.")
