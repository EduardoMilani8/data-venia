// Passo 4 dos dados reais (fonte gratuita): processos de cada empresa no DJEN, o Diário de Justiça
// Eletrônico Nacional do CNJ. Não precisa de cadastro nem de chave.
// Uso: node scripts/djen.mjs dados-reais/casamento-passo-fundo.json [--max 10] [--tribunais TJRS,TRT4,TRF4] [--comarca "PASSO FUNDO"]
//
// Como funciona: busca as publicações pelo nome da empresa (razão social da Receita), confere que a
// publicação é mesmo dela, agrupa por número de processo e grava em dados-reais/processos/<básico>.json,
// no mesmo formato dos fornecedores pagos (scripts/processos.mjs). Assim o resto do caminho não muda.
//
// Limites, para saber o que o mapa mostra:
//   - a busca é por NOME, não por CNPJ: cada publicação é conferida contra a razão social;
//   - só aparecem processos com publicação no diário (histórico recente, não a vida toda da empresa);
//   - não há valor da causa nem assunto detalhado (o DataJud pode completar isso depois).
// Privacidade: o texto das publicações NÃO é guardado. De cada parte, só fica o nome se for claramente
// uma empresa ou órgão público; pessoas viram "pessoa física", sem nome. Advogados são descartados.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import net from "node:net";
import { API_DJEN, consultarEmpresa } from "../js/dados/djen.js";

net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const args = process.argv.slice(2);
const arqCasamento = args[0];
const opcao = (nome, padrao) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : padrao; };
const MAX = Number(opcao("--max", 10));
const TRIBUNAIS = opcao("--tribunais", "TJRS,TRT4,TRF4").split(",");
const COMARCA = opcao("--comarca", "PASSO FUNDO");          // "todas" para não filtrar
if (!arqCasamento) throw new Error("Uso: node scripts/djen.mjs <casamento.json> [--max N] [--tribunais ...] [--comarca ...]");

const PASTA = "dados-reais/processos";
await mkdir(PASTA, { recursive: true });

// As regras (conferir a empresa, filtrar a comarca, esconder pessoas) ficam em js/dados/djen.js,
// as mesmas que a busca ao vivo do navegador usa.
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function pedir(params) {
  const url = new URL(API_DJEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "user-agent": "data-venia/0.1 (projeto pessoal)" } });
      if (r.ok) { await espera(1000); return r.json(); }   // ~1 pedido por segundo, abaixo do limite de 20/min por folga
      if ((r.status === 429 || r.status >= 500) && tentativa <= 5) { await espera(5000 * tentativa); continue; }
      throw new Error(`DJEN respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
    } catch (e) {
      if (tentativa > 5 || !/fetch failed|ETIMEDOUT|ECONNRESET/.test(e.message + e.cause?.code)) throw e;
      await espera(5000 * tentativa);
    }
  }
}
const buscarEmpresa = (razao, cnpj) =>
  consultarEmpresa({ razao, cnpj, comarca: COMARCA === "todas" ? null : COMARCA, tribunais: TRIBUNAIS }, pedir);

// ---------- Quem consultar ----------
const casamento = JSON.parse(await readFile(arqCasamento, "utf8"));
const empresas = new Map();
for (const l of casamento) {
  if (!["alta", "média", "revisada"].includes(l.confianca) || l.pessoa || !l.razao) continue;
  if (!empresas.has(l.basico)) empresas.set(l.basico, { cnpj: l.cnpj, razao: l.razao });
}
const existe = (f) => access(f).then(() => true, () => false);
const pendentes = [];
for (const [basico, e] of empresas) if (!(await existe(`${PASTA}/${basico}.json`))) pendentes.push({ basico, ...e });
console.log(`${empresas.size} empresas; ${empresas.size - pendentes.length} já consultadas; consultando ${Math.min(MAX, pendentes.length)} ` +
  `(tribunais ${TRIBUNAIS.join(", ")}; comarca ${COMARCA}).`);

for (const { basico, cnpj, razao } of pendentes.slice(0, MAX)) {
  try {
    const r = await buscarEmpresa(razao, cnpj);
    await writeFile(`${PASTA}/${basico}.json`, JSON.stringify({
      basico, fonte: "djen", tribunais: TRIBUNAIS, comarca: COMARCA, consultado_em: new Date().toISOString(),
      envolvido: { nome: razao, quantidade_processos: r.processos.length }, processos: r.processos,
    }, null, 1));
    console.log(`  ${razao.slice(0, 45).padEnd(45)} ${String(r.processos.length).padStart(3)} processos  ` +
      `(${r.publicacoes} publicações; ${r.descartadas} de homônimos; ${r.foraDaComarca} de outras comarcas)`);
  } catch (e) {
    console.error(`  ${razao}: ${e.message}`);
  }
}
console.log(`Faltam ${Math.max(0, pendentes.length - MAX)} empresas.`);
