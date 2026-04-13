#!/usr/bin/env python3
"""
importar_agora.py — lê e-mails DisplayForce, extrai ZIPs (CSV/XLSX) e importa em Supabase.
"""
import os, io, imaplib, email, zipfile, logging, sys, hashlib
from datetime import datetime, timezone, timedelta
from email.header import decode_header

def _load_env(path=".env"):
    try:
        if not os.path.exists(path): return
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"): continue
                if line.lower().startswith("$env:"): line = line[5:].strip()
                if "=" not in line: continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip()
                if not k or not v: continue
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                atual = os.environ.get(k, "")
                atual_lower = atual.lower()
                deve_sobrescrever = (
                    not atual
                    or atual_lower.startswith("seu-")
                    or atual_lower.startswith("your-")
                    or "seu-projeto" in atual_lower
                    or "your-project" in atual_lower
                    or "example" in atual_lower
                    or atual.endswith("@...")
                )
                if deve_sobrescrever:
                    os.environ[k] = v
    except Exception: return

_load_env(os.environ.get("DOTENV_PATH", ".env"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler("importar_agora.log", encoding="utf-8")])
log = logging.getLogger("importar")

IMAP_SERVER   = os.environ.get("IMAP_SERVER", "imap.gmail.com")
IMAP_PORT     = int(os.environ.get("IMAP_PORT", "993"))
IMAP_EMAIL    = os.environ.get("IMAP_EMAIL", "")
IMAP_PASSWORD = os.environ.get("IMAP_PASSWORD", "")
SUPABASE_URL  = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")

_fallback_raw = os.environ.get("CLIENTES_FALLBACK", "Panvel|c6999bd9-14c0-4e26-abb1-d4b852d34421,Assai|b1c05e4d-0417-4853-9af9-8c0725df1880")
CLIENTES = {}
for part in _fallback_raw.split(","):
    if "|" in part:
        nome, uid = part.split("|", 1)
        CLIENTES[nome.strip().lower()] = uid.strip()

log.info(f"Clientes configurados: {list(CLIENTES.keys())}")

erros = []
if not IMAP_EMAIL:    erros.append("IMAP_EMAIL")
if not IMAP_PASSWORD: erros.append("IMAP_PASSWORD")
if not SUPABASE_URL:  erros.append("SUPABASE_URL")
if not SUPABASE_KEY:  erros.append("SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY")
if erros:
    log.error(f"Variaveis faltando: {', '.join(erros)}")
    sys.exit(1)

import requests as _req

def _sb_headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation"}

def _sb_get(table, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r = _req.get(url, headers=_sb_headers(), params=params or {}, timeout=30)
    r.raise_for_status()
    return r.json()

def _sb_insert(table, payload):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r = _req.post(url, headers=_sb_headers(), json=payload, timeout=30)
    r.raise_for_status()
    return r.json() if r.text else []

def _sb_patch(table, row_id, payload):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = dict(_sb_headers())
    headers["Prefer"] = "return=representation"
    r = _req.patch(url, headers=headers, params={"id": f"eq.{row_id}"}, json=payload, timeout=30)
    r.raise_for_status()
    return r.json() if r.text else []

def _norm_text(value):
    text = str(value or "").strip()
    return text or None

def _campaign_match_variants(registro):
    client_id = _norm_text(registro.get("client_id"))
    name = _norm_text(registro.get("name"))
    content_name = _norm_text(registro.get("content_name"))
    loja = _norm_text(registro.get("loja"))
    tipo_midia = _norm_text(registro.get("tipo_midia"))
    start_date = _norm_text(registro.get("start_date"))

    variants = []
    seen = set()

    def push(**kwargs):
        candidate = {"client_id": client_id}
        for key, value in kwargs.items():
            if value:
                candidate[key] = value
        if len(candidate) <= 1:
            return
        marker = tuple(sorted(candidate.items()))
        if marker in seen:
            return
        seen.add(marker)
        variants.append(candidate)

    push(name=name, content_name=content_name, loja=loja, tipo_midia=tipo_midia, start_date=start_date)
    push(content_name=content_name, loja=loja, tipo_midia=tipo_midia, start_date=start_date)
    push(name=name, loja=loja, tipo_midia=tipo_midia, start_date=start_date)
    push(name=name, content_name=content_name, loja=loja, tipo_midia=tipo_midia)
    push(content_name=content_name, loja=loja, tipo_midia=tipo_midia)
    push(name=name, loja=loja, tipo_midia=tipo_midia)
    if not loja and not tipo_midia:
        push(name=name, start_date=start_date)
        push(content_name=content_name, start_date=start_date)
        push(name=name, content_name=content_name)
    return variants

def _discover_mailboxes(imap):
    inbox = "INBOX"
    all_mail = None
    spam_boxes = []
    try:
        status, boxes = imap.list()
        if status != "OK" or not boxes:
            return inbox, all_mail, spam_boxes
        for raw in boxes:
            line = raw.decode("utf-8", errors="replace")
            lower = line.lower()
            name = line.rsplit(' "/" ', 1)[-1].strip().strip('"')
            if name.upper() == "INBOX":
                inbox = name
            if "\\all" in lower or "todos os e-mails" in lower or "all mail" in lower:
                all_mail = name
            if "\\junk" in lower or "spam" in lower or "lixo eletr" in lower:
                spam_boxes.append(name)
    except Exception:
        pass
    return inbox, all_mail, spam_boxes

def _find_existing_campaign(registro):
    for variant in _campaign_match_variants(registro):
        params = {"select": "id,uploaded_at", "order": "uploaded_at.desc", "limit": "1"}
        for key, value in variant.items():
            params[key] = f"eq.{value}"
        try:
            data = _sb_get("campaigns", params)
            if data:
                return data[0]
        except Exception as exc:
            log.warning(f"  Falha ao procurar campanha existente ({variant}): {exc}")
    return None

def _save_campaign_record(registro):
    existente = _find_existing_campaign(registro)
    if existente and existente.get("id"):
        _sb_patch("campaigns", existente["id"], registro)
        return 1
    _sb_insert("campaigns", registro)
    return 1

def salvar_supabase(registros):
    if not registros:
        return 0
    salvos = 0
    for registro in registros:
        try:
            salvos += _save_campaign_record(registro)
        except Exception as exc:
            log.warning(f"  Erro ao salvar campanha '{registro.get('content_name') or registro.get('name')}': {exc}")
    if salvos == 0:
        log.error("  Nao foi possivel salvar.")
    else:
        log.info(f"  OK {salvos} registros salvos/atualizados")
    return salvos

EXTENSOES_ACEITAS = (".csv", ".xlsx", ".xls", ".txt")

def extrair_zip(zip_bytes):
    arquivos = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            todos = [n for n in z.namelist() if not n.endswith("/") and not n.startswith("__MACOSX")]
            log.info(f"    Conteudo do ZIP ({len(todos)} arquivo(s)): {todos[:10]}")
            for nome in todos:
                ext = os.path.splitext(nome.lower())[1]
                if ext in EXTENSOES_ACEITAS:
                    arquivos.append((nome, z.read(nome)))
                    log.info(f"    OK Arquivo aceito: {nome}")
                else:
                    log.info(f"    X Ignorado ({ext!r}): {nome}")
    except zipfile.BadZipFile as e:
        log.error(f"  ZIP invalido: {e}")
    return arquivos

def processar_views_csv(arq_bytes, client_id, nome_arquivo=""):
    try:
        import pandas as pd
    except ImportError:
        log.error("pandas nao instalado"); return []

    log.info(f"  Processando: {nome_arquivo}")
    ext = os.path.splitext(nome_arquivo.lower())[1]
    df = None

    if ext in (".xlsx", ".xls"):
        for skip in (1, 0):
            try:
                df = pd.read_excel(io.BytesIO(arq_bytes), skiprows=skip)
                cols = [str(c).lower() for c in df.columns]
                if any("campaign" in c or "visitor" in c for c in cols): break
                df = None
            except Exception as e:
                log.warning(f"  Excel skip={skip}: {e}")
    else:
        for enc in ("utf-8", "latin-1", "utf-8-sig"):
            for skip in (1, 0):
                try:
                    df = pd.read_csv(io.BytesIO(arq_bytes), skiprows=skip, encoding=enc)
                    cols = [str(c).lower() for c in df.columns]
                    if any("campaign" in c or "campanha" in c or "visitor" in c for c in cols): break
                    df = None
                except Exception:
                    df = None
            if df is not None: break

    if df is None:
        log.error(f"  Nao conseguiu ler: {nome_arquivo}"); return []

    df.columns = [str(c).strip() for c in df.columns]
    log.info(f"  {len(df)} linhas | Colunas: {list(df.columns)[:8]}")

    def _find(*names):
        for c in df.columns:
            for n in names:
                if n.lower() in c.lower(): return c
        return None

    col_campaign    = _find("Campaign", "Campanha")
    col_content     = _find("Content", "Conteúdo", "Conteudo", "Video", "Vídeo")
    col_device      = _find("Device", "Dispositivo")
    col_visitor     = _find("Visitor ID", "VisitorID")
    col_contact_id  = _find("Contact ID", "ContactID")
    col_contact_dur = _find("Contact Duration")
    col_start       = _find("Content View Start", "Contact Start", "Start")
    col_end         = _find("Content View End", "Contact End", "End")

    if not col_campaign:
        log.warning("  Coluna Campaign nao encontrada — pulando."); return []
    if not col_device:
        log.warning("  Coluna Device nao encontrada — pulando."); return []

    df = df[df[col_campaign].notna() & (df[col_campaign].astype(str).str.strip() != "") &
            df[col_device].notna() & (df[col_device].astype(str).str.strip() != "")].copy()

    import re as _re
    def _clean_content(raw):
        n = str(raw).strip()
        n = _re.sub(r'\.mp4$', '', n, flags=_re.IGNORECASE)
        meses = r'(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)'
        n = _re.sub(rf'(?:[_\-\s]+\d{{1,2}}{meses})+(?:[_\-]\d{{2,4}})?', '', n, flags=_re.IGNORECASE)
        n = _re.sub(r'[_\-\s]*\d{3,4}\s*[xX]\s*\d{3,4}', '', n)
        n = _re.sub(r'\s*\([^)]*(?:vertical|horizontal)[^)]*\)', '', n, flags=_re.IGNORECASE)
        n = _re.sub(r'\s*\(\d+\)\s*$', '', n)
        n = _re.sub(r'[_\s]+v\d+$', '', n, flags=_re.IGNORECASE)
        n = _re.sub(r'[_\-\s]+$', '', n)
        return n.strip()

    agora = datetime.now(timezone.utc).isoformat()
    registros = []

    group_keys = [col_campaign, col_content, col_device] if (col_content and col_content in df.columns) else [col_campaign, col_device]

    for group_vals, grupo in df.groupby(group_keys):
        if len(group_keys) == 3:
            camp, content_val, dev = group_vals
            content_val = _clean_content(content_val) if str(content_val).strip().lower() != "nan" else ""
        else:
            camp, dev = group_vals
            content_val = ""
        camp = str(camp).strip()
        if not camp or camp.lower() == "nan": continue

        dev_str = str(dev).strip()
        if ": " in dev_str: dev_str = dev_str.split(": ", 1)[1]
        loja, tipo_midia = dev_str, ""
        if " - " in dev_str:
            parts = dev_str.rsplit(" - ", 1)
            loja, tipo_midia = parts[0].strip(), parts[1].strip()

        display_count = len(grupo)
        visitors = grupo[col_visitor].nunique() if col_visitor else len(grupo)
        avg_attention = 0
        if col_contact_id and col_contact_dur:
            try:
                uniq = grupo.drop_duplicates(subset=[col_contact_id])[[col_contact_dur]]
                avg_attention = int(pd.to_numeric(uniq[col_contact_dur], errors="coerce").mean() or 0)
            except Exception: pass

        start_date = end_date = None
        if col_start:
            try:
                dts = pd.to_datetime(grupo[col_start], errors="coerce").dropna()
                if not dts.empty: start_date = dts.min().isoformat()
            except Exception: pass
        if col_end:
            try:
                dte = pd.to_datetime(grupo[col_end], errors="coerce").dropna()
                if not dte.empty: end_date = dte.max().isoformat()
            except Exception: pass

        duration_days = duration_hms = None
        if start_date and end_date:
            try:
                delta = int((pd.Timestamp(end_date) - pd.Timestamp(start_date)).total_seconds())
                duration_days = round(delta / 86400, 2)
                hh, r2 = divmod(delta, 3600); mm, ss = divmod(r2, 60)
                duration_hms = f"{hh}:{mm:02d}:{ss:02d}"
            except Exception: pass

        registros.append({"client_id": client_id, "name": camp,
            "content_name": content_val if content_val else None,
            "tipo_midia": tipo_midia, "loja": loja,
            "start_date": start_date, "end_date": end_date,
            "duration_days": duration_days, "duration_hms": duration_hms,
            "display_count": display_count,
            "visitors": int(visitors), "avg_attention_sec": avg_attention,
            "uploaded_at": agora})

    log.info(f"  -> {len(registros)} registros extraidos")
    return registros

def detectar_cliente(assunto, remetente):
    texto = (assunto + " " + remetente).lower()
    for nome, uid in CLIENTES.items():
        if nome in texto: return nome, uid
    if len(CLIENTES) == 1:
        nome, uid = next(iter(CLIENTES.items())); return nome, uid
    return None

def buscar_emails_displayforce(dias=60):
    log.info(f"Conectando ao Gmail ({IMAP_EMAIL})...")
    try:
        imap = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
        imap.login(IMAP_EMAIL, IMAP_PASSWORD)
    except Exception as e:
        log.error(f"Falha IMAP: {e}"); return []

    resultados = []
    inbox, all_mail, _ = _discover_mailboxes(imap)
    pastas = [inbox]
    if all_mail and all_mail not in pastas:
        pastas.append(all_mail)

    for pasta in pastas:
        try:
            status, _ = imap.select(pasta)
            if status != "OK": continue
            from_date = (datetime.now() - timedelta(days=dias)).strftime("%d-%b-%Y")
            _, ids = imap.search(None, f'(SINCE "{from_date}")')
            ids_list = ids[0].split()
            if not ids_list: continue
            log.info(f"  {len(ids_list)} e-mails em '{pasta}'")

            for eid in ids_list:
                try:
                    _, data = imap.fetch(eid, "(RFC822)")
                    msg = email.message_from_bytes(data[0][1])
                    assunto_parts = decode_header(msg.get("Subject", ""))
                    assunto = "".join(p.decode(e or "utf-8", errors="ignore") if isinstance(p, bytes) else str(p) for p, e in assunto_parts)
                    remetente = msg.get("From", "")
                    al, rl = assunto.lower(), remetente.lower()
                    if not ("displ" in rl or "visitant" in al or "relat" in al or "visitor" in al):
                        continue
                    log.info(f"  Email '{assunto[:60]}' de {remetente[:40]}")
                    for part in msg.walk():
                        ct = part.get_content_type()
                        fn = part.get_filename() or ""
                        payload = part.get_payload(decode=True)
                        is_zip = (fn.lower().endswith(".zip") or
                                  ct in ("application/zip", "application/x-zip-compressed") or
                                  (payload and len(payload) > 4 and payload[:2] == b"PK"))
                        if is_zip and payload:
                            log.info(f"    ZIP: '{fn}' ({len(payload)} bytes)")
                            resultados.append((assunto, remetente, payload))
                except Exception as e:
                    log.warning(f"  Erro e-mail {eid}: {e}")
            break
        except Exception as e:
            log.debug(f"  Pasta '{pasta}': {e}")

    try: imap.logout()
    except Exception: pass
    return resultados

def main():
    log.info("=" * 60)
    log.info("  IMPORTACAO DE CAMPANHAS — DisplayForce -> Supabase")
    log.info("=" * 60)

    emails = buscar_emails_displayforce(dias=90)
    if not emails:
        log.warning("Nenhum e-mail com ZIP encontrado."); return

    log.info(f"\n{len(emails)} e-mail(s) com ZIP\n")
    total_salvos = 0
    processados = set()

    for assunto, remetente, zip_bytes in emails:


        # Evita processar o mesmo ZIP duas vezes (pelo hash)
        import hashlib

        chave = hashlib.md5(zip_bytes).hexdigest()
        if chave in processados:
            log.info("  (ZIP ja processado)"); continue
        processados.add(chave)

        cliente = detectar_cliente(assunto, remetente)
        if not cliente:
            log.warning(f"  Cliente nao identificado: '{assunto}'"); continue

        nome_cliente, client_id = cliente
        log.info(f"  Cliente: {nome_cliente} ({client_id})")

        arquivos = extrair_zip(zip_bytes)
        if not arquivos:
            log.warning("  ZIP sem arquivos reconhecidos (.csv/.xlsx)"); continue

        todos = []
        for nome_arq, arq_bytes in arquivos:
            todos.extend(processar_views_csv(arq_bytes, client_id, nome_arq))

        if not todos:
            log.warning("  Nenhum registro extraido"); continue

        salvos = sum(salvar_supabase(todos[i:i+100]) for i in range(0, len(todos), 100))
        total_salvos += salvos
        log.info(f"  {salvos}/{len(todos)} salvos para {nome_cliente}\n")

    log.info("=" * 60)
    log.info(f"  CONCLUIDO — Total: {total_salvos} registros importados")
    log.info("=" * 60)

if __name__ == "__main__":
    main()
                                                                                                           
