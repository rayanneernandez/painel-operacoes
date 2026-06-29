from __future__ import annotations

import argparse
import json
import ssl
import threading
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

# MobileNet-SSD (rápido, recall baixo)
PROTO_PATH = MODEL_DIR / "deploy.prototxt"
WEIGHTS_PATH = MODEL_DIR / "mobilenet_iter_73000.caffemodel"
PROTO_URL = "https://raw.githubusercontent.com/chuanqi305/MobileNet-SSD/master/deploy.prototxt"
WEIGHTS_URL = "https://github.com/chuanqi305/MobileNet-SSD/raw/master/mobilenet_iter_73000.caffemodel"

# YOLOv4-tiny (mais lento ~2x mas recall MUITO melhor — pega pessoas que o SSD perde)
YOLO_CFG_PATH = MODEL_DIR / "yolov4-tiny.cfg"
YOLO_WEIGHTS_PATH = MODEL_DIR / "yolov4-tiny.weights"
YOLO_CFG_URL = "https://raw.githubusercontent.com/AlexeyAB/darknet/master/cfg/yolov4-tiny.cfg"
YOLO_WEIGHTS_URL = "https://github.com/AlexeyAB/darknet/releases/download/yolov4/yolov4-tiny.weights"

CLASSES = [
    "background", "aeroplane", "bicycle", "bird", "boat", "bottle", "bus",
    "car", "cat", "chair", "cow", "diningtable", "dog", "horse",
    "motorbike", "person", "pottedplant", "sheep", "sofa", "train",
    "tvmonitor",
]
PERSON_CLASS_ID = CLASSES.index("person")
COCO_PERSON_CLASS_ID = 0  # YOLO/COCO: person é classe 0

DEFAULT_CONFIG: dict[str, Any] = {
    "api_url": "https://filaguard-f67w.onrender.com",
    "camera_index": 0,
    "camera_width": 640,
    "camera_height": 360,
    "max_frame_width": 640,
    "roi": None,
    "confidence": 0.35,
    "process_every_n_frames": 3,
    "stable_window": 7,
    "min_post_interval_seconds": 3,
    "heartbeat_seconds": 30,
    "cap_count": 3,
    # ── Backend de detecção ──────────────────────────────────────
    # "yolov4-tiny" (recomendado, melhor recall) ou "ssd" (legado, mais rápido)
    "backend": "yolov4-tiny",
    # Persistência: 0 = desligado (recomendado se houver fantasmas).
    # 1-2 = tolera 1-2 frames sem detecção antes de zerar.
    "persistence_frames": 0,
    "track_max_distance": 90,
    # Detecção fina ────────────────────────────────────────────────
    "nms_iou": 0.35,
    # Múltiplo de 32 (320, 416, 512, 608). Maior = separa melhor pessoas próximas.
    "input_size": 416,
    # multi_scale roda inferência 2x — desligado por padrão (tile_split substitui).
    "multi_scale": False,
    # Tile-split: divide o crop em 2 metades horizontais com overlap e infere em cada.
    # Custa ~1.6x uma inferência única, mas separa pessoas grudadas que YOLO fundiria.
    "tile_split": True,
    "tile_overlap": 0.20,
    # Split por aspect-ratio (largura/altura). Pessoa só ≈ 0.4-0.5.
    # Se >= este valor, divide em 2 pessoas.
    "merged_aspect_2": 0.75,
    # Se >= este valor, divide em 3.
    "merged_aspect_3": 1.20,
    # Split por largura absoluta (fração do crop/ROI).
    # Se a caixa ocupar >= esta fração da largura, considera 2 pessoas fundidas.
    "merged_width_ratio_2": 0.55,
    "merged_width_ratio_3": 0.85,
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


def _download(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size > 0:
        return
    print(f"[model] baixando {path.name}...")
    try:
        urllib.request.urlretrieve(url, path)
    except Exception as exc:
        print(f"[model] download SSL falhou, tentando modo compativel: {exc}")
        context = ssl._create_unverified_context()
        with urllib.request.urlopen(url, context=context, timeout=120) as response:
            path.write_bytes(response.read())


def ensure_model(backend: str = "ssd") -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if backend == "yolov4-tiny":
        _download(YOLO_CFG_URL, YOLO_CFG_PATH)
        _download(YOLO_WEIGHTS_URL, YOLO_WEIGHTS_PATH)
    else:
        _download(PROTO_URL, PROTO_PATH)
        _download(WEIGHTS_URL, WEIGHTS_PATH)


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


class FrameGrabber:
    """Captura frames em thread separada — o loop de inferência sempre lê o último frame
    sem bloquear no I/O da câmera. Evita acumulação de buffer e melhora FPS."""

    def __init__(self, cap: cv2.VideoCapture) -> None:
        self.cap = cap
        self.lock = threading.Lock()
        self.frame: np.ndarray | None = None
        self.running = True
        self._t = threading.Thread(target=self._loop, daemon=True)
        self._t.start()

    def _loop(self) -> None:
        while self.running:
            ok, f = self.cap.read()
            if ok:
                with self.lock:
                    self.frame = f
            else:
                time.sleep(0.01)

    def read(self) -> np.ndarray | None:
        with self.lock:
            return None if self.frame is None else self.frame.copy()

    def stop(self) -> None:
        self.running = False
        self._t.join(timeout=1.0)


class PersonDetector:
    def __init__(self, cfg: dict[str, Any]) -> None:
        self.backend = str(cfg.get("backend", "yolov4-tiny")).lower()
        ensure_model(self.backend)
        if self.backend == "yolov4-tiny":
            self.net = cv2.dnn.readNetFromDarknet(str(YOLO_CFG_PATH), str(YOLO_WEIGHTS_PATH))
            self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
            # Tenta FP16 (i5/i7 modernos com AVX2 → ~1.5x mais rápido). Fallback p/ FP32.
            try:
                self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU_FP16)
            except Exception:
                self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
            self.yolo_layers = self.net.getUnconnectedOutLayersNames()
        else:
            self.net = cv2.dnn.readNetFromCaffe(str(PROTO_PATH), str(WEIGHTS_PATH))
            self.yolo_layers = None
        self.tile_split = bool(cfg.get("tile_split", True))
        self.tile_overlap = float(cfg.get("tile_overlap", 0.20))
        self.confidence = float(cfg.get("confidence", 0.35))
        self.nms_iou = float(cfg.get("nms_iou", 0.35))
        self.input_size = int(cfg.get("input_size", 416))
        self.multi_scale = bool(cfg.get("multi_scale", True))
        self.merged_aspect_2 = float(cfg.get("merged_aspect_2", 0.75))
        self.merged_aspect_3 = float(cfg.get("merged_aspect_3", 1.20))
        self.merged_width_ratio_2 = float(cfg.get("merged_width_ratio_2", 0.55))
        self.merged_width_ratio_3 = float(cfg.get("merged_width_ratio_3", 0.85))
        # Persistência temporal (tracker simples por centroide)
        self.persistence_frames = int(cfg.get("persistence_frames", 3))
        self.track_max_distance = float(cfg.get("track_max_distance", 90))
        # Cada track: dict(box=(x1,y1,x2,y2), conf=float, ttl=int)
        self._tracks: list[dict[str, Any]] = []

    def _infer(self, crop: np.ndarray, size: int) -> list[tuple[int, int, int, int, float]]:
        ch, cw = crop.shape[:2]
        if self.backend == "yolov4-tiny":
            blob = cv2.dnn.blobFromImage(crop, 1 / 255.0, (size, size), swapRB=True, crop=False)
            self.net.setInput(blob)
            outs = self.net.forward(self.yolo_layers)
            out: list[tuple[int, int, int, int, float]] = []
            for layer in outs:
                for det in layer:
                    scores = det[5:]
                    class_id = int(np.argmax(scores))
                    conf = float(scores[class_id])
                    if class_id != COCO_PERSON_CLASS_ID or conf < self.confidence:
                        continue
                    cx, cy, bw, bh = det[0] * cw, det[1] * ch, det[2] * cw, det[3] * ch
                    x1 = max(0, int(cx - bw / 2))
                    y1 = max(0, int(cy - bh / 2))
                    x2 = min(cw - 1, int(cx + bw / 2))
                    y2 = min(ch - 1, int(cy + bh / 2))
                    if x2 > x1 and y2 > y1:
                        out.append((x1, y1, x2, y2, conf))
            return out
        # SSD fallback
        blob = cv2.dnn.blobFromImage(cv2.resize(crop, (size, size)), 0.007843, (size, size), 127.5)
        self.net.setInput(blob)
        detections = self.net.forward()
        out = []
        for i in range(detections.shape[2]):
            conf = float(detections[0, 0, i, 2])
            class_id = int(detections[0, 0, i, 1])
            if class_id != PERSON_CLASS_ID or conf < self.confidence:
                continue
            box = detections[0, 0, i, 3:7] * np.array([cw, ch, cw, ch])
            x1, y1, x2, y2 = box.astype("int")
            x1, y1 = max(0, int(x1)), max(0, int(y1))
            x2, y2 = min(cw - 1, int(x2)), min(ch - 1, int(y2))
            if x2 > x1 and y2 > y1:
                out.append((x1, y1, x2, y2, conf))
        return out

    def _tile_infer(self, crop: np.ndarray, size: int) -> list[tuple[int, int, int, int, float]]:
        """Divide o crop em 2 metades horizontais com overlap e roda inferência em cada.
        Quando 2 pessoas estão grudadas no centro do ROI, cada uma fica dominante
        em uma das metades — o detector identifica as 2 separadamente. NMS depois
        remove a duplicação na zona de overlap."""
        ch, cw = crop.shape[:2]
        if cw < 60:
            return self._infer(crop, size)
        overlap = max(20, int(cw * self.tile_overlap))
        mid = cw // 2
        left = crop[:, : mid + overlap]
        right = crop[:, mid - overlap :]
        b_left = self._infer(left, size)
        b_right = self._infer(right, size)
        # Reposiciona caixas da metade direita para coords do crop completo
        right_offset = mid - overlap
        b_right = [(x1 + right_offset, y1, x2 + right_offset, y2, c) for (x1, y1, x2, y2, c) in b_right]
        return b_left + b_right

    def _nms(self, boxes: list[tuple[int, int, int, int, float]]) -> list[tuple[int, int, int, int, float]]:
        if not boxes:
            return []
        rects = [[x1, y1, x2 - x1, y2 - y1] for (x1, y1, x2, y2, _) in boxes]
        scores = [c for (_, _, _, _, c) in boxes]
        idxs = cv2.dnn.NMSBoxes(rects, scores, self.confidence, self.nms_iou)
        if idxs is None or len(idxs) == 0:
            return []
        idxs = np.array(idxs).flatten()
        return [boxes[i] for i in idxs]

    def _split_merged(self, boxes: list[tuple[int, int, int, int, float]], crop_w: int) -> list[tuple[int, int, int, int, float]]:
        """Divide caixas que parecem fundir 2-3 pessoas.
        Critério: aspect-ratio (w/h) OU largura absoluta como fração do crop."""
        out: list[tuple[int, int, int, int, float]] = []
        for (x1, y1, x2, y2, conf) in boxes:
            w = x2 - x1
            h = max(1, y2 - y1)
            aspect = w / h
            width_ratio = w / max(1, crop_w)
            # 3 pessoas
            if aspect >= self.merged_aspect_3 or width_ratio >= self.merged_width_ratio_3:
                step = w // 3
                out.append((x1,              y1, x1 + step,     y2, conf * 0.92))
                out.append((x1 + step,       y1, x1 + 2 * step, y2, conf * 0.92))
                out.append((x1 + 2 * step,   y1, x2,            y2, conf * 0.92))
            # 2 pessoas
            elif aspect >= self.merged_aspect_2 or width_ratio >= self.merged_width_ratio_2:
                mid = (x1 + x2) // 2
                out.append((x1,  y1, mid, y2, conf * 0.95))
                out.append((mid, y1, x2,  y2, conf * 0.95))
            else:
                out.append((x1, y1, x2, y2, conf))
        return out

    @staticmethod
    def _centroid(b: tuple[int, int, int, int, float]) -> tuple[float, float]:
        x1, y1, x2, y2, _ = b
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    def _apply_persistence(self, detected: list[tuple[int, int, int, int, float]]) -> list[tuple[int, int, int, int, float]]:
        """Tracker simples por centroide: detecções somem por 1-2 frames? mantém como fantasma."""
        if self.persistence_frames <= 0:
            return detected
        # 1) Match cada track existente com a melhor detecção próxima
        used = [False] * len(detected)
        new_tracks: list[dict[str, Any]] = []
        for tr in self._tracks:
            tcx, tcy = self._centroid((*tr["box"], tr["conf"]))
            best_i, best_d = -1, self.track_max_distance
            for i, det in enumerate(detected):
                if used[i]:
                    continue
                dcx, dcy = self._centroid(det)
                d = ((tcx - dcx) ** 2 + (tcy - dcy) ** 2) ** 0.5
                if d < best_d:
                    best_d, best_i = d, i
            if best_i >= 0:
                # Track atualizada com detecção fresca
                x1, y1, x2, y2, c = detected[best_i]
                new_tracks.append({"box": (x1, y1, x2, y2), "conf": c, "ttl": self.persistence_frames})
                used[best_i] = True
            else:
                # Sem match — decrementa TTL; se ainda válido, mantém como fantasma
                tr["ttl"] -= 1
                if tr["ttl"] > 0:
                    new_tracks.append(tr)
        # 2) Detecções não matchadas viram tracks novas
        for i, det in enumerate(detected):
            if used[i]:
                continue
            x1, y1, x2, y2, c = det
            new_tracks.append({"box": (x1, y1, x2, y2), "conf": c, "ttl": self.persistence_frames})
        self._tracks = new_tracks
        # 3) Output = todos os tracks ativos
        return [(*tr["box"], tr["conf"]) for tr in self._tracks]

    def detect(self, frame: np.ndarray, roi: dict[str, int] | None) -> list[tuple[int, int, int, int, float]]:
        ox = oy = 0
        crop = frame
        if roi:
            x, y, w, h = roi["x"], roi["y"], roi["w"], roi["h"]
            crop = frame[y:y + h, x:x + w]
            ox, oy = x, y
        if crop.size == 0:
            return []

        # 1) Inferência — tile (recomendado, separa pessoas próximas) ou single
        if self.tile_split:
            boxes = self._tile_infer(crop, self.input_size)
        else:
            boxes = self._infer(crop, self.input_size)
        # Multi-escala opcional (custa caro — desligado por padrão)
        if self.multi_scale:
            secondary = 320 if self.backend == "yolov4-tiny" else 300
            if self.input_size != secondary:
                boxes += self._infer(crop, secondary)

        # 2) NMS — remove duplicatas (mesma pessoa detectada várias vezes / escalas)
        boxes = self._nms(boxes)

        # 3) Split por aspect-ratio / largura — separa pessoas grudadas
        crop_w = crop.shape[1]
        boxes = self._split_merged(boxes, crop_w)

        # 4) Translada coords do crop para o frame original
        boxes = [(x1 + ox, y1 + oy, x2 + ox, y2 + oy, c) for (x1, y1, x2, y2, c) in boxes]

        # 5) Persistência temporal — bridge de frames perdidos
        boxes = self._apply_persistence(boxes)
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
    # Libera todos os cores para o OpenCV/DNN (i5-13 tem 14 cores — usar tudo).
    cv2.setNumThreads(0)
    detector = PersonDetector(cfg)
    cap = open_camera(cfg)
    grabber = FrameGrabber(cap)
    frame_id = 0
    history: deque[int] = deque(maxlen=int(cfg["stable_window"]))
    last_sent_count: int | None = None
    last_post_at = 0.0
    boxes: list[tuple[int, int, int, int, float]] = []
    last_fps_t = time.time()
    fps_count = 0
    fps = 0.0

    print("[operadores] rodando. Teclas: q=sair, r=remarcar area.")
    try:
        while True:
            frame = grabber.read()
            if frame is None:
                time.sleep(0.005)
                continue
            frame = resize_frame(frame, int(cfg["max_frame_width"]))
            frame_id += 1
            now = time.time()
            fps_count += 1
            if now - last_fps_t >= 1.0:
                fps = fps_count / (now - last_fps_t)
                fps_count = 0
                last_fps_t = now

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
                cv2.putText(view, f"FPS {fps:.1f}", (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 200, 0), 2)
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
                print(f"[operadores] count={stable} fps={fps:.1f}")
    finally:
        grabber.stop()
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
