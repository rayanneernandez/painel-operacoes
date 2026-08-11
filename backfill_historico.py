"""
Backfill histórico de visitantes — Painel de Operações GlobalIA
================================================================
Chama o endpoint de sync semana a semana (janelas de 7 dias) para
garantir que cada chamada termine dentro do limite de 60s da Vercel.

Como usar:
  python backfill_historico.py

Requisitos:
  pip install requests
"""

import requests
import time
from datetime import datetime, timedelta, timezone

API_BASE    = "https://painel-de-operacoes.globalia.com.br"
TOKEN       = "painel@2026*"
START_DATE  = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
END_DATE    = datetime(2026, 5, 31, 23, 59, 59, tzinfo=timezone.utc)
CHUNK_DAYS  = 7    # janela por chamada (7 dias cabe bem nos 60s da Vercel)
WAIT_SECONDS = 75  # tempo para o background sync terminar antes da próxima chamada

# ── Clientes a sincronizar ────────────────────────────────────────────────────
clients = [
    ("c6999bd9-14c0-4e26-abb1-d4b852d34421", "Panvel"),
]

# ── Gera intervalos semanais ──────────────────────────────────────────────────
def get_weekly_ranges():
    ranges = []
    cursor = START_DATE
    while cursor <= END_DATE:
        chunk_end = min(cursor + timedelta(days=CHUNK_DAYS - 1, hours=23, minutes=59, seconds=59), END_DATE)
        ranges.append({
            "label": f"{cursor.strftime('%d/%m')} → {chunk_end.strftime('%d/%m')}",
            "start": cursor.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "end":   chunk_end.strftime("%Y-%m-%dT%H:%M:%S.999Z"),
        })
        cursor = cursor + timedelta(days=CHUNK_DAYS)
    return ranges

weekly_ranges = get_weekly_ranges()

print(f"Clientes: {[c[1] for c in clients]}")
print(f"Período: {START_DATE.strftime('%d/%m/%Y')} → {END_DATE.strftime('%d/%m/%Y')}")
print(f"Janelas de {CHUNK_DAYS} dias → {len(weekly_ranges)} chamadas por cliente")
print(f"Tempo estimado: ~{len(weekly_ranges) * len(clients) * WAIT_SECONDS // 60} minutos\n")

total = len(clients) * len(weekly_ranges)
done  = 0

for client_id, client_name in clients:
    print(f"{'='*60}")
    print(f"Cliente: {client_name}")
    print(f"{'='*60}")

    for r in weekly_ranges:
        done += 1
        print(f"  [{done}/{total}] {r['label']}  ", end="", flush=True)

        try:
            resp = requests.post(
                f"{API_BASE}/api/sync-analytics",
                json={
                    "client_id":       client_id,
                    "background_sync": True,
                    "force_full_sync": True,
                    "start":           r["start"],
                    "end":             r["end"],
                    "auth":            TOKEN,
                },
                timeout=15
            )
            data = resp.json()
            if data.get("started"):
                print(f"✓ sync iniciado")
            elif data.get("needs_sync") is False:
                print(f"— já atualizado")
            else:
                print(f"? {data.get('message', resp.status_code)}")
        except Exception as e:
            print(f"✗ erro: {e}")

        # Aguarda o background sync terminar
        for remaining in range(WAIT_SECONDS, 0, -5):
            print(f"    aguardando {remaining}s...   ", end="\r", flush=True)
            time.sleep(5)
        print(" " * 35, end="\r")

    print()

print("\n✅ Backfill concluído! Atualize o painel para ver os dados.")
