from __future__ import annotations

import argparse
import json
import ssl
import time
import urllib.request
from collections import Counter, deque
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import requests


BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
MODEL_DIR = BASE_DIR / "models"
PROTO_PATH = MODEL_DIR / "deploy.prototxt"
WEIGHTS_PATH = MODEL_DIR / "mobilenet_iter_73000.caffemodel"

PROTO_URL = "https://raw.githubusercontent.com/chuanqi305/MobileNet-SSD/master/deploy.prototxt"
WEIGHTS_URL = "https://github.com/chuanqi305/MobileNet-SSD/raw/master/mobilenet_iter_73000.caffemodel"

CLASSES = [
    "background", "aeroplane", "bicycle", "bird", "boat", "bottle", "bus",
    "car", "cat", "chair", "cow", "diningtable", "dog", "horse",
    "motorbike", "person", "pottedplant", "sheep", "sofa", "train",
    "tvmonitor",
]
PERSON_CLASS_ID = CLASSES.index("person")

DEFAULT_CONFIG: dict[str, Any] = {
    "api_url": "https://visitor-api-48fe.onrender.com",
    "source": "",
    "camera_index": 0,
    "camera_width": 640,
    "camera_height": 360,
    "max_frame_width": 640,
    "roi": None,
    "confidence": 0.45,
    "process_every_n_frames": 3,
    "stable_window": 7,
    "min_post_interval_seconds": 3,
    "heartbeat_seconds": 30,
    "cap_count": 2,
    "show_window": True,
    "dry_run": False,
}


def load_config() -> dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    return cfg


def save_config(cfg: dict[str, Any]) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def apply_args(cfg: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    if args.api_url:
        cfg["api_url"] = args.api_url
    if args.source:
        cfg["source"] = args.source
    if args.camera is not None:
        cfg["camera_index"] = args.camera
    if args.dry_run:
        cfg["dry_run"] = True
    if args.no_window:
        cfg["show_window"] = False
    return cfg


def ensure_model() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for url, path in [(PROTO_URL, PROTO_PATH), (WEIGHTS_URL, WEIGHTS_PATH)]:
        if path.exists() and path.stat().st_size > 0:
            continue
        print(f"[model] baixando {path.name}...")
        try:
            urllib.request.urlretrieve(url, path)
        except Exception as exc:
            print(f"[model] download SSL falhou, tentando modo compativel: {exc}")
            context = ssl._create_unverified_context()
            with urllib.request.urlopen(url, context=context, timeout=60) as response:
                path.write_bytes(response.read())


def open_camera(cfg: dict[str, Any]) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(int(cfg["camera_index"]), cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, int(cfg["camera_width"]))
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, int(cfg["camera_height"]))
    cap.set(cv2.CAP_PROP_FPS, 15)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    if not cap.isOpened():
        raise RuntimeError("Nao foi possivel abrir a camera USB.")
    return cap


def resize_frame(frame: np.ndarray, max_width: int) -> np.ndarray:
    h, w = frame.shape[:2]
    if w <= max_width:
        return frame
    scale = max_width / float(w)
    return cv2.resize(frame, (max_width, int(h * scale)), interpolation=cv2.INTER_AREA)


def select_roi(cfg: dict[str, Any]) -> None:
    cap = open_camera(cfg)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise RuntimeError("Nao consegui capturar frame da camera para marcar a area.")
    frame = resize_frame(frame, int(cfg["max_frame_width"]))
    roi = cv2.selectROI("Selecione a area dos operadores e pressione ENTER", frame, showCrosshair=True, fromCenter=False)
    cv2.destroyAllWindows()
    x, y, w, h = [int(v) for v in roi]
    if w <= 0 or h <= 0:
        print("[roi] selecao cancelada.")
        return
    cfg["roi"] = {"x": x, "y": y, "w": w, "h": h}
    save_config(cfg)
    print(f"[roi] salvo em {CONFIG_PATH}: {cfg['roi']}")


class PersonDetector:
    def __init__(self, confidence: float) -> None:
        ensure_model()
        self.net = cv2.dnn.readNetFromCaffe(str(PROTO_PATH), str(WEIGHTS_PATH))
        self.confidence = confidence

    def detect(self, frame: np.ndarray, roi: dict[str, int] | None) -> list[tuple[int, int, int, int, float]]:
        ox = oy = 0
        crop = frame
        if roi:
            x, y, w, h = roi["x"], roi["y"], roi["w"], roi["h"]
            crop = frame[y:y + h, x:x + w]
            ox, oy = x, y
        if crop.size == 0:
            return []

        blob = cv2.dnn.blobFromImage(cv2.resize(crop, (300, 300)), 0.007843, (300, 300), 127.5)
        self.net.setInput(blob)
        detections = self.net.forward()
        ch, cw = crop.shape[:2]
        boxes: list[tuple[int, int, int, int, float]] = []

        for i in range(detections.shape[2]):
            conf = float(detections[0, 0, i, 2])
            class_id = int(detections[0, 0, i, 1])
            if class_id != PERSON_CLASS_ID or conf < self.confidence:
                continue
            box = detections[0, 0, i, 3:7] * np.array([cw, ch, cw, ch])
            x1, y1, x2, y2 = box.astype("int")
            x1, y1 = max(0, x1) + ox, max(0, y1) + oy
            x2, y2 = min(cw - 1, x2) + ox, min(ch - 1, y2) + oy
            if x2 > x1 and y2 > y1:
                boxes.append((x1, y1, x2, y2, conf))
        return boxes


def stable_count(history: deque[int]) -> int:
    if not history:
        return 0
    counts = Counter(history)
    return counts.most_common(1)[0][0]


def post_status(cfg: dict[str, Any], count: int) -> None:
    payload = {
        "operadores": int(count),
        "ts": time.time(),
    }
    if cfg.get("source"):
        payload["source"] = cfg["source"]
    if cfg["dry_run"]:
        print("[dry-run][operadores]", payload)
        return

    url = cfg["api_url"].rstrip("/") + "/api/operadores/status"
    try:
        res = requests.post(url, json=payload, timeout=5)
        res.raise_for_status()
        print(f"[operadores] enviado count={count}")
    except Exception as exc:
        print(f"[operadores] falha ao enviar count={count}: {exc}")


def draw(frame: np.ndarray, cfg: dict[str, Any], boxes: list[tuple[int, int, int, int, float]], raw_count: int, count: int) -> None:
    roi = cfg.get("roi")
    if roi:
        cv2.rectangle(frame, (roi["x"], roi["y"]), (roi["x"] + roi["w"], roi["y"] + roi["h"]), (255, 160, 0), 2)
        cv2.putText(frame, "AREA OPERADORES", (roi["x"], max(18, roi["y"] - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 160, 0), 2)
    for idx, (x1, y1, x2, y2, conf) in enumerate(boxes, start=1):
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 120), 2)
        cv2.putText(frame, f"Pessoa {idx} {conf:.2f}", (x1, max(18, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 220, 120), 2)
    cv2.putText(frame, f"Operadores: {count} (raw {raw_count})", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (40, 240, 40), 2)


def run(cfg: dict[str, Any]) -> None:
    cv2.setNumThreads(1)
    detector = PersonDetector(float(cfg["confidence"]))
    cap = open_camera(cfg)
    frame_id = 0
    history: deque[int] = deque(maxlen=int(cfg["stable_window"]))
    last_sent_count: int | None = None
    last_post_at = 0.0
    boxes: list[tuple[int, int, int, int, float]] = []

    print("[operadores] rodando. Teclas: q=sair, r=remarcar area.")
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.2)
                continue
            frame = resize_frame(frame, int(cfg["max_frame_width"]))
            frame_id += 1
            now = time.time()

            if frame_id % int(cfg["process_every_n_frames"]) == 0:
                boxes = detector.detect(frame, cfg.get("roi"))
                raw_count = len(boxes)
                count = min(raw_count, int(cfg["cap_count"])) if int(cfg["cap_count"]) > 0 else raw_count
                history.append(count)
            else:
                raw_count = len(boxes)
                count = stable_count(history)

            stable = stable_count(history)
            due_change = last_sent_count is None or stable != last_sent_count
            due_time = now - last_post_at >= float(cfg["min_post_interval_seconds"])
            due_heartbeat = now - last_post_at >= float(cfg["heartbeat_seconds"])
            if (due_change and due_time) or due_heartbeat:
                post_status(cfg, stable)
                last_sent_count = stable
                last_post_at = now

            if cfg["show_window"]:
                view = frame.copy()
                draw(view, cfg, boxes, raw_count, stable)
                cv2.imshow("FilaGuard - Operadores", view)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                if key == ord("r"):
                    roi = cv2.selectROI("Selecione a area dos operadores e pressione ENTER", view, showCrosshair=True, fromCenter=False)
                    cv2.destroyWindow("Selecione a area dos operadores e pressione ENTER")
                    x, y, w, h = [int(v) for v in roi]
                    if w > 0 and h > 0:
                        cfg["roi"] = {"x": x, "y": y, "w": w, "h": h}
                        save_config(cfg)
                        print(f"[roi] atualizado: {cfg['roi']}")
            elif frame_id % 60 == 0:
                print(f"[operadores] count={stable}")
    finally:
        cap.release()
        cv2.destroyAllWindows()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detector leve de operadores por camera USB.")
    parser.add_argument("--select-roi", action="store_true", help="Abre a camera e salva a area desejada para analise.")
    parser.add_argument("--camera", type=int, default=None, help="Indice da camera USB. Ex: 0, 1.")
    parser.add_argument("--source", default=None, help="Unidade/local/camera enviado para a API.")
    parser.add_argument("--api-url", default=None, help="Base URL da API.")
    parser.add_argument("--dry-run", action="store_true", help="Nao envia para API, apenas imprime payload.")
    parser.add_argument("--no-window", action="store_true", help="Roda sem janela de visualizacao.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg = apply_args(load_config(), args)
    if args.select_roi:
        select_roi(cfg)
    else:
        run(cfg)


if __name__ == "__main__":
    main()
