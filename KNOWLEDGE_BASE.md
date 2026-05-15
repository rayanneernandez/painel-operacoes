# Knowledge Base — Painel de Operações (GlobalTera)

> Documento de referência completo para o projeto. Leia este arquivo antes de qualquer tarefa de desenvolvimento.

---

## 1. Visão Geral

Sistema de analytics e monitoramento operacional para clientes de varejo.  
Desenvolvido pela **GlobalTera** — o produto tem dois tipos de dashboard:

| Dashboard | Rota | Para quem |
|-----------|------|-----------|
| **Dashboard Geral** | `/clientes/:id/dashboard` | Todos os clientes — métricas de visitantes, gênero, idade, atributos, campanhas |
| **Painel BRF Exclusivo** | `/clientes/:id/brf` | Apenas o cliente BRF (`id = b93d290b-b069-4715-84cc-ddc393c9bfc1`) — ruptura de gôndola, operação de atendentes, fila |

---

## 2. Stack Tecnológica

### Frontend
- **React 18.3.1** + **TypeScript** + **Vite 5**
- **TailwindCSS 3** — tema escuro, `bg-[#0d1117]` como base
- **React Router v6** — SPA com rotas em `src/App.tsx`
- **Lucide React** — ícones
- **Chart.js** — carregado via CDN no `index.html` (`window.Chart`), NÃO instalado como módulo npm
- **React Three Fiber 8.17.14** + **Three.js** + **@react-three/drei** — gôndola 3D no painel BRF
- **@anthropic-ai/sdk** — chat IA "Lia" (`dangerouslyAllowBrowser: true`)
- **@supabase/supabase-js** — banco de dados

### Backend / Infra
- **Supabase** (PostgreSQL) — banco principal
- **Vercel** — deploy do frontend e serverless functions em `/api/`
- **Python** — script de dispositivo (`device/analyzer.py`)

### Python (dispositivo de loja)
- `anthropic` — envia frames ao Claude Sonnet 4.6
- `supabase` — salva resultados no banco
- `opencv-python` — captura frames da câmera
- `python-dotenv`

---

## 3. Estrutura de Arquivos

```
painel-operacoes-main/
├── src/
│   ├── pages/
│   │   ├── ClientDashboard.tsx          # Dashboard geral (visitantes)
│   │   ├── ClientDashboardBRF.tsx       # Painel exclusivo BRF
│   │   ├── ClientDashboardConfig.tsx    # Configurações de layout
│   │   ├── ClientsNew.tsx               # CRUD de clientes
│   │   └── DevicesOnline.tsx            # Monitoramento de dispositivos
│   ├── components/
│   │   ├── DashboardChat.tsx            # Widget flutuante "Lia" (IA)
│   │   ├── DashboardWidgets.tsx         # Widgets do dashboard geral
│   │   ├── Gondola3D.tsx                # Visualização 3D da gôndola (BRF)
│   │   └── ExportButton.tsx             # Exportação PDF/Excel
│   ├── lib/
│   │   ├── supabase.ts                  # Cliente Supabase (anon key)
│   │   └── brf-pipeline.ts              # Pipeline browser-side BRF (não usado em prod)
│   └── App.tsx                          # Rotas principais
├── device/
│   ├── analyzer.py                      # Worker Python — câmera → Sonnet → Supabase
│   ├── test_image.py                    # Teste manual com imagem estática
│   ├── requirements.txt                 # anthropic, supabase, opencv-python, python-dotenv
│   └── .env                             # Variáveis do dispositivo
├── supabase/
│   └── migrations/
│       └── 001_brf_vision_architecture.sql   # Schema das tabelas BRF
├── api/                                 # Serverless functions Vercel
│   ├── cron-sync.ts
│   ├── cron-monitoring.ts
│   ├── sync-analytics.ts
│   └── proxy.ts
├── public/
│   ├── lia.png                          # Avatar da assistente Lia
│   └── gondola/
│       ├── pos4.png                     # Imagem produto posição 4
│       ├── pos5.png                     # Imagem produto posição 5
│       └── pos6.png                     # Imagem produto posição 6
├── .env                                 # Variáveis de ambiente (frontend + scripts)
├── KNOWLEDGE_BASE.md                    # Este arquivo
└── package.json
```

---

## 4. Variáveis de Ambiente

### `.env` (raiz do projeto — frontend Vite)
```env
# Anthropic — chat IA Lia
VITE_ANTHROPIC_API_KEY=sk-ant-api03-...

# Supabase — frontend (anon key, segura para browser)
VITE_SUPABASE_URL=https://zkzpvaabjchwnnvuwuls.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...

# Supabase — scripts server-side (service role, NUNCA expor no browser)
SUPABASE_URL=https://zkzpvaabjchwnnvuwuls.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# DisplayForce (integração câmeras)
VITE_DISPLAYFORCE_TOKEN=S4VY-ZP65-KSRN-4Q7R
DISPLAYFORCE_EMAIL=bruno.lyra@globaltera.com.br
DISPLAYFORCE_PASS=Tony@2023

# E-mail (relatórios e IMAP)
RELATORIO_EMAIL=rayanne.ernandez@globaltera.com.br
IMAP_EMAIL=rayanne.ernandez@globaltera.com.br
IMAP_PASSWORD=nfav lshi hfax jhvu
IMAP_SERVER=imap.gmail.com
IMAP_PORT=993

# Bot config
TIMEOUT_EMAIL_SEG=1200
HEADLESS=true
SYNC_INTERVAL_MIN=10
```

### `device/.env` (dispositivo de loja — Python)
```env
ANTHROPIC_API_KEY=sk-ant-api03-...
SUPABASE_URL=https://zkzpvaabjchwnnvuwuls.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
BRF_CLIENT_ID=b93d290b-b069-4715-84cc-ddc393c9bfc1

# Opcionais
BRF_STORE_ID=
BRF_CAMERA_ID=
BRF_PLANOGRAM_ID=
```

---

## 5. Banco de Dados (Supabase / PostgreSQL)

### 5.1 Tabelas Gerais (todos os clientes)

| Tabela | Descrição |
|--------|-----------|
| `clients` | Cadastro de clientes (id, name, logo_url, status, plan…) |
| `stores` | Lojas de cada cliente (client_id, name, city, state…) |
| `devices` | Dispositivos/câmeras (store_id, name, mac_address, type…) |
| `users` | Usuários do sistema (client_id, email, role…) |
| `visitor_sessions` | Sessões de visitantes capturadas pelos dispositivos |
| `visitor_analytics` | Analytics individuais de visita |
| `visitors` | Visitantes (age, gender, emotion…) |
| `dashboard_configs` | Configurações de layout salvas por cliente (widgets_config jsonb) |
| `client_api_configs` | Configs de API externa por cliente |
| `client_permissions` | Permissões de acesso por cliente |

### 5.2 Tabelas BRF (painel exclusivo)

Todas as tabelas BRF têm `client_id` obrigatório. `store_id` é **nullable** (BRF não usa conceito de loja no painel exclusivo).

#### `brf_rupture_alerts`
Alertas de ruptura de gôndola gerados pelo Sonnet.
```sql
id uuid PK
client_id uuid NOT NULL
store_id uuid  -- nullable
severity text  -- 'orange' (estoque baixo) | 'red' (ruptura)
planogram_position_id uuid
snapshot_id uuid
product_code text
product_name text
confidence float
resolved_at timestamptz
created_at timestamptz
```

#### `brf_operation_detections`
Snapshot de quantos atendentes estão no stand.
```sql
id uuid PK
snapshot_id uuid
store_id uuid NOT NULL
client_id uuid NOT NULL
attendant_count int   -- 0, 1, 2, 3...
is_preparing boolean
details jsonb         -- {"summary": "..."}
detected_at timestamptz
```

#### `brf_prep_sessions`
Sessões de preparo identificadas pelo analyzer.
```sql
id uuid PK
store_id uuid
client_id uuid
started_at timestamptz
ended_at timestamptz
attendant_count_avg float
```

#### `brf_queue_detections`
Snapshot da quantidade de pessoas na fila.
```sql
id uuid PK
snapshot_id uuid
store_id uuid NOT NULL
client_id uuid NOT NULL
people_count int
details jsonb
detected_at timestamptz
```

#### `brf_queue_sessions`
Sessões individuais de espera de cada pessoa.
```sql
id uuid PK
store_id uuid
client_id uuid
entered_at timestamptz
exited_at timestamptz
wait_seconds int
tracking_id text
```

#### `brf_vision_snapshots`
Registro de cada frame enviado ao Sonnet.
```sql
id uuid PK
camera_id uuid
store_id uuid
client_id uuid
function text   -- 'ruptura' | 'operacao' | 'fila'
image_url text
analyzed_at timestamptz
model_used text  -- 'claude-sonnet-4-6'
processing_ms int
raw_response jsonb
```

#### `brf_gondola_status`
Status atual de cada posição do planograma.
```sql
id uuid PK
planogram_position_id uuid
snapshot_id uuid
store_id uuid
client_id uuid
status text   -- 'ok' | 'warning' | 'rupture'
confidence float
updated_at timestamptz
details jsonb
```

#### `brf_planograms` / `brf_planogram_positions`
Definição do planograma (quais produtos em quais posições).
```sql
-- brf_planogram_positions
id uuid PK
planogram_id uuid
column_number int   -- 4, 5, 6
shelf_number int    -- 1 (inferior), 2 (meio), 3 (superior)
product_code text
product_name text
product_image_url text
```

### 5.3 Views BRF

| View | Descrição |
|------|-----------|
| `brf_gondola_current` | Último status de cada posição (alimenta gôndola 3D) |
| `brf_queue_now` | Pessoas na fila nos últimos 5 minutos |
| `brf_queue_hourly` | Média/máximo de pessoas por hora |
| `brf_operation_hourly` | Média de atendentes e contagem de preparos por hora |

---

## 6. Painel BRF — `ClientDashboardBRF.tsx`

### Identificação do cliente
```typescript
const BRF_CLIENT_ID = 'b93d290b-b069-4715-84cc-ddc393c9bfc1';
// A rota /clientes/:id/brf só renderiza o painel se id === BRF_CLIENT_ID
```

### Seções e Widgets

O dashboard é dividido em 3 seções, cada uma com KPIs à esquerda e gráfico à direita:

#### Seção: Ruptura (`section_rupture`)
| Widget ID | Tipo | Descrição |
|-----------|------|-----------|
| `rupture_orange` | KPI | Alertas laranja (estoque baixo) |
| `rupture_red` | KPI | Alertas vermelho (ruptura confirmada) |
| `rupture_hourly` | Gráfico linha | Quantidade de rupturas por hora (0-23h) |

Abaixo dos gráficos há a **gôndola 3D** (React Three Fiber) com os produtos das posições 4, 5, 6 e cards de status ao lado.

#### Seção: Operação (`section_operation`)
| Widget ID | Tipo | Descrição |
|-----------|------|-----------|
| `op_hours_two` | KPI verde | Total de horas com 2+ operadores |
| `op_hours_one` | KPI laranja | Total de horas com 1 operador |
| `op_hours_zero` | KPI vermelho | Total de horas com 0 operadores |
| `op_dist_chart` | Gráfico barra horizontal | % do tempo por nível de cobertura |

**Como as horas são calculadas:** detecções de `brf_operation_detections` são ordenadas por tempo. O gap entre detecções consecutivas (máx 10 min) é atribuído ao bucket de `attendant_count` daquela detecção. Total em segundos é convertido para horas.

#### Seção: Fila (`section_queue`)
| Widget ID | Tipo | Descrição |
|-----------|------|-----------|
| `queue_total` | KPI | Total de pessoas no período |
| `queue_avg` | KPI | Tempo médio de espera (mm:ss) |
| `queue_now` | KPI | Pessoas na fila agora (atualiza a cada 5 min) |
| `queue_rate` | KPI | Taxa de ocupação (tempo médio × pessoas agora) |
| `queue_line` | Gráfico linha | Pessoas por hora ao longo do dia |

### Layout customizável
O usuário pode reordenar widgets por drag-and-drop. O layout é salvo em:
- `localStorage` com chave `dashboard-config-brf-{client_id}`
- Tabela `dashboard_configs` com `layout_name = 'client_brf_user'`

**Migração automática:** se o layout salvo contiver IDs antigos (`op_total_preps`, `op_avg_prep`, `op_prep_line`, `queue_p95`, `queue_max`), é resetado para o padrão atual.

---

## 7. Script de Dispositivo — `device/analyzer.py`

Worker Python que roda continuamente na loja. A cada intervalo:
1. Captura frame da câmera via OpenCV
2. Converte para base64
3. Envia ao Sonnet 4.6 com prompt especializado
4. Salva resultado no Supabase

### Uso
```bash
python analyzer.py --module ruptura  --camera 0 --interval 300
python analyzer.py --module operacao --camera 1 --interval 60
python analyzer.py --module fila     --camera 2 --interval 30
python analyzer.py --module ruptura  --camera 0 --once   # roda uma vez e sai
```

### Módulos e prompts

**`ruptura`** — analisa gôndola, retorna status por posição:
```json
{
  "positions": [
    {
      "column_number": 4,
      "shelf_number": 1,
      "status": "ok|warning|rupture",
      "confidence": 0.95,
      "product_match": true
    }
  ],
  "summary": "descrição geral"
}
```
O planograma hardcoded no prompt:
- Coluna 4: Peito de Peru Fatiado Soltíssimo (embalagem vermelha/branca)
- Coluna 5: Filé Mignon Suíno Mignoneto Sadia 180g (embalagem amarela/vermelha)
- Coluna 6: Presunto Cozido Fatiado 180g (embalagem rosa/branca)
- Prateleiras: 1 = inferior, 2 = meio, 3 = superior

**`operacao`** — analisa stand de atendimento:
```json
{
  "attendant_count": 2,
  "is_preparing": true,
  "summary": "dois atendentes, um manipulando produtos"
}
```

**`fila`** — conta pessoas na fila:
```json
{
  "people_count": 5,
  "summary": "fila moderada, 5 pessoas aguardando"
}
```

### Teste manual
```bash
# device/test_image.py — envia imagem estática, NÃO salva no banco
python test_image.py foto.jpg
```

---

## 8. Assistente IA "Lia" — `DashboardChat.tsx`

Widget flutuante de chat disponível em ambos os dashboards.

### Aparência
- Botão circular fixo (bottom-right), mostra avatar `/public/lia.png`
- Painel de chat 360×520px, tema escuro
- Ícone de usuário para mensagens do usuário, avatar Lia para respostas

### Funcionamento
```typescript
// Props do componente
type ChatContext = {
  dashboardName: string;
  data: Record<string, unknown>;  // dados atuais do dashboard
};
type QueryFn = (startDate: string, endDate: string) => Promise<Record<string, unknown>>;

<DashboardChat context={context} queryFn={queryFn} />
```

### Fluxo técnico
1. Usa `anthropic.messages.stream()` para streaming real
2. Tool use: ferramenta `buscar_dados` com `data_inicio` e `data_fim`
3. Se Lia quiser dados históricos → executa `queryFn` → segunda chamada com dados reais
4. System prompt instrui: responder SEMPRE em português, NUNCA retornar JSON, interpretar números em linguagem natural

### System prompt (resumo)
```
Você é a Lia, assistente de análise de dados integrada ao dashboard "{dashboardName}".
Seja simpática e objetiva. Responda SEMPRE em português, em linguagem natural e amigável para o usuário final.
NUNCA retorne JSON, listas técnicas ou dados brutos. Sempre interprete os números e escreva frases completas.
Hoje é {data_atual}.
DADOS ATUALMENTE EXIBIDOS NO DASHBOARD: {JSON do estado atual}
Quando o usuário perguntar sobre outra data ou período, use a ferramenta buscar_dados.
```

### Modelo usado
`claude-sonnet-4-6` — direto no browser com `dangerouslyAllowBrowser: true`

---

## 9. Dashboard Geral — `ClientDashboard.tsx`

Para todos os clientes. Lê dados de visitantes da DisplayForce/API externa.

### Principais métricas exibidas
- Total de visitantes no período
- Média de visitantes por dia
- Tempo médio de visita / atenção (segundos)
- Distribuição por gênero (masculino/feminino)
- Distribuição por faixa etária
- Heatmap por hora do dia
- Atributos físicos (óculos, chapéu, cor de cabelo, etc.)
- Campanhas exibidas

### Fonte de dados
Tabelas: `visitor_sessions`, `visitor_analytics`, `visitors`, `stores`, `devices`

### Chat Lia no dashboard geral
```typescript
<DashboardChat
  context={{
    dashboardName: clientData.name,
    data: {
      visitantes: { totalVisitors, avgVisitorsPerDay, avgVisitSeconds, ... },
      genero: { ... },
      idade: { ... },
      atributos: { ... },
    },
  }}
/>
// Sem queryFn — Lia não busca dados históricos no dashboard geral
```

---

## 10. Gôndola 3D — `Gondola3D.tsx`

Componente React Three Fiber que renderiza representação 3D das posições 4, 5 e 6 da gôndola.

### Props
```typescript
type ProductSlot = {
  position: number;      // 4, 5 ou 6
  code: string;          // código do produto
  name: string;          // nome do produto
  image: string;         // URL da imagem (/gondola/posX.png)
  status: 'ok' | 'warning' | 'rupture';
};

<Gondola3D
  products={gondolaProducts}
  onSlotClick={(product) => setSelectedGondolaProduct(product)}
/>
```

### Cores por status
- `ok` → verde (`#10b981`)
- `warning` → laranja (`#f97316`)
- `rupture` → vermelho (`#ef4444`)

---

## 11. Padrões de Código

### Chart.js no projeto
Chart.js é carregado via CDN, não como pacote npm. Para usar:
```typescript
function useChartJs(canvasRef, configFn, deps) {
  // Hook customizado que espera window.Chart estar disponível
  // Destrói instância anterior antes de criar nova
}
```
Nunca usar `import Chart from 'chart.js'`.

### Tema visual
```
Fundo principal:     #0d1117
Fundo secundário:    #161b22
Bordas:              border-gray-800/60
Texto principal:     text-white
Texto secundário:    text-gray-400
Accent ruptura:      #f97316 (orange), #ef4444 (red)
Accent operação:     #10b981 (emerald)
Accent fila:         #38bdf8 (sky)
Accent IA/Lia:       #7c3aed (violet)
```

### KPI Card — tons disponíveis
```typescript
tone: 'neutral' | 'orange' | 'red'
// neutral = borda cinza, ícone verde
// orange  = borda laranja, fundo gradiente laranja
// red     = borda vermelha, fundo gradiente vermelho
```

### Supabase — como usar
```typescript
import supabase from '../lib/supabase';  // anon key
// Service role key NUNCA no frontend — só em scripts Python/server
```

### Tratamento de tabelas inexistentes
```typescript
// Erro PGRST = tabela não existe no schema cache
if (String(error.code || '').includes('PGRST')) {
  missingTablesRef.current.rupture = true;
  // Não tenta de novo
}
```

---

## 12. IDs Importantes

| Recurso | ID |
|---------|----|
| Cliente BRF | `b93d290b-b069-4715-84cc-ddc393c9bfc1` |
| Cliente Assai | `b1c05e4d-0417-4853-9af9-8c0725df1880` |
| Cliente Panvel | `c6999bd9-14c0-4e26-abb1-d4b852d34421` |

---

## 13. Comandos Úteis

```bash
# Desenvolvimento
npm run dev              # Inicia Vite na porta 5173

# Build
npm run build            # Build para produção

# Dispositivo Python
cd device
pip install -r requirements.txt
python analyzer.py --module ruptura --camera 0 --interval 300

# Teste rápido com imagem
python test_image.py foto.jpg
```

---

## 14. Integrações Externas

| Serviço | Uso |
|---------|-----|
| **Anthropic / Claude** | Chat IA Lia (browser) + análise de imagens (Python) — modelo `claude-sonnet-4-6` |
| **Supabase** | Banco de dados PostgreSQL principal |
| **DisplayForce** | Fonte de dados de visitantes (câmeras de reconhecimento) |
| **Vercel** | Deploy + serverless functions (`/api/`) |
| **Gmail IMAP** | Leitura de relatórios por e-mail |

---

## 15. Decisões de Design Relevantes

- **BRF não tem filtro de loja/dispositivo** — painel exclusivo opera sem `store_id` obrigatório; todos os campos de loja são nullable nas tabelas BRF.
- **Chart.js via CDN** — evita bundle grande; carregado no `index.html`.
- **`dangerouslyAllowBrowser: true`** no Anthropic SDK — deliberado para o chat funcionar direto no browser sem proxy.
- **Streaming real** no chat — usa `anthropic.messages.stream()`, não fake word-by-word.
- **Tool use para dados históricos** — Lia pode buscar qualquer período via ferramenta `buscar_dados`, não fica limitada ao estado atual do dashboard.
- **Migração automática de layout** — IDs antigos de widget são detectados e o layout é resetado para o padrão, evitando tela em branco.
- **Sem FK entre tabelas BRF** — todas as referências são por UUID simples, sem foreign key constraint, para facilitar inserção do Python sem dependências de ordem.
