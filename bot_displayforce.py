#!/usr/bin/env python3
"""
==============================================================
  BOT DISPLAYFORCE → PAINEL DE OPERAÇÕES
  Sincronização automática de campanhas a cada 10 minutos
==============================================================
  Fluxo:
    1. Busca clientes ativos no Supabase
    2. Acessa DisplayForce e exporta relatório via e-mail
    3. Lê o e-mail com o anexo Excel
    4. Processa os dados e insere na tabela `campaigns` do Supabase
    5. O widget "Engajamento em Campanhas" no dashboard é atualizado automaticamente
==============================================================
  REQUISITOS:
    pip install playwright supabase pandas openpyxl schedule imap-tools
    playwright install chromium
==============================================================
"""

import os
import re
import time
import imaplib
import email
import tempfile
import logging
import schedule
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
from supabase import create_client, Client
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# ──────────────────────────────────────────────────────────────
# CONFIGURAÇÕES — edite apenas esta seção
# ──────────────────────────────────────────────────────────────

# DisplayForce
DISPLAYFORCE_URL    = "https://id.displayforce.ai/#/platforms"
DISPLAYFORCE_EMAIL  = "bruno.lyra@globaltera.com.br"
DISPLAYFORCE_PASS   = "Tony@2023"
RELATORIO_EMAIL     = "rayanne.ernandez@globaltera.com.br"  # e-mail que recebe o relatório

# E-mail IMAP para receber o relatório da DisplayForce
# Senha no formato "xxxx xxxx xxxx xxxx" = Google App Password (Gmail/Workspace)
IMAP_SERVER         = "imap.gmail.com"
IMAP_PORT           = 993
IMAP_EMAIL          = "rayanne.ernandez@globaltera.com.br"  # e-mail completo para login IMAP
IMAP_PASSWORD       = "nfav lshi hfax jhvu"                 # Google App Password

# Supabase
SUPABASE_URL        = "https://zkzpvaabjchwnnvuwuls.supabase.co"
SUPABASE_KEY        = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprenB2YWFiamNod25udnV3dWxzIiwicm9sZSI6"
    "InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU3OTYyOSwiZXhwIjoyMDg3MTU1NjI5fQ"
    ".udqmu2DaEN_WsW1f02UOfb8G8ScshrpMSJKlWM7W11I"
)

# Configurações gerais
INTERVALO_MINUTOS   = 10         # frequência de atualização
DOWNLOAD_DIR        = Path("./downloads_displayforce")
LOG_FILE            = "bot_displayforce.log"
TIMEOUT_EMAIL_SEG   = 300        # aguarda até 5 min pelo e-mail da DisplayForce
HEADLESS            = True       # False para ver o browser abrindo (útil para debug)

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
    """Retorna todos os clientes ativos do Supabase."""
    sb = get_supabase()
    res = sb.table("clients").select("id, name").eq("status", "active").execute()
    clientes = res.data or []
    log.info(f"Clientes encontrados no Supabase: {[c['name'] for c in clientes]}")
    return clientes


def upsert_campanhas(registros: list[dict]) -> int:
    """Insere/atualiza campanhas no Supabase. Retorna quantidade de registros salvos."""
    if not registros:
        return 0
    sb = get_supabase()
    # Usa upsert com a constraint única (client_id, name, start_date, end_date)
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
    """Converte 'mm:ss' → segundos. Ex: '00:30' → 30, '01:15' → 75."""
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
    """Converte datas no formato 'DD/MM/YYYY HH:MM:SS' para ISO 8601."""
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
    """
    Lê o Excel da DisplayForce e retorna lista de registros no formato da tabela campaigns.

    Colunas esperadas no Excel:
        MIDIA_VALIDADA | INICIO_EXIBIÇÃO | FIM_EXIBIÇÃO | Tempo (Dias) |
        Tempo (hh:mm:ss) | VISITANTES | TEMPO_MED ATENÇÃO (mm:ss)
    """
    log.info(f"  Processando Excel: {caminho_arquivo}")
    try:
        # Tenta ler como xlsx; se falhar, tenta como csv
        try:
            df = pd.read_excel(caminho_arquivo, engine="openpyxl")
        except Exception:
            df = pd.read_csv(caminho_arquivo, sep=";", encoding="latin-1")
    except Exception as e:
        log.error(f"  Erro ao ler arquivo: {e}")
        return []

    # Normaliza nomes das colunas (remove espaços extras, acentos parciais etc.)
    df.columns = [str(c).strip() for c in df.columns]
    log.info(f"  Colunas encontradas: {list(df.columns)}")

    # Mapeamento flexível de colunas
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
            # busca parcial
            for col in df.columns:
                if op.lower() in col.lower():
                    return col
        return None

    mapa = {campo: encontrar_coluna(df, opcoes) for campo, opcoes in COL_MAP.items()}
    log.info(f"  Mapeamento de colunas: {mapa}")

    registros = []
    agora = datetime.now(timezone.utc).isoformat()

    for _, row in df.iterrows():
        nome = str(row.get(mapa["name"], "")).strip() if mapa["name"] else ""
        if not nome or nome.lower() == "nan":
            continue

        reg = {
            "client_id":         client_id,
            "name":              nome,
            "start_date":        parse_data(row.get(mapa["start_date"])) if mapa["start_date"] else None,
            "end_date":          parse_data(row.get(mapa["end_date"])) if mapa["end_date"] else None,
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
# IMAP — aguardar e baixar o e-mail da DisplayForce
# ──────────────────────────────────────────────────────────────

def baixar_relatorio_email(timeout_seg: int = TIMEOUT_EMAIL_SEG) -> str | None:
    """
    Aguarda o e-mail da DisplayForce e retorna o caminho do arquivo baixado.
    Verifica a caixa de entrada do IMAP a cada 15 segundos.
    """
    log.info(f"  Aguardando e-mail com relatório em {IMAP_EMAIL}...")
    DOWNLOAD_DIR.mkdir(exist_ok=True)
    inicio = time.time()
    ultimo_uid = _obter_ultimo_uid()

    while time.time() - inicio < timeout_seg:
        try:
            caminho = _verificar_email_displayforce(ultimo_uid)
            if caminho:
                log.info(f"  Relatório baixado: {caminho}")
                return caminho
        except Exception as e:
            log.warning(f"  Erro ao verificar e-mail: {e}")
        time.sleep(15)

    log.error("  ⏱️  Timeout: nenhum e-mail da DisplayForce recebido")
    return None


def _obter_ultimo_uid() -> int:
    """Retorna o UID da mensagem mais recente para ignorar e-mails antigos."""
    try:
        with imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT) as imap:
            imap.login(IMAP_EMAIL, IMAP_PASSWORD)
            imap.select("INBOX")
            _, data = imap.search(None, "ALL")
            uids = data[0].split()
            uid_atual = int(uids[-1]) if uids else 0
            log.info(f"  📬 IMAP conectado — {len(uids)} e-mails na caixa, último UID: {uid_atual}")
            return uid_atual
    except Exception as e:
        log.error(f"  ❌ Erro ao conectar ao IMAP ({IMAP_SERVER}) com {IMAP_EMAIL}: {e}")
        return 0


def _verificar_email_displayforce(apos_uid: int) -> str | None:
    """Verifica se chegou e-mail novo da DisplayForce com anexo Excel/ZIP."""
    with imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT) as imap:
        imap.login(IMAP_EMAIL, IMAP_PASSWORD)
        imap.select("INBOX")

        # Busca e-mails novos
        _, data = imap.search(None, f"UID {apos_uid + 1}:*")
        uids = [u for u in data[0].split() if int(u) > apos_uid]

        for uid in reversed(uids):  # mais recentes primeiro
            _, msg_data = imap.fetch(uid, "(RFC822)")
            msg = email.message_from_bytes(msg_data[0][1])
            assunto = str(msg.get("Subject", "")).lower()

            # Identifica e-mails da DisplayForce
            remetente = str(msg.get("From", "")).lower()
            eh_displayforce = (
                "displayforce" in remetente
                or "displayforce" in assunto
                or "relatório" in assunto
                or "report" in assunto
                or "visitors" in assunto
            )
            if not eh_displayforce:
                continue

            # Procura anexo Excel ou ZIP
            for part in msg.walk():
                ct = part.get_content_type()
                nome = part.get_filename() or ""
                extensao = Path(nome).suffix.lower()

                if extensao in (".xlsx", ".xls", ".csv", ".zip") or ct in (
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "application/vnd.ms-excel",
                    "application/zip",
                    "text/csv",
                ):
                    payload = part.get_payload(decode=True)
                    if not payload:
                        continue

                    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                    destino = DOWNLOAD_DIR / f"relatorio_{ts}{extensao}"

                    # Se for ZIP, extrai o primeiro Excel/CSV
                    if extensao == ".zip" or ct == "application/zip":
                        import zipfile, io
                        with zipfile.ZipFile(io.BytesIO(payload)) as z:
                            for member in z.namelist():
                                if Path(member).suffix.lower() in (".xlsx", ".xls", ".csv"):
                                    destino = DOWNLOAD_DIR / f"relatorio_{ts}{Path(member).suffix.lower()}"
                                    destino.write_bytes(z.read(member))
                                    return str(destino)
                    else:
                        destino.write_bytes(payload)
                        return str(destino)

    return None


# ──────────────────────────────────────────────────────────────
# PLAYWRIGHT — automação do browser na DisplayForce
# ──────────────────────────────────────────────────────────────

def _clicar_texto(page, opcoes: list, timeout_ms: int = 8000, descricao: str = "") -> bool:
    """Tenta clicar num elemento por uma lista de textos possíveis. Retorna True se clicou."""
    for texto in opcoes:
        try:
            el = page.get_by_text(texto, exact=False).first
            if el.is_visible(timeout=timeout_ms):
                el.click()
                log.info(f"  ✔ Clicado: '{texto}'" + (f" ({descricao})" if descricao else ""))
                return True
        except Exception:
            continue
    return False


def exportar_relatorio_cliente(page, nome_cliente: str, data_inicio: str, data_fim: str) -> bool:
    """
    Navega até o cliente na DisplayForce e exporta o relatório Visitors Insights.
    Retorna True se exportou com sucesso.
    """
    try:
        log.info(f"  Exportando relatório para: {nome_cliente}")

        # ── 1. Garante que estamos na lista de plataformas ───────────────
        # Volta sempre para a página principal antes de cada cliente
        if "id.displayforce.ai" not in page.url or "platforms" not in page.url:
            page.goto("https://id.displayforce.ai/#/platforms")
            page.wait_for_timeout(4000)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass

        page.wait_for_timeout(2000)

        # Rola para carregar todos os cards
        for _ in range(6):
            page.keyboard.press("End")
            page.wait_for_timeout(600)
        page.keyboard.press("Home")
        page.wait_for_timeout(800)

        # Lista TODOS os textos da página para diagnóstico completo
        try:
            todos_textos = page.locator("body").all_text_contents()
            texto_pagina = " | ".join(todos_textos)[:3000]
            log.info(f"  📄 Conteúdo completo da página (trecho): {texto_pagina[:800]}")
        except Exception:
            pass

        _screenshot_debug(page, f"01_plataformas_{nome_cliente}")

        # ── 2. Navega diretamente pelo href do link do cliente ────────────
        # Pegar o href evita problemas com eventos de clique em SPAs React
        nome_lower = nome_cliente.strip().lower()
        url_antes_clique = page.url
        cliente_clicado = False

        # Extrai o href do link da plataforma via JS
        href_cliente = page.evaluate(f"""
            () => {{
                const alvo = '{nome_lower}';
                // Tenta primeiro pelos links com classe platformName (descoberto no debug)
                const seletores = [
                    'a[class*="platformName"]',
                    'a[class*="platform"]',
                    'a[href*="platform"]',
                    'li a', 'a'
                ];
                for (const sel of seletores) {{
                    const links = document.querySelectorAll(sel);
                    for (const link of links) {{
                        const txt = link.textContent.trim().toLowerCase();
                        if (txt === alvo || txt.includes(alvo)) {{
                            // Retorna href absoluto ou relativo
                            return link.href || link.getAttribute('href');
                        }}
                    }}
                }}
                return null;
            }}
        """)

        log.info(f"  href encontrado para '{nome_lower}': {href_cliente}")

        if href_cliente and href_cliente not in ("", "javascript:void(0)", "#", None):
            # Navega diretamente para o URL do cliente
            page.goto(href_cliente)
            page.wait_for_timeout(4000)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            page.wait_for_timeout(2000)

            if page.url != url_antes_clique:
                cliente_clicado = True
                log.info(f"  ✔ Navegou via href direto: {page.url}")
            else:
                log.warning(f"  ⚠ goto não mudou URL, ainda em: {page.url}")
        else:
            log.warning(f"  href inválido ou não encontrado: '{href_cliente}'")

        # Fallback: tenta subdomain (padrão: https://{slug}.displayforce.ai/)
        if not cliente_clicado:
            for slug in [nome_lower.strip(), nome_lower.strip().replace(" ", "")]:
                for padrao_url in [
                    f"https://{slug}.displayforce.ai/",
                    f"https://{slug}.displayforce.ai/n/#/",
                    f"https://id.displayforce.ai/#/platform/{slug}",
                ]:
                    try:
                        log.info(f"  Tentando URL direta: {padrao_url}")
                        page.goto(padrao_url)
                        page.wait_for_timeout(4000)
                        try:
                            page.wait_for_load_state("networkidle", timeout=10000)
                        except Exception:
                            pass
                        url_atual = page.url
                        # Sucesso se não voltou para login nem para a lista de plataformas do id.
                        nao_voltou = (
                            "login" not in url_atual.lower() and
                            url_atual != url_antes_clique and
                            not (url_atual.rstrip("/") == "https://id.displayforce.ai/#/platforms")
                        )
                        if nao_voltou:
                            cliente_clicado = True
                            log.info(f"  ✔ Navegou via URL direta: {url_atual}")
                            break
                    except Exception:
                        continue
                if cliente_clicado:
                    break

        if not cliente_clicado:
            _screenshot_debug(page, f"02_sem_cliente_{nome_cliente}")
            # Volta para a lista de plataformas
            page.goto("https://id.displayforce.ai/#/platforms")
            page.wait_for_timeout(2000)
            log.warning(f"  ❌ Não foi possível navegar até '{nome_cliente}' — pulando")
            return False

        # Aguarda a página do cliente carregar (SPA)
        page.wait_for_timeout(4000)
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(2000)
        _screenshot_debug(page, f"03_cliente_aberto_{nome_cliente}")
        log.info(f"  URL após abrir cliente: {page.url}")

        # ── DIAGNÓSTICO: imprime textos do menu/sidebar ────────────────────
        try:
            textos = page.locator("a, button, li, nav *, [class*='menu'] *, [class*='sidebar'] *").all_text_contents()
            textos_limpos = [t.strip() for t in textos if t.strip() and len(t.strip()) < 80]
            unicos = list(dict.fromkeys(textos_limpos))[:60]
            log.info(f"  📋 Textos do menu/nav ({len(unicos)}): {unicos}")
        except Exception as ex:
            log.warning(f"  Não foi possível listar textos: {ex}")

        # ── 3. Navega para Insights de Visitantes ────────────────────────
        # URL confirmada pelo DevTools: https://{slug}.displayforce.ai/n/#/stats/visitors
        # "Insights & dados" no DOM aponta para /n/#/stats/devices → trocamos por /stats/visitors
        log.info("  Navegando para Insights de Visitantes (stats/visitors)...")

        # Derivar URL: pegar href de "Insights & dados" e substituir /devices por /visitors
        href_insights_dados = page.evaluate("""
            () => {
                for (const a of document.querySelectorAll('a[href]')) {
                    const txt = (a.textContent || '').trim().toLowerCase();
                    if (txt.includes('insights') && txt.includes('dados')) {
                        return a.href;
                    }
                }
                return null;
            }
        """)
        log.info(f"  href 'Insights & dados': {href_insights_dados}")

        if href_insights_dados and '/stats/' in str(href_insights_dados):
            url_visitors_direto = href_insights_dados.replace('/stats/devices', '/stats/visitors').split('?')[0]
        else:
            # Fallback: construir a partir da URL atual
            url_atual_base = page.url
            if '/n/#' in url_atual_base:
                url_visitors_direto = url_atual_base.split('/n/#')[0] + '/n/#/stats/visitors'
            else:
                partes = url_atual_base.rstrip('/').rstrip('#').rstrip('/')
                url_visitors_direto = partes + '/n/#/stats/visitors'

        log.info(f"  URL Visitors Insights calculada: {url_visitors_direto}")
        page.goto(url_visitors_direto)
        page.wait_for_timeout(4000)
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        log.info(f"  ✔ Navegou para: {page.url}")

        _screenshot_debug(page, f"06_visitors_aberto_{nome_cliente}")
        log.info(f"  URL após Visitors Insights: {page.url}")

        # ── DIAGNÓSTICO: mostra textos da página Visitors Insights ────────
        try:
            textos_vis = page.locator("button, a, [class*='btn'], [role='button']").all_text_contents()
            textos_limpos = [t.strip() for t in textos_vis if t.strip() and len(t.strip()) < 100]
            unicos = list(dict.fromkeys(textos_limpos))
            log.info(f"  📋 Botões/links na página ({len(unicos)}): {unicos[:30]}")
        except Exception:
            pass

        # ── 5. Selecionar período nos filtros ─────────────────────────────
        _selecionar_periodo(page, data_inicio, data_fim)
        page.wait_for_timeout(1500)

        # ── 6. Clicar em "Enviar relatório" / "Export" ───────────────────
        _screenshot_debug(page, f"07_pre_enviar_{nome_cliente}")

        # Diagnóstico: lista todos os botões visíveis para encontrar o nome certo
        try:
            btns = page.locator("button:visible, [role='button']:visible, a:visible").all_text_contents()
            btns_limpos = list(dict.fromkeys([b.strip() for b in btns if b.strip() and len(b.strip()) < 80]))
            log.info(f"  📋 Botões visíveis na página: {btns_limpos[:25]}")
        except Exception:
            pass

        enviar_clicado = _clicar_texto(page, [
            "ENVIAR RELATÓRIO",    # confirmado no DevTools (all-caps)
            "ENVIAR RELATORIO",
            "Enviar relatório",
            "Enviar Relatório",
            "Enviar por e-mail",
            "Enviar por email",
            "Exportar relatório",
            "Exportar",
            "Export",
            "Enviar",
            "Send",
            "Download",
            "Relatório",
        ], timeout_ms=5000, descricao="botão exportar")

        if not enviar_clicado:
            # Tenta por data-for, aria-label / SVG icon buttons
            for sel_export in [
                "button[data-for='sendReport']",   # confirmado no DevTools
                "[data-for='sendReport']",
                "button[aria-label*='envi']",
                "button[aria-label*='ENVI']",
                "button[aria-label*='export']",
                "button[aria-label*='relat']",
                "button[title*='envi']",
                "button[title*='export']",
                "[data-testid*='export']",
                "[data-testid*='send']",
                "[data-testid*='relat']",
            ]:
                try:
                    el = page.locator(sel_export).first
                    if el.is_visible(timeout=2000):
                        el.click()
                        log.info(f"  ✔ Botão export clicado via {sel_export}")
                        enviar_clicado = True
                        break
                except Exception:
                    continue

        if not enviar_clicado:
            _screenshot_debug(page, f"08_sem_botao_enviar_{nome_cliente}")
            log.error("  ❌ Botão de enviar relatório não encontrado — veja screenshot e log de botões acima")
            return False

        page.wait_for_timeout(2000)
        _screenshot_debug(page, f"10_modal_email_{nome_cliente}")

        # ── 7. Clicar em "Inserir email manualmente" ──────────────────────
        _clicar_texto(page, [
            "Inserir email manualmente",
            "Inserir e-mail manualmente",
            "email manualmente",
            "Outro email",
            "Inserir email",
            "Manual",
        ], timeout_ms=5000, descricao="inserir email")
        page.wait_for_timeout(800)

        # ── 8. Preencher o campo de e-mail ────────────────────────────────
        email_preenchido = False
        for sel_email in [
            "input[type='email']",
            "input[placeholder*='email']",
            "input[placeholder*='Email']",
            "input[placeholder*='e-mail']",
            "input[placeholder*='Digite']",
        ]:
            try:
                inp = page.locator(sel_email).first
                if inp.is_visible(timeout=3000):
                    inp.click()
                    inp.fill(RELATORIO_EMAIL)
                    email_preenchido = True
                    log.info(f"  ✔ E-mail preenchido: {RELATORIO_EMAIL}")
                    break
            except Exception:
                continue

        if not email_preenchido:
            # Fallback: preenche qualquer input visível que pareça ser e-mail
            inputs = page.locator("input:visible").all()
            for inp in inputs:
                ph = (inp.get_attribute("placeholder") or "").lower()
                tp = (inp.get_attribute("type") or "").lower()
                if "email" in ph or "e-mail" in ph or tp == "email":
                    inp.fill(RELATORIO_EMAIL)
                    email_preenchido = True
                    break
            if not email_preenchido and inputs:
                inputs[-1].fill(RELATORIO_EMAIL)
                email_preenchido = True
                log.warning("  Preencheu último input disponível como e-mail (fallback)")

        page.wait_for_timeout(500)

        # ── 9. Confirmar envio ────────────────────────────────────────────
        _screenshot_debug(page, f"11_pre_confirmar_{nome_cliente}")
        confirmado = False
        for nome_btn in [
            re.compile(r"^enviar$", re.I),
            re.compile(r"enviar relatório|enviar relatorio", re.I),
            re.compile(r"send|confirmar|ok|salvar", re.I),
        ]:
            try:
                btn = page.get_by_role("button", name=nome_btn).first
                if btn.is_visible(timeout=3000):
                    btn.click()
                    confirmado = True
                    log.info(f"  ✔ Confirmação clicada")
                    break
            except Exception:
                continue

        if not confirmado:
            page.keyboard.press("Enter")
            log.info("  Enter pressionado para confirmar")

        page.wait_for_timeout(3000)
        _screenshot_debug(page, f"12_pos_envio_{nome_cliente}")
        log.info(f"  ✅ Relatório enviado para {RELATORIO_EMAIL}")

        # ── 10. Voltar à lista de plataformas ─────────────────────────────
        try:
            page.goto("https://id.displayforce.ai/#/platforms")
            page.wait_for_timeout(3000)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass
        except Exception:
            pass

        return True

    except Exception as e:
        log.error(f"  Erro ao exportar '{nome_cliente}': {e}")
        _screenshot_debug(page, f"erro_{nome_cliente}")
        try:
            page.goto("https://id.displayforce.ai/#/platforms")
            page.wait_for_timeout(3000)
        except Exception:
            pass
        return False


def _selecionar_periodo(page, data_inicio: str, data_fim: str):
    """Seleciona o período nos filtros de data da DisplayForce."""
    try:
        # Tenta clicar no filtro de data / date picker
        date_picker = page.locator(
            "[data-testid*='date'], [aria-label*='data'], [aria-label*='date'], "
            ".date-picker, .filter-date, button:has-text('Período'), "
            "button:has-text('Data'), button:has-text('Filtro')"
        ).first

        if date_picker.is_visible(timeout=3000):
            date_picker.click()
            page.wait_for_timeout(800)

            # Preenche data início
            inputs = page.locator("input[type='date'], input[placeholder*='DD'], input[placeholder*='início']").all()
            if len(inputs) >= 2:
                inputs[0].fill(data_inicio)
                inputs[1].fill(data_fim)
            elif len(inputs) == 1:
                inputs[0].fill(data_inicio)

            # Confirma seleção
            try:
                page.get_by_role("button", name=re.compile(r"aplicar|apply|ok|confirmar", re.I)).click(timeout=3000)
            except Exception:
                pass
    except Exception:
        pass  # Continua mesmo sem selecionar o filtro


def _screenshot_debug(page, nome: str):
    """Salva screenshot para debug quando algo falha."""
    try:
        DOWNLOAD_DIR.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        caminho = str(DOWNLOAD_DIR / f"debug_{nome}_{ts}.png")
        page.screenshot(path=caminho)
        log.info(f"  📸 Screenshot salvo: {caminho}")
    except Exception:
        pass


def fazer_login_displayforce(page) -> bool:
    """Realiza login na DisplayForce. Retorna True se bem-sucedido."""
    log.info("Acessando DisplayForce...")

    # SPAs com hash-routing precisam do URL base sem o hash
    url_base = "https://id.displayforce.ai/"
    page.goto(url_base)

    # Aguarda o JavaScript carregar (SPA demora para renderizar)
    page.wait_for_timeout(5000)

    # Se a página redirecionar para alguma rota, aguarda estabilizar
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        pass
    page.wait_for_timeout(3000)

    log.info(f"  URL atual: {page.url}")

    try:
        # ── Estratégia 1: aguarda qualquer input aparecer (SPA pode demorar) ──
        try:
            page.wait_for_selector("input", timeout=20000)
        except Exception:
            log.warning("  Nenhum input encontrado ainda, aguardando mais 5s...")
            page.wait_for_timeout(5000)

        # ── Encontra campo de e-mail com múltiplos seletores ──────────────────
        SELETORES_EMAIL = [
            "input[type='email']",
            "input[name='email']",
            "input[name='username']",
            "input[placeholder*='e-mail']",
            "input[placeholder*='email']",
            "input[placeholder*='Email']",
            "input[placeholder*='usuário']",
            "input[placeholder*='login']",
        ]
        campo_email = None
        for sel in SELETORES_EMAIL:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=2000):
                    campo_email = el
                    log.info(f"  Campo email encontrado: {sel}")
                    break
            except Exception:
                continue

        # Fallback: pega o primeiro input visível
        if not campo_email:
            inputs_visiveis = page.locator("input:visible").all()
            if inputs_visiveis:
                campo_email = inputs_visiveis[0]
                log.info("  Usando primeiro input visível como campo de e-mail")

        if not campo_email:
            _screenshot_debug(page, "sem_input")
            log.error("  ❌ Não foi possível encontrar o campo de e-mail")
            return False

        campo_email.click()
        campo_email.fill(DISPLAYFORCE_EMAIL)
        page.wait_for_timeout(800)

        # ── Verifica se senha já está visível (login 1 etapa) ─────────────────
        senha_visivel = False
        try:
            campo_senha_teste = page.locator("input[type='password']").first
            senha_visivel = campo_senha_teste.is_visible(timeout=2000)
        except Exception:
            senha_visivel = False

        # ── Se senha NÃO visível: login em 2 etapas — clica em Próximo/Enter ──
        if not senha_visivel:
            log.info("  Login em 2 etapas: procurando botão Próximo/Continuar...")
            btn_proximo_clicado = False
            for nome_btn in [
                re.compile(r"próximo|proximo|next|continuar|continue|avançar", re.I),
                re.compile(r"entrar|login|sign.?in|acessar", re.I),
            ]:
                try:
                    btn = page.get_by_role("button", name=nome_btn).first
                    if btn.is_visible(timeout=3000):
                        btn.click()
                        btn_proximo_clicado = True
                        log.info(f"  Botão '{nome_btn.pattern}' clicado")
                        break
                except Exception:
                    continue

            if not btn_proximo_clicado:
                # Tenta submit ou Enter como fallback
                try:
                    page.locator("button[type='submit']").first.click(timeout=3000)
                    btn_proximo_clicado = True
                except Exception:
                    page.keyboard.press("Enter")
                    btn_proximo_clicado = True
                    log.info("  Enter pressionado (step 1)")

            # Aguarda a tela de senha aparecer
            page.wait_for_timeout(2000)
            try:
                page.wait_for_selector("input[type='password']", timeout=15000)
                log.info("  Campo de senha apareceu (step 2)")
            except Exception:
                log.warning("  Campo de senha não apareceu após step 1")
                _screenshot_debug(page, "aguardando_senha")

        # ── Preenche senha ─────────────────────────────────────────────────────
        campo_senha = None
        try:
            campo_senha = page.locator("input[type='password']").first
            campo_senha.wait_for(state="visible", timeout=10000)
            log.info("  Campo de senha encontrado")
        except Exception:
            # Fallback: tenta qualquer input que não seja e-mail
            inputs = page.locator("input:visible").all()
            for inp in inputs:
                tipo = inp.get_attribute("type") or ""
                if tipo not in ("email", "text", "search"):
                    campo_senha = inp
                    break
            if not campo_senha and inputs:
                campo_senha = inputs[-1]  # último input visível
                log.warning("  Usando último input como campo de senha (fallback)")

        if not campo_senha:
            _screenshot_debug(page, "sem_campo_senha")
            log.error("  ❌ Campo de senha não encontrado")
            return False

        campo_senha.click()
        campo_senha.fill(DISPLAYFORCE_PASS)
        page.wait_for_timeout(500)

        # ── Botão de login (step final) ────────────────────────────────────────
        botao_clicado = False
        for nome_btn in [
            re.compile(r"entrar|login|sign.?in|acessar|confirmar", re.I),
            re.compile(r"continuar|continue|próximo|proximo|next", re.I),
        ]:
            try:
                btn = page.get_by_role("button", name=nome_btn).first
                if btn.is_visible(timeout=3000):
                    btn.click()
                    botao_clicado = True
                    log.info(f"  Botão de login clicado: '{nome_btn.pattern}'")
                    break
            except Exception:
                continue

        if not botao_clicado:
            try:
                page.locator("button[type='submit']").first.click(timeout=3000)
                botao_clicado = True
                log.info("  Botão submit clicado")
            except Exception:
                page.keyboard.press("Enter")
                botao_clicado = True
                log.info("  Enter pressionado (login final)")

        # ── Aguarda o redirecionamento pós-login ───────────────────────────────
        page.wait_for_timeout(3000)
        try:
            page.wait_for_load_state("networkidle", timeout=25000)
        except Exception:
            pass
        page.wait_for_timeout(3000)

        url_atual = page.url
        log.info(f"  URL após login: {url_atual}")

        # Verifica se saiu da tela de login
        indicadores_sucesso = ["platform", "dashboard", "home", "cliente", "client", "insight"]
        indicadores_falha   = ["login", "signin", "auth", "error"]

        url_lower = url_atual.lower()
        if any(s in url_lower for s in indicadores_sucesso):
            log.info("  ✅ Login realizado com sucesso")
            return True

        # Se a URL ainda contém indicadores de login, verifica o conteúdo da página
        if any(s in url_lower for s in indicadores_falha):
            _screenshot_debug(page, "login_falhou")
            log.error("  ❌ Login falhou — verifique as credenciais")
            return False

        # URL ambígua (SPA com hash) — verifica se há conteúdo pós-login
        try:
            # Se aparecer qualquer menu/nav ou lista de clientes, login OK
            page.wait_for_selector(
                "nav, [class*='sidebar'], [class*='menu'], [class*='platform'], [class*='client']",
                timeout=8000
            )
            log.info("  ✅ Login realizado com sucesso (conteúdo detectado)")
            return True
        except Exception:
            _screenshot_debug(page, "pos_login")
            log.warning("  ⚠️  Login pode ter funcionado — continuando (verifique screenshot)")
            return True  # Tenta continuar mesmo assim

    except Exception as e:
        _screenshot_debug(page, "erro_login")
        log.error(f"  ❌ Erro no login: {e}")
        return False


# ──────────────────────────────────────────────────────────────
# LÓGICA PRINCIPAL DO BOT
# ──────────────────────────────────────────────────────────────

def obter_periodo_atual() -> tuple[str, str]:
    """
    Retorna o período do dia atual (início do dia → fim do dia) no fuso de Brasília.
    Compatível com o filtro padrão do dashboard.
    """
    agora = datetime.now(timezone(timedelta(hours=-3)))  # UTC-3 (Brasília)
    inicio = agora.replace(hour=0, minute=0, second=0, microsecond=0)
    fim    = agora.replace(hour=23, minute=59, second=59, microsecond=0)
    # Formato aceito por inputs HTML date: YYYY-MM-DD
    return inicio.strftime("%Y-%m-%d"), fim.strftime("%Y-%m-%d")


_bot_lock = threading.Lock()


def executar_bot():
    """Execução principal do bot. Chamada pelo scheduler."""
    if not _bot_lock.acquire(blocking=False):
        log.info("⏭️  Bot já em execução, aguardando próxima rodada...")
        return

    try:
        log.info("=" * 60)
        log.info(f"🤖 Iniciando bot — {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
        log.info("=" * 60)

        # 1. Busca clientes no Supabase
        clientes = buscar_clientes()
        if not clientes:
            log.warning("Nenhum cliente ativo encontrado no Supabase.")
            return

        # 2. Período atual (hoje)
        data_inicio, data_fim = obter_periodo_atual()
        log.info(f"Período: {data_inicio} → {data_fim}")

        # 3. Abre o browser e exporta relatório para cada cliente
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=HEADLESS)
            ctx = browser.new_context(accept_downloads=True)
            page = ctx.new_page()

            if not fazer_login_displayforce(page):
                log.error("Falha no login — abortando rodada")
                browser.close()
                return

            for cliente in clientes:
                nome_cliente  = cliente["name"]
                client_id     = cliente["id"]

                exportou = exportar_relatorio_cliente(page, nome_cliente, data_inicio, data_fim)
                if not exportou:
                    continue

                # 4. Aguarda e-mail e baixa o arquivo
                caminho_arquivo = baixar_relatorio_email()
                if not caminho_arquivo:
                    log.error(f"  Relatório não recebido para '{nome_cliente}'")
                    continue

                # 5. Processa o Excel
                registros = processar_excel(caminho_arquivo, client_id)
                if not registros:
                    log.warning(f"  Nenhum dado extraído do Excel de '{nome_cliente}'")
                    continue

                # 6. Salva no Supabase
                upsert_campanhas(registros)

                # Remove arquivo temporário
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

    # Executa imediatamente ao iniciar
    executar_bot()

    # Agenda para repetir a cada X minutos
    schedule.every(INTERVALO_MINUTOS).minutes.do(executar_bot)

    log.info(f"⏰ Agendamento ativo — rodando a cada {INTERVALO_MINUTOS} min (Ctrl+C para parar)")
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
