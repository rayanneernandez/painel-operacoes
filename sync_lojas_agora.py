"""
Sincroniza lojas/dispositivos AGORA — Painel de Operações GlobalIA
=================================================================
Dispara a ação sync_stores para cada cliente. Isso puxa os dispositivos
da DisplayForce e grava (entre outras coisas) a DATA DE INSTALAÇÃO
(activation_date), que aparece na tela de Evolução → Semanal por Loja.

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

# ── Clientes a sincronizar (client_id, nome) ──────────────────────────────────
# Adicione outras redes aqui se quiser preencher a data de instalação delas também.
clients = [
    ("c6999bd9-14c0-4e26-abb1-d4b852d34421", "Panvel"),
]

for client_id, name in clients:
    print(f"Sincronizando dispositivos de {name}...", flush=True)
    try:
        resp = requests.post(
            f"{API_BASE}/api/sync-analytics",
            json={"client_id": client_id, "sync_stores": True, "auth": TOKEN},
            timeout=120,
        )
        try:
            data = resp.json()
        except Exception:
            data = {"status": resp.status_code, "text": resp.text[:200]}
        print(f"  ✓ {name}: {data}", flush=True)
    except Exception as e:
        print(f"  ✗ {name}: erro {e}", flush=True)

print("\n✅ Pronto! Abra Evolução → Semanal por Loja e expanda uma loja: a data de instalação já deve aparecer por dispositivo.")
