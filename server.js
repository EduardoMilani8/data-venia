// Servidor local sem dependências (Node 18+).
//   node server.js           → http://localhost:5173  (modo demonstração)
//   http://localhost:5173/?modo=api  → usa a rota /api/empresas abaixo
//
// Por que um servidor? A chave de um serviço de dados judiciais nunca pode ir para o navegador.
// O front pede /api/empresas, e o servidor busca com a chave guardada em variável de ambiente.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL(".", import.meta.url));
const PORTA = Number(process.env.PORT) || 5173;
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml" };

// Dados reais: gerados pelos scripts/ (osm → receita → casar → processos → cidade) e guardados em
// dados-reais/cidade-*.json, que nunca vão para o git. A chave da API só é usada por scripts/processos.mjs;
// este servidor apenas lê o resultado. Formato: o mesmo de js/dados/demo.js → gerarEmpresas().
const RAIO_METROS = 2000;
let cidades = null;
async function carregarCidades() {
  const { readdir } = await import("node:fs/promises");
  const arquivos = (await readdir(join(RAIZ, "dados-reais")).catch(() => [])).filter((f) => /^cidade-.+\.json$/.test(f));
  return (await Promise.all(arquivos.map((f) => readFile(join(RAIZ, "dados-reais", f), "utf8").then(JSON.parse)))).flat();
}
async function empresasReais(lat, lng) {
  cidades ??= await carregarCidades();
  if (!cidades.length) {
    const e = new Error("Nenhum dados-reais/cidade-*.json. Rode os scripts/ (veja o README).");
    e.status = 501;
    throw e;
  }
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  return cidades.filter((e) => Math.hypot((e.lng - lng) * kx, (e.lat - lat) * 110540) <= RAIO_METROS);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/empresas") {
    try {
      const dados = await empresasReais(Number(url.searchParams.get("lat")), Number(url.searchParams.get("lng")));
      res.writeHead(200, { "content-type": TIPOS[".json"] }).end(JSON.stringify(dados));
    } catch (err) {
      res.writeHead(err.status || 500, { "content-type": TIPOS[".json"] }).end(JSON.stringify({ erro: err.message }));
    }
    return;
  }

  const caminho = normalize(join(RAIZ, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  // Fora da pasta, dados brutos, scripts e arquivos ocultos (.env, .git) não são servidos.
  const relativo = caminho.slice(RAIZ.length);
  if (!caminho.startsWith(RAIZ) || /^(dados-reais|scripts|node_modules)(\/|$)|(^|\/)\./.test(relativo)) return res.writeHead(403).end();
  try {
    const corpo = await readFile(caminho);
    res.writeHead(200, { "content-type": TIPOS[extname(caminho)] || "application/octet-stream" }).end(corpo);
  } catch {
    res.writeHead(404).end("Não encontrado");
  }
}).listen(PORTA, () => console.log(`Data Venia em http://localhost:${PORTA}`));
