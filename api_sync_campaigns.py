#!/usr/bin/env python3
"""
api_sync_campaigns.py
─────────────────────
Sincroniza dados de campanha diretamente via API Displayforce → Supabase.
Alternativa ao fluxo de e-mail/bot — não requer Playwright, navegador ou e-mail.

Uso:
    python api_sync_campaigns.py              # últimos 30 dias
    python api_sync_campaigns.py --days 60    # últimos 60 dias
    python api_sync_campaigns.py --test       # testa conexão e lista recursos disponíveis

.env necessário (mesmo arquivo do bot):
    VITE_DISPLAYFORCE_TOKEN      Token da API Displayforce
    SUPABASE_URL                 URL do projeto Supabase
    SUPABASE_SERVICE_ROLE_KEY    Chave de serviço (ou SUPABASE_KEY)
    CLIENTES_FALLBACK            nome|uuid,... ex: Assai|uuid1,Panvel|uuid2
"""

import os
import re
import sys
import argparse
import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("api_sync")


# ── Carrega .env ─────────────────────────────────────────────────────────────

def _load_env(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.lower().startswith("$env:"):
                line = line[5:].strip()
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and v and k not in os.environ:
                os.environ[k] = v

_load_env(".env")

API_BASE  = "https://api.displayforce.ai/public/v1"
API_TOKEN = os.environ.get("VITE_DISPLAYFORCE_TOKEN", "")
SUPA_URL  = os.environ.get("SUPABASE_URL", "")
SUPA_KEY  = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or
             os.environ.get("SUPABASE_KEY", ""))

if not API_TOKEN:
    log.error("VITE_DISPLAYFORCE_TOKEN não configurado no .env")
    sys.exit(1)
if not SUPA_URL or not SUPA_KEY:
    log.error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar no .env")
    sys.exit(1)


# ── Mapeamento de clientes ────────────────────────────────────────────────────

def _parse_clientes_fallback() -> dict:
    """Retorna {nome_lower: client_uuid} a partir de CLIENTES_FALLBACK."""
    raw = os.environ.get("CLIENTES_FALLBACK", "")
    result = {}
    for part in raw.split(","):
        part = part.strip()
        if "|" in part:
            nome, uid = part.split("|", 1)
            nome = nome.strip().lower()
            uid = uid.strip()
            if nome and uid:
                result[nome] = uid
    return result


def _load_active_clients() -> dict:
    try:
        from supabase import create_client
        sb = create_client(SUPA_URL, SUPA_KEY)
        for status in ("active", "ativo"):
            res = sb.table("clients").select("id,name,status").eq("status", status).execute()
            rows = res.data or []
            if rows:
                mapped = {str(r.get("name", "")).strip().lower(): str(r.get("id", "")).strip() for r in rows if r.get("id") and r.get("name")}
                if mapped:
                    log.info(f"Clientes ativos carregados do Supabase: {list(mapped.keys())}")
                    return mapped

        res = sb.table("clients").select("id,name,status").execute()
        rows = res.data or []
        mapped = {str(r.get("name", "")).strip().lower(): str(r.get("id", "")).strip() for r in rows if r.get("id") and r.get("name")}
        if mapped:
            log.warning(f"Nenhum cliente com status ativo/ativo. Usando clientes existentes no Supabase: {list(mapped.keys())}")
            return mapped
    except Exception as e:
        log.warning(f"Não foi possível carregar clientes do Supabase: {e}")

    fallback = _parse_clientes_fallback()
    log.warning(f"Usando CLIENTES_FALLBACK: {list(fallback.keys())}")
    return fallback

CLIENTES = _load_active_clients()


# ── Helpers da API Displayforce ───────────────────────────────────────────────

HEADERS = {
    "X-APT-Token": API_TOKEN,
    "Content-Type": "application/json",
}


def _post(endpoint: str, body: dict) -> object:
    """Faz POST e retorna o JSON parseado (lista ou dict)."""
    url = f"{API_BASE}/{endpoint.lstrip('/')}"
    resp = requests.post(url, json=body, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    return resp.json()


def _list_all(endpoint: str, body: dict, page_size: int = 1000) -> list:
    """Pagina automaticamente e retorna todos os itens da lista."""
    items = []
    offset = 0
    body = {**body, "limit": page_size}
    while True:
        body["offset"] = offset
        data = _post(endpoint, body)
        if isinstance(data, list):
            chunk = data
        elif isinstance(data, dict):
            # Suporta {'items': [...]} / {'results': [...]} / {'data': [...]}
            chunk = (data.get("items")
                     or data.get("results")
                     or data.get("data")
                     or [])
        else:
            break
        items.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return items


# ── Limpeza do nome do vídeo ──────────────────────────────────────────────────

def _clean_content_name(raw: str) -> str:
    """Remove extensão, datas, resolução e formato do nome do vídeo."""
    name = str(raw).strip()
    # Remove extensão .mp4
    name = re.sub(r'\.mp4$', '', name, flags=re.IGNORECASE)
    # Remove datas (ex: _10mar_15mar_26, -05mar_26-30mai_26)
    meses = r'(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)'
    name = re.sub(rf'(?:[_\-\s]+\d{{1,2}}{meses})+(?:[_\-]\d{{2,4}})?', '', name, flags=re.IGNORECASE)
    # Remove resolução (ex: _1080x1920, 720X1280)
    name = re.sub(r'[_\-\s]*\d{3,4}\s*[xX]\s*\d{3,4}', '', name)
    # Remove formato entre parênteses (ex: (vertical), (horizontal))
    name = re.sub(r'\s*\([^)]*(?:vertical|horizontal|vert|horiz)[^)]*\)', '', name, flags=re.IGNORECASE)
    # Remove sufixos numéricos (ex: (2))
    name = re.sub(r'\s*\(\d+\)\s*$', '', name)
    # Remove versão (ex: _v2, _v3)
    name = re.sub(r'[_\s]+v\d+$', '', name, flags=re.IGNORECASE)
    # Limpa separadores finais
    name = re.sub(r'[_\-\s]+$', '', name)
    return name.strip()


# ── Mapeamento dispositivos → loja / tipo_midia / client_id ──────────────────

def _build_device_map() -> dict:
    """
    Retorna {device_id: {loja, tipo_midia, client_id}}.

    Estratégia:
    1. Busca todas as pastas e monta hierarquia
    2. Busca todos os dispositivos
    3. Detecta client_id pelo nome do cliente no caminho da pasta (ou no nome do device)
    4. Extrai loja + tipo_midia: "Nome da Loja - TipoMidia"
    """
    # 1. Hierarquia de pastas
    try:
        folders_raw = _list_all("device-folder/list", {}, page_size=10000)
    except Exception as e:
        log.warning(f"Não foi possível buscar pastas: {e}")
        folders_raw = []

    folder_meta = {}  # id → {name, parent_id}
    for f in folders_raw:
        fid = f.get("id")
        if fid:
            folder_meta[fid] = {
                "name":      f.get("name", ""),
                "parent_id": f.get("parent_id"),
            }

    def _folder_path(folder_id) -> str:
        parts = []
        current = folder_id
        seen = set()
        while current and current not in seen:
            seen.add(current)
            f = folder_meta.get(current)
            if not f:
                break
            parts.append(f["name"].lower())
            current = f.get("parent_id")
        return "/".join(reversed(parts))

    def _detect_client(folder_id, device_name: str) -> str:
        path = _folder_path(folder_id) if folder_id else ""
        full = (path + " " + device_name).lower()
        for nome, uid in CLIENTES.items():
            if nome in full:
                return uid
        return ""

    # 2. Dispositivos
    try:
        devices_raw = _list_all("device/list", {}, page_size=10000)
    except Exception as e:
        log.error(f"Erro ao buscar dispositivos: {e}")
        return {}

    device_map = {}
    for d in devices_raw:
        did = d.get("id")
        if not did:
            continue
        name      = d.get("name", "")
        parent_id = d.get("parent_id")

        # loja + tipo_midia
        if " - " in name:
            loja, tipo_midia = name.rsplit(" - ", 1)
        else:
            loja, tipo_midia = name.strip(), ""

        client_id = _detect_client(parent_id, name)

        device_map[did] = {
            "loja":       loja.strip(),
            "tipo_midia": tipo_midia.strip(),
            "client_id":  client_id,
        }

    sem_cliente = sum(1 for v in device_map.values() if not v["client_id"])
    log.info(f"  Dispositivos: {len(device_map)} total | {sem_cliente} sem client_id detectado")
    return device_map


# ── Cálculo de duração ────────────────────────────────────────────────────────

def _calc_duration(start_str: str | None, end_str: str | None):
    """Retorna (duration_days, duration_hms) ou (None, None)."""
    if not start_str or not end_str:
        return None, None
    try:
        import pandas as pd
        delta = pd.Timestamp(end_str) - pd.Timestamp(start_str)
        total = max(0, int(delta.total_seconds()))
        duration_days = round(total / 86400, 2)
        hh, rem = divmod(total, 3600)
        mm, ss  = divmod(rem, 60)
        duration_hms = f"{hh}:{mm:02d}:{ss:02d}"
        return duration_days, duration_hms
    except Exception:
        return None, None


# ── Sync principal ────────────────────────────────────────────────────────────

def sincronizar(days: int = 30):
    now       = datetime.now(timezone.utc)
    start_dt  = now - timedelta(days=days)
    end_dt    = now
    if start_dt > end_dt:
        start_dt, end_dt = end_dt, start_dt
    start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso   = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    log.info(f"Período: {start_iso} → {end_iso}")

    # ── 1. Mapa de dispositivos ──────────────────────────────────────────────
    log.info("Buscando dispositivos...")
    device_map = _build_device_map()
    if not device_map:
        log.error("Nenhum dispositivo encontrado. Verifique o token da API.")
        return

    # ── 2. Catálogo de campanhas ─────────────────────────────────────────────
    log.info("Buscando campanhas...")
    campaigns_raw = _list_all("campaign/list", {}, page_size=1000)
    campaign_map  = {c["id"]: c for c in campaigns_raw if "id" in c}
    log.info(f"  {len(campaign_map)} campanhas encontradas")

    # ── 3. Catálogo de conteúdos ─────────────────────────────────────────────
    log.info("Buscando conteúdos...")
    content_raw = _list_all("content/list", {}, page_size=1000)
    content_map = {c["id"]: c for c in content_raw if "id" in c}
    log.info(f"  {len(content_map)} conteúdos encontrados")

    if not content_map:
        log.error("Nenhum conteúdo encontrado — verifique o token.")
        return

    # ── 4. Exibições de conteúdo (display_count) ─────────────────────────────
    log.info("Buscando exibições de conteúdo...")
    content_ids = list(content_map.keys())
    shows_raw   = []
    chunk_size  = 100  # Evita body muito grande
    for i in range(0, len(content_ids), chunk_size):
        chunk = content_ids[i : i + chunk_size]
        try:
            chunk_shows = _list_all(
                "stats/content-show/list",
                {"start": start_iso, "end": end_iso, "content": chunk},
                page_size=10000,
            )
            shows_raw.extend(chunk_shows)
            log.info(f"  chunk {i//chunk_size + 1}: {len(chunk_shows)} exibições")
        except Exception as e:
            log.warning(f"  Erro no chunk {i//chunk_size + 1}: {e}")
    log.info(f"  Total: {len(shows_raw)} exibições")

    # Agrega por (campaign_id, content_id, device_id)
    show_agg: dict = defaultdict(lambda: {"count": 0, "min_start": None, "max_end": None})
    for s in shows_raw:
        key = (s.get("campaign_id"), s.get("content_id"), s.get("device_id"))
        if None in key:
            continue
        rec = show_agg[key]
        rec["count"] += 1
        t_s, t_e = s.get("start"), s.get("end")
        if t_s and (not rec["min_start"] or t_s < rec["min_start"]):
            rec["min_start"] = t_s
        if t_e and (not rec["max_end"] or t_e > rec["max_end"]):
            rec["max_end"] = t_e

    # ── 5. Sessões de visitantes (visitors + atenção) ─────────────────────────
    log.info("Buscando sessões de visitantes...")
    visitors_raw = []
    try:
        visitors_raw = _list_all(
            "stats/visitor/list",
            {"start": start_iso, "end": end_iso},
            page_size=1000,
        )
    except Exception as e:
        log.warning(f"  Erro ao buscar visitantes: {e}")
    log.info(f"  {len(visitors_raw)} sessões de visitantes")

    # Agrega por (campaign_id, device_id)
    visitor_agg: dict = defaultdict(lambda: {"visitor_ids": set(), "attn_sum": 0, "attn_count": 0})
    for v in visitors_raw:
        vid = v.get("visitor_id")
        if not vid:
            continue
        camps     = v.get("campaigns") or []
        devs      = v.get("devices")   or []
        attention = v.get("tracks_duration") or 0
        for c in camps:
            for d in devs:
                rec = visitor_agg[(c, d)]
                rec["visitor_ids"].add(vid)
                rec["attn_sum"]   += attention
                rec["attn_count"] += 1

    # ── 6. Monta registros ───────────────────────────────────────────────────
    log.info("Montando registros para o Supabase...")
    agora     = datetime.now(timezone.utc).isoformat()
    registros = []

    for (campaign_id, content_id, device_id), show_data in show_agg.items():
        campaign = campaign_map.get(campaign_id, {})
        content  = content_map.get(content_id,  {})
        device   = device_map.get(device_id,    {})

        if not campaign or not device:
            continue

        client_id = device.get("client_id", "")
        if not client_id:
            log.debug(f"  Device {device_id} sem client_id — ignorado")
            continue

        content_raw_name = content.get("name", "")
        content_name     = _clean_content_name(content_raw_name) if content_raw_name else None
        loja             = device.get("loja",       "")
        tipo_midia       = device.get("tipo_midia", "")
        display_count    = show_data["count"]

        # Datas: usa exibições reais; fallback = datas da campanha no catálogo
        start_date = show_data["min_start"] or campaign.get("start_at")
        end_date   = show_data["max_end"]   or campaign.get("end_at")

        duration_days, duration_hms = _calc_duration(start_date, end_date)

        # Visitantes e atenção média pelo par (campaign, device)
        v_data        = visitor_agg.get((campaign_id, device_id), {})
        visitors      = len(v_data.get("visitor_ids", set()))
        attn_count    = v_data.get("attn_count", 0)
        avg_attention = int(v_data.get("attn_sum", 0) / attn_count) if attn_count else 0

        reg = {
            "client_id":         client_id,
            "name":              campaign.get("name", ""),
            "content_name":      content_name,
            "tipo_midia":        tipo_midia,
            "loja":              loja,
            "start_date":        start_date,
            "end_date":          end_date,
            "duration_days":     duration_days,
            "duration_hms":      duration_hms,
            "display_count":     display_count,
            "visitors":          visitors,
            "avg_attention_sec": avg_attention,
            "uploaded_at":       agora,
        }
        registros.append(reg)
        log.info(
            f"  → '{content_name or campaign.get('name')}'"
            f" | {loja} | {tipo_midia}"
            f" | exibições={display_count} | visitantes={visitors}"
        )

    log.info(f"Total: {len(registros)} registros prontos para salvar")

    if not registros:
        log.warning("Nenhum registro gerado — verifique se o período tem dados ou se os devices têm client_id.")
        log.warning("Dica: rode com --test para inspecionar os recursos disponíveis na API.")
        return

    _upsert_supabase(registros)


# ── Upsert Supabase ───────────────────────────────────────────────────────────

def _upsert_supabase(registros: list[dict]) -> None:
    from supabase import create_client

    sb = create_client(SUPA_URL, SUPA_KEY)

    tentativas = [
        ("client_id,name,content_name,tipo_midia,loja", set()),
        ("client_id,name,tipo_midia,loja",              set()),
        ("client_id,name,start_date,end_date",          set()),
        ("client_id,name",                              set()),
        ("client_id,name,tipo_midia,loja",              {"uploaded_at"}),
        ("client_id,name",                              {"uploaded_at", "tipo_midia", "loja"}),
    ]

    def _drop(rows, keys):
        return [{k: v for k, v in r.items() if k not in keys} for r in rows]

    for on_conflict, drop_keys in tentativas:
        try:
            payload = _drop(registros, drop_keys)
            res     = sb.table("campaigns").upsert(payload, on_conflict=on_conflict).execute()
            count   = len(res.data) if res.data else len(payload)
            log.info(f"✅ {count} registros salvos no Supabase (on_conflict={on_conflict})")
            return
        except Exception as e:
            log.warning(f"  Tentativa '{on_conflict}' falhou: {e}")

    # Fallback: INSERT direto
    try:
        res   = sb.table("campaigns").insert(registros).execute()
        count = len(res.data) if res.data else len(registros)
        log.info(f"✅ {count} registros inseridos via INSERT direto")
    except Exception as e:
        log.error(f"❌ Falha ao salvar no Supabase: {e}")


# ── Modo --test ───────────────────────────────────────────────────────────────

def testar():
    """Testa conectividade e lista o que está disponível na API."""
    log.info("=== MODO TESTE — verificando API Displayforce ===")
    log.info(f"Token: {API_TOKEN[:4]}...{API_TOKEN[-4:]}")

    # Pastas
    try:
        folders = _list_all("device-folder/list", {}, page_size=10000)
        log.info(f"Pastas: {len(folders)}")
        for f in folders[:10]:
            log.info(f"  [{f.get('id')}] {f.get('name')} (parent={f.get('parent_id')})")
    except Exception as e:
        log.error(f"Pastas: ERRO — {e}")

    # Devices
    try:
        devices = _list_all("device/list", {}, page_size=10000)
        log.info(f"Devices: {len(devices)}")
        for d in devices[:10]:
            log.info(f"  [{d.get('id')}] {d.get('name')} (parent={d.get('parent_id')})")
    except Exception as e:
        log.error(f"Devices: ERRO — {e}")

    # Campanhas
    try:
        campaigns = _list_all("campaign/list", {}, page_size=1000)
        log.info(f"Campanhas: {len(campaigns)}")
        for c in campaigns[:10]:
            log.info(f"  [{c.get('id')}] {c.get('name')} | {c.get('start_at')} → {c.get('end_at')}")
    except Exception as e:
        log.error(f"Campanhas: ERRO — {e}")

    # Conteúdos
    try:
        contents = _list_all("content/list", {}, page_size=1000)
        log.info(f"Conteúdos: {len(contents)}")
        for c in contents[:10]:
            log.info(f"  [{c.get('id')}] {c.get('name')}")
    except Exception as e:
        log.error(f"Conteúdos: ERRO — {e}")

    # Teste de visitor stats (últimos 7 dias)
    now      = datetime.now(timezone.utc)
    start    = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    end      = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        visitors = _post("stats/visitor/list", {"start": start, "end": end, "limit": 5})
        count = len(visitors) if isinstance(visitors, list) else "?"
        log.info(f"Visitantes (últimos 7 dias, amostra): {count} sessões")
    except Exception as e:
        log.error(f"Visitantes: ERRO — {e}")

    log.info("=== FIM DO TESTE ===")


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Sincroniza campanhas via API Displayforce → Supabase"
    )
    parser.add_argument(
        "--days", type=int, default=30,
        help="Janela de dados em dias (padrão: 30)"
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Apenas testa conectividade e lista recursos disponíveis"
    )
    args = parser.parse_args()

    log.info("=" * 60)
    log.info(f"API Sync Campanhas — {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    log.info("=" * 60)

    if args.test:
        testar()
    else:
        sincronizar(days=args.days)
        log.info("Concluído!")
