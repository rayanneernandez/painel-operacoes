# ============================================================
#  Bot DisplayForce — Docker para Railway
#  Usa imagem oficial do Playwright que já tem Chromium + deps
# ============================================================

# Imagem oficial do Playwright com Python — já tem tudo instalado
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

WORKDIR /app

# Instala dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia o código do bot
COPY bot_displayforce.py .

# Cria pasta de downloads
RUN mkdir -p downloads_displayforce

# Variáveis de ambiente (sobrescritas pelo Railway)
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
