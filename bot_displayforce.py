#!/usr/bin/env python3
"""
==============================================================
  BOT DISPLAYFORCE → PAINEL DE OPERAÇÕES
  Sincronização automática de campanhas a cada 10 minutos
==============================================================
  Fluxo:
    1. Busca clientes ativos no Supabase
    2. Acessa DisplayForce e exporta relatório via e-mail
    3. Lê o e-mail, extrai o LINK de download (não anexo) e baixa o ZIP
    4. Processa os dados e insere na tabela `campaigns` do Supabase
    5. O widget "Engajamento em Campanhas" no dashboard é atualizado automaticamente
==============================================================
  REQUISITOS:
    pip install playwright supabase pandas openpyxl schedule imap-tools requests
    playwright install chromium
==============================================================
"""

import io
import os
import re
import time
import imaplib
import email
import zipfile
import logging
import schedule
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
import requests
from supabase import create_client, Client
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# ──────────────────────────────────────────────────────────────
# CONFIGURAÇÕES — lê de variáveis de ambiente ou usa defaults
# Para rodar localmente: edite os valores abaixo
# Para Railway/Render: configure as env vars no painel deles
# ──────────────────────────────────────────────────────────────

def _env(key: str, default: str) -> str:
    """Lê variável de ambiente; usa default se não existir."""
    return os.environ.get(key, default)

# DisplayForce
DISPLAYFORCE_URL   = "https://id.displayforce.ai/#/platforms"
DISPLAYFORCE_EMAIL = _env("DISPLAYFORCE_EMAIL", "bruno.lyra@globaltera.com.br")
DISPLAYFORCE_PASS  = _env("DISPLAYFORCE_PASS",  "Tony@2023")
RELATORIO_EMAIL    = _env("RELATORIO_EMAIL",    "rayanne.ernandez@globaltera.com.br")

# E-mail IMAP para receber o relatório da DisplayForce
IMAP_SERVER   = "imap.gmail.com"
IMAP_PORT     = 993
IMAP_EMAIL    = _env("IMAP_EMAIL",    "rayanne.ernandez@globaltera.com.br")
IMAP_PASSWORD = _env("IMAP_PASSWORD", "nfav lshi hfax jhvu")

# Supabase
SUPABASE_URL = _env("SUPABASE_URL", "https://zkzpvaabjchwnnvuwuls.supabase.co")
SUPABASE_KEY = _env("SUPABASE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprenB2YWFiamNod25udnV3dWxzIiwicm9sZSI6"
    "InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU3OTYyOSwiZXhwIjoyMDg3MTU1NjI5fQ"
    ".udqmu2DaEN_WsW1f02UOfb8G8ScshrpMSJKlWM7W11I"
)

# Configurações gerais
# Horário diário de execução (formato HH:MM, horário de Brasília)
HORARIO_EXECUCAO  = _env("HORARIO_EXECUCAO", "07:00")
DOWNLOAD_DIR      = Path("./downloads_displayforce")
LOG_FILE          = "bot_displayforce.log"
TIMEOUT_EMAIL_SEG = 600   # aguarda até 10 min pelo e-mail da DisplayForce
HEADLESS          = _env("HEADLESS", "true").lower() == "true"  # False para ver o browser (debug)

# ──────────────────────────────────────────────────────────────
# LOGGING
# ──────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("bot_displayforce")

# ──────────────────────────────────────────────────────────────
# SUPABASE — helpers
# ──────────────────────────────────────────────────────────────

def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def buscar_clientes() -> list[dict]:
    sb  = get_supabase()
    res = sb.table("clients").select("id, name").eq("status", "active").execute()
    clientes = res.data or []
    log.info(f"Clientes encontrados no Supabase: {[c['name'] for c in clientes]}")
    return clientes


def upsert_campanhas(registros: list[dict]) -> int:
    if not registros:
        return 0
    sb  = get_supabase()
    try:
        # on_conflict usa client_id+name+tipo_midia+loja (índice único completo)
        res = sb.table("campaigns").upsert(
            registros,
            on_conflict="client_id,name,tipo_midia,loja"
        ).execute()
        count = len(res.data) if res.data else 0
        log.info(f"  ✅ {count} campanhas salvas no Supabase")
        return count
    except Exception as e:
        log.error(f"  ❌ Erro ao salvar campanhas no Supabase: {e}")
        # Tenta inserir ignorando duplicatas se o upsert falhar
        try:
            res2 = sb.table("campaigns").insert(registros, upsert=False).execute()
            count2 = len(res2.data) if res2.data else 0
            log.info(f"  ✅ {count2} campanhas inseridas via fallback INSERT")
            return count2
        except Exception as e2:
            log.error(f"  ❌ Fallback INSERT também falhou: {e2}")
            return 0


# ──────────────────────────────────────────────────────────────
# EXCEL — parsing do relatório da DisplayForce
# ──────────────────────────────────────────────────────────────

def parse_tempo_atencao(valor: str) -> int:
    try:
        if not valor or str(valor).strip() in ("", "nan", "—"):
            return 0
        partes = str(valor).strip().split(":")
        if len(partes) == 2:
            return int(partes[0]) * 60 + int(partes[1])
        if len(partes) == 3:
            return int(partes[0]) * 3600 + int(partes[1]) * 60 + int(partes[2])
    except Exception:
        pass
    return 0


def parse_data(valor) -> str | None:
    try:
        if pd.isna(valor) or str(valor).strip() in ("", "nan"):
            return None
        if isinstance(valor, datetime):
            return valor.replace(tzinfo=timezone.utc).isoformat()
        s = str(valor).strip()
        for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(s, fmt)
                return dt.replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                continue
    except Exception:
        pass
    return None


def processar_excel(caminho_arquivo: str, client_id: str) -> list[dict]:
    log.info(f"  Processando Excel: {caminho_arquivo}")
    try:
        try:
            df = pd.read_excel(caminho_arquivo, engine="openpyxl")
        except Exception:
            df = pd.read_csv(caminho_arquivo, sep=";", encoding="latin-1")
    except Exception as e:
        log.error(f"  Erro ao ler arquivo: {e}")
        return []

    df.columns = [str(c).strip() for c in df.columns]
    log.info(f"  Colunas encontradas: {list(df.columns)}")

    COL_MAP = {
        # Nome da campanha (ex: "CLINIC", "VERÃO 2025")
        "campanha":      ["CAMPANHA", "Campanha", "Campaign Name", "Campaign",
                          "MIDIA_VALIDADA", "MÍDIA_VALIDADA", "MIDIA VALIDADA"],
        # Tipo de mídia (ex: "Calhau", "TOT", "CAIXA")
        "tipo_midia":    ["TIPO_MIDIA", "TIPO MIDIA", "Tipo Midia", "Tipo_Midia",
                          "Mídia", "Midia", "Type"],
        # Loja/unidade (ex: "309 - Dom Joaquim Posto")
        "loja":          ["LOJA", "Loja", "Store", "Unidade", "Filial", "deviceID"],
        "start_date":    ["INICIO_EXIBIÇÃO", "INÍCIO_EXIBIÇÃO", "INICIO EXIBIÇÃO",
                          "INICIO_EXIBICAO", "Início", "Start", "Data Início"],
        "end_date":      ["FIM_EXIBIÇÃO", "FIM EXIBIÇÃO", "FIM_EXIBICAO", "Fim", "End", "Data Fim"],
        "duration_days": ["Tempo (Dias)", "TEMPO (DIAS)", "Dias", "Duration Days"],
        "duration_hms":  ["Tempo (hh:mm:ss)", "TEMPO (HH:MM:SS)", "Tempo Total", "Duration"],
        "visitors":      ["VISITANTES", "Visitantes", "Visitors"],
        "avg_attention": ["TEMPO_MED ATENÇÃO (mm:ss)", "TEMPO_MED_ATENÇÃO", "TEMPO MED ATENÇÃO",
                          "TEMPO_MED ATENCAO", "Atenção (mm:ss)", "Avg Attention"],
    }

    def encontrar_coluna(df: pd.DataFrame, opcoes: list[str]) -> str | None:
        for op in opcoes:
            if op in df.columns:
                return op
            for col in df.columns:
                if op.lower() in col.lower():
                    return col
        return None

    mapa  = {campo: encontrar_coluna(df, opcoes) for campo, opcoes in COL_MAP.items()}
    log.info(f"  Mapeamento de colunas: {mapa}")

    registros = []
    agora     = datetime.now(timezone.utc).isoformat()

    for _, row in df.iterrows():
        # Extrai campanha, tipo_midia e loja como campos separados
        campanha_col   = mapa.get("campanha")
        tipo_midia_col = mapa.get("tipo_midia")
        loja_col       = mapa.get("loja")

        campanha_val   = str(row.get(campanha_col,   "")).strip() if campanha_col   else ""
        tipo_midia_val = str(row.get(tipo_midia_col, "")).strip() if tipo_midia_col else ""
        loja_val       = str(row.get(loja_col,       "")).strip() if loja_col       else ""

        # Normaliza "nan"
        campanha_val   = "" if campanha_val.lower()   == "nan" else campanha_val
        tipo_midia_val = "" if tipo_midia_val.lower() == "nan" else tipo_midia_val
        loja_val       = "" if loja_val.lower()       == "nan" else loja_val

        # Linha inválida se não tiver nem campanha nem tipo_midia
        if not campanha_val and not tipo_midia_val:
            continue

        # name = nome da campanha (para agrupar no widget)
        # Se tiver coluna CAMPANHA separada usa ela; senão usa tipo_midia como nome
        nome = campanha_val if campanha_val else tipo_midia_val

        reg = {
            "client_id":         client_id,
            "name":              nome,
            "tipo_midia":        tipo_midia_val,
            "loja":              loja_val,
            "start_date":        parse_data(row.get(mapa["start_date"])) if mapa["start_date"] else None,
            "end_date":          parse_data(row.get(mapa["end_date"]))   if mapa["end_date"]   else None,
            "duration_days":     _to_float(row.get(mapa["duration_days"])) if mapa["duration_days"] else None,
            "duration_hms":      str(row.get(mapa["duration_hms"], "")).strip() if mapa["duration_hms"] else None,
            "visitors":          _to_int(row.get(mapa["visitors"])) if mapa["visitors"] else 0,
            "avg_attention_sec": parse_tempo_atencao(row.get(mapa["avg_attention"], "")) if mapa["avg_attention"] else 0,
            "uploaded_at":       agora,
        }
        registros.append(reg)

    log.info(f"  {len(registros)} linhas extraídas do Excel")
    return registros


def _to_int(val) -> int:
    try:
        return int(str(val).replace(".", "").replace(",", ""))
    except Exception:
        return 0


def _to_float(val) -> float | None:
    try:
        return float(str(val).replace(",", "."))
    except Exception:
        return None


def processar_views_csv(caminho_arquivo: str, client_id: str) -> list[dict]:
    """
    Lê o arquivo 'Views of visitors' CSV do DisplayForce e agrega por
    Campaign + Device → salva como (name, tipo_midia, loja) na tabela campaigns.

    Estrutura real do CSV (confirmada nos arquivos reais da DisplayForce):
      - Primeira linha contém 'sep=,' → precisa skiprows=1
      - Colunas: Campaign, Device, Visitor ID, Content View Start,
                 Content View End, Content View Duration, ...
    """
    log.info(f"  Processando Views CSV: {caminho_arquivo}")
    try:
        # O CSV exportado pela DisplayForce começa com "sep=," — pular essa linha
        try:
            df = pd.read_csv(caminho_arquivo, skiprows=1, encoding="utf-8")
        except Exception:
            df = pd.read_csv(caminho_arquivo, skiprows=1, encoding="latin-1")
    except Exception as e:
        log.error(f"  Erro ao ler Views CSV: {e}")
        return []

    df.columns = [str(c).strip() for c in df.columns]
    log.info(f"  Colunas Views CSV ({len(df.columns)}): {list(df.columns)}")
    log.info(f"  Total de linhas brutas: {len(df)}")

    # Detecta colunas pelo nome real confirmado nos arquivos
    def achar(opcoes):
        for op in opcoes:
            if op in df.columns:
                return op
            for c in df.columns:
                if op.lower() == c.lower().strip():
                    return c
        return None

    col_campaign  = achar(["Campaign", "Campanha"])
    col_device    = achar(["Device", "Dispositivo"])
    col_visitor   = achar(["Visitor ID", "Visitor_ID"])
    col_start     = achar(["Content View Start", "Contact Start", "View Start"])
    col_end       = achar(["Content View End",   "Contact End",   "View End"])
    col_duration  = achar(["Content View Duration", "Contact Duration", "View Duration"])

    log.info(f"  Mapeamento: campaign={col_campaign}, device={col_device}, "
             f"visitor={col_visitor}, start={col_start}, end={col_end}, dur={col_duration}")

    if not col_campaign:
        log.warning("  Coluna 'Campaign' não encontrada no Views CSV")
        return []

    # Remove linhas sem campanha
    df = df[df[col_campaign].notna() & (df[col_campaign].astype(str).str.strip() != "")].copy()
    if df.empty:
        log.warning("  Nenhuma linha com campanha no Views CSV")
        return []

    agora     = datetime.now(timezone.utc).isoformat()
    registros = []

    # Agrupa por Campaign + Device (cada linha = 1 tela em 1 loja)
    group_cols = [col_campaign]
    if col_device:
        group_cols.append(col_device)

    for chave, grupo in df.groupby(group_cols):
        campaign_val = str(chave[0] if isinstance(chave, tuple) else chave).strip()
        device_val   = str(chave[1] if isinstance(chave, tuple) and len(chave) > 1 else "").strip()

        if not campaign_val or campaign_val.lower() == "nan":
            continue

        # ── TIPO_MIDIA: parte do device após " - " ──────────────────────────
        # Ex: "Filial 309 - Totem 1"  → tipo_midia = "Totem 1"
        # Ex: "Totem Medicamentos"     → tipo_midia = "Totem Medicamentos"
        if device_val and " - " in device_val:
            tipo_midia = device_val.split(" - ", 1)[1].strip()
        else:
            tipo_midia = device_val

        # ── LOJA: extrai da campanha (remove prefixo "Filial ") ─────────────
        # Ex: "Filial Dom Joaquim - 309" → loja = "Dom Joaquim - 309"
        loja = campaign_val
        if loja.lower().startswith("filial "):
            loja = loja[7:].strip()

        # ── Visitantes únicos ───────────────────────────────────────────────
        visitantes = grupo[col_visitor].nunique() if col_visitor else len(grupo)

        # ── Datas de início e fim ───────────────────────────────────────────
        start_date = end_date = None
        if col_start:
            try:
                datas = pd.to_datetime(grupo[col_start], errors="coerce").dropna()
                if not datas.empty:
                    start_date = datas.min().isoformat()
            except Exception:
                pass
        if col_end:
            try:
                datas_fim = pd.to_datetime(grupo[col_end], errors="coerce").dropna()
                if not datas_fim.empty:
                    end_date = datas_fim.max().isoformat()
            except Exception:
                pass

        # ── Duração total (dias e hh:mm:ss) ─────────────────────────────────
        duration_days = None
        duration_hms  = None
        if start_date and end_date:
            try:
                delta = pd.to_datetime(end_date) - pd.to_datetime(start_date)
                total_sec    = int(delta.total_seconds())
                duration_days = round(total_sec / 86400, 2)
                hh = total_sec // 3600
                mm = (total_sec % 3600) // 60
                ss = total_sec % 60
                duration_hms = f"{hh:02d}:{mm:02d}:{ss:02d}"
            except Exception:
                pass

        # ── Atenção média em segundos ────────────────────────────────────────
        avg_attention = 0
        if col_duration:
            try:
                avg_attention = int(pd.to_numeric(grupo[col_duration], errors="coerce").mean() or 0)
            except Exception:
                pass

        reg = {
            "client_id":         client_id,
            "name":              campaign_val,   # nome da campanha / loja
            "tipo_midia":        tipo_midia,     # tipo de tela (Totem, Caixa, etc.)
            "loja":              loja,           # nome da loja
            "start_date":        start_date,
            "end_date":          end_date,
            "duration_days":     duration_days,
            "duration_hms":      duration_hms,
            "visitors":          int(visitantes),
            "avg_attention_sec": avg_attention,
            "uploaded_at":       agora,
        }
        registros.append(reg)

    log.info(f"  {len(registros)} registros extraídos do Views CSV")
    return registros


# ──────────────────────────────────────────────────────────────
# IMAP + DOWNLOAD — aguardar e-mail e baixar o arquivo
# ──────────────────────────────────────────────────────────────

def _obter_ultimo_uid() -> int:
    """Retorna UID real da mensagem mais recente para ignorar e-mails antigos."""
    try:
        with imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT) as imap:
            imap.login(IMAP_EMAIL, IMAP_PASSWORD)
            imap.select("INBOX")
            # CRÍTICO: usa uid('search') para obter UIDs reais (não seq numbers)
            # No Gmail, UIDs são números grandes diferentes dos seq numbers
            _, data = imap.uid('search', None, 'ALL')
            uids   = data[0].split()
            ultimo = int(uids[-1]) if uids else 0
            log.info(f"  📬 IMAP conectado — {len(uids)} e-mails na caixa, último UID real: {ultimo}")
            return ultimo
    except Exception as e:
        log.warning(f"  Erro ao obter último UID: {e}")
        return 0


def _extrair_link_download(msg) -> str | None:
    """
    Varre o corpo HTML/texto do e-mail em busca do link de download.
    Prioriza links com extensão de arquivo ou palavras-chave de relatório.
    """
    candidatos = []

    for part in msg.walk():
        ct = part.get_content_type()
        if ct not in ("text/html", "text/plain"):
            continue
        try:
            payload_bytes = part.get_payload(decode=True)
            charset       = part.get_content_charset() or "utf-8"
            corpo         = payload_bytes.decode(charset, errors="replace")
        except Exception:
            continue

        # Coleta todos hrefs e URLs nuas
        hrefs  = re.findall(r'href=["\']([^"\']+)["\']', corpo, re.IGNORECASE)
        hrefs += re.findall(r'https?://\S+', corpo)

        for href in hrefs:
            href       = href.strip().rstrip(">).\"'")
            href_lower = href.lower()

            # Filtra irrelevantes
            if any(x in href_lower for x in ("unsubscribe", "mailto:", "tracking", "pixel", "logo", ".png", ".jpg", ".gif")):
                continue

            # Prioridade 1: extensão de arquivo de dados
            if any(href_lower.split("?")[0].endswith(ext) for ext in (".zip", ".xlsx", ".xls", ".csv")):
                candidatos.insert(0, href)
                continue

            # Prioridade 2: URL com palavras-chave de download/relatório
            if any(kw in href_lower for kw in (
                "download", "report", "relatorio", "relatório",
                "attachment", "export", "visitors", "arquivo", "file"
            )):
                candidatos.append(href)

    # Remove duplicatas mantendo ordem
    vistos, resultado = set(), []
    for c in candidatos:
        if c not in vistos:
            vistos.add(c)
            resultado.append(c)

    if resultado:
        log.info(f"  🔗 Links candidatos encontrados: {resultado}")
        return resultado[0]
    return None


def _extrair_zip(conteudo_bytes: bytes, ts: str) -> list[str]:
    """Extrai todos os Excel/CSV de um ZIP em memória. Retorna lista de caminhos."""
    try:
        caminhos = []
        with zipfile.ZipFile(io.BytesIO(conteudo_bytes)) as z:
            membros = [m for m in z.namelist() if Path(m).suffix.lower() in (".xlsx", ".xls", ".csv")]
            if not membros:
                log.warning(f"  ZIP não contém Excel/CSV. Arquivos dentro: {z.namelist()}")
                return []
            for membro in membros:
                ext     = Path(membro).suffix.lower()
                nome_base = Path(membro).stem[:40].replace(" ", "_")
                destino = DOWNLOAD_DIR / f"{nome_base}_{ts}{ext}"
                destino.write_bytes(z.read(membro))
                log.info(f"  📂 Extraído do ZIP: {membro} → {destino}")
                caminhos.append(str(destino))
        return caminhos
    except zipfile.BadZipFile as e:
        log.error(f"  ZIP inválido: {e}")
        return []


def _baixar_arquivo_url(url: str) -> list[str]:
    """
    Faz GET na URL e salva o(s) arquivo(s) em DOWNLOAD_DIR.
    Se for ZIP, extrai todos os Excel/CSV encontrados.
    Retorna lista de caminhos.
    """
    DOWNLOAD_DIR.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    try:
        log.info(f"  ⬇️  Baixando arquivo de: {url}")
        resp = requests.get(url, timeout=60, allow_redirects=True)
        resp.raise_for_status()

        # Detecta extensão pelo Content-Disposition ou pela URL
        ext = ".zip"
        cd  = resp.headers.get("Content-Disposition", "")
        if cd:
            m = re.search(r'filename=["\']?([^"\';\s]+)', cd)
            if m:
                ext = Path(m.group(1)).suffix.lower() or ext
        else:
            url_path = url.split("?")[0]
            ext_url  = Path(url_path).suffix.lower()
            if ext_url in (".zip", ".xlsx", ".xls", ".csv"):
                ext = ext_url

        conteudo = resp.content
        log.info(f"  📦 {len(conteudo):,} bytes baixados (ext detectada: {ext})")

        if ext == ".zip":
            resultados = _extrair_zip(conteudo, ts)
            if resultados:
                return resultados
            # Fallback: salva o ZIP mesmo assim
            destino = DOWNLOAD_DIR / f"relatorio_{ts}.zip"
            destino.write_bytes(conteudo)
            log.warning(f"  ⚠️  ZIP sem Excel/CSV — salvo como: {destino}")
            return [str(destino)]

        destino = DOWNLOAD_DIR / f"relatorio_{ts}{ext}"
        destino.write_bytes(conteudo)
        log.info(f"  ✅ Arquivo salvo: {destino}")
        return [str(destino)]

    except requests.RequestException as e:
        log.error(f"  ❌ Erro ao baixar arquivo: {e}")
        return []


def _processar_msg_displayforce(imap, uid, use_uid: bool = False) -> list[str]:
    """Tenta extrair arquivo(s) de um e-mail e retorna lista de caminhos."""
    try:
        if use_uid:
            _, msg_data = imap.uid('fetch', uid, '(RFC822)')
        else:
            _, msg_data = imap.fetch(uid, "(RFC822)")
    except Exception as e:
        log.warning(f"  Erro ao buscar e-mail UID {uid}: {e}")
        return []

    if not msg_data or not msg_data[0]:
        log.warning(f"  UID {uid}: fetch retornou vazio")
        return []
    raw = msg_data[0][1]
    if not isinstance(raw, bytes):
        log.warning(f"  UID {uid}: dados não são bytes — tipo={type(raw)}")
        return []
    msg = email.message_from_bytes(raw)

    assunto   = str(msg.get("Subject", "")).lower()
    remetente = str(msg.get("From",    "")).lower()
    log.info(f"  ✉️  E-mail UID {uid} | de: {remetente} | assunto: '{assunto}'")

    # ── Tenta encontrar anexo direto ──────────────────────────────
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    DOWNLOAD_DIR.mkdir(exist_ok=True)

    for part in msg.walk():
        ct   = part.get_content_type()
        nome = part.get_filename() or ""
        ext  = Path(nome).suffix.lower()

        is_attachment = (
            ext in (".xlsx", ".xls", ".csv", ".zip")
            or ct in (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
                "application/zip",
                "application/x-zip-compressed",
                "application/octet-stream",
                "text/csv",
            )
        )

        if is_attachment and part.get_payload(decode=True):
            payload = part.get_payload(decode=True)
            log.info(f"  📎 Anexo encontrado: '{nome}' ({ct}) — {len(payload):,} bytes")

            # Detecta se é ZIP pelo conteúdo (magic bytes PK)
            is_zip = ext == ".zip" or ct in ("application/zip", "application/x-zip-compressed") or payload[:2] == b"PK"
            if is_zip:
                resultados = _extrair_zip(payload, ts)
                if resultados:
                    return resultados
            # Fallback: salva como excel ou csv
            safe_ext = ext if ext in (".xlsx", ".xls", ".csv") else ".xlsx"
            destino = DOWNLOAD_DIR / f"relatorio_{ts}{safe_ext}"
            destino.write_bytes(payload)
            log.info(f"  📁 Anexo salvo: {destino}")
            return [str(destino)]

    # ── Sem anexo → extrai link do corpo HTML e baixa ─────────────
    log.info("  📧 Sem anexo — buscando link de download no corpo do e-mail...")
    link = _extrair_link_download(msg)
    if link:
        caminhos = _baixar_arquivo_url(link)
        if caminhos:
            return caminhos
    else:
        log.warning("  ⚠️  E-mail sem link/anexo reconhecível")
    return []


def _buscar_em_pasta(imap, pasta: str, apos_uid: int) -> list[str]:
    """Tenta encontrar e processar e-mail DisplayForce numa pasta específica.
    CORRIGIDO: usa uid('search') e uid('fetch') para UIDs reais."""
    try:
        status, _ = imap.select(pasta)
        if status != "OK":
            return []
    except Exception:
        return []

    hoje = datetime.now().strftime("%d-%b-%Y")

    # Tenta por UID novo (usando uid search)
    try:
        _, data = imap.uid('search', None, f'{apos_uid + 1}:*')
        uids = [u for u in data[0].split() if int(u) > apos_uid]
    except Exception:
        uids = []

    if not uids:
        # Fallback por data de hoje
        try:
            _, data2 = imap.uid('search', None, f'SINCE "{hoje}"')
            uids = data2[0].split()[-20:]  # só os 20 mais recentes
        except Exception:
            uids = []

    if uids:
        log.info(f"  📂 Verificando {len(uids)} e-mail(s) na pasta '{pasta}'")

    for uid in reversed(uids):
        try:
            _, msg_data = imap.uid('fetch', uid, '(RFC822)')
            if not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            if not isinstance(raw, bytes):
                continue
            msg       = email.message_from_bytes(raw)
            assunto   = str(msg.get("Subject", "")).lower()
            remetente = str(msg.get("From",    "")).lower()

            eh_displayforce = (
                "displayforce" in remetente
                or "displ"        in remetente
                or "noreply"      in remetente
                or "no-reply"     in remetente
                or "displ"        in assunto
                or "displayforce" in assunto
                or "relatório"    in assunto
                or "relatorio"    in assunto
                or "report"       in assunto
                or "visitors"     in assunto
                or "visitor"      in assunto
                or "visitantes"   in assunto
                or "insights"     in assunto
            )

            tem_anexo = any(
                (part.get_filename() or "").lower().endswith((".xlsx", ".xls", ".csv", ".zip"))
                for part in msg.walk()
            )

            if not eh_displayforce and not tem_anexo:
                log.info(f"    ⏭️  UID {uid} ignorado — de: '{remetente}' | assunto: '{assunto}'")
                continue

            log.info(f"  ✉️  DisplayForce detectado em '{pasta}' (UID {uid}) | assunto: '{assunto}'")
            resultado = _processar_msg_displayforce(imap, uid, use_uid=True)
            if resultado:
                return resultado
        except Exception as e:
            log.warning(f"    Erro ao processar UID {uid} em '{pasta}': {e}")

    return []


def _verificar_email_displayforce(apos_uid: int) -> list[str]:
    """
    Verifica e-mails novos da DisplayForce em INBOX e Spam.
    CORRIGIDO: usa uid('search') e uid('fetch') para UIDs reais do Gmail.
    Estratégia 1: UIDs novos (> apos_uid) na INBOX.
    Estratégia 2: busca por remetente displ na INBOX de hoje.
    Estratégia 3: busca ampla por qualquer remetente hoje na INBOX.
    Estratégia 4: verifica pasta Spam/Junk.
    """
    with imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT) as imap:
        imap.login(IMAP_EMAIL, IMAP_PASSWORD)
        imap.select("INBOX")

        # ── Estratégia 1: UIDs reais novos via uid('search') ─────────────
        # CORREÇÃO: usa imap.uid() para trabalhar com UIDs reais (não seq numbers)
        _, data = imap.uid('search', None, f'{apos_uid + 1}:*')
        uids    = [u for u in data[0].split() if int(u) > apos_uid]

        if uids:
            log.info(f"  📨 {len(uids)} e-mail(s) novo(s) encontrado(s) (UID > {apos_uid})")
            for uid in reversed(uids):
                try:
                    # CORREÇÃO: usa uid('fetch') para buscar pelo UID real
                    _, msg_data = imap.uid('fetch', uid, '(RFC822)')
                    if not msg_data or not msg_data[0]:
                        log.info(f"  ⚠️  UID {uid}: fetch retornou vazio")
                        continue
                    raw = msg_data[0][1]
                    if not isinstance(raw, bytes):
                        log.info(f"  ⚠️  UID {uid}: dados não são bytes (tipo={type(raw)})")
                        continue
                    msg       = email.message_from_bytes(raw)
                    assunto   = str(msg.get("Subject", "")).lower()
                    remetente = str(msg.get("From",    "")).lower()
                    log.info(f"  📧 UID {uid} | de: '{remetente}' | assunto: '{assunto}'")

                    eh_displayforce = (
                        "displayforce" in remetente
                        or "displ"        in remetente
                        or "noreply"      in remetente
                        or "no-reply"     in remetente
                        or "displ"        in assunto
                        or "displayforce" in assunto
                        or "relatório"    in assunto
                        or "relatorio"    in assunto
                        or "report"       in assunto
                        or "visitors"     in assunto
                        or "visitor"      in assunto
                        or "visitantes"   in assunto
                        or "insights"     in assunto
                    )

                    # Também tenta se tiver anexo relevante independente do remetente
                    tem_anexo = any(
                        (part.get_filename() or "").lower().endswith((".xlsx", ".xls", ".csv", ".zip"))
                        for part in msg.walk()
                    )

                    if not eh_displayforce and not tem_anexo:
                        log.info(f"  ⏭️  UID {uid} ignorado (não é DisplayForce, sem anexo relevante)")
                        continue

                    if tem_anexo and not eh_displayforce:
                        log.info(f"  🔎 UID {uid}: tem anexo Excel/ZIP — tentando processar")

                    log.info(f"  ✉️  E-mail DisplayForce processando (UID {uid})")
                    resultado = _processar_msg_displayforce(imap, uid, use_uid=True)
                    if resultado:
                        return resultado
                except Exception as e:
                    log.warning(f"  Erro ao processar UID {uid}: {e}")
        else:
            hoje = datetime.now().strftime("%d-%b-%Y")
            # ── Estratégia 2: busca por remetente 'displ' de hoje ────────
            log.info(f"  🔍 Sem UIDs novos — buscando por remetente 'displ' desde {hoje}...")
            _, data2 = imap.uid('search', None, f'FROM "displ" SINCE "{hoje}"')
            uids2 = data2[0].split()
            if uids2:
                log.info(f"  📨 {len(uids2)} e-mail(s) displ.com encontrado(s) hoje na INBOX")
                for uid in reversed(uids2):
                    resultado = _processar_msg_displayforce(imap, uid, use_uid=True)
                    if resultado:
                        return resultado

            # ── Estratégia 3: busca ampla por qualquer e-mail de hoje ────
            log.info(f"  🔍 Busca ampla — qualquer e-mail de hoje com possível relatório...")
            _, data3 = imap.uid('search', None, f'SINCE "{hoje}"')
            uids3 = [u for u in data3[0].split() if int(u) > apos_uid]
            if uids3:
                log.info(f"  📨 {len(uids3)} e-mail(s) de hoje não processados — verificando...")
                for uid in reversed(uids3[-10:]):  # verifica só os 10 mais recentes
                    try:
                        _, msg_data = imap.uid('fetch', uid, '(RFC822)')
                        if not msg_data or not msg_data[0]:
                            continue
                        raw = msg_data[0][1]
                        if not isinstance(raw, bytes):
                            continue
                        msg       = email.message_from_bytes(raw)
                        assunto   = str(msg.get("Subject", "")).lower()
                        remetente = str(msg.get("From", "")).lower()

                        tem_anexo = any(
                            (part.get_filename() or "").lower().endswith((".xlsx", ".xls", ".csv", ".zip"))
                            for part in msg.walk()
                        )
                        tem_link_relatorio = any(
                            kw in assunto for kw in
                            ("report", "relat", "visitor", "insight", "displ", "export")
                        )

                        if tem_anexo or tem_link_relatorio:
                            log.info(f"  🔎 Estratégia 3: UID {uid} | de: '{remetente}' | assunto: '{assunto}'")
                            resultado = _processar_msg_displayforce(imap, uid, use_uid=True)
                            if resultado:
                                return resultado
                    except Exception as e:
                        log.warning(f"  Erro na estratégia 3 UID {uid}: {e}")

        # ── Estratégia 4: verifica pasta Spam ────────────────────────────
        for pasta_spam in ["[Gmail]/Spam", "[Gmail]/Lixo eletrônico", "Spam", "Junk", "SPAM",
                           "[Gmail]/Lixo Eletr\u00f4nico"]:
            resultado = _buscar_em_pasta(imap, pasta_spam, apos_uid)
            if resultado:
                log.warning(f"  ⚠️  E-mail encontrado na pasta SPAM! Mova para INBOX para evitar isso.")
                return resultado

    return []


def baixar_relatorio_email(timeout_seg: int = TIMEOUT_EMAIL_SEG) -> list[str]:
    """
    Aguarda o e-mail da DisplayForce e retorna lista de caminhos de arquivos baixados.
    Verifica a caixa IMAP a cada 15 segundos até timeout_seg.
    """
    log.info(f"  Aguardando e-mail com relatório em {IMAP_EMAIL}...")
    DOWNLOAD_DIR.mkdir(exist_ok=True)
    inicio     = time.time()
    ultimo_uid = _obter_ultimo_uid()

    while time.time() - inicio < timeout_seg:
        try:
            caminhos = _verificar_email_displayforce(ultimo_uid)
            if caminhos:
                log.info(f"  ✅ {len(caminhos)} arquivo(s) baixado(s): {caminhos}")
                return caminhos
        except Exception as e:
            log.warning(f"  Erro ao verificar e-mail: {e}")
        time.sleep(15)

    log.error(f"  ⏱️  Timeout: nenhum e-mail da DisplayForce recebido em {timeout_seg}s")
    return []


# ──────────────────────────────────────────────────────────────
# PLAYWRIGHT — automação do browser na DisplayForce
# ──────────────────────────────────────────────────────────────

def _screenshot(page, nome: str, cliente: str):
    """Salva screenshot de debug."""
    try:
        ts      = datetime.now().strftime("%Y%m%d_%H%M%S")
        destino = DOWNLOAD_DIR / f"debug_{nome}_{cliente}_{ts}.png"
        page.screenshot(path=str(destino))
        log.info(f"  📸 Screenshot salvo: {destino}")
    except Exception:
        pass


def fazer_login_displayforce(page) -> bool:
    """Realiza login na DisplayForce. Retorna True se bem-sucedido."""
    log.info("Acessando DisplayForce...")
    page.goto(DISPLAYFORCE_URL)
    page.wait_for_load_state("networkidle", timeout=30000)
    page.wait_for_timeout(5000)

    url_atual = page.url
    log.info(f"  URL atual: {url_atual}")

    # Se já estiver logado
    if "login" not in url_atual.lower() and "platforms" in url_atual.lower():
        log.info("  ✅ Já logado")
        return True

    try:
        # ── Campo de e-mail ───────────────────────────────────────────────
        inputs_visiveis = page.locator("input:visible").all()
        if not inputs_visiveis:
            log.error("  ❌ Nenhum input visível na página de login")
            return False

        log.info("  Usando primeiro input visível como campo de e-mail")
        inputs_visiveis[0].fill(DISPLAYFORCE_EMAIL)
        page.wait_for_timeout(300)

        # ── Login em 1 etapa (e-mail + senha na mesma tela) ───────────────
        senha_fields = page.locator("input[type='password']:visible").all()
        if senha_fields:
            log.info("  Login em 1 etapa: preenchendo senha diretamente")
            senha_fields[0].fill(DISPLAYFORCE_PASS)
            page.wait_for_timeout(300)
        else:
            # ── Login em 2 etapas: clicar em "Próximo" primeiro ───────────
            log.info("  Login em 2 etapas: procurando botão Próximo/Continuar...")
            btn_proximo = page.locator(
                "button:visible"
            ).filter(has_text=re.compile(r"próximo|proximo|next|continuar|continue|avançar", re.I)).first
            btn_proximo.click(timeout=5000)
            log.info("  Botão 'próximo' clicado")
            page.wait_for_timeout(2000)

            senha_field = page.locator("input[type='password']:visible").first
            senha_field.wait_for(state="visible", timeout=8000)
            log.info("  Campo de senha apareceu (step 2)")
            senha_field.fill(DISPLAYFORCE_PASS)
            page.wait_for_timeout(300)

        # ── Botão de entrar ───────────────────────────────────────────────
        btn_login = page.locator("button:visible").filter(
            has_text=re.compile(r"entrar|login|sign.?in|acessar|confirmar", re.I)
        ).first
        btn_login.click(timeout=5000)
        log.info(f"  Botão de login clicado")

        page.wait_for_load_state("networkidle", timeout=20000)
        page.wait_for_timeout(3000)

        url_pos = page.url
        log.info(f"  URL após login: {url_pos}")

        if "login" not in url_pos.lower() or "platforms" in url_pos.lower():
            log.info("  ✅ Login realizado com sucesso")
            return True
        else:
            log.error("  ❌ Login falhou — verifique as credenciais")
            return False

    except PlaywrightTimeout as e:
        log.error(f"  ❌ Timeout ao fazer login: {e}")
        return False
    except Exception as e:
        log.error(f"  ❌ Erro inesperado no login: {e}")
        return False


def exportar_relatorio_cliente(page, nome_cliente: str, data_inicio: str, data_fim: str) -> bool:
    """
    Navega até o cliente na DisplayForce e exporta o relatório Visitors Insights.
    Retorna True se exportou com sucesso.
    """
    try:
        log.info(f"  Exportando relatório para: {nome_cliente}")
        nome_lower = nome_cliente.strip().lower()

        # ── 1. Página de plataformas ──────────────────────────────────────
        page.wait_for_timeout(2000)
        conteudo = page.content()
        log.info(f"  📄 Conteúdo completo da página (trecho): {conteudo[:500]}")
        _screenshot(page, "01_plataformas", nome_cliente)

        # Busca href direto pelo slug do cliente
        hrefs_encontrados = re.findall(r'href=["\']([^"\']+)["\']', conteudo)
        href_cliente = None
        for h in hrefs_encontrados:
            if nome_lower.replace(" ", "") in h.lower().replace("-", "").replace("_", ""):
                href_cliente = h
                break

        if href_cliente:
            log.info(f"  href encontrado para '{nome_lower}': {href_cliente}")
            # Garante URL absoluta
            if href_cliente.startswith("http"):
                url_cliente = href_cliente
            else:
                url_cliente = f"https://id.displayforce.ai{href_cliente}"

            page.goto(url_cliente)
            page.wait_for_load_state("networkidle", timeout=20000)
            page.wait_for_timeout(3000)
            log.info(f"  ✔ Navegou via href direto: {page.url}")
        else:
            # Fallback: clica no texto do cliente
            log.info(f"  href não encontrado, tentando clicar no texto '{nome_cliente}'")
            cliente_loc = page.get_by_text(nome_cliente, exact=False).first
            if not cliente_loc.is_visible(timeout=5000):
                log.warning(f"  Cliente '{nome_cliente}' não encontrado — pulando")
                return False
            cliente_loc.click()
            page.wait_for_load_state("networkidle", timeout=15000)
            page.wait_for_timeout(3000)

        _screenshot(page, "03_cliente_aberto", nome_cliente)
        log.info(f"  URL após abrir cliente: {page.url}")

        # ── 2. Menu items disponíveis ──────────────────────────────────────
        menu_texts = [el.inner_text().strip() for el in page.locator("nav a, nav button, aside a, aside button, [role='navigation'] a").all()]
        log.info(f"  📋 Textos do menu/nav ({len(menu_texts)}): {menu_texts}")

        # ── 3. Navegar para Visitors Insights via URL calculada ────────────
        log.info("  Navegando para Insights de Visitantes (stats/visitors)...")
        insights_href = None
        for el in page.locator("a").all():
            try:
                txt  = el.inner_text().strip()
                href = el.get_attribute("href") or ""
                if "insights" in txt.lower() or "dados" in txt.lower():
                    log.info(f"  href 'Insights & dados': {href}")
                    # Calcula URL de visitors a partir do href de devices
                    if "stats/devices" in href:
                        insights_href = href.replace("stats/devices", "stats/visitors")
                    elif "stats/" in href:
                        base = href.rsplit("/", 1)[0]
                        insights_href = f"{base}/visitors"
                    else:
                        # Tenta construir URL base da plataforma
                        base_url = page.url.split("/n/#")[0]
                        insights_href = f"{base_url}/n/#/stats/visitors"
                    break
            except Exception:
                continue

        if not insights_href:
            base_url      = page.url.split("/n/#")[0]
            insights_href = f"{base_url}/n/#/stats/visitors"

        # Adiciona timestamp para o mês atual
        ts_ms = int(time.time() * 1000)
        if "?" not in insights_href:
            insights_href += f"?scale=month&date={ts_ms}"

        log.info(f"  URL Visitors Insights calculada: {insights_href}")
        page.goto(insights_href)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.wait_for_timeout(2000)
        log.info(f"  ✔ Navegou para: {page.url}")
        _screenshot(page, "06_visitors_aberto", nome_cliente)

        # ── 4. Lista botões disponíveis ───────────────────────────────────
        btns = [el.inner_text().strip() for el in page.locator("a:visible, button:visible").all() if el.inner_text().strip()]
        log.info(f"  📋 Botões/links na página ({len(btns)}): {btns}")
        page.wait_for_timeout(1500)

        # Filtra botões visíveis relevantes
        btns_visiveis = [b for b in btns if b and "new chat" not in b.lower()
                         and "versão" not in b.lower() and "sair" not in b.lower()]
        log.info(f"  📋 Botões visíveis na página: {btns_visiveis}")
        _screenshot(page, "07_pre_enviar", nome_cliente)

        # ── 5. Clicar em "Enviar relatório" ───────────────────────────────
        btn_enviar = page.locator("a:visible, button:visible").filter(
            has_text=re.compile(r"enviar.?relat|send.?report|export", re.I)
        ).first
        btn_enviar.click(timeout=8000)
        log.info("  ✔ Clicado: 'ENVIAR RELATÓRIO' (botão exportar)")
        page.wait_for_timeout(2000)
        _screenshot(page, "10_modal_email", nome_cliente)

        # ── 6. Inserir e-mail manualmente ─────────────────────────────────
        # O modal do DisplayForce tem uma lista de e-mails pré-configurados
        # e uma opção para inserir manualmente. Tentamos múltiplas variações de texto.
        _screenshot(page, "10_modal_aberto", nome_cliente)

        # Loga tudo que está visível no modal para diagnóstico
        btns_modal_antes = [el.inner_text().strip() for el in page.locator("button:visible, a:visible").all() if el.inner_text().strip()]
        inputs_antes = [(el.get_attribute("type") or "text", el.get_attribute("placeholder") or "") for el in page.locator("input:visible").all()]
        log.info(f"  📋 Modal aberto — botões: {btns_modal_antes}")
        log.info(f"  📋 Modal aberto — inputs visíveis: {inputs_antes}")

        clicou_manual = False
        textos_manual = [
            r"inserir.?e?-?mail.?manualmente",
            r"inserir.?manualmente",
            r"manual",
            r"add.?e?-?mail",
            r"adicionar.?e?-?mail",
            r"novo.?e?-?mail",
            r"digitar.?e?-?mail",
            r"outro.?e?-?mail",
        ]
        for texto in textos_manual:
            try:
                btn = page.locator("button:visible, a:visible, span:visible, div:visible").filter(
                    has_text=re.compile(texto, re.I)
                ).first
                if btn.is_visible(timeout=2000):
                    btn.click()
                    clicou_manual = True
                    log.info(f"  ✔ Clicado botão manual com padrão: '{texto}'")
                    page.wait_for_timeout(1000)
                    break
            except Exception:
                continue

        if not clicou_manual:
            log.info("  ℹ️  Botão 'Inserir email manualmente' não encontrado — tentando encontrar input direto")

        _screenshot(page, "10b_apos_inserir_manual", nome_cliente)

        # Loga estado do modal após tentar clicar em manual
        btns_apos = [el.inner_text().strip() for el in page.locator("button:visible, a:visible").all() if el.inner_text().strip()]
        inputs_apos = [(el.get_attribute("type") or "text", el.get_attribute("placeholder") or "", el.get_attribute("value") or "") for el in page.locator("input:visible").all()]
        log.info(f"  📋 Após manual — botões: {btns_apos}")
        log.info(f"  📋 Após manual — inputs: {inputs_apos}")

        # Preenche campo de e-mail — tenta seletores específicos antes do fallback
        def _preencher_input_react(locator, valor: str) -> bool:
            """
            Preenche um input em React garantindo que o onChange seja disparado.
            Usa fill() + dispatchEvent para compatibilidade máxima.
            """
            try:
                locator.click(timeout=2000)
                locator.fill(valor, timeout=2000)
                # Dispara eventos React para garantir que o estado atualize
                page.evaluate("""(el, val) => {
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'value').set;
                    nativeInputValueSetter.call(el, val);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }""", [locator.element_handle(), valor])
                return True
            except Exception:
                return False

        preencheu = False
        for sel_email in [
            "input[type='email']:visible",
            "input[placeholder*='mail']:visible",
            "input[placeholder*='Mail']:visible",
            "input[placeholder*='e-mail']:visible",
            "input[placeholder*='E-mail']:visible",
            "input[placeholder*='Email']:visible",
            "input[placeholder*='Digite']:visible",
            "input[placeholder*='Insira']:visible",
            "input[placeholder*='Adicionar']:visible",
            "input[type='text']:visible",
        ]:
            try:
                campos = page.locator(sel_email).all()
                for campo in campos:
                    if campo.is_visible(timeout=500):
                        # Verifica se o campo parece ser para email (não filtro/busca)
                        placeholder = (campo.get_attribute("placeholder") or "").lower()
                        val_atual   = (campo.get_attribute("value") or "").lower()
                        # Pula campos de busca/filtro genéricos da página principal
                        if any(x in placeholder for x in ("buscar", "search", "filter", "filtrar")):
                            continue
                        if _preencher_input_react(campo, RELATORIO_EMAIL):
                            val_verificado = campo.input_value() or ""
                            if RELATORIO_EMAIL.lower() in val_verificado.lower():
                                preencheu = True
                                log.info(f"  ✔ E-mail preenchido e verificado via '{sel_email}' — valor: '{val_verificado}'")
                                break
                            else:
                                log.info(f"  ⚠️  Preencheu '{sel_email}' mas valor não confirmou: '{val_verificado}'")
                if preencheu:
                    break
            except Exception:
                continue

        if not preencheu:
            log.warning("  ⚠️  Não conseguiu preencher campo de email — tentando fallback geral")
            inputs = page.locator(
                "input:visible:not([type='checkbox']):not([type='radio'])"
                ":not([type='hidden']):not([type='file']):not([type='submit'])"
                ":not([type='button'])"
            ).all()
            for inp in inputs:
                try:
                    placeholder = (inp.get_attribute("placeholder") or "").lower()
                    if any(x in placeholder for x in ("buscar", "search", "filter", "filtrar")):
                        continue
                    if _preencher_input_react(inp, RELATORIO_EMAIL):
                        preencheu = True
                        log.warning("  Preencheu input disponível como e-mail (fallback)")
                        break
                except Exception:
                    continue

        if not preencheu:
            log.error("  ❌ CRÍTICO: Não foi possível preencher o e-mail no modal!")

        page.wait_for_timeout(800)

        # Log dos botões visíveis no modal antes de confirmar
        btns_modal = [el.inner_text().strip() for el in page.locator("button:visible").all() if el.inner_text().strip()]
        log.info(f"  📋 Botões visíveis antes de confirmar: {btns_modal}")
        _screenshot(page, "11_pre_confirmar", nome_cliente)

        # ── 7. Confirmar envio ────────────────────────────────────────────
        # Importante: excluir "RELATÓRIO" para não re-clicar o botão de fundo
        confirmou = False
        try:
            # Tenta primeiro o botão com texto exato de confirmação (sem "relatório")
            btn_confirm = page.locator("button:visible").filter(
                has_text=re.compile(r"\benviar\b|\bsend\b|\bconfirmar\b|\bconfirm\b|\bok\b", re.I)
            ).filter(has_not_text=re.compile(r"relat", re.I)).last
            btn_confirm.click(timeout=5000)
            confirmou = True
            log.info("  ✔ Botão de confirmação clicado")
        except Exception:
            pass

        if not confirmou:
            # Fallback: tenta botão type=submit dentro do modal
            try:
                page.locator("button[type='submit']:visible, input[type='submit']:visible").first.click(timeout=3000)
                confirmou = True
                log.info("  ✔ Botão submit clicado (fallback)")
            except Exception:
                pass

        if not confirmou:
            page.keyboard.press("Enter")
            log.info("  ✔ Enter pressionado como confirmação")

        page.wait_for_timeout(3000)
        _screenshot(page, "12_pos_envio", nome_cliente)
        log.info(f"  ✅ Relatório enviado para {RELATORIO_EMAIL}")

        # ── 8. Volta à lista de plataformas ──────────────────────────────
        try:
            page.goto(DISPLAYFORCE_URL)
            page.wait_for_load_state("networkidle", timeout=15000)
            page.wait_for_timeout(2000)
        except Exception:
            pass

        return True

    except Exception as e:
        log.error(f"  Erro ao exportar '{nome_cliente}': {e}")
        try:
            page.goto(DISPLAYFORCE_URL)
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        return False


# ──────────────────────────────────────────────────────────────
# LÓGICA PRINCIPAL DO BOT
# ──────────────────────────────────────────────────────────────

def obter_periodo_atual() -> tuple[str, str]:
    agora  = datetime.now(timezone(timedelta(hours=-3)))
    inicio = agora.replace(hour=0,  minute=0,  second=0,  microsecond=0)
    fim    = agora.replace(hour=23, minute=59, second=59, microsecond=0)
    return inicio.strftime("%Y-%m-%d"), fim.strftime("%Y-%m-%d")


_bot_lock = threading.Lock()


def executar_bot():
    if not _bot_lock.acquire(blocking=False):
        log.info("⏭️  Bot já em execução, aguardando próxima rodada...")
        return

    try:
        log.info("=" * 60)
        log.info(f"🤖 Iniciando bot — {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
        log.info("=" * 60)

        clientes = buscar_clientes()
        if not clientes:
            log.warning("Nenhum cliente ativo encontrado no Supabase.")
            return

        data_inicio, data_fim = obter_periodo_atual()
        log.info(f"Período: {data_inicio} → {data_fim}")

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=HEADLESS)
            ctx     = browser.new_context(accept_downloads=True)
            page    = ctx.new_page()

            if not fazer_login_displayforce(page):
                log.error("Falha no login — abortando rodada")
                browser.close()
                return

            for cliente in clientes:
                nome_cliente = cliente["name"]
                client_id    = cliente["id"]

                exportou = exportar_relatorio_cliente(page, nome_cliente, data_inicio, data_fim)
                if not exportou:
                    continue

                caminhos = baixar_relatorio_email()
                if not caminhos:
                    log.error(f"  Relatório não recebido para '{nome_cliente}'")
                    continue

                total_registros = 0
                for caminho_arquivo in caminhos:
                    nome_arq = Path(caminho_arquivo).name.lower()
                    # Prioriza o CSV de Views (engagement por campanha)
                    if "views" in nome_arq:
                        registros = processar_views_csv(caminho_arquivo, client_id)
                    elif nome_arq.endswith(".xlsx") or nome_arq.endswith(".xls"):
                        registros = processar_excel(caminho_arquivo, client_id)
                    else:
                        log.info(f"  Arquivo ignorado na extração: {nome_arq}")
                        registros = []

                    if registros:
                        upsert_campanhas(registros)
                        total_registros += len(registros)
                    else:
                        log.info(f"  Sem dados extraídos de: {nome_arq}")

                    try:
                        os.remove(caminho_arquivo)
                    except Exception:
                        pass

                if total_registros == 0:
                    log.warning(f"  Nenhuma campanha salva para '{nome_cliente}'")

            browser.close()

        proxima = datetime.now(timezone(timedelta(hours=-3))).strftime("%d/%m/%Y")
        log.info(f"✅ Rodada concluída — próxima execução amanhã às {HORARIO_EXECUCAO}")

    except Exception as e:
        log.exception(f"❌ Erro inesperado na rodada: {e}")
    finally:
        _bot_lock.release()


# ──────────────────────────────────────────────────────────────
# SCHEDULER
# ──────────────────────────────────────────────────────────────

def main():
    log.info("🚀 Bot DisplayForce iniciado")
    log.info(f"   Horário de execução: todo dia às {HORARIO_EXECUCAO} (horário de Brasília)")
    log.info(f"   Clientes: buscados dinamicamente do Supabase")
    log.info(f"   Relatório enviado para: {RELATORIO_EMAIL}")

    DOWNLOAD_DIR.mkdir(exist_ok=True)

    # Executa uma vez imediatamente ao iniciar
    log.info("▶️  Execução inicial ao ligar o bot...")
    executar_bot()

    # Agenda para rodar uma vez por dia no horário configurado
    schedule.every().day.at(HORARIO_EXECUCAO).do(executar_bot)

    log.info(f"⏰ Agendamento ativo — próxima execução hoje/amanhã às {HORARIO_EXECUCAO} (Ctrl+C para parar)")
    while True:
        schedule.run_pending()
        time.sleep(60)  # verifica a cada 1 min (muito mais leve que 30s)


if __name__ == "__main__":
    import sys
    # --once: roda uma vez e sai (usado pelo GitHub Actions)
    # sem argumento: roda em loop diário (usado localmente)
    if "--once" in sys.argv:
        log.info("▶️  Modo --once: executa uma vez e encerra (GitHub Actions)")
        DOWNLOAD_DIR.mkdir(exist_ok=True)
        executar_bot()
        log.info("✅ Modo --once concluído.")
    else:
        main()