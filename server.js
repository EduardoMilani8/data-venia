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

// Pipeline de dados reais, a implementar:
//   1. Empresas por perto: base aberta de CNPJs da Receita Federal (endereço de cada
//      estabelecimento), geocodificada uma vez e salva num banco com índice geográfico.
//   2. Processos por CNPJ: serviço pago com API (Escavador, Judit, Digesto, Jusbrasil…).
//      Guarde em cache: é caro e muda pouco.
//   3. Filtre antes de devolver: só pessoas jurídicas, sem MEI, sem nomes de pessoas físicas,
//      sem processos em segredo de justiça.
// Formato esperado da resposta: o mesmo de js/dados/demo.js → gerarEmpresas().
async function empresasReais(lat, lng) {
  if (!process.env.PROCESSOS_API_TOKEN) {
    const e = new Error("Defina PROCESSOS_API_TOKEN e implemente empresasReais() no server.js.");
    e.status = 501;
    throw e;
  }
  const e = new Error("empresasReais() ainda não foi implementada.");
  e.status = 501;
  throw e;
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
  if (!caminho.startsWith(RAIZ)) return res.writeHead(403).end();
  try {
    const corpo = await readFile(caminho);
    res.writeHead(200, { "content-type": TIPOS[extname(caminho)] || "application/octet-stream" }).end(corpo);
  } catch {
    res.writeHead(404).end("Não encontrado");
  }
}).listen(PORTA, () => console.log(`Data Venia em http://localhost:${PORTA}`));
