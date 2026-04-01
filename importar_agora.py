#!/usr/bin/env python3
"""
importar_agora.py
─────────────────────────────────────────────────────────────────
Lê os e-mails da DisplayForce no Gmail, extrai os ZIPs com CSV
de visitantes e importa os dados na tabela `campaigns` do Supabase.

Uso:
    python importar_agora.py

Não precisa de nenhuma configuração extra — lê tudo do .env
─────────────────────────────────────────────────────────────────
"""

import os, io, imaplib, email, zipfile, logging, sys
from datetime import datetime, timezone, timedelta
from email.header import decode_header

# ── Carrega .env ──────────────────────────────────────────────────────────────
def _load_env(path=".env"):
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

_load_env(".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("importar_agora.log", encoding="utf-8"),
    ]
)
log = logging.getLogger("importar")

# ── Configurações (do .env) ────────────────────────────────────────────────────
IMAP_SERVER   = os.environ.get("IMAP_SERVER",   "imap.gmail.com")
IMAP_PORT     = int(os.environ.get("IMAP_PORT", "993"))
IMAP_EMAIL    = os.environ.get("IMAP_EMAIL",    "")
IMAP_PASSWORD = os.environ.get("IMAP_PASSWORD", "")

SUPABASE_URL  = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY  = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# IDs dos clientes no Supabase (do CLIENTES_FALLBACK no .env ou hardcoded)
_fallback_raw = os.environ.get("CLIENTES_FALLBACK", "Panvel|c6999bd9-14c0-4e26-abb1-d4b852d34421,Assai|b1c05e4d-0417-4853-9af9-8c0725df1880")
CLIENTES = {}
for part in _fallback_raw.split(","):
    if "|" in part:
        nome, uid = part.split("|", 1)
        CLIENTES[nome.strip().lower()] = uid.strip()

log.info(f"Clientes configurados: {list(CLIENTES.keys())}")

# ── Validação ─────────────────────────────────────────────────────────────────
erros = []
if not IMAP_EMAIL:    erros.append("IMAP_EMAIL")
if not IMAP_PASSWORD: erros.append("IMAP_PASSWORD")
if not SUPABASE_URL:  erros.append("SUPABASE_URL")
if not SUPABASE_KEY:  erros.append("SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY")
if erros:
    log.error(f"Variáveis faltando no .env: {', '.join(erros)}")
    sys.exit(1)

# ── Supabase REST (usa requests — lê proxy do Windows automaticamente) ─────────
import requests as _req

def _sb_headers():
    return {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates,return=representation",
    }

def salvar_supabase(registros: list) -> int:
    if not registros:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/campaigns"
    # Tenta upsert com on_conflict=client_id,name,start_date
    for on_conflict in ["client_id,name,start_date", "client_id,name", None]:
        try:
            params = {}
            if on_conflict:
                params["on_conflict"] = on_conflict
            r = _req.post(url, headers=_sb_headers(), params=params, json=registros, timeout=30)
            if r.status_code in (200, 201):
                data = r.json()
                count = len(data) if isinstance(data, list) else len(registros)
                log.info(f"  ✅ {count} registros salvos (on_conflict={on_conflict})")
                return count
            log.warning(f"  Status {r.status_code} com on_conflict={on_conflict}: {r.text[:200]}")
        except Exception as e:
            log.warning(f"  Erro com on_conflict={on_conflict}: {e}")
    log.error("  ❌ Não foi possível salvar os registros no Supabase.")
    return 0

# ── Processamento do CSV "Views of visitors" ──────────────────────────────────
def processar_views_csv(csv_bytes: bytes, client_id: str, nome_arquivo: str = "") -> list:
    try:
        import pandas as pd
    except ImportError:
        log.error("pandas não instalado. Execute: pip install pandas")
        return []

    log.info(f"  Processando CSV: {nome_arquivo}")
    try:
        df = pd.read_csv(io.BytesIO(csv_bytes), skiprows=1, encoding="utf-8")
    except Exception:
        try:
            df = pd.read_csv(io.BytesIO(csv_bytes), skiprows=1, encoding="latin-1")
        except Exception as e:
            log.error(f"  Não conseguiu ler CSV: {e}")
            return []

    df.columns = [str(c).strip() for c in df.columns]
    log.info(f"  {len(df)} linhas | Colunas: {list(df.columns)[:8]}")

    def _find(*names):
        for c in df.columns:
            for n in names:
                if n.lower() in c.lower():
                    return c
        return None

    col_campaign    = _find("Campaign", "Campanha")
    col_device      = _find("Device", "Dispositivo")
    col_visitor     = _find("Visitor ID", "VisitorID")
    col_contact_id  = _find("Contact ID", "ContactID")
    col_contact_dur = _find("Contact Duration")
    col_start       = _find("Content View Start", "Contact Start", "Start")
    col_end         = _find("Content View End",   "Contact End",   "End")

    if not col_campaign:
        log.warning("  Coluna 'Campaign' não encontrada — pulando arquivo.")
        return []
    if not col_device:
        log.warning("  Coluna 'Device' não encontrada — pulando arquivo.")
        return []

    df = df[
        df[col_campaign].notna() & (df[col_campaign].astype(str).str.strip() != "") &
        df[col_device].notna()   & (df[col_device].astype(str).str.strip()   != "")
    ].copy()

    agora = datetime.now(timezone.utc).isoformat()
    registros = []

    for (camp, dev), grupo in df.groupby([col_campaign, col_device]):
        camp = str(camp).strip()
        if not camp or camp.lower() == "nan":
            continue

        # Extrai loja e tipo_midia do campo device
        dev_str = str(dev).strip()
        if ": " in dev_str:
            dev_str = dev_str.split(": ", 1)[1]
        loja, tipo_midia = dev_str, ""
        if " - " in dev_str:
            parts = dev_str.rsplit(" - ", 1)
            loja, tipo_midia = parts[0].strip(), parts[1].strip()

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
                delta = int((_pd.Timestamp(end_date) - _pd.Timestamp(start_date)).total_seconds())
                duration_days = round(delta / 86400, 2)
                hh, r = divmod(delta, 3600)
                mm, ss = divmod(r, 60)
                duration_hms = f"{hh}:{mm:02d}:{ss:02d}"
            except Exception:
                pass

        registros.append({
            "client_id":          client_id,
            "name":               camp,
            "tipo_midia":         tipo_midia,
            "loja":               loja,
            "start_date":         start_date,
            "end_date":           end_date,
            "duration_days":      duration_days,
            "duration_hms":       duration_hms,
            "visitors":           int(visitors),
            "avg_attention_sec":  avg_attention,
            "uploaded_at":        agora,
            "updated_at":         agora,
        })

    log.info(f"  → {len(registros)} registros extraídos")
    return registros

# ── Extrai arquivos de um ZIP ─────────────────────────────────────────────────
def extrair_zip(zip_bytes: bytes) -> list:
    """Retorna lista de (nome_arquivo, conteudo_bytes)"""
    arquivos = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            for nome in z.namelist():
                if nome.endswith("/") or nome.startswith("__MACOSX"):
                    continue
                if nome.lower().endswith(".csv"):
                    arquivos.append((nome, z.read(nome)))
                    log.info(f"    Arquivo no ZIP: {nome}")
    except zipfile.BadZipFile as e:
        log.error(f"  ZIP inválido: {e}")
    return arquivos

# ── Detecta qual cliente pertence o e-mail ────────────────────────────────────
def detectar_cliente(assunto: str, remetente: str) -> tuple[str, str] | None:
    """Retorna (nome_cliente, client_id) ou None"""
    texto = (assunto + " " + remetente).lower()
    for nome, uid in CLIENTES.items():
        if nome in texto:
            return nome, uid
    # fallback: usa Panvel se tiver só um cliente configurado
    if len(CLIENTES) == 1:
        nome, uid = next(iter(CLIENTES.items()))
        return nome, uid
    return None

# ── Lê e-mails do Gmail via IMAP ─────────────────────────────────────────────
def buscar_emails_displayforce(dias: int = 60) -> list:
    """
    Conecta no Gmail, busca e-mails da DisplayForce com ZIP nos últimos `dias` dias.
    Retorna lista de (assunto, remetente, zip_bytes).
    """
    log.info(f"Conectando ao Gmail ({IMAP_EMAIL})...")
    try:
        imap = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
        imap.login(IMAP_EMAIL, IMAP_PASSWORD)
    except Exception as e:
        log.error(f"Falha ao conectar no IMAP: {e}")
        return []

    resultados = []

    # Busca em INBOX e possivelmente outras pastas
    pastas = ["INBOX", "[Gmail]/Todos os e-mails", "[Gmail]/All Mail", "All Mail"]
    encontrou = False

    for pasta in pastas:
        try:
            status, _ = imap.select(pasta)
            if status != "OK":
                continue

            # Busca e-mails dos últimos `dias` dias
            from_date = (datetime.now() - timedelta(days=dias)).strftime("%d-%b-%Y")
            _, ids = imap.search(None, f'(SINCE "{from_date}")')
            ids_list = ids[0].split()

            if not ids_list:
                log.info(f"  Nenhum e-mail encontrado em '{pasta}'")
                continue

            log.info(f"  {len(ids_list)} e-mails em '{pasta}' (últimos {dias} dias)")
            encontrou = True

            for eid in ids_list:
                try:
                    _, data = imap.fetch(eid, "(RFC822)")
                    raw = data[0][1]
                    msg = email.message_from_bytes(raw)

                    assunto_raw = msg.get("Subject", "")
                    assunto_parts = decode_header(assunto_raw)
                    assunto = ""
                    for part, enc in assunto_parts:
                        if isinstance(part, bytes):
                            assunto += part.decode(enc or "utf-8", errors="ignore")
                        else:
                            assunto += str(part)

                    remetente = msg.get("From", "")

                    # Filtra e-mails relevantes
                    assunto_lower = assunto.lower()
                    remetente_lower = remetente.lower()
                    relevante = (
                        "displayforce" in remetente_lower or
                        "displ" in remetente_lower or
                        "visitant" in assunto_lower or
                        "relatório" in assunto_lower or
                        "relatorio" in assunto_lower or
                        "visitor" in assunto_lower
                    )
                    if not relevante:
                        continue

                    log.info(f"  📧 E-mail relevante: '{assunto[:60]}' de {remetente[:40]}")

                    # Procura anexo ZIP
                    for part in msg.walk():
                        ct = part.get_content_type()
                        filename = part.get_filename() or ""
                        payload = part.get_payload(decode=True)

                        is_zip = (
                            filename.lower().endswith(".zip") or
                            ct in ("application/zip", "application/x-zip-compressed") or
                            (payload and len(payload) > 4 and payload[:2] == b"PK")
                        )

                        if is_zip and payload:
                            log.info(f"    ZIP encontrado: '{filename}' ({len(payload)} bytes)")
                            resultados.append((assunto, remetente, payload))

                except Exception as e:
                    log.warning(f"  Erro ao processar e-mail {eid}: {e}")

            break  # Se encontrou a pasta certa, para aqui

        except Exception as e:
            log.debug(f"  Pasta '{pasta}' indisponível: {e}")

    if not encontrou:
        log.warning("Nenhuma pasta de e-mail acessível encontrada.")

    try:
        imap.logout()
    except Exception:
        pass

    return resultados

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    log.info("=" * 60)
    log.info("  IMPORTAÇÃO DE CAMPANHAS — DisplayForce → Supabase")
    log.info("=" * 60)

    # 1. Busca e-mails
    emails = buscar_emails_displayforce(dias=90)
    if not emails:
        log.warning("Nenhum e-mail com ZIP encontrado nos últimos 90 dias.")
        log.info("Dica: verifique se IMAP_EMAIL e IMAP_PASSWORD estão corretos no .env")
        return

    log.info(f"\n{len(emails)} e-mail(s) com ZIP para processar\n")

    total_salvos = 0
    processados = set()

    for assunto, remetente, zip_bytes in emails:
        # Evita processar o mesmo ZIP duas vezes (pelo tamanho)
        chave = len(zip_bytes)
        if chave in processados:
            log.info(f"  (ZIP já processado, pulando)")
            continue
        processados.add(chave)

        # Detecta cliente
        cliente = detectar_cliente(assunto, remetente)
        if not cliente:
            log.warning(f"  Não identificou o cliente para: '{assunto}' — pulando")
            log.warning(f"  Clientes configurados: {list(CLIENTES.keys())}")
            continue

        nome_cliente, client_id = cliente
        log.info(f"  Cliente: {nome_cliente} ({client_id})")

        # Extrai arquivos do ZIP
        csvs = extrair_zip(zip_bytes)
        if not csvs:
            log.warning("  ZIP sem CSVs encontrado — pulando")
            continue

        # Processa cada CSV
        todos_registros = []
        for nome_arq, csv_bytes in csvs:
            registros = processar_views_csv(csv_bytes, client_id, nome_arq)
            todos_registros.extend(registros)

        if not todos_registros:
            log.warning("  Nenhum registro extraído dos CSVs")
            continue

        # Salva em lotes de 100
        salvos = 0
        for i in range(0, len(todos_registros), 100):
            lote = todos_registros[i:i+100]
            salvos += salvar_supabase(lote)

        total_salvos += salvos
        log.info(f"  ✅ {salvos}/{len(todos_registros)} registros salvos para {nome_cliente}\n")

    log.info("=" * 60)
    log.info(f"  CONCLUÍDO — Total: {total_salvos} registros importados")
    log.info("=" * 60)

if __name__ == "__main__":
    main()
