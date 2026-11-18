// Formato comum de processo ({numero_cnj, fontes:[…]}) → formato que a gaveta e o mapa leem.
// Usado por scripts/cidade.mjs (em lote) e pela busca ao vivo no navegador.

// Categoria do processo, a partir do tribunal, da matéria e da classe (nessa ordem de confiança).
function categoriaDe(f) {
  const capa = f.capa || {};
  const texto = [...(capa.materias || []), ...(capa.assuntos || []), capa.area || ""].join(" ").toUpperCase();
  if (/^TRT|^TST/.test(f.sigla) || texto.includes("TRABALH")) return "trabalhista";
  if (/EXECU[CÇ][AÃ]O FISCAL/i.test(capa.classe || "") || texto.includes("TRIBUT")) return "tributario";
  if (texto.includes("CONSUMIDOR")) return "consumidor";
  return "civel";
}

// "CUMPRIMENTO DE SENTENçA" → "Cumprimento de sentença" (o DJEN escreve tudo em maiúsculas).
// Critério: nenhuma letra minúscula comum. O DJEN mistura "EXECUçãO", então s === s.toUpperCase() não serve.
const frase = (s) => (s && !/[a-z]/.test(s) ? s.toLowerCase().replace(/^\p{L}/u, (c) => c.toUpperCase()) : s);
const linkSeguro = (u) => (typeof u === "string" && u.startsWith("https://") ? u : null);

export function converterProcesso(proc, basico, i) {
  // Um processo pode ter várias fontes (1º grau, recurso…); a de 1º grau descreve melhor a causa.
  const fontes = proc.fontes.length ? proc.fontes : [{ sigla: "?", capa: {} }];
  const f = fontes.find((x) => x.grau === 1) || fontes[0];
  const capa = f.capa || {};
  const envolvidos = fontes.flatMap((x) => x.envolvidos || []);
  const eu = envolvidos.find((e) => e.cnpj?.replace(/\D/g, "").startsWith(basico));
  const polo = eu?.polo === "ATIVO" ? "autora" : eu?.polo === "PASSIVO" ? "ré" : "parte";
  const outro = envolvidos.find((e) => e !== eu && e.polo && e.polo !== eu?.polo);
  // A situação escrita pelo tribunal ("Baixado", "Arquivado") vale mais que a previsão de IA do Escavador.
  const encerradoNoTribunal = /baixad|arquivad|extint|encerrad|transitad/i.test(capa.situacao || "") || f.arquivado || capa.data_arquivamento;
  const ativo = !encerradoNoTribunal && (f.status_predito ? f.status_predito === "ATIVO" : true);
  return {
    id: `${basico}-${i}`,
    numero: proc.numero_cnj,
    tribunal: f.sigla,
    categoria: categoriaDe(f),
    classe: frase(capa.classe) || null,
    assunto: f.segredo_justica ? "Processo em segredo de justiça" : frase(capa.assunto || capa.classe) || "Assunto não informado",
    resumo: null,
    polo,
    outraParte: !outro ? null : outro.tipo_pessoa === "FISICA" ? "Pessoa física (nome omitido)" : outro.nome,
    status: capa.situacao || (ativo ? "Em andamento" : "Encerrado"),
    ativo,
    valor: capa.valor_causa ?? null,
    distribuicao: capa.data_distribuicao || proc.data_inicio,
    movimentacoes: proc.data_ultima_movimentacao
      ? [{ data: proc.data_ultima_movimentacao, texto: `Última movimentação${proc.quantidade_movimentacoes ? ` (${proc.quantidade_movimentacoes} no total)` : ""}` }]
      : [],
    link: linkSeguro(f.url),
  };
}

// Mais recentes primeiro (pela distribuição; sem ela, pela última movimentação).
export const maisRecentes = (a, b) =>
  String(b.distribuicao || b.movimentacoes[0]?.data || "").localeCompare(String(a.distribuicao || a.movimentacoes[0]?.data || ""));
