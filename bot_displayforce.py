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
# CONFIGURAÇÕES — edite apenas esta seção
# ──────────────────────────────────────────────────────────────

# DisplayForce
DISPLAYFORCE_URL   = "https://id.displayforce.ai/#/platforms"
DISPLAYFORCE_EMAIL = "bruno.lyra@globaltera.com.br"
DISPLAYFORCE_PASS  = "Tony@2023"
RELATORIO_EMAIL    = "rayanne.ernandez@globaltera.com.br"  # e-mail que recebe o relatório

# E-mail IMAP para receber o relatório da DisplayForce
IMAP_SERVER   = "outlook.office365.com"
IMAP_PORT     = 993
IMAP_EMAIL    = "rayanne.ernandez@globaltera.com.br"
IMAP_PASSWORD = "nfav lshi hfax jhvu"

# Supabase
SUPABASE_URL = "https://zkzpvaabjchwnnvuwuls.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprenB2YWFiamNod25udnV3dWxzIiwicm9sZSI6"
    "InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU3OTYyOSwiZXhwIjoyMDg3MTU1NjI5fQ"
    ".udqmu2DaEN_WsW1f02UOfb8G8ScshrpMSJKlWM7W11I"
)

# Configurações gerais
INTERVALO_MINUTOS = 10
DOWNLOAD_DIR      = Path("./downloads_displayforce")
LOG_FILE          = "bot_displayforce.log"
TIMEOUT_EMAIL_SEG = 300   # aguarda até 5 min pelo e-mail da DisplayForce
HEADLESS          = True  # False para ver o browser (debug)

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
    res = sb.table("campaigns").upsert(
        registros,
        on_conflict="client_id,name,start_date,end_date"
    ).execute()
    count = len(res.data) if res.data else 0
    log.info(f"  ✅ {count} campanhas salvas no Supabase")
    return count


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
        "name":          ["MIDIA_VALIDADA", "MÍDIA_VALIDADA", "MIDIA VALIDADA", "Campanha", "Campaign"],
        "start_date":    ["INICIO_EXIBIÇÃO", "INÍCIO_EXIBIÇÃO", "INICIO EXIBIÇÃO", "Início", "Start"],
        "end_date":      ["FIM_EXIBIÇÃO", "FIM EXIBIÇÃO", "Fim", "End"],
        "duration_days": ["Tempo (Dias)", "TEMPO (DIAS)", "Dias", "Duration Days"],
        "duration_hms":  ["Tempo (hh:mm:ss)", "TEMPO (HH:MM:SS)", "Tempo Total", "Duration"],
        "visitors":      ["VISITANTES", "Visitantes", "Visitors"],
        "avg_attention": ["TEMPO_MED ATENÇÃO (mm:ss)", "TEMPO_MED_ATENÇÃO", "TEMPO MED ATENÇÃO",
                          "Atenção (mm:ss)", "Avg Attention"],
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
        nome = str(row.get(mapa["name"], "")).strip() if mapa["name"] else ""
        if not nome or nome.lower() == "nan":
            continue

        reg = {
            "client_id":         client_id,
            "name":              nome,
            "start_date":        parse_data(row.get(mapa["start_date"])) if mapa["start_date"] else None,
            "end_date":          parse_data(row.get(mapa["end_date"]))   if mapa["end_date"]   else None,
            "duration_days":     _to_float(row.get(mapa["duration_days"])) if mapa["duration_days"] else None,
            "duration_hms":      str(row.get(mapa["duration_hms"], "")).strip() if mapa["duration_hms"] else None,
            "visitors":          _to_int(row.get(mapa["visitors"])) if mapa["visitors"] else 0,
            "avg_attention_sec": parse_tempo_atencao(row.get(mapa["avg_attention"], "")) if mapa["avg_attention"] else 0,
            "synced_at":         agora,
        }
        registros.append(reg)

    log.info(f"  {len(registros)} campanhas extraídas do Excel")
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


# ──────────────────────────────────────────────────────────────
# IMAP + DOWNLOAD — aguardar e-mail e baixar o arquivo
# ──────────────────────────────────────────────────────────────

def _obter_ultimo_uid() -> int:
    """Retorna UID da mensagem mais recente para ignorar e-mails antigos."""
    try:
        with imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT) as imap:
            imap.login(IMAP_EMAIL, IMAP_PASSWORD)
            imap.select("INBOX")
            _, data = imap.search(None, "ALL")
            uids   = data[0].split()
            ultimo = int(uids[-1]) if uids else 0
            log.info(f"  📬 IMAP conectado — {len(uids)} e-mails na caixa, último UID: {ultimo}")
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


def _extrair_zip(conteudo_bytes: bytes, ts: str) -> str | None:
    """Extrai o primeiro Excel/CSV de um ZIP em memória. Retorna caminho ou None."""
    try:
        with zipfile.ZipFile(io.BytesIO(conteudo_bytes)) as z:
            membros = [m for m in z.namelist() if Path(m).suffix.lower() in (".xlsx", ".xls", ".csv")]
            if not membros:
                log.warning(f"  ZIP não contém Excel/CSV. Arquivos dentro: {z.namelist()}")
                return None
            membro  = membros[0]
            ext     = Path(membro).suffix.lower()
            destino = DOWNLOAD_DIR / f"relatorio_{ts}{ext}"
            destino.write_bytes(z.read(membro))
            log.info(f"  📂 Extraído do ZIP: {membro} → {destino}")
            return str(destino)
    except zipfile.BadZipFile as e:
        log.error(f"  ZIP inválido: {e}")
        return None


def _baixar_arquivo_url(url: str) -> str | None:
    """
    Faz GET na URL e salva o arquivo em DOWNLOAD_DIR.
    Se for ZIP, extrai o primeiro Excel/CSV encontrado.
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
            resultado = _extrair_zip(conteudo, ts)
            if resultado:
                return resultado
            # Fallback: salva o ZIP mesmo assim
            destino = DOWNLOAD_DIR / f"relatorio_{ts}.zip"
            destino.write_bytes(conteudo)
            log.warning(f"  ⚠️  ZIP sem Excel/CSV — salvo como: {destino}")
            return str(destino)

        destino = DOWNLOAD_DIR / f"relatorio_{ts}{ext}"
        destino.write_bytes(conteudo)
        log.info(f"  ✅ Arquivo salvo: {destino}")
        return str(destino)

    except requests.RequestException as e:
        log.error(f"  ❌ Erro ao baixar arquivo: {e}")
        return None


def _verificar_email_displayforce(apos_uid: int) -> str | None:
    """
    Verifica e-mails novos da DisplayForce.
    Tenta primeiro anexo (compatibilidade futura), depois extrai link do corpo HTML.
    """
    with imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT) as imap:
        imap.login(IMAP_EMAIL, IMAP_PASSWORD)
        imap.select("INBOX")

        _, data = imap.search(None, f"UID {apos_uid + 1}:*")
        uids    = [u for u in data[0].split() if int(u) > apos_uid]

        if uids:
            log.info(f"  📨 {len(uids)} e-mail(s) novo(s) encontrado(s)")

        for uid in reversed(uids):  # mais recentes primeiro
            _, msg_data = imap.fetch(uid, "(RFC822)")
            msg = email.message_from_bytes(msg_data[0][1])

            assunto   = str(msg.get("Subject", "")).lower()
            remetente = str(msg.get("From",    "")).lower()

            eh_displayforce = (
                "displayforce" in remetente
                or "displ"       in remetente
                or "noreply"     in remetente   # noreply@displ.com
                or "displ"       in assunto
                or "displayforce" in assunto
                or "relatório"   in assunto
                or "relatorio"   in assunto
                or "report"      in assunto
                or "visitors"    in assunto
                or "visitor"     in assunto
            )

            if not eh_displayforce:
                log.debug(f"  E-mail UID {uid} ignorado — de: {remetente} | assunto: {assunto}")
                continue

            log.info(f"  ✉️  E-mail DisplayForce detectado (UID {uid}) | assunto: '{assunto}'")

            # ── Tenta encontrar anexo direto ──────────────────────────────
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            for part in msg.walk():
                ct   = part.get_content_type()
                nome = part.get_filename() or ""
                ext  = Path(nome).suffix.lower()

                if ext in (".xlsx", ".xls", ".csv", ".zip") or ct in (
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "application/vnd.ms-excel",
                    "application/zip",
                    "text/csv",
                ):
                    payload = part.get_payload(decode=True)
                    if not payload:
                        continue
                    log.info(f"  📎 Anexo encontrado: {nome}")
                    if ext == ".zip" or ct == "application/zip":
                        resultado = _extrair_zip(payload, ts)
                        if resultado:
                            return resultado
                    else:
                        destino = DOWNLOAD_DIR / f"relatorio_{ts}{ext or '.xlsx'}"
                        destino.write_bytes(payload)
                        log.info(f"  📁 Anexo salvo: {destino}")
                        return str(destino)

            # ── Sem anexo → extrai link do corpo HTML e baixa ─────────────
            log.info("  📧 Sem anexo — buscando link de download no corpo do e-mail...")
            link = _extrair_link_download(msg)
            if link:
                caminho = _baixar_arquivo_url(link)
                if caminho:
                    return caminho
            else:
                log.warning("  ⚠️  E-mail DisplayForce sem link/anexo reconhecível")

    return None


def baixar_relatorio_email(timeout_seg: int = TIMEOUT_EMAIL_SEG) -> str | None:
    """
    Aguarda o e-mail da DisplayForce e retorna o caminho do arquivo baixado.
    Verifica a caixa IMAP a cada 15 segundos até timeout_seg.
    """
    log.info(f"  Aguardando e-mail com relatório em {IMAP_EMAIL}...")
    DOWNLOAD_DIR.mkdir(exist_ok=True)
    inicio     = time.time()
    ultimo_uid = _obter_ultimo_uid()

    while time.time() - inicio < timeout_seg:
        try:
            caminho = _verificar_email_displayforce(ultimo_uid)
            if caminho:
                log.info(f"  ✅ Relatório baixado: {caminho}")
                return caminho
        except Exception as e:
            log.warning(f"  Erro ao verificar e-mail: {e}")
        time.sleep(15)

    log.error(f"  ⏱️  Timeout: nenhum e-mail da DisplayForce recebido em {timeout_seg}s")
    return None


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
        try:
            page.locator("button:visible, a:visible").filter(
                has_text=re.compile(r"inserir.?email|manual|add.?email", re.I)
            ).first.click(timeout=5000)
            log.info("  ✔ Clicado: 'Inserir email manualmente'")
            page.wait_for_timeout(800)
        except Exception:
            pass

        # Preenche campo de e-mail
        preencheu = False
        try:
            campo = page.locator("input[type='email']:visible, input[placeholder*='mail']:visible").first
            campo.fill(RELATORIO_EMAIL)
            preencheu = True
        except Exception:
            pass

        if not preencheu:
            inputs = page.locator("input:visible").all()
            if inputs:
                inputs[-1].fill(RELATORIO_EMAIL)
                log.warning("  Preencheu último input disponível como e-mail (fallback)")

        page.wait_for_timeout(800)
        _screenshot(page, "11_pre_confirmar", nome_cliente)

        # ── 7. Confirmar envio ────────────────────────────────────────────
        try:
            page.locator("button:visible").filter(
                has_text=re.compile(r"enviar|send|confirmar|ok|submit", re.I)
            ).last.click(timeout=5000)
            log.info("  ✔ Confirmação clicada")
        except Exception:
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

                caminho_arquivo = baixar_relatorio_email()
                if not caminho_arquivo:
                    log.error(f"  Relatório não recebido para '{nome_cliente}'")
                    continue

                registros = processar_excel(caminho_arquivo, client_id)
                if not registros:
                    log.warning(f"  Nenhum dado extraído do Excel de '{nome_cliente}'")
                    continue

                upsert_campanhas(registros)

                try:
                    os.remove(caminho_arquivo)
                except Exception:
                    pass

            browser.close()

        log.info(f"✅ Rodada concluída — próxima em {INTERVALO_MINUTOS} minutos")

    except Exception as e:
        log.exception(f"❌ Erro inesperado na rodada: {e}")
    finally:
        _bot_lock.release()


# ──────────────────────────────────────────────────────────────
# SCHEDULER
# ──────────────────────────────────────────────────────────────

def main():
    log.info("🚀 Bot DisplayForce iniciado")
    log.info(f"   Intervalo: a cada {INTERVALO_MINUTOS} minutos")
    log.info(f"   Clientes: buscados dinamicamente do Supabase")
    log.info(f"   Relatório enviado para: {RELATORIO_EMAIL}")

    DOWNLOAD_DIR.mkdir(exist_ok=True)

    executar_bot()

    schedule.every(INTERVALO_MINUTOS).minutes.do(executar_bot)

    log.info(f"⏰ Agendamento ativo — rodando a cada {INTERVALO_MINUTOS} min (Ctrl+C para parar)")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()