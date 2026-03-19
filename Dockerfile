# ============================================================
#  Bot DisplayForce — Docker para Railway / Render / VPS
#  Suporta Playwright (Chromium headless) em ambiente cloud
# ============================================================
FROM python:3.11-slim

# Instala dependências do sistema para o Playwright/Chromium
RUN apt-get update && apt-get install -y \
    wget curl gnupg \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 \
    fonts-liberation libappindicator3-1 \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia e instala dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Instala o Chromium do Playwright
RUN playwright install chromium
RUN playwright install-deps chromium

# Copia o código do bot
COPY bot_displayforce.py .

# Cria pasta de downloads
RUN mkdir -p downloads_displayforce

# Variáveis de ambiente (sobrescritas pelo Railway/Render)
ENV DISPLAYFORCE_EMAIL=""
ENV DISPLAYFORCE_PASS=""
ENV RELATORIO_EMAIL=""
ENV IMAP_EMAIL=""
ENV IMAP_PASSWORD=""
ENV SUPABASE_URL=""
ENV SUPABASE_KEY=""
ENV HEADLESS="true"
ENV HORARIO_EXECUCAO="07:00"

CMD ["python", "-u", "bot_displayforce.py"]
