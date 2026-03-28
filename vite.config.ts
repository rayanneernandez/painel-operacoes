import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import type { IncomingMessage, ServerResponse } from 'http'
import type { ViteDevServer } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Carrega o .env manualmente para que process.env tenha SUPABASE_SERVICE_ROLE_KEY etc.
// O Vite só injeta variáveis com prefixo VITE_ — as demais precisam ser carregadas aqui.
function loadDotEnv() {
  const envPath = path.join(__dirname, '.env')
  try {
    const content = fs.readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  } catch { /* .env não encontrado — ok em produção */ }
}

loadDotEnv()

// Plugin que serve /api/* diretamente no servidor de dev do Vite
// sem precisar de segundo terminal ou Vercel CLI
function localApiPlugin() {
  return {
    name: 'local-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api/')) { next(); return; }

        // Lê body da requisição
        const rawBody = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })

        let parsedBody: any = {}
        try { parsedBody = rawBody ? JSON.parse(rawBody) : {} } catch { /* noop */ }

        // Monta req/res no formato que o handler espera (compatível com VercelRequest/VercelResponse)
        const mockReq: any = {
          method: req.method ?? 'POST',
          headers: req.headers,
          body: parsedBody,
          url: req.url,
          query: {},
        }

        let statusCode = 200
        const extraHeaders: Record<string, string> = {}

        const mockRes: any = {
          setHeader(k: string, v: string) { extraHeaders[k] = v },
          status(code: number) { statusCode = code; return mockRes },
          json(data: unknown) {
            const payload = JSON.stringify(data)
            res.writeHead(statusCode, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              ...extraHeaders,
            })
            res.end(payload)
          },
        }

        try {
          // ssrLoadModule compila o TypeScript em tempo real via Vite
          const apiPath = (req.url ?? '').split('?')[0].replace(/^\/api\//, '')
          const mod = await server.ssrLoadModule(`/api/${apiPath}.ts`)
          const handler = mod.default
          if (typeof handler !== 'function') { next(); return; }
          await handler(mockReq, mockRes)
        } catch (err: any) {
          console.error('[local-api] Erro:', err?.message ?? err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Erro interno no servidor local', details: err?.message }))
        }
      })
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), localApiPlugin()],
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          content: [
            "./index.html",
            "./src/**/*.{js,ts,jsx,tsx}",
          ],
          darkMode: 'class',
          theme: {
            extend: {},
          },
          plugins: [],
        }),
        autoprefixer,
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api-proxy': {
        target: 'https://api.displayforce.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy/, ''),
        secure: false,
      },
    },
  },
})

