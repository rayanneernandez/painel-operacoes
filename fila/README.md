# Fila - detector leve de corpos

Detector otimizado para CPU fraca, usando OpenCV DNN + MobileNet-SSD. Ele identifica pessoas na area marcada da camera USB, acompanha cada pessoa por centroide e envia sessoes para:

`POST /api/fila/sessao`

Payload enviado:

```json
{
  "track_uid": 104,
  "first_seen": 1778781600.5,
  "last_seen": 1778781625.8,
  "duration": 25.3,
  "source": "THE_LED"
}
```

## Instalar

```powershell
cd C:\Users\Administrador\Downloads\painel-operacoes-main\fila
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.json config.json
```

## Marcar area da fila

```powershell
python fila_detector.py --select-roi
```

Selecione a area desejada com o mouse, pressione ENTER para salvar ou ESC para cancelar.

## Rodar

```powershell
python fila_detector.py
```

Opcoes uteis:

```powershell
python fila_detector.py --source THE_LED --camera 0 --api-url https://visitor-api-48fe.onrender.com
python fila_detector.py --dry-run
python fila_detector.py --no-window
```

## Otimizacao

- Use ROI pequena.
- Mantenha `camera_width` em 640 e `process_every_n_frames` entre 3 e 5 em i5 4200/N100.
- Se perder pessoas, reduza `confidence` para 0.35.
- Se duplicar IDs, aumente `max_match_distance` ou `max_missed_frames`.
