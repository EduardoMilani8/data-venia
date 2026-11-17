// Passo 5 dos dados reais: junta lugares do mapa + processos baixados no formato que o app lê.
// Uso: node scripts/cidade.mjs dados-reais/casamento-passo-fundo.json
// Saída: dados-reais/cidade-<cidade>.json (fica só na sua máquina; o server.js serve dali).

import { readFile, writeFile } from "node:fs/promises";

const arqCasamento = process.argv[2];
if (!arqCasamento) throw new Error("Uso: node scripts/cidade.mjs <casamento.json>");
const slug = arqCasamento.match(/casamento-(.+)\.json$/)?.[1] || "cidade";

const TIPOS = {
  "amenity=restaurant": "Restaurante", "amenity=fast_food": "Lanchonete", "amenity=cafe": "Café", "amenity=bar": "Bar",
  "amenity=pub": "Bar", "amenity=ice_cream": "Sorveteria", "amenity=pharmacy": "Farmácia", "amenity=bank": "Banco",
  "amenity=fuel": "Posto de combustível", "amenity=dentist": "Dentista", "amenity=clinic": "Clínica",
  "amenity=doctors": "Consultório", "amenity=veterinary": "Veterinária", "amenity=cinema": "Cinema",
  "shop=supermarket": "Supermercado", "shop=convenience": "Mercado", "shop=clothes": "Loja de roupas",
  "shop=shoes": "Calçados", "shop=bakery": "Padaria", "shop=optician": "Ótica", "shop=hardware": "Ferragem",
  "shop=furniture": "Móveis", "shop=electronics": "Eletrônicos", "shop=mobile_phone": "Celulares",
  "shop=car": "Concessionária", "shop=car_repair": "Oficina", "shop=butcher": "Açougue", "shop=hairdresser": "Cabeleireiro",
  "shop=beauty": "Estética", "shop=pet": "Pet shop", "shop=books": "Livraria", "shop=jewelry": "Joalheria",
  "shop=sports": "Esportes", "shop=cosmetics": "Cosméticos", "shop=mall": "Shopping", "tourism=hotel": "Hotel",
  "tourism=motel": "Motel", "leisure=fitness_centre": "Academia", "leisure=sports_centre": "Centro esportivo",
};
const tipoDe = (t) => TIPOS[t] || (t.startsWith("shop=") ? "Loja" : t.startsWith("office=") ? "Escritório" : "Serviço");

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

const formatarCnpj = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const linkSeguro = (u) => (typeof u === "string" && u.startsWith("https://") ? u : null);

function converter(proc, basico, i) {
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

const casamento = JSON.parse(await readFile(arqCasamento, "utf8"));
const cache = new Map();
async function processosDe(basico) {
  if (!cache.has(basico)) cache.set(basico, await readFile(`dados-reais/processos/${basico}.json`, "utf8").then(JSON.parse, () => null));
  return cache.get(basico);
}

const empresas = [];
let semConsulta = 0;
for (const l of casamento) {
  if (!["alta", "média", "revisada"].includes(l.confianca) || l.pessoa) continue;
  const dados = await processosDe(l.basico);
  if (!dados) { semConsulta++; continue; }
  const processos = dados.processos.map((p, i) => converter(p, l.basico, i)).sort((a, b) => (b.distribuicao || "").localeCompare(a.distribuicao || ""));
  empresas.push({
    id: l.osm, nome: l.nome, tipo: tipoDe(l.tipo), cnpj: formatarCnpj(l.cnpj), lat: l.lat, lng: l.lng,
    confianca: l.confianca, totalProcessos: dados.envolvido.quantidade_processos ?? processos.length, processos,
  });
}

await writeFile(`dados-reais/cidade-${slug}.json`, JSON.stringify(empresas));
const total = empresas.reduce((s, e) => s + e.processos.length, 0);
const porCat = empresas.flatMap((e) => e.processos).reduce((a, p) => ((a[p.categoria] = (a[p.categoria] || 0) + 1), a), {});
console.log(`${empresas.length} lugares no mapa, ${total} processos (${JSON.stringify(porCat)}); ${semConsulta} lugares ligados ainda sem consulta.`);
