# 🤖 Bot DisplayForce — Instruções de Instalação e Uso

## O que o bot faz

A cada **10 minutos**, o bot automaticamente:
1. Busca todos os clientes ativos do seu Supabase
2. Acessa a DisplayForce e exporta o relatório "Visitors Insights" de cada cliente
3. Envia o relatório para `rayanne.ernandez@globaltera.com`
4. Baixa o arquivo Excel do e-mail recebido
5. Extrai e insere os dados na tabela `campaigns` do Supabase
6. O widget **Engajamento em Campanhas** no dashboard atualiza automaticamente

---

## PASSO 1 — Criar a tabela no Supabase

1. Acesse seu [Supabase](https://supabase.com) → projeto → **SQL Editor**
2. Cole o conteúdo do arquivo `create_campaigns_table.sql`
3. Clique em **Run**

---

## PASSO 2 — Instalar Python e dependências

> Precisa ter **Python 3.10+** instalado. Download: https://python.org

Abra o **Prompt de Comando** (cmd) na pasta do projeto e execute:

```bash
pip install playwright supabase pandas openpyxl schedule imap-tools
playwright install chromium
```

---

## PASSO 3 — Configurar a senha do e-mail

Abra o arquivo `bot_displayforce.py` e preencha:

```python
IMAP_PASSWORD = "SUA_SENHA_AQUI"   # ← coloque a senha do e-mail rayanne.ernandez@globaltera.com.br
```

### Configuração de servidor IMAP por provedor:

| Provedor | IMAP_SERVER | IMAP_PORT |
|----------|-------------|-----------|
| Microsoft 365 / Outlook | `outlook.office365.com` | `993` |
| Gmail | `imap.gmail.com` | `993` |
| Hotmail | `outlook.office365.com` | `993` |

> **Outlook/Microsoft 365:** pode ser necessário habilitar o acesso IMAP em:
> Outlook Web → Configurações → Email → Sync → Protocolo IMAP → Ativar

---

## PASSO 4 — Executar o bot

```bash
python bot_displayforce.py
```

O bot vai:
- Rodar imediatamente (primeira sincronização)
- Continuar rodando a cada 10 minutos até você fechar com `Ctrl+C`
- Salvar logs no arquivo `bot_displayforce.log`

---

## Como funciona o filtro de datas

O bot usa **sempre o dia atual** como período de exportação (00:00 → 23:59 no horário de Brasília), que é o mesmo filtro padrão do seu dashboard.

---

## Como os clientes são selecionados

O bot busca **automaticamente** todos os clientes com `status = 'active'` no Supabase. Não precisa configurar a lista manualmente.

> **Atenção:** o nome do cliente no Supabase precisa bater (ao menos parcialmente) com o nome do cliente na DisplayForce. Se um cliente não for encontrado na DisplayForce, ele será pulado e aparecerá um aviso no log.

---

## Logs

O arquivo `bot_displayforce.log` registra toda a execução:

```
2026-03-16 08:00:00 [INFO] 🤖 Iniciando bot
2026-03-16 08:00:01 [INFO] Clientes encontrados: ['Panvel', 'Assaí']
2026-03-16 08:00:05 [INFO]   Exportando relatório para: Panvel
2026-03-16 08:00:45 [INFO]   ✅ Relatório enviado para rayanne.ernandez@globaltera.com
2026-03-16 08:01:10 [INFO]   Relatório baixado: ./downloads_displayforce/relatorio_20260316_080110.xlsx
2026-03-16 08:01:11 [INFO]   14 campanhas extraídas do Excel
2026-03-16 08:01:12 [INFO]   ✅ 14 campanhas salvas no Supabase
```

---

## Solução de problemas

| Problema | Solução |
|----------|---------|
| "Login falhou" | Verifique `DISPLAYFORCE_EMAIL` e `DISPLAYFORCE_PASS` |
| "Timeout: nenhum e-mail recebido" | Verifique `IMAP_PASSWORD` e `IMAP_SERVER` |
| "Cliente não encontrado" | Confira se o nome no Supabase bate com o nome na DisplayForce |
| "Erro ao ler arquivo" | O Excel pode ter formato diferente — veja os logs para ver as colunas encontradas |
| Bot fecha sozinho | Adicione ao **Agendador de Tarefas** do Windows para iniciar automaticamente |

---

## Rodar como serviço no Windows (opcional)

Para o bot iniciar automaticamente com o Windows:

1. Pressione `Win + R` → digite `taskschd.msc`
2. Criar tarefa básica → "Bot DisplayForce"
3. Gatilho: "Ao iniciar o computador"
4. Ação: Iniciar programa → `python` → Argumentos: `C:\caminho\para\bot_displayforce.py`
