"""
Teste rápido: envia uma imagem estática ao Sonnet e mostra o resultado.
Não precisa de câmera nem salva nada no banco.

Uso:
  python test_image.py caminho/para/foto.jpg
"""

import base64
import json
import sys
import os
from dotenv import load_dotenv
import anthropic

load_dotenv()

MODEL_ID = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip()

PROMPT = """
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

Também informe se o produto visível na posição corresponde ao planograma acima.

Responda SOMENTE com JSON válido, sem markdown, sem texto extra:
{
  "positions": [
    {
      "column_number": <4, 5 ou 6>,
      "shelf_number": <1, 2 ou 3>,
      "status": "ok|warning|rupture",
      "confidence": <0.0 a 1.0>,
      "product_match": <true se produto visível bate com planograma, false se produto errado, null se vazio>
    }
  ],
  "summary": "<descrição objetiva do estado geral da gôndola>"
}
""".strip()

def main():
    if len(sys.argv) < 2:
        print("Uso: python test_image.py <caminho_da_imagem>")
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"Arquivo não encontrado: {path}")
        sys.exit(1)

    with open(path, "rb") as f:
        data = base64.standard_b64encode(f.read()).decode()

    ext = path.lower().split(".")[-1]
    media_type = "image/png" if ext == "png" else "image/jpeg"

    print(f"Enviando {path} ao Sonnet ({MODEL_ID})...")
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msg = client.messages.create(
        model=MODEL_ID,
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    )

    raw = next((b.text for b in msg.content if b.type == "text"), "")
    print("\n── Resposta bruta ──────────────────────")
    print(raw)

    # Remove markdown code block se vier com ```json ... ```
    clean = raw.strip()
    if clean.startswith("```"):
        clean = "\n".join(clean.split("\n")[1:])
    if clean.endswith("```"):
        clean = "\n".join(clean.split("\n")[:-1])

    try:
        parsed = json.loads(clean)
        print("\n── Resultado ───────────────────────────")
        print(f"Resumo: {parsed.get('summary')}")
        print()
        for p in parsed.get("positions", []):
            status_icon = {"ok": "✓", "warning": "⚠", "rupture": "✗"}.get(p["status"], "?")
            match = p.get("product_match")
            match_str = "" if match is None else (" [produto OK]" if match else " [PRODUTO ERRADO]")
            print(f"  {status_icon} Col {p['column_number']} Prat {p['shelf_number']} — "
                  f"{p['status'].upper()} (conf: {p.get('confidence', 0):.0%}){match_str}")
    except json.JSONDecodeError:
        print("\n[AVISO] Resposta não é JSON válido — ajuste o prompt se necessário")

if __name__ == "__main__":
    main()
