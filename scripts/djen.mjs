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

net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const args = process.argv.slice(2);
const arqCasamento = args[0];
const opcao = (nome, padrao) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : padrao; };
const MAX = Number(opcao("--max", 10));
const TRIBUNAIS = opcao("--tribunais", "TJRS,TRT4,TRF4").split(",");
const COMARCA = opcao("--comarca", "PASSO FUNDO");          // "todas" para não filtrar
const PAGINAS = 5;                                           // até 500 publicações por tribunal
const RECENTE_MESES = 18;                                    // publicação mais nova que isso = processo ativo
if (!arqCasamento) throw new Error("Uso: node scripts/djen.mjs <casamento.json> [--max N] [--tribunais ...] [--comarca ...]");

const API = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
const PASTA = "dados-reais/processos";
await mkdir(PASTA, { recursive: true });

// ---------- Nomes ----------
const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const SUFIXOS = new Set("LTDA ME EPP EIRELI SA S A SS LIMITADA CIA".split(" "));
const normalNome = (s) => semAcento(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/)
  .filter((t) => t && !SUFIXOS.has(t)).join(" ");
// A publicação menciona a empresa (nas partes ou no texto). O texto é lido aqui e descartado.
const ehParte = (item, alvo) => (item.destinatarios || []).some((d) => normalNome(d.nome) === alvo);
function ehDaEmpresa(item, alvo) {
  return ehParte(item, alvo) || ` ${normalNome(item.texto?.replace(/<[^>]+>/g, " "))} `.includes(` ${alvo} `);
}
// Parece empresa ou órgão público? Só então o nome pode aparecer no app.
const PJ = /\b(LTDA|S\/?A|EIRELI|EPP|ME|BANCO|CAIXA|COMPANHIA|CIA|COOPERATIVA|ASSOCIA|SINDICATO|CONDOMINIO|INSTITUTO|FUNDACAO|FUNDO|MUNICIPIO|ESTADO|UNIAO|FAZENDA|INSS|MINISTERIO|PREFEITURA|EMPRESA|COMERCIO|INDUSTRIA|SERVICOS|CONSTRUTORA|INCORPORADORA|SHOPPING|SUPERMERCADO|FARMACIA|SEGURADORA|SEGUROS|TELECOM|ENERGIA|HOSPITAL|UNIVERSIDADE|ESCOLA|IGREJA|PARTICIPACOES|ADMINISTRADORA|HOLDING|S\.A\.)\b/;
const pareceEmpresa = (nome) => PJ.test(` ${semAcento(nome || "").toUpperCase()} `);

// ---------- Consulta ----------
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function pedir(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "user-agent": "data-venia/0.1 (projeto pessoal)" } });
      if (r.ok) return r.json();
      if ((r.status === 429 || r.status >= 500) && tentativa <= 5) { await espera(5000 * tentativa); continue; }
      throw new Error(`DJEN respondeu ${r.status}: ${(await r.text()).slice(0, 150)}`);
    } catch (e) {
      if (tentativa > 5 || !/fetch failed|ETIMEDOUT|ECONNRESET/.test(e.message + e.cause?.code)) throw e;
      await espera(5000 * tentativa);
    }
  }
}

const CLASSE_FISCAL = /EXECU[CÇ][AÃ]O FISCAL/i, JUIZADO = /JUIZADO ESPECIAL/i;
const POLO = { P: "PASSIVO", A: "ATIVO" };
const mesesAtras = (data) => (Date.now() - new Date(data)) / (30.44 * 864e5);

async function buscarEmpresa(razao, cnpj) {
  const alvo = normalNome(razao);
  const porProcesso = new Map();
  let publicacoes = 0, descartadas = 0, foraDaComarca = 0;
  for (const tribunal of TRIBUNAIS) {
    for (let pagina = 1; pagina <= PAGINAS; pagina++) {
      const r = await pedir({ nomeParte: alvo, siglaTribunal: tribunal, itensPorPagina: 100, pagina });
      await espera(1000);
      const itens = r.items || [];
      for (const it of itens) {
        publicacoes++;
        if (!ehDaEmpresa(it, alvo)) { descartadas++; continue; }
        if (COMARCA !== "todas" && !semAcento(it.nomeOrgao || "").toUpperCase().includes(COMARCA)) { foraDaComarca++; continue; }
        const numero = it.numeroprocessocommascara || it.numero_processo;
        const p = porProcesso.get(numero) || { numero, tribunal: it.siglaTribunal, classe: it.nomeClasse, orgao: it.nomeOrgao, datas: [], partes: new Map() };
        p.datas.push(it.data_disponibilizacao);
        for (const d of it.destinatarios || []) {
          const daEmpresa = normalNome(d.nome) === alvo;
          const chave = daEmpresa ? "__empresa" : normalNome(d.nome);
          if (!p.partes.has(chave)) p.partes.set(chave, daEmpresa
            ? { nome: razao, tipo_pessoa: "JURIDICA", cnpj, polo: POLO[d.polo] || null }
            : pareceEmpresa(d.nome) ? { nome: d.nome, tipo_pessoa: "JURIDICA", polo: POLO[d.polo] || null }
            : { tipo_pessoa: "FISICA", polo: POLO[d.polo] || null });
        }
        porProcesso.set(numero, p);
      }
      if (itens.length < 100) break;
    }
  }
  // Só conta o processo em que a empresa é PARTE em ao menos uma publicação. Mencionada só no texto,
  // ela costuma ser terceira (ex.: empregadora mandada descontar pensão do salário de alguém), ou o
  // nome é um sobrenome comum ("BORDIGNON"). Nesses casos o processo não é dela.
  const processos = [...porProcesso.values()].filter((p) => p.partes.has("__empresa")).map((p) => {
    const datas = p.datas.sort();
    const recente = mesesAtras(datas.at(-1)) <= RECENTE_MESES;
    const trabalhista = /^TRT/.test(p.tribunal);
    return {
      numero_cnj: p.numero, data_inicio: null,
      data_ultima_movimentacao: datas.at(-1), quantidade_movimentacoes: datas.length,
      fontes: [{
        sigla: p.tribunal.replace(/^TRT(\d)/, "TRT-$1"), grau: /TURMA|C[AÂ]MARA|GABINETE/i.test(p.orgao || "") ? 2 : 1,
        segredo_justica: false, arquivado: null, status_predito: recente ? "ATIVO" : "INATIVO", url: null,
        capa: {
          classe: p.classe, assunto: null, assuntos: [], materias: [],
          area: trabalhista ? "TRABALHISTA" : CLASSE_FISCAL.test(p.classe) ? "TRIBUTARIO" : JUIZADO.test(p.classe) ? "CONSUMIDOR" : null,
          situacao: recente ? "Com publicação recente" : "Sem publicação recente",
          orgao_julgador: p.orgao, valor_causa: null, data_distribuicao: null, data_arquivamento: null,
        },
        envolvidos: [...p.partes.values()],
      }],
    };
  });
  return { processos, publicacoes, descartadas, foraDaComarca };
}

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
