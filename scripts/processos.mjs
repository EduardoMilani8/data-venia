// Passo 4 dos dados reais: busca os processos de cada empresa ligada, na API do BuscaProcessos.
// Uso (a chave fica em .env, como PROCESSOS_API_TOKEN=...):
//   node --env-file=.env scripts/processos.mjs dados-reais/casamento-passo-fundo.json --max 5
//   node scripts/processos.mjs dados-reais/casamento-passo-fundo.json --simular resposta.json   (sem gastar nada)
// Opções:
//   --max N            quantas empresas consultar nesta rodada (padrão 5)
//   --tribunais LISTA  siglas separadas por vírgula (padrão TJRS,TRT-4); "todos" tira o filtro
//
// Cada empresa vira um arquivo em dados-reais/processos/<cnpj básico>.json. Empresa já baixada não é
// consultada de novo, então dá para rodar aos poucos e conferir o custo.
// Antes de gravar, apaga dados de pessoas: nomes e CPFs de pessoas físicas, advogados, sócios.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import net from "node:net";

net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const args = process.argv.slice(2);
const arqCasamento = args[0];
const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const MAX = Number(opcao("--max") ?? 5);
const SIMULAR = opcao("--simular");
const TRIBUNAIS = (opcao("--tribunais") ?? "TJRS,TRT-4") === "todos" ? null : (opcao("--tribunais") ?? "TJRS,TRT-4");
const TOKEN = process.env.PROCESSOS_API_TOKEN;
if (!arqCasamento) throw new Error("Uso: node scripts/processos.mjs <casamento.json> [--max N] [--tribunais TJRS,TRT-4] [--simular resposta.json]");
if (!TOKEN && !SIMULAR) throw new Error("Defina PROCESSOS_API_TOKEN no .env (a chave da API do BuscaProcessos) ou use --simular.");

const BASE = "https://api.buscaprocessos.app.br";
const POR_PAGINA = 100;
// Com filtro de tribunais, só a 1ª página é cobrada (R$ 0,25 por tribunal com resultado): vale seguir as próximas.
// Sem filtro, cada consulta custa R$ 2,00 e as 100 mais recentes bastam para o mapa.
const MAX_PAGINAS = TRIBUNAIS ? 10 : 1;
const PASTA = "dados-reais/processos";
await mkdir(PASTA, { recursive: true });

// ---------- Quem consultar ----------
const casamento = JSON.parse(await readFile(arqCasamento, "utf8"));
const empresas = new Map(); // básico → cnpj da loja ligada
for (const l of casamento) {
  if (!["alta", "média", "revisada"].includes(l.confianca) || l.pessoa) continue;
  if (!empresas.has(l.basico)) empresas.set(l.basico, l.cnpj);
}
const existe = (f) => access(f).then(() => true, () => false);
const pendentes = [];
for (const [basico, cnpj] of empresas) if (!(await existe(`${PASTA}/${basico}.json`))) pendentes.push({ basico, cnpj });
console.log(`${empresas.size} empresas ligadas; ${empresas.size - pendentes.length} já baixadas; consultando ${Math.min(MAX, pendentes.length)} agora` +
  ` (tribunais: ${TRIBUNAIS || "todos"}).`);

// ---------- Limpeza de dados pessoais ----------
// Só mantém o nome de quem PROVADAMENTE é empresa (tem CNPJ ou está marcado como jurídica).
// Na dúvida (campo ausente), trata como pessoa física e apaga o nome.
const ehEmpresa = (e) => Boolean(e.cnpj) || (e.tipo_pessoa || e.tipoPessoa) === "JURIDICA";
function limparEnvolvido(e) {
  const tipo = e.tipo_normalizado || e.tipo || null;
  if (!ehEmpresa(e)) return { tipo_pessoa: "FISICA", polo: e.polo || null, tipo };
  return { nome: e.nome, tipo_pessoa: "JURIDICA", cnpj: e.cnpj || null, polo: e.polo || null, tipo };
}
const ehAdvogadoOuJuiz = (e) => e.polo === "ADVOGADO" || /ADVOGAD|JUIZ|MAGISTRAD|PERIT/i.test(e.tipo || "");
function limparProcesso(p) {
  return {
    numero_cnj: p.numero_cnj || p.numeroCnj,
    ano_inicio: p.ano_inicio ?? null, data_inicio: p.data_inicio || null,
    data_ultima_movimentacao: p.data_ultima_movimentacao || null,
    quantidade_movimentacoes: p.quantidade_movimentacoes ?? null,
    fontes: (p.fontes || []).filter((f) => !f.tipo || f.tipo === "TRIBUNAL").map((f) => ({
      sigla: f.sigla || f.tribunal?.sigla || null, grau: f.grau ?? null,
      segredo_justica: f.segredo_justica ?? null, arquivado: f.arquivado ?? null,
      status_predito: f.status_predito || null, data_inicio: f.data_inicio || null, url: f.url || null,
      capa: f.capa && {
        classe: f.capa.classe_normalizada?.nome || f.capa.classe || null,
        assunto: f.capa.assunto_principal_normalizado?.nome || f.capa.assunto || null,
        assuntos: (f.capa.assuntos_normalizados || []).map((a) => a.path_completo || a.nome),
        materias: (f.capa.materias || []).map((m) => m.nome),
        area: f.capa.area || null, situacao: f.capa.situacao || null,
        orgao_julgador: f.capa.orgao_julgador || null,
        valor_causa: f.capa.valor_causa?.valor ? Number(f.capa.valor_causa.valor) : null,
        data_distribuicao: f.capa.data_distribuicao || null, data_arquivamento: f.capa.data_arquivamento || null,
      },
      envolvidos: (f.envolvidos || []).filter((e) => !ehAdvogadoOuJuiz(e)).map(limparEnvolvido),
    })),
  };
}

// ---------- Consulta ----------
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const cabecalhos = { "x-api-key": TOKEN, Accept: "application/json" };
let gastoTotal = 0, saldo = null;

class Parar extends Error {}
async function pedir(url) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(url, { headers: cabecalhos });
    const corpo = await r.json().catch(() => ({}));
    if (r.status === 202) {
      // Consulta longa: o servidor continua sozinho; a URL de status devolve o resultado sem cobrar de novo.
      const status = r.headers.get("location") || corpo.data?.statusUrl;
      const ms = Number(r.headers.get("retry-after")) * 1000 || corpo.data?.pollAfterMs || 5000;
      if (!status || tentativa > 40) throw new Error("Consulta assíncrona sem resposta a tempo.");
      await espera(ms); url = new URL(status, BASE); continue;
    }
    if (r.ok) return corpo;
    const codigo = corpo.error?.code || "";
    if (r.status === 429 && tentativa <= 5) {
      const ms = Number(r.headers.get("retry-after")) * 1000 || 30000;
      console.warn(`  limite de requisições; esperando ${ms / 1000}s`); await espera(ms); continue;
    }
    if (r.status === 404) return { data: { processos: [], total: 0 }, meta: {} };
    if (r.status === 401) throw new Parar("Chave recusada (401). Confira PROCESSOS_API_TOKEN no .env.");
    if (r.status === 402 || /CREDIT|SALDO|BALANCE/i.test(codigo)) throw new Parar(`Sem crédito (${r.status} ${codigo}). Nada mais será consultado.`);
    if (r.status === 403) throw new Parar(`Acesso negado (403 ${codigo}): ${corpo.error?.message || ""}`);
    throw new Error(`BuscaProcessos respondeu ${r.status} ${codigo}: ${JSON.stringify(corpo).slice(0, 200)}`);
  }
}

async function consultar(cnpj) {
  if (SIMULAR) return { respostas: [JSON.parse(await readFile(SIMULAR, "utf8"))] };
  const url = new URL("/v1/processos", BASE);
  url.searchParams.set("cpf_cnpj", cnpj);
  url.searchParams.set("limit", String(POR_PAGINA));
  if (TRIBUNAIS) url.searchParams.set("tribunais", TRIBUNAIS);
  const respostas = [];
  for (let proxima = url, pagina = 1; proxima && pagina <= MAX_PAGINAS; pagina++) {
    const r = await pedir(proxima);
    respostas.push(r);
    const next = r.data?.links?.next;
    proxima = next ? new URL(typeof next === "string" ? next : next.href) : null;
  }
  return { respostas };
}

for (const { basico, cnpj } of pendentes.slice(0, MAX)) {
  let respostas;
  try { ({ respostas } = await consultar(cnpj)); }
  catch (e) { if (e instanceof Parar) { console.error(e.message); break; } console.error(`  ${basico}: ${e.message}`); continue; }

  const dados = respostas.map((r) => r.data || r);
  const envolvido = dados[0]?.envolvido || {};
  const processos = dados.flatMap((d) => d.processos || d.items || []).map(limparProcesso);
  const gasto = respostas.reduce((s, r) => s + (Number(r.meta?.creditsCharged) || 0), 0);
  gastoTotal += gasto;
  saldo = respostas.at(-1)?.meta?.creditsRemaining ?? saldo;

  await writeFile(`${PASTA}/${basico}.json`, JSON.stringify({
    basico, fonte: "buscaprocessos", tribunais: TRIBUNAIS, consultado_em: new Date().toISOString(), custo: gasto,
    envolvido: { nome: envolvido.nome || null, quantidade_processos: envolvido.quantidade_processos ?? envolvido.quantidadeProcessos ?? null },
    processos,
  }, null, 1));
  const siglas = [...new Set(processos.flatMap((p) => p.fontes.map((f) => f.sigla)))].join(", ") || "-";
  console.log(`  ${basico}  ${processos.length} processos [${siglas}]  custo R$ ${gasto.toFixed(2)}`);
  if (!SIMULAR) await espera(1000);
}
console.log(`Gasto nesta rodada: R$ ${gastoTotal.toFixed(2)}${saldo != null ? `; saldo restante: R$ ${Number(saldo).toFixed(2)}` : ""}.` +
  ` Faltam ${Math.max(0, pendentes.length - MAX)} empresas.`);
