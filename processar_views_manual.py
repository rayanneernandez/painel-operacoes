"""
processar_views_manual.py
─────────────────────────
Processa o arquivo 'Views of visitors' do DisplayForce e insere os dados
de engajamento por campanha na tabela `campaigns` do Supabase.

Uso:
    python processar_views_manual.py <caminho_do_csv> <client_id>

Exemplos:
    python processar_views_manual.py "Views of visitors_20260330.csv" b1c05e4d-0417-4853-9af9-8c0725df1880
    python processar_views_manual.py "Views of visitors_20260330.csv" c6999bd9-14c0-4e26-abb1-d4b852d34421

IDs dos clientes:
    Assai  → b1c05e4d-0417-4853-9af9-8c0725df1880
    Panvel → c6999bd9-14c0-4e26-abb1-d4b852d34421
"""

import sys
import os
import logging
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("processar_views")

# ── Lê variáveis do .env ────────────────────────────────────────────────────

def _carregar_env(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and v and k not in os.environ:
                os.environ[k] = v

_carregar_env(".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    log.error("SUPABASE_URL e SUPABASE_KEY precisam estar definidos no .env")
    sys.exit(1)

# ── Processamento do CSV ────────────────────────────────────────────────────

def processar_views_csv(caminho: str, client_id: str) -> list[dict]:
    import pandas as pd

    log.info(f"Lendo CSV: {caminho}")
    try:
        df = pd.read_csv(caminho, skiprows=1, encoding="utf-8")
    except Exception:
        df = pd.read_csv(caminho, skiprows=1, encoding="latin-1")

    df.columns = [str(c).strip() for c in df.columns]
    log.info(f"  {len(df)} linhas | colunas: {list(df.columns)}")

    def _find(*names):
        for c in df.columns:
            if c.lower().strip() in {n.lower() for n in names}:
                return c
        for c in df.columns:
            for n in names:
                if n.lower() in c.lower():
                    return c
        return None

    col_campaign   = _find("Campaign", "Campanha")
    col_device     = _find("Device", "Dispositivo")
    col_visitor    = _find("Visitor ID", "VisitorID")
    col_contact_id = _find("Contact ID", "ContactID")
    col_contact_dur= _find("Contact Duration")
    col_start      = _find("Content View Start", "Contact Start")
    col_end        = _find("Content View End", "Contact End")

    if not col_campaign or not col_device:
        log.error("Colunas 'Campaign' ou 'Device' não encontradas no CSV.")
        return []

    df = df[
        df[col_campaign].notna() & (df[col_campaign].astype(str).str.strip() != "") &
        df[col_device].notna()   & (df[col_device].astype(str).str.strip()   != "")
    ].copy()

    def _parse_device(s: str):
        s = str(s).strip()
        if ": " in s:
            s = s.split(": ", 1)[1].strip()
        if " - " in s:
            parts = s.rsplit(" - ", 1)
            return parts[0].strip(), parts[1].strip()
        return s, ""

    agora = datetime.now(timezone.utc).isoformat()
    registros = []

    for (camp, dev), grupo in df.groupby([col_campaign, col_device]):
        camp = str(camp).strip()
        if not camp or camp.lower() == "nan":
            continue
        loja, tipo_midia = _parse_device(dev)

        visitors = grupo[col_visitor].nunique() if col_visitor else len(grupo)

        avg_attention = 0
        if col_contact_id and col_contact_dur:
            try:
                uniq = grupo.drop_duplicates(subset=[col_contact_id])[[col_contact_dur]]
                avg_attention = int(
                    pd.to_numeric(uniq[col_contact_dur], errors="coerce").mean() or 0
                )
            except Exception:
                pass

        start_date = end_date = None
        if col_start:
            try:
                dts = pd.to_datetime(grupo[col_start], errors="coerce").dropna()
                if not dts.empty:
                    start_date = dts.min().isoformat()
            except Exception:
                pass
        if col_end:
            try:
                dte = pd.to_datetime(grupo[col_end], errors="coerce").dropna()
                if not dte.empty:
                    end_date = dte.max().isoformat()
            except Exception:
                pass

        duration_days = duration_hms = None
        if start_date and end_date:
            try:
                import pandas as _pd
                delta = _pd.Timestamp(end_date) - _pd.Timestamp(start_date)
                total = int(delta.total_seconds())
                duration_days = round(total / 86400, 2)
                hh, rem = divmod(total, 3600)
                mm, ss = divmod(rem, 60)
                duration_hms = f"{hh}:{mm:02d}:{ss:02d}"
            except Exception:
                pass

        registros.append({
            "client_id":         client_id,
            "name":              camp,
            "tipo_midia":        tipo_midia,
            "loja":              loja,
            "start_date":        start_date,
            "end_date":          end_date,
            "duration_days":     duration_days,
            "duration_hms":      duration_hms,
            "visitors":          int(visitors),
            "avg_attention_sec": avg_attention,
            "uploaded_at":       agora,
        })
        log.info(f"  → '{camp}' | loja='{loja}' | tipo='{tipo_midia}' | visitantes={visitors} | atenção={avg_attention}s")

    log.info(f"  Total extraído: {len(registros)} registros")
    return registros


def upsert_supabase(registros: list[dict]) -> None:
    from supabase import create_client

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    tentativas = [
        ("client_id,name,tipo_midia,loja",   set()),
        ("client_id,name,start_date,end_date", set()),
        ("client_id,name",                    set()),
        ("client_id,name,tipo_midia,loja",    {"uploaded_at"}),
        ("client_id,name",                    {"uploaded_at", "tipo_midia", "loja"}),
    ]

    def _drop(rows, keys):
        return [{k: v for k, v in r.items() if k not in keys} for r in rows]

    for on_conflict, drop_keys in tentativas:
        try:
            payload = _drop(registros, drop_keys)
            res = sb.table("campaigns").upsert(payload, on_conflict=on_conflict).execute()
            count = len(res.data) if res.data else len(payload)
            log.info(f"✅ {count} registros salvos no Supabase (on_conflict={on_conflict})")
            return
        except Exception as e:
            log.warning(f"  Tentativa com {on_conflict} falhou: {e}")

    # Fallback: INSERT direto
    try:
        res2 = sb.table("campaigns").insert(registros, upsert=False).execute()
        count2 = len(res2.data) if res2.data else len(registros)
        log.info(f"✅ {count2} registros inseridos via INSERT direto")
    except Exception as e2:
        log.error(f"❌ Falha ao salvar no Supabase: {e2}")


# ── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(0)

    csv_path  = sys.argv[1]
    client_id = sys.argv[2]

    if not Path(csv_path).exists():
        log.error(f"Arquivo não encontrado: {csv_path}")
        sys.exit(1)

    registros = processar_views_csv(csv_path, client_id)
    if not registros:
        log.warning("Nenhum dado extraído — verifique o arquivo.")
        sys.exit(0)

    upsert_supabase(registros)
    log.info("Concluído!")
