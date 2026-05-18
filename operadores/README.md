# Operadores - detector leve de corpos

Detector otimizado para CPU fraca, usando OpenCV DNN + MobileNet-SSD. Ele identifica pessoas na area marcada da camera USB, estabiliza a contagem e envia a quantidade atual para:

`POST /api/operadores/status`

Payload enviado:

```json
{
  "operadores": 2,
  "source": "THE_LED",
  "ts": 1778781625.8
}
```

## Instalar

```powershell
cd C:\Users\Administrador\Downloads\painel-operacoes-main\operadores
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.json config.json
```

## Marcar area dos operadores

```powershell
python operadores_detector.py --select-roi
```

Selecione apenas a regiao onde os funcionarios trabalham. Isso evita contar clientes.

## Rodar

```powershell
python operadores_detector.py
```

Opcoes uteis:

```powershell
python operadores_detector.py --source THE_LED --camera 0 --api-url https://visitor-api-48fe.onrender.com
python operadores_detector.py --dry-run
python operadores_detector.py --no-window
```

## Otimizacao

- Use ROI pequena e camera em 640x360.
- `stable_window` evita oscilacao entre 0/1/2.
- `cap_count` vem como 2 por padrao, porque o dashboard usa 2+ operadores.
- Em i5 4200/N100 use `process_every_n_frames` entre 3 e 5.
