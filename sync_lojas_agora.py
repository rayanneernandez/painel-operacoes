"""
Sincroniza lojas/dispositivos de TODAS as redes — Painel de Operações GlobalIA
==============================================================================
Descobre automaticamente todas as redes com API configurada e dispara a ação
sync_stores para cada uma. Isso puxa os dispositivos da DisplayForce e grava,
entre outras coisas, a DATA DE INSTALAÇÃO (activation_date), que aparece na
tela de Evolução → Semanal por Loja (por dispositivo).

Pré-requisitos:
  1. Rodar o SQL devices_activation_date.sql no Supabase (adiciona a coluna).
  2. Ter feito o deploy do api/sync-analytics.ts atualizado.
  3. pip install requests

Como usar:
  python sync_lojas_agora.py
"""

import requests

API_BASE = "https://painel-de-operacoes.globalia.com.br"
TOKEN    = "painel@2026*"

# ── Descobre as redes automaticamente ─────────────────────────────────────────
clients = []
try:
    r = requests.post(
        f"{API_BASE}/api/sync-analytics",
        json={"list_clients": True, "auth": TOKEN},
        timeout=60,
    )
    clients = [(c["id"], c.get("name", c["id"])) for c in r.json().get("clients", [])]
except Exception as e:
    print(f"Não consegui listar as redes automaticamente ({e}). Usando lista fixa.")

# Fallback caso a listagem falhe (Panvel + Assaí conhecidos)
if not clients:
    clients = [
        ("c6999bd9-14c0-4e26-abb1-d4b852d34421", "Panvel"),
        ("b1c05e4d-0417-4853-9af9-8c0725df1880", "Assai"),
    ]

print(f"Redes a sincronizar: {[c[1] for c in clients]}\n", flush=True)

for client_id, name in clients:
    print(f"Sincronizando dispositivos de {name}...", flush=True)
    try:
        resp = requests.post(
            f"{API_BASE}/api/sync-analytics",
            json={"client_id": client_id, "sync_stores": True, "auth": TOKEN},
            timeout=180,
        )
        try:
            data = resp.json()
            up = data.get("devices_upserted", "?")
            err = data.get("devices_upsert_error")
            print(f"  ✓ {name}: {up} dispositivos" + (f" | ERRO: {err}" if err else ""), flush=True)
        except Exception:
            print(f"  ? {name}: HTTP {resp.status_code}", flush=True)
    except Exception as e:
        print(f"  ✗ {name}: erro {e}", flush=True)

print("\n✅ Pronto! Abra Evolução → Semanal por Loja e expanda uma loja: a data de instalação já deve aparecer nos dispositivos que a DisplayForce tem cadastrada.")
