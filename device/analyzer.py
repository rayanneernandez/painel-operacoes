"""
BRF Vision Analyzer
Roda no dispositivo da loja. Captura frames da câmera,
envia ao Sonnet 4.6 e salva os resultados no Supabase.

Uso:
  python analyzer.py --module ruptura  --camera 0 --interval 300
  python analyzer.py --module operacao --camera 1 --interval 60
  python analyzer.py --module fila     --camera 2 --interval 30

Dependências:
  pip install anthropic supabase opencv-python python-dotenv
"""

import argparse
import base64
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

import anthropic
import cv2
from dotenv import load_dotenv
from supabase import create_client

# ── Config ────────────────────────────────────────────────────────────────────

load_dotenv()

def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value or not value.strip():
        raise RuntimeError(f"Variável de ambiente obrigatória ausente: {name}")
    return value.strip()


def optional_env(name: str) -> str | None:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else None


MODEL_ID           = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip()
ANTHROPIC_API_KEY  = required_env("ANTHROPIC_API_KEY")
SUPABASE_URL       = required_env("SUPABASE_URL")
SUPABASE_KEY       = required_env("SUPABASE_SERVICE_ROLE_KEY")
CLIENT_ID          = required_env("BRF_CLIENT_ID")
STORE_ID           = optional_env("BRF_STORE_ID")
CAMERA_ID          = optional_env("BRF_CAMERA_ID")
PLANOGRAM_ID       = optional_env("BRF_PLANOGRAM_ID")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("brf")

client_ai  = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
client_db  = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Prompts ───────────────────────────────────────────────────────────────────

PROMPTS = {
    "ruptura": """
Você é um sistema de visão computacional especializado em auditoria de gôndolas de supermercado.

PLANOGRAMA DESTA GÔNDOLA (colunas 4, 5 e 6 — 3 prateleiras cada):
- Coluna 4, prateleiras 1-2-3: Peito de Peru Fatiado Soltíssimo (embalagem vermelha/branca, 200g)
- Coluna 5, prateleiras 1-2-3: Filé Mignon Suíno Mignoneto Sadia 180g (embalagem amarela/vermelha)
- Coluna 6, prateleiras 1-2-3: Presunto Cozido Fatiado 180g (embalagem rosa/branca)

Prateleira 1 = inferior, 2 = meio, 3 = superior.

Para cada uma das 9 posições (3 colunas × 3 prateleiras), determine:
- "ok": espaço bem preenchido, produto claramente visível e ocupa mais de 50% do espaço
- "warning": produto presente mas ocupando menos de 50% do espaço (estoque baixo)
- "rupture": espaço completamente vazio ou praticamente sem produto

Responda SOMENTE com JSON válido, sem markdown, sem texto extra:
{
  "positions": [
    {
      "column_number": <4, 5 ou 6>,
      "shelf_number": <1, 2 ou 3>,
      "status": "ok|warning|rupture",
      "confidence": <0.0 a 1.0>
    }
  ],
  "summary": "<descrição objetiva do estado geral da gôndola>"
}
""".strip(),

    "operacao": """
Você é um sistema de visão computacional para varejo. Analise a imagem deste stand/balcão de atendimento.

Identifique:
1. Quantas pessoas (atendentes/funcionários) estão DENTRO ou ATRÁS do balcão
2. Se algum deles está em atividade de preparo (manuseando produtos, equipamentos, etc.)

Responda SOMENTE com JSON válido, sem markdown, sem texto extra:
{
  "attendant_count": <número de atendentes visíveis>,
  "is_preparing": <true ou false>,
  "summary": "<descrição breve do que está acontecendo>"
}
""".strip(),

    "fila": """
Você é um sistema de visão computacional para varejo. Analise a imagem desta fila de atendimento.

Conte quantas pessoas estão aguardando na fila (não contar atendentes atrás do balcão).

Responda SOMENTE com JSON válido, sem markdown, sem texto extra:
{
  "people_count": <número de pessoas na fila>,
  "summary": "<descrição breve da situação da fila>"
}
""".strip(),
}

# ── Captura de frame ──────────────────────────────────────────────────────────

def capture_frame(camera_index: int) -> bytes:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        raise RuntimeError(f"Não foi possível abrir a câmera {camera_index}")
    ret, frame = cap.read()
    cap.release()
    if not ret:
        raise RuntimeError("Falha ao capturar frame")
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes()


def frame_to_base64(data: bytes) -> str:
    return base64.standard_b64encode(data).decode()

# ── Sonnet ────────────────────────────────────────────────────────────────────

def call_sonnet(module: str, image_b64: str) -> dict:
    msg = client_ai.messages.create(
        model=MODEL_ID,
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}},
                {"type": "text",  "text": PROMPTS[module]},
            ],
        }],
    )
    raw = next((b.text for b in msg.content if b.type == "text"), "")
    clean = raw.strip()
    if clean.startswith("```"):
        clean = "\n".join(clean.split("\n")[1:])
    if clean.endswith("```"):
        clean = "\n".join(clean.split("\n")[:-1])
    return json.loads(clean)

# ── Supabase ──────────────────────────────────────────────────────────────────

def save_snapshot(module: str, image_url: str, processing_ms: int, response: dict) -> str | None:
    try:
        res = client_db.table("brf_vision_snapshots").insert({
            "camera_id":      CAMERA_ID,
            "store_id":       STORE_ID,
            "client_id":      CLIENT_ID,
            "function":       module,
            "image_url":      image_url,
            "analyzed_at":    datetime.now(timezone.utc).isoformat(),
            "model_used":     MODEL_ID,
            "processing_ms":  processing_ms,
            "raw_response":   response,
        }).execute()
        rows = res.data
        return rows[0]["id"] if rows else None
    except Exception as e:
        log.warning("Snapshot não salvo; seguindo com a detecção principal: %s", e)
        return None


def handle_ruptura(result: dict, snapshot_id: str | None):
    positions = result.get("positions", [])

    # Busca posições do planograma
    pos_map = {}
    if PLANOGRAM_ID:
        rows = client_db.table("brf_planogram_positions") \
            .select("id, column_number, shelf_number, product_code, product_name") \
            .eq("planogram_id", PLANOGRAM_ID).execute().data
        pos_map = {(r["column_number"], r["shelf_number"]): r for r in rows}

    for pos in positions:
        col, shelf = pos["column_number"], pos["shelf_number"]
        plan_pos = pos_map.get((col, shelf))
        plan_pos_id = plan_pos["id"] if plan_pos else None
        # Salva status na gôndola
        if plan_pos_id:
            client_db.table("brf_gondola_status").insert({
                "planogram_position_id": plan_pos_id,
                "snapshot_id":           snapshot_id,
                "store_id":              STORE_ID,
                "client_id":             CLIENT_ID,
                "status":                pos["status"],
                "confidence":            pos.get("confidence"),
                "updated_at":            datetime.now(timezone.utc).isoformat(),
            }).execute()

        # Alerta se warning ou rupture
        if pos["status"] != "ok":
            client_db.table("brf_rupture_alerts").insert({
                "client_id":             CLIENT_ID,
                "store_id":              STORE_ID,
                "severity":              "red" if pos["status"] == "rupture" else "orange",
                "planogram_position_id": plan_pos_id,
                "snapshot_id":           snapshot_id,
                "product_code":          plan_pos["product_code"] if plan_pos else None,
                "product_name":          plan_pos["product_name"] if plan_pos else None,
                "confidence":            pos.get("confidence"),
            }).execute()
            log.warning("ALERTA %s — col %d, shelf %d (%s)",
                        pos["status"].upper(), col, shelf,
                        plan_pos["product_name"] if plan_pos else "desconhecido")


def handle_operacao(result: dict, snapshot_id: str | None):
    client_db.table("brf_operation_detections").insert({
        "snapshot_id":     snapshot_id,
        "store_id":        STORE_ID,
        "client_id":       CLIENT_ID,
        "attendant_count": result.get("attendant_count", 0),
        "is_preparing":    result.get("is_preparing", False),
        "detected_at":     datetime.now(timezone.utc).isoformat(),
        "details":         {"summary": result.get("summary", "")},
    }).execute()
    log.info("Operação: %d atendente(s), preparando=%s",
             result.get("attendant_count", 0), result.get("is_preparing"))


def handle_fila(result: dict, snapshot_id: str | None):
    client_db.table("brf_queue_detections").insert({
        "snapshot_id":   snapshot_id,
        "store_id":      STORE_ID,
        "client_id":     CLIENT_ID,
        "people_count":  result.get("people_count", 0),
        "detected_at":   datetime.now(timezone.utc).isoformat(),
        "details":       {"summary": result.get("summary", "")},
    }).execute()
    log.info("Fila: %d pessoa(s)", result.get("people_count", 0))

# ── Loop principal ────────────────────────────────────────────────────────────

HANDLERS = {
    "ruptura":  handle_ruptura,
    "operacao": handle_operacao,
    "fila":     handle_fila,
}

def run_once(module: str, camera_index: int):
    log.info("Analisando módulo: %s", module)

    # 1. Captura frame
    image_bytes = capture_frame(camera_index)
    image_b64   = frame_to_base64(image_bytes)

    # 2. Chama Sonnet
    t0 = time.monotonic()
    result = call_sonnet(module, image_b64)
    ms = int((time.monotonic() - t0) * 1000)
    log.info("Sonnet respondeu em %d ms: %s", ms, result.get("summary", ""))

    # 3. Salva snapshot (sem URL pública — frame não é persistido no storage)
    snapshot_id = save_snapshot(module, "device://local", ms, result)

    # 4. Salva resultado específico do módulo
    HANDLERS[module](result, snapshot_id)


def main():
    parser = argparse.ArgumentParser(description="BRF Vision Analyzer")
    parser.add_argument("--module",   required=True, choices=["ruptura", "operacao", "fila"])
    parser.add_argument("--camera",   type=int, default=0, help="Índice da câmera (default: 0)")
    parser.add_argument("--interval", type=int, default=300, help="Intervalo em segundos entre análises (default: 300)")
    parser.add_argument("--once",     action="store_true", help="Executa uma vez e sai")
    args = parser.parse_args()

    log.info("Iniciando BRF Analyzer | módulo=%s câmera=%d intervalo=%ds",
             args.module, args.camera, args.interval)

    if args.once:
        run_once(args.module, args.camera)
        return

    while True:
        try:
            run_once(args.module, args.camera)
        except Exception as e:
            log.error("Erro na análise: %s", e)
        log.info("Aguardando %ds...", args.interval)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
