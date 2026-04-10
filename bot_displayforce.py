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
import requests as _requests
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# ──────────────────────────────────────────────────────────────
# CONFIGURAÇÕES — lê de variáveis de ambiente ou usa defaults
# ──────────────────────────────────────────────────────────────

def _carregar_env_arquivo(path: str = ".env") -> None:
    try:
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue

                if line.lower().startswith("$env:"):
                    line = line[5:].strip()

                if "=" not in line:
                    continue

                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip()

                if not k or not v:
                    continue

                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]

                if k not in os.environ:
                    os.environ[k] = v
    except Exception:
        return


_carregar_env_arquivo(os.environ.get("DOTENV_PATH", ".env"))


def _env(key: str, default: str) -> str:
    """Lê variável de ambiente; usa default se não existir."""
    return os.environ.get(key, default)

# DisplayForce
DISPLAYFORCE_URL   = "https://id.displayforce.ai/#/platforms"
DISPLAYFORCE_EMAIL = _env("DISPLAYFORCE_EMAIL", "")
DISPLAYFORCE_PASS  = _env("DISPLAYFORCE_PASS",  "")
RELATORIO_EMAIL    = _env("RELATORIO_EMAIL",    "")

# E-mail IMAP para receber o relatório da DisplayForce
IMAP_SERVER   = _env("IMAP_SERVER", "imap.gmail.com")
IMAP_PORT     = int(_env("IMAP_PORT", "993"))
IMAP_EMAIL    = _env("IMAP_EMAIL",    "")
IMAP_PASSWORD = _env("IMAP_PASSWORD", "")

# Supabase
SUPABASE_URL = _env("SUPABASE_URL", "")
SUPABASE_KEY = _env("SUPABASE_KEY", "")
if not SUPABASE_KEY:
    SUPABASE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY", "")


# Configurações gerais
HORARIO_EXECUCAO  = _env("HORARIO_EXECUCAO", "07:00")
DOWNLOAD_DIR      = Path("./downloads_displayforce")
LOG_FILE          = "bot_displayforce.log"
TIMEOUT_EMAIL_SEG = int(_env("TIMEOUT_EMAIL_SEG", "1200"))  # 20 minutos
HEADLESS          = _env("HEADLESS", "true").lower() == "true"


def _sb_headers() -> dict:
    """Headers padrão para chamadas REST ao Supabase."""
    return {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }

def _sb_get(table: str, params: dict | None = None) -> list:
    """
    GET na REST API do Supabase usando requests (lê proxy do Windows automaticamente).
    Retorna lista de registros ou lança exceção.
    """
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r = _requests.get(url, headers=_sb_headers(), params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def _sb_post(table: str, payload: list | dict, on_conflict: str | None = None) -> list:
    """
    POST (upsert) na REST API do Supabase usando requests.
    """
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params = {}
    prefer = "return=representation"
    if on_conflict:
        params["on_conflict"] = on_conflict
        prefer = f"resolution=merge-duplicates,{prefer}"
    headers = {**_sb_headers(), "Prefer": prefer}
    r = _requests.post(url, headers=headers, params=params, json=payload, timeout=15)
    r.raise_for_status()
    return r.json() if r.text else []


def carregar_config_supabase() -> None:
    """
    Lê o agendamento da tabela `bot_configs` no Supabase e aplica nos
    valores globais. Credenciais de acesso ficam no .env.
    Usa requests (lê proxy do Windows automaticamente).
    """
    global HORARIO_EXECUCAO, TIMEOUT_EMAIL_SEG

    if not SUPABASE_URL or not SUPABASE_KEY:
        log.info("  Supabase não configurado — usando agendamento do .env")
        return
    try:
        dados = _sb_get("bot_configs", {"select": "horario_execucao,timeout_email_seg", "limit": "1"})
        cfg = dados[0] if dados else None
        if not cfg:
            log.info("  Nenhuma config de agendamento salva no Supabase — usando .env")
            return

        horario = str(cfg.get("horario_execucao") or "").strip()
        if horario:
            HORARIO_EXECUCAO = horario

        timeout = cfg.get("timeout_email_seg")
        if timeout and int(timeout) > 0:
            TIMEOUT_EMAIL_SEG = int(timeout)

        log.info(f"  ✅ Agendamento carregado do Supabase: {HORARIO_EXECUCAO} / timeout={TIMEOUT_EMAIL_SEG}s")
    except Exception as e:
        log.warning(f"  Não foi possível carregar agendamento do Supabase: {e} — usando .env")

try:
    SYNC_INTERVAL_MIN = int(_env("SYNC_INTERVAL_MIN", "10"))
except Exception:
    SYNC_INTERVAL_MIN = 10

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


def validar_config() -> bool:
    faltando = []
    if not SUPABASE_URL:
        faltando.append("SUPABASE_URL")
    if not SUPABASE_KEY:
        faltando.append("SUPABASE_KEY")
    if not DISPLAYFORCE_EMAIL:
        faltando.append("DISPLAYFORCE_EMAIL")
    if not DISPLAYFORCE_PASS:
        faltando.append("DISPLAYFORCE_PASS")
    if not RELATORIO_EMAIL:
        faltando.append("RELATORIO_EMAIL")
    if not IMAP_EMAIL:
        faltando.append("IMAP_EMAIL")
    if not IMAP_PASSWORD:
        faltando.append("IMAP_PASSWORD")

    if faltando:
        log.error(f"Config incompleta. Defina as env vars: {', '.join(faltando)}")
        return False

    return True

# ──────────────────────────────────────────────────────────────
# SUPABASE — helpers
# ──────────────────────────────────────────────────────────────



def _clientes_fallback() -> list[dict]:
    """
    Retorna clientes a partir da variável CLIENTES_FALLBACK no .env.
    Formato: nome1|uuid1,nome2|uuid2
    Exemplo: assai|c6999bd9-14c0-4e26-abb1-d4b8xxxx,panvel|b1c05e4d-0417-4853-9af9-8c0725df1880
    """
    raw = _env("CLIENTES_FALLBACK", "").strip()
    if not raw:
        return []
    clientes = []
    for item in raw.split(","):
        item = item.strip()
        if "|" not in item:
            continue
        nome, uid = item.split("|", 1)
        nome = nome.strip()
        uid  = uid.strip()
        if nome and uid:
            clientes.append({"id": uid, "name": nome, "status": "active"})
    if clientes:
        log.info(f"  📋 Clientes do fallback (.env): {[c['name'] for c in clientes]}")
    return clientes


def buscar_clientes() -> list[dict]:
    """Busca clientes ativos no Supabase via REST (usa proxy do Windows automaticamente)."""
    try:
        for status in ("active", "ativo"):
            dados = _sb_get("clients", {"select": "id,name,status", "status": f"eq.{status}"})
            if dados:
                log.info(f"Clientes encontrados no Supabase (status={status}): {[c['name'] for c in dados]}")
                return dados

        dados = _sb_get("clients", {"select": "id,name,status"})
        if dados:
            log.warning("Nenhum cliente com status 'active/ativo'. Usando todos.")
            return dados

        log.warning("Nenhum cliente encontrado no Supabase.")
    except Exception as e:
        log.error(f"Erro ao buscar clientes no Supabase: {e}")

    fallback = _clientes_fallback()
    if fallback:
        return fallback

    log.warning("Nenhum cliente ativo encontrado.")
    return []


def upsert_campanhas(registros: list[dict]) -> int:
    """Salva campanhas no Supabase via REST. Em caso de falha, salva localmente."""
    if not registros:
        return 0

    import json as _json

    def _drop_keys(rows: list[dict], keys: set) -> list[dict]:
        if not keys:
            return rows
        return [{k: v for k, v in r.items() if k not in keys} for r in rows]

    tentativas = [
        ("client_id,name,content_name,tipo_midia,loja", set()),
        ("client_id,name,tipo_midia,loja", set()),
        ("client_id,name,start_date,end_date", set()),
        ("client_id,name", set()),
        ("client_id,name,tipo_midia,loja", {"uploaded_at"}),
        ("client_id,name", {"uploaded_at", "tipo_midia", "loja"}),
    ]

    for on_conflict, drop_keys in tentativas:
        try:
            payload = _drop_keys(registros, drop_keys)
            resultado = _sb_post("campaigns", payload, on_conflict=on_conflict)
            count = len(resultado) if resultado else len(payload)
            log.info(f"  ✅ {count} campanhas salvas no Supabase (on_conflict={on_conflict})")
            return count
        except Exception as e:
            log.warning(f"  Falha no upsert (on_conflict={on_conflict}): {e}")

    # Fallback INSERT simples sem on_conflict
    try:
        resultado2 = _sb_post("campaigns", registros)
        count2 = len(resultado2) if resultado2 else len(registros)
        log.info(f"  ✅ {count2} campanhas inseridas via fallback INSERT")
        return count2
    except Exception as e2:
        log.error(f"  ❌ Supabase indisponível — salvando dados localmente para reenvio posterior")
        pendente = DOWNLOAD_DIR / f"pendente_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        pendente.write_text(_json.dumps(registros, ensure_ascii=False, default=str), encoding="utf-8")
        log.warning(f"  💾 Dados salvos em: {pendente} — serão reenviados na próxima execução")
        return 0


def _reenviar_pendentes() -> None:
    """Tenta reenviar arquivos JSON pendentes para o Supabase."""
    pendentes = list(DOWNLOAD_DIR.glob("pendente_*.json"))
    if not pendentes:
        return
    log.info(f"  🔄 {len(pendentes)} arquivo(s) pendente(s) para reenvio...")
    import json as _json
    for arq in pendentes:
        try:
            registros = _json.loads(arq.read_text(encoding="utf-8"))
            count = upsert_campanhas(registros)
            if count > 0:
                arq.unlink()
                log.info(f"  ✅ Pendente reenviado e removido: {arq.name}")
        except Exception as e:
            log.warning(f"  ⚠️  Falha ao reenviar {arq.name}: {e}")


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
        "display_count": ["QUANTIDADE DE EXIBIÇÕES", "QTD EXIBIÇÕES", "QTD_EXIBICOES",
                          "Exibições", "Exibicoes", "Display Count", "Shows", "Views"],
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
            "display_count":     _to_int(row.get(mapa["display_count"])) if mapa.get("display_count") else None,
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


def _clean_content_name(raw: str) -> str:
    """
    Limpa o nome do vídeo/conteúdo removendo:
    - Períodos de exibição (ex: _10mar_15mar_26, -05mar_26-30mai_26)
    - Resolução e formato (ex: - 1080x1920, _1080x1920, (43' Vertical))
    - Extensão .mp4
    - Versões (_v4, (1), (2))
    - Separadores finais
    """
    import re
    name = str(raw).strip()

    # Remove extensão .mp4 (case-insensitive)
    name = re.sub(r'\.mp4$', '', name, flags=re.IGNORECASE)

    # Remove períodos de exibição:
    # Cobre: _10mar_15mar_26 | -05mar_26-30mai_26 | -15fev_26-15Ago_26 | _03mar_31mar_26
    # Lógica: um ou mais tokens "sep+dia+mês" seguidos de um ano opcional no final
    meses = r'(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)'
    padrao_data = rf'(?:[_\-\s]+\d{{1,2}}{meses})+(?:[_\-]\d{{2,4}})?'
    name = re.sub(padrao_data, '', name, flags=re.IGNORECASE)

    # Remove resolução: 1080x1920, 1920x1080, 1080 x 1920, etc.
    name = re.sub(r'[_\-\s]*\d{3,4}\s*[xX]\s*\d{3,4}', '', name)

    # Remove formato entre parênteses: (43' Vertical), (43 Vertical), (Horizontal), etc.
    name = re.sub(r'\s*\([^)]*(?:vertical|horizontal|vert|horiz)[^)]*\)', '', name, flags=re.IGNORECASE)

    # Remove parênteses com apenas números no final: (1), (2), (3)
    name = re.sub(r'\s*\(\d+\)\s*$', '', name)

    # Remove versão no final: _v4, _v2, v4
    name = re.sub(r'[_\s]+v\d+$', '', name, flags=re.IGNORECASE)

    # Remove separadores soltos no final (_ - espaço)
    name = re.sub(r'[_\-\s]+$', '', name)

    # Limpa separadores duplos internos
    name = re.sub(r'[_\-]{2,}', '-', name)

    return name.strip()


def processar_views_csv(caminho_arquivo: str, client_id: str) -> list[dict]:
    """
    Lê o arquivo 'Views of visitors' CSV do DisplayForce e agrega por
    Campaign + Device → salva como (name, tipo_midia, loja) na tabela campaigns.

    Estrutura confirmada do CSV DisplayForce:
      - Primeira linha: 'sep=,' → skiprows=1
      - Colunas relevantes:
          Campaign            → name da campanha
          Device              → "Brand: Location - MediaType"
                                  loja      = Location (entre ': ' e ' - ')
                                  tipo_midia= MediaType (após ' - ')
          Visitor ID          → contagem de visitantes únicos
          Contact ID          → para deduplicar atenção média
          Contact Duration    → duração do contato (seg) → avg_attention_sec
          Content View Start  → start_date (mínimo do grupo)
          Content View End    → end_date (máximo do grupo)
    """
    log.info(f"  Processando Views CSV: {caminho_arquivo}")
    try:
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

    # ── Encontrar colunas por nome (case-insensitive) ──────────
    def _find_col(*names: str) -> str | None:
        norm = {n.lower().strip(): n for n in names}
        for c in df.columns:
            if c.lower().strip() in norm:
                return c
        # fallback: contém
        for c in df.columns:
            for n in names:
                if n.lower() in c.lower():
                    return c
        return None

    col_campaign   = _find_col("Campaign", "Campanha")
    col_content    = _find_col("Content", "Conteúdo", "Conteudo", "Video", "Vídeo")
    col_device     = _find_col("Device", "Dispositivo")
    col_visitor    = _find_col("Visitor ID", "Visitor_ID", "VisitorID")
    col_contact_id = _find_col("Contact ID", "Contact_ID", "ContactID")
    col_contact_dur= _find_col("Contact Duration", "Contact_Duration")
    col_start      = _find_col("Content View Start", "Contact Start", "View Start")
    col_end        = _find_col("Content View End",   "Contact End",   "View End")

    log.info(
        f"  Mapeamento: campaign={col_campaign}, content={col_content}, device={col_device}, "
        f"visitor={col_visitor}, contact_id={col_contact_id}, "
        f"contact_dur={col_contact_dur}, start={col_start}, end={col_end}"
    )

    if not col_campaign or not col_device:
        log.warning(f"  Colunas 'Campaign' ou 'Device' não encontradas — abortando Views CSV")
        return []

    # Remove linhas sem Campaign ou Device
    df = df[
        df[col_campaign].notna() & (df[col_campaign].astype(str).str.strip() != "") &
        df[col_device].notna()   & (df[col_device].astype(str).str.strip()   != "")
    ].copy()
    if df.empty:
        log.warning("  Nenhuma linha útil no Views CSV")
        return []

    # ── Parser de Device: "Brand: Location - MediaType" ────────
    def _parse_device(device_str: str) -> tuple[str, str]:
        """Retorna (loja, tipo_midia) a partir do nome do Device."""
        s = str(device_str).strip()
        loja = tipo_midia = ""
        # Extrai a parte após ": " (ignora o nome da rede/brand)
        if ": " in s:
            s = s.split(": ", 1)[1].strip()
        # Divide em Location e MediaType pelo último " - "
        if " - " in s:
            parts = s.rsplit(" - ", 1)
            loja       = parts[0].strip()
            tipo_midia = parts[1].strip()
        else:
            loja = s
        return loja, tipo_midia

    # ── Agregar por Campaign + Content + Device ────────────────
    agora     = datetime.now(timezone.utc).isoformat()
    registros = []

    # Define chaves de agrupamento: inclui Content se a coluna existir
    group_keys = [col_campaign, col_device]
    if col_content and col_content in df.columns:
        group_keys = [col_campaign, col_content, col_device]

    for group_vals, grupo in df.groupby(group_keys):
        # Desempacota os valores do grupo conforme as chaves usadas
        if len(group_keys) == 3:
            campaign_val, content_val, device_val = group_vals
            content_val = str(content_val).strip()
            content_val = "" if content_val.lower() == "nan" else content_val
        else:
            campaign_val, device_val = group_vals
            content_val = ""
        campaign_val = str(campaign_val).strip()
        device_val   = str(device_val).strip()
        campaign_val = "" if campaign_val.lower() == "nan" else campaign_val
        if not campaign_val:
            continue

        # Limpa o nome do vídeo removendo datas, resolução e formato
        if content_val:
            content_val = _clean_content_name(content_val)

        loja, tipo_midia = _parse_device(device_val)

        # Visitantes únicos
        visitantes = (
            grupo[col_visitor].nunique()
            if col_visitor and col_visitor in grupo.columns
            else len(grupo)
        )

        # Atenção média: Contact Duration médio por contato único (sem duplicatas)
        avg_attention = 0
        if col_contact_id and col_contact_dur and col_contact_id in grupo.columns and col_contact_dur in grupo.columns:
            try:
                contatos_unicos = grupo.drop_duplicates(subset=[col_contact_id])[[col_contact_dur]]
                avg_attention = int(
                    pd.to_numeric(contatos_unicos[col_contact_dur], errors="coerce").mean() or 0
                )
            except Exception:
                pass
        elif col_contact_dur and col_contact_dur in grupo.columns:
            try:
                avg_attention = int(
                    pd.to_numeric(grupo[col_contact_dur], errors="coerce").mean() or 0
                )
            except Exception:
                pass

        # Datas
        start_date = end_date = None
        if col_start and col_start in grupo.columns:
            try:
                datas = pd.to_datetime(grupo[col_start], errors="coerce").dropna()
                if not datas.empty:
                    start_date = datas.min().isoformat()
            except Exception:
                pass
        if col_end and col_end in grupo.columns:
            try:
                datas_fim = pd.to_datetime(grupo[col_end], errors="coerce").dropna()
                if not datas_fim.empty:
                    end_date = datas_fim.max().isoformat()
            except Exception:
                pass

        # Duração (período da campanha no Device)
        duration_days = None
        duration_hms  = None
        if start_date and end_date:
            try:
                delta     = pd.to_datetime(end_date) - pd.to_datetime(start_date)
                total_sec = int(delta.total_seconds())
                duration_days = round(total_sec / 86400, 2)
                hh = total_sec // 3600
                mm = (total_sec % 3600) // 60
                ss = total_sec % 60
                duration_hms = f"{hh}:{mm:02d}:{ss:02d}"
            except Exception:
                pass

        # Quantidade de exibições (total de linhas no grupo = nº de interações de exibição)
        display_count = len(grupo)

        reg = {
            "client_id":         client_id,
            "name":              campaign_val,
            "content_name":      content_val if content_val else None,
            "tipo_midia":        tipo_midia,
            "loja":              loja,
            "start_date":        start_date,
            "end_date":          end_date,
            "duration_days":     duration_days,
            "duration_hms":      duration_hms,
            "display_count":     display_count,
            "visitors":          int(visitantes),
            "avg_attention_sec": avg_attention,
            "uploaded_at":       agora,
        }
        registros.append(reg)
        log.info(
            f"    → '{campaign_val}' | content='{content_val}' | loja='{loja}' | tipo='{tipo_midia}' "
            f"| exibições={display_count} | visitantes={visitantes} | atenção={avg_attention}s"
        )

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


def _buscar_em_pasta(imap, pasta: str, apos_uid: int, nome_cliente: str = "") -> list[str]:
    """Tenta encontrar e processar e-mail DisplayForce numa pasta específica.
    CORRIGIDO: usa uid('search') e uid('fetch') para UIDs reais.
    nome_cliente: se informado, filtra apenas e-mails cujo remetente contenha esse nome."""
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

            # Filtro por cliente: verifica remetente OU assunto
            # (DisplayForce envia de noreply@displ.com mas menciona o cliente no assunto)
            if nome_cliente:
                nm = nome_cliente.strip().lower()
                if nm not in remetente and nm not in assunto:
                    log.info(f"    ⏭️  UID {uid} ignorado — '{nm}' não está em remetente='{remetente}' nem assunto='{assunto}'")
                    continue

            log.info(f"  ✉️  DisplayForce detectado em '{pasta}' (UID {uid}) | assunto: '{assunto}'")
            resultado = _processar_msg_displayforce(imap, uid, use_uid=True)
            if resultado:
                return resultado
        except Exception as e:
            log.warning(f"    Erro ao processar UID {uid} em '{pasta}': {e}")

    return []


def _verificar_email_displayforce(apos_uid: int, nome_cliente: str = "") -> list[str]:
    """
    Verifica e-mails novos da DisplayForce em INBOX e Spam.
    CORRIGIDO: usa uid('search') e uid('fetch') para UIDs reais do Gmail.
    nome_cliente: se informado, filtra apenas e-mails cujo remetente contenha esse nome.
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

                    # Filtro por cliente: verifica remetente OU assunto
                    if nome_cliente:
                        nm = nome_cliente.strip().lower()
                        if nm not in remetente and nm not in assunto:
                            log.info(f"  ⏭️  UID {uid} ignorado — '{nm}' não está em remetente='{remetente}' nem assunto='{assunto}'")
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
                    try:
                        _, msg_data2 = imap.uid('fetch', uid, '(RFC822)')
                        if not msg_data2 or not msg_data2[0]:
                            continue
                        raw2 = msg_data2[0][1]
                        if not isinstance(raw2, bytes):
                            continue
                        msg2      = email.message_from_bytes(raw2)
                        remetente2 = str(msg2.get("From", "")).lower()
                        assunto2   = str(msg2.get("Subject", "")).lower()
                        if nome_cliente:
                            nm2 = nome_cliente.strip().lower()
                            if nm2 not in remetente2 and nm2 not in assunto2:
                                log.info(f"  ⏭️  UID {uid} (est.2) ignorado — '{nm2}' não está em remetente='{remetente2}' nem assunto='{assunto2}'")
                                continue
                    except Exception:
                        pass
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
                            if nome_cliente:
                                nm3 = nome_cliente.strip().lower()
                                if nm3 not in remetente and nm3 not in assunto:
                                    log.info(f"  ⏭️  UID {uid} (est.3) ignorado — '{nm3}' não está em remetente='{remetente}' nem assunto='{assunto}'")
                                    continue
                            log.info(f"  🔎 Estratégia 3: UID {uid} | de: '{remetente}' | assunto: '{assunto}'")
                            resultado = _processar_msg_displayforce(imap, uid, use_uid=True)
                            if resultado:
                                return resultado
                    except Exception as e:
                        log.warning(f"  Erro na estratégia 3 UID {uid}: {e}")

        # ── Estratégia 4: verifica pasta Spam ────────────────────────────
        for pasta_spam in ["[Gmail]/Spam", "[Gmail]/Lixo eletrônico", "Spam", "Junk", "SPAM",
                           "[Gmail]/Lixo Eletr\u00f4nico"]:
            resultado = _buscar_em_pasta(imap, pasta_spam, apos_uid, nome_cliente=nome_cliente)
            if resultado:
                log.warning(f"  ⚠️  E-mail encontrado na pasta SPAM! Mova para INBOX para evitar isso.")
                return resultado

    return []


def baixar_relatorio_email(timeout_seg: int = TIMEOUT_EMAIL_SEG, nome_cliente: str = "") -> list[str]:
    """
    Aguarda o e-mail da DisplayForce e retorna lista de caminhos de arquivos baixados.
    Verifica a caixa IMAP a cada 15 segundos até timeout_seg.
    nome_cliente: se informado, filtra apenas e-mails cujo remetente contenha esse nome,
    evitando que o bot processe e-mail do cliente errado.
    """
    log.info(f"  Aguardando e-mail com relatório em {IMAP_EMAIL} (cliente: '{nome_cliente}')...")
    DOWNLOAD_DIR.mkdir(exist_ok=True)
    inicio     = time.time()
    ultimo_uid = _obter_ultimo_uid()

    while time.time() - inicio < timeout_seg:
        try:
            caminhos = _verificar_email_displayforce(ultimo_uid, nome_cliente=nome_cliente)
            if caminhos:
                log.info(f"  ✅ {len(caminhos)} arquivo(s) baixado(s): {caminhos}")
                return caminhos
        except Exception as e:
            log.warning(f"  Erro ao verificar e-mail: {e}")
        time.sleep(10)  # checa a cada 10s (era 15s)

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


def _fill_input_react(page, locator, valor: str) -> bool:
    """Preenche input controlado por React disparando input/change."""
    try:
        locator.click(timeout=2000)
    except Exception:
        pass

    try:
        locator.fill(valor, timeout=2000)
    except Exception:
        try:
            locator.press_sequentially(valor, delay=40)
        except Exception:
            return False

    try:
        handle = locator.element_handle(timeout=2000)
        if handle:
            page.evaluate(
                """([el, val]) => {
                    const setter = Object.getOwnPropertyDescriptor(
                      window.HTMLInputElement.prototype,
                      'value'
                    )?.set;
                    if (setter) setter.call(el, val);
                    else el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                }""",
                [handle, valor],
            )
    except Exception:
        pass

    try:
        atual = (locator.input_value(timeout=2000) or "").strip()
        return atual == valor
    except Exception:
        return False


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
        # ── Aguarda página de login carregar completamente ────────────────
        page.wait_for_load_state("networkidle", timeout=20000)
        page.wait_for_timeout(2000)
        _screenshot(page, "login_01_inicial", "login")

        # ── Campo de e-mail ───────────────────────────────────────────────
        inputs_visiveis = page.locator("input:visible").all()
        if not inputs_visiveis:
            log.error("  ❌ Nenhum input visível na página de login")
            return False

        email_selectors = [
            "input[type='email']:visible",
            "input[name*='mail' i]:visible",
            "input[placeholder*='mail' i]:visible",
            "input[autocomplete='username']:visible",
        ]
        email_field = None
        for sel in email_selectors:
            try:
                candidate = page.locator(sel).first
                if candidate.count() > 0 and candidate.is_visible(timeout=1000):
                    email_field = candidate
                    break
            except Exception:
                continue

        if email_field is None:
            log.info("  Usando primeiro input visível como campo de e-mail")
            email_field = inputs_visiveis[0]

        if not _fill_input_react(page, email_field, DISPLAYFORCE_EMAIL):
            log.error("  ❌ Não foi possível preencher o e-mail no login")
            _screenshot(page, "login_01b_email_falhou", "login")
            return False

        try:
            valor_email = email_field.input_value(timeout=1000)
            log.info(f"  ✔ E-mail preenchido: '{valor_email}'")
        except Exception:
            log.info("  ✔ E-mail preenchido")
        page.wait_for_timeout(500)

        # ── Verifica se já tem campo de senha na mesma tela ───────────────
        senha_fields = page.locator("input[type='password']:visible").all()
        if senha_fields:
            log.info("  Login em 1 etapa: preenchendo senha diretamente")
            _fill_input_react(page, senha_fields[0], DISPLAYFORCE_PASS)
            page.wait_for_timeout(300)
        else:
            # ── Login em 2 etapas: clicar em "Próximo" primeiro ───────────
            log.info("  Login em 2 etapas: procurando botão Próximo/Continuar...")
            btn_proximo = page.locator("button:visible").filter(
                has_text=re.compile(r"próximo|proximo|next|continuar|continue|avançar", re.I)
            ).first
            btn_proximo.click(timeout=5000)
            log.info("  Botão 'próximo' clicado")

            # Aguarda transição da página (networkidle ou campo de senha)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass
            page.wait_for_timeout(3000)
            _screenshot(page, "login_02_apos_proximo", "login")

            # Tenta localizar o campo de senha com timeout generoso
            senha_field = page.locator("input[type='password']:visible").first
            try:
                senha_field.wait_for(state="visible", timeout=20000)
                log.info("  Campo de senha apareceu (step 2)")
                if not _fill_input_react(page, senha_field, DISPLAYFORCE_PASS):
                    raise RuntimeError("falha ao preencher senha")
                page.wait_for_timeout(500)
            except Exception:
                # Fallback: tenta preencher qualquer input vazio que não seja e-mail
                log.warning("  Campo senha não encontrado pelo tipo — tentando fallback")
                _screenshot(page, "login_03_sem_senha", "login")
                todos_inputs = page.locator("input:visible").all()
                for inp in todos_inputs:
                    tp = (inp.get_attribute("type") or "text").lower()
                    val = (inp.input_value() or "").strip()
                    if tp in ("password", "text") and val == "":
                        if _fill_input_react(page, inp, DISPLAYFORCE_PASS):
                            log.info(f"  Senha preenchida via fallback (type={tp})")
                            break

        # ── Botão de entrar ───────────────────────────────────────────────
        _screenshot(page, "login_04_pre_submit", "login")
        clicou_login = False
        # Tenta vários padrões de texto para o botão de login
        padroes_login = [
            r"entrar|login|sign.?in|acessar|confirmar",
            r"continuar|continue|next|próximo",
            r"submit|enviar",
        ]
        for padrao in padroes_login:
            try:
                btn_login = page.locator("button:visible").filter(
                    has_text=re.compile(padrao, re.I)
                ).first
                if btn_login.is_visible(timeout=2000):
                    btn_login.click(timeout=3000)
                    clicou_login = True
                    log.info(f"  ✔ Botão de login clicado (padrão: '{padrao}')")
                    break
            except Exception:
                continue
        if not clicou_login:
            # Fallback: tenta qualquer button:visible ou pressiona Enter
            try:
                btns = page.locator("button:visible").all()
                if btns:
                    btns[-1].click(timeout=2000)
                    clicou_login = True
                    log.info("  ✔ Botão de login clicado (último botão visível)")
            except Exception:
                pass
        if not clicou_login:
            page.keyboard.press("Enter")
            log.info("  ✔ Enter pressionado como fallback de login")

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
        # O modal exibe um DROPDOWN com e-mails pré-configurados.
        # Para usar outro e-mail, é preciso marcar o CHECKBOX "Inserir email manualmente".
        # O checkbox pode ser um <input type='checkbox'> ou um <label> clicável.
        _screenshot(page, "10_modal_aberto", nome_cliente)

        # Loga tudo que está visível no modal para diagnóstico
        btns_modal_antes = [el.inner_text().strip() for el in page.locator("button:visible, a:visible").all() if el.inner_text().strip()]
        inputs_antes = [(el.get_attribute("type") or "text", el.get_attribute("placeholder") or "") for el in page.locator("input:visible").all()]
        log.info(f"  📋 Modal aberto — botões: {btns_modal_antes}")
        log.info(f"  📋 Modal aberto — inputs visíveis: {inputs_antes}")

        clicou_manual = False

        # Estratégia 1: clica no LABEL "Inserir email manualmente" (mais comum no DisplayForce)
        textos_label = [
            r"inserir.{0,10}e?-?mail.{0,10}manualmente",
            r"inserir.{0,10}manualmente",
            r"manual",
            r"add.{0,10}e?-?mail",
            r"digitar.{0,10}e?-?mail",
        ]
        seletores_clicaveis = (
            "label:visible, "
            "button:visible, "
            "a:visible, "
            "span:visible, "
            "div[role='checkbox']:visible, "
            "div[role='button']:visible, "
            "p:visible"
        )
        for texto in textos_label:
            if clicou_manual:
                break
            try:
                el = page.locator(seletores_clicaveis).filter(
                    has_text=re.compile(texto, re.I)
                ).first
                if el.is_visible(timeout=1500):
                    el.click()
                    clicou_manual = True
                    log.info(f"  ✔ Clicado elemento 'Inserir manualmente' com padrão: '{texto}'")
                    page.wait_for_timeout(2000)  # aguarda campo de e-mail aparecer
            except Exception:
                continue

        # Estratégia 2: procura input[type='checkbox'] próximo ao texto
        if not clicou_manual:
            try:
                chk = page.locator("input[type='checkbox']:visible").first
                if chk.is_visible(timeout=1500):
                    chk.click()
                    clicou_manual = True
                    log.info("  ✔ Checkbox clicado (estratégia 2)")
                    page.wait_for_timeout(2000)
            except Exception:
                pass

        if not clicou_manual:
            log.info("  ℹ️  Checkbox 'Inserir email manualmente' não encontrado — tentando encontrar input direto")

        _screenshot(page, "10b_apos_inserir_manual", nome_cliente)

        # Loga estado do modal após tentar clicar no checkbox
        btns_apos = [el.inner_text().strip() for el in page.locator("button:visible, a:visible").all() if el.inner_text().strip()]
        inputs_apos = [(el.get_attribute("type") or "text", el.get_attribute("placeholder") or "", el.get_attribute("value") or "") for el in page.locator("input:visible").all()]
        log.info(f"  📋 Após checkbox — botões: {btns_apos}")
        log.info(f"  📋 Após checkbox — inputs: {inputs_apos}")

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

        # ── Aguarda que o campo de e-mail apareça após "inserir manualmente" ──
        page.wait_for_timeout(1500)

        preencheu = False

        # Seletores em ordem de especificidade (mais específico primeiro)
        seletores_email = [
            "input[type='email']:visible",
            "input[placeholder*='mail' i]:visible",
            "input[placeholder*='e-mail' i]:visible",
            "input[placeholder*='Digite' i]:visible",
            "input[placeholder*='Insira' i]:visible",
            "input[placeholder*='Adicionar' i]:visible",
        ]

        for sel in seletores_email:
            try:
                campos = page.locator(sel).all()
                for campo in campos:
                    if not campo.is_visible(timeout=500):
                        continue
                    placeholder = (campo.get_attribute("placeholder") or "").lower()
                    if any(x in placeholder for x in ("buscar", "search", "filter", "filtrar")):
                        continue
                    if _preencher_input_react(campo, RELATORIO_EMAIL):
                        val = campo.input_value() or ""
                        if RELATORIO_EMAIL.lower() in val.lower():
                            preencheu = True
                            log.info(f"  ✔ E-mail preenchido via '{sel}' — valor: '{val}'")
                            break
                if preencheu:
                    break
            except Exception:
                continue

        if not preencheu:
            # Fallback: todos os inputs text/email visíveis, pulando campos hh/mm/ss
            log.warning("  ⚠️  Tentando fallback: percorrendo todos inputs visíveis")
            inputs = page.locator(
                "input:visible:not([type='checkbox']):not([type='radio'])"
                ":not([type='hidden']):not([type='file']):not([type='submit'])"
                ":not([type='button']):not([type='number'])"
            ).all()
            for inp in inputs:
                try:
                    placeholder = (inp.get_attribute("placeholder") or "").lower()
                    val_atual   = (inp.input_value() or "").strip()
                    # Pula campos de filtro/busca
                    if any(x in placeholder for x in ("buscar", "search", "filter", "filtrar")):
                        continue
                    # Pula campos de tempo (hh, mm, ss — valor numérico curto)
                    if placeholder in ("hh", "mm", "ss") or (val_atual.isdigit() and len(val_atual) <= 2):
                        continue
                    if _preencher_input_react(inp, RELATORIO_EMAIL):
                        val = inp.input_value() or ""
                        if RELATORIO_EMAIL.lower() in val.lower():
                            preencheu = True
                            log.info(f"  ✔ E-mail preenchido via fallback geral — valor: '{val}'")
                            break
                except Exception:
                    continue

        if not preencheu:
            # Último recurso: preenche o ÚLTIMO input de texto vazio no modal
            log.warning("  ⚠️  Último recurso: preenchendo último input vazio disponível")
            try:
                inputs = page.locator("input[type='text']:visible, input:not([type]):visible").all()
                candidatos = []
                for inp in inputs:
                    try:
                        val = (inp.input_value() or "").strip()
                        ph  = (inp.get_attribute("placeholder") or "").lower()
                        if ph not in ("hh", "mm", "ss") and val == "":
                            candidatos.append(inp)
                    except Exception:
                        continue
                if candidatos:
                    alvo = candidatos[-1]  # último input vazio
                    if _preencher_input_react(alvo, RELATORIO_EMAIL):
                        val = alvo.input_value() or ""
                        preencheu = True
                        log.info(f"  ✔ E-mail preenchido no último input vazio — valor: '{val}'")
            except Exception as e:
                log.warning(f"  Último recurso falhou: {e}")

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

        # Carrega credenciais do Supabase (sobrepõe .env se existir configuração salva)
        carregar_config_supabase()

        # Tenta reenviar dados que ficaram pendentes de execuções anteriores
        _reenviar_pendentes()

        clientes = buscar_clientes()
        if not clientes:
            log.warning("Nenhum cliente ativo encontrado. Configure CLIENTES_FALLBACK no .env")
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

                caminhos = baixar_relatorio_email(nome_cliente=nome_cliente)
                if not caminhos:
                    log.error(f"  Relatório não recebido para '{nome_cliente}'")
                    continue

                total_registros = 0
                for caminho_arquivo in caminhos:
                    nome_arq = Path(caminho_arquivo).name.lower()
                    # Somente o CSV 'Views of visitors' alimenta o gráfico de engajamento.
                    # Os demais arquivos (Visitors, Passerby, Contacts, XLSX) são ignorados
                    # neste fluxo pois não contêm dados de visualização por campanha.
                    if "views" in nome_arq and nome_arq.endswith(".csv"):
                        registros = processar_views_csv(caminho_arquivo, client_id)
                    else:
                        log.info(f"  Arquivo ignorado na extração de engajamento: {nome_arq}")
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

        log.info("✅ Rodada concluída")

    except Exception as e:
        log.exception(f"❌ Erro inesperado na rodada: {e}")
    finally:
        _bot_lock.release()


# ──────────────────────────────────────────────────────────────
# SCHEDULER
# ──────────────────────────────────────────────────────────────

def main():
    log.info("🚀 Bot DisplayForce iniciado")
    if not validar_config():
        return

    if SYNC_INTERVAL_MIN and SYNC_INTERVAL_MIN > 0:
        log.info(f"   Execução: a cada {SYNC_INTERVAL_MIN} min")
    else:
        log.info(f"   Execução: todo dia às {HORARIO_EXECUCAO} (horário de Brasília)")

    log.info(f"   Clientes: buscados dinamicamente do Supabase")
    log.info(f"   Relatório enviado para: {RELATORIO_EMAIL}")

    DOWNLOAD_DIR.mkdir(exist_ok=True)

    log.info("▶️  Execução inicial ao ligar o bot...")
    executar_bot()

    if SYNC_INTERVAL_MIN and SYNC_INTERVAL_MIN > 0:
        schedule.every(SYNC_INTERVAL_MIN).minutes.do(executar_bot)
        log.info(f"⏰ Agendamento ativo — executa a cada {SYNC_INTERVAL_MIN} min (Ctrl+C para parar)")
    else:
        schedule.every().day.at(HORARIO_EXECUCAO).do(executar_bot)
        log.info(f"⏰ Agendamento ativo — próxima execução hoje/amanhã às {HORARIO_EXECUCAO} (Ctrl+C para parar)")

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    import sys
    # --once: roda uma vez e sai (usado pelo GitHub Actions)
    # sem argumento: roda em loop diário (usado localmente)
    if "--once" in sys.argv:
        log.info("▶️  Modo --once: executa uma vez e encerra")
        if not validar_config():
            raise SystemExit(2)
        DOWNLOAD_DIR.mkdir(exist_ok=True)
        executar_bot()
        log.info("✅ Modo --once concluído.")
    else:
        main()
