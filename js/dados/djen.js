// Regras de leitura do DJEN (Diário de Justiça Eletrônico Nacional do CNJ), num lugar só.
// Usado pelo script em lote (scripts/djen.mjs, no Node) e pela busca ao vivo no navegador
// (js/dados/aovivo.js). Por isso não importa nada do Node: a regra de privacidade é a mesma nos dois.
//
// Privacidade: o texto das publicações é lido só para conferir a empresa e nunca sai daqui.
// De cada parte, fica o nome apenas se for claramente empresa ou órgão público; pessoas viram
// "pessoa física", sem nome. Advogados não entram (não são destinatários como parte).

export const API_DJEN = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
export const PAGINAS = 5;            // até 500 publicações por tribunal
export const RECENTE_MESES = 18;     // publicação mais nova que isso = processo ativo

// Tribunais que cobrem cada estado: Justiça estadual, do Trabalho e Federal.
// SP tem dois TRTs (capital e Campinas); os dois entram.
const TRT = { RJ: [1], SP: [2, 15], MG: [3], RS: [4], BA: [5], PE: [6], CE: [7], PA: [8], AP: [8], PR: [9], DF: [10], TO: [10],
  AM: [11], RR: [11], SC: [12], PB: [13], RO: [14], AC: [14], MA: [16], ES: [17], GO: [18], AL: [19], SE: [20], RN: [21],
  PI: [22], MT: [23], MS: [24] };
const TRF = { RJ: 2, ES: 2, SP: 3, MS: 3, RS: 4, SC: 4, PR: 4, AL: 5, CE: 5, PB: 5, PE: 5, RN: 5, SE: 5, MG: 6 };
export function tribunaisDaUf(uf) {
  if (!TRT[uf]) throw new Error(`UF desconhecida: ${uf}`);
  return [`TJ${uf}`, ...TRT[uf].map((n) => `TRT${n}`), `TRF${TRF[uf] || 1}`];
}

// ---------- Nomes ----------
export const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const SUFIXOS = new Set("LTDA ME EPP EIRELI SA S A SS LIMITADA CIA".split(" "));
export const normalNome = (s) => semAcento(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/)
  .filter((t) => t && !SUFIXOS.has(t)).join(" ");
const ehParte = (item, alvo) => (item.destinatarios || []).some((d) => normalNome(d.nome) === alvo);
// Parece empresa ou órgão público? Só então o nome pode aparecer no app.
const PJ = /\b(LTDA|S\/?A|EIRELI|EPP|ME|BANCO|CAIXA|COMPANHIA|CIA|COOPERATIVA|ASSOCIA|SINDICATO|CONDOMINIO|INSTITUTO|FUNDACAO|FUNDO|MUNICIPIO|ESTADO|UNIAO|FAZENDA|INSS|MINISTERIO|PREFEITURA|EMPRESA|COMERCIO|INDUSTRIA|SERVICOS|CONSTRUTORA|INCORPORADORA|SHOPPING|SUPERMERCADO|FARMACIA|SEGURADORA|SEGUROS|TELECOM|ENERGIA|HOSPITAL|UNIVERSIDADE|ESCOLA|IGREJA|PARTICIPACOES|ADMINISTRADORA|HOLDING|S\.A\.)\b/;
export const pareceEmpresa = (nome) => PJ.test(` ${semAcento(nome || "").toUpperCase()} `);

const CLASSE_FISCAL = /EXECU[CÇ][AÃ]O FISCAL/i, JUIZADO = /JUIZADO ESPECIAL/i;
const POLO = { P: "PASSIVO", A: "ATIVO" };
const mesesAtras = (data) => (Date.now() - new Date(data)) / (30.44 * 864e5);

// Busca uma empresa em todos os tribunais e devolve os processos no formato comum
// ({numero_cnj, fontes:[{sigla, capa, envolvidos…}]}), o mesmo dos fornecedores pagos.
// pedir(params) → resposta JSON da API; quem chama decide como esperar, repetir e identificar-se.
// emParalelo: consultar os tribunais ao mesmo tempo. O navegador usa (uma empresa grande cai de ~40 s
// para ~15 s); o lote não, porque várias empresas seguidas em paralelo estouram os 20 pedidos/min.
export async function consultarEmpresa({ razao, cnpj, comarca, tribunais }, pedir, aoProgresso, { emParalelo = false } = {}) {
  const alvo = normalNome(razao);
  const porProcesso = new Map();
  let publicacoes = 0, descartadas = 0, foraDaComarca = 0, feitos = 0;
  async function lerTribunal(tribunal) {
    for (let pagina = 1; pagina <= PAGINAS; pagina++) {
      const r = await pedir({ nomeParte: alvo, siglaTribunal: tribunal, itensPorPagina: 100, pagina });
      aoProgresso?.({ tribunal, pagina, pedidos: ++feitos });
      const itens = r.items || [];
      for (const it of itens) {
        publicacoes++;
        // Só conta quando a empresa é PARTE (destinatária). Mencionada só no texto, ela costuma ser
        // terceira (ex.: empregadora mandada descontar pensão de alguém) ou é um sobrenome comum.
        if (!ehParte(it, alvo)) { descartadas++; continue; }
        if (comarca && !semAcento(it.nomeOrgao || "").toUpperCase().includes(comarca)) { foraDaComarca++; continue; }
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
  if (emParalelo) await Promise.all(tribunais.map(lerTribunal));
  else for (const t of tribunais) await lerTribunal(t);
  const processos = [...porProcesso.values()].map((p) => {
    const datas = p.datas.sort();
    const recente = mesesAtras(datas.at(-1)) <= RECENTE_MESES;
    const trabalhista = /^TRT/.test(p.tribunal);
    return {
      numero_cnj: p.numero, data_inicio: null,
      data_ultima_movimentacao: datas.at(-1), quantidade_movimentacoes: datas.length,
      fontes: [{
        sigla: p.tribunal.replace(/^(TRT|TRF)(\d)/, "$1-$2"), grau: /TURMA|C[AÂ]MARA|GABINETE/i.test(p.orgao || "") ? 2 : 1,
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
  return { processos, publicacoes, descartadas, foraDaComarca, pedidos: feitos };
}
