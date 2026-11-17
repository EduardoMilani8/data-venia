// Gera empresas e processos FICTÍCIOS ao redor de um ponto.
// Nada aqui se refere a empresas reais: nomes, CNPJs e números de processo são inventados.
// O gerador é "semeado" pela posição, então o mesmo lugar sempre mostra os mesmos dados.

export const TIPOS_PROCESSO = {
  consumidor: { nome: "Consumidor", cor: "#f2b33d" },
  trabalhista: { nome: "Trabalhista", cor: "#4cc3e0" },
  tributario: { nome: "Tributário", cor: "#a487f5" },
  civel: { nome: "Cível", cor: "#5fd3a0" },
};

function semente(lat, lng) {
  let s = Math.floor((lat + 90) * 1000) * 100003 + Math.floor((lng + 180) * 1000);
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAMOS = [
  { tipo: "Restaurante", nomes: ["Cantina Bella Rua", "Sabor de Brasa", "Panela de Barro", "Bistrô Esquina", "Casa do Feijão"], pesos: { consumidor: 3, trabalhista: 4, tributario: 1, civel: 1 } },
  { tipo: "Café", nomes: ["Café Grão Fino", "Torra Clara", "Coado & Cia"], pesos: { consumidor: 2, trabalhista: 3, tributario: 1, civel: 1 } },
  { tipo: "Farmácia", nomes: ["Drogaria Bem Viver", "Farma Centro", "Drogaria Saúde Já"], pesos: { consumidor: 4, trabalhista: 2, tributario: 2, civel: 1 } },
  { tipo: "Supermercado", nomes: ["Mercado Boa Compra", "Super Econômico", "Empório da Praça"], pesos: { consumidor: 5, trabalhista: 4, tributario: 2, civel: 1 } },
  { tipo: "Loja de roupas", nomes: ["Vitrine Moda", "Estilo Urbano", "Ateliê Linho", "Trama Store"], pesos: { consumidor: 3, trabalhista: 2, tributario: 2, civel: 2 } },
  { tipo: "Eletrônicos", nomes: ["Conecta Eletro", "Mega Volts", "Ponto Digital"], pesos: { consumidor: 6, trabalhista: 1, tributario: 2, civel: 1 } },
  { tipo: "Academia", nomes: ["Academia Força Total", "Studio Movimento"], pesos: { consumidor: 4, trabalhista: 2, tributario: 1, civel: 2 } },
  { tipo: "Ótica", nomes: ["Ótica Visão Clara", "Ótica Foco"], pesos: { consumidor: 3, trabalhista: 1, tributario: 1, civel: 1 } },
  { tipo: "Padaria", nomes: ["Padaria Trigo de Ouro", "Pão da Esquina", "Forno Antigo"], pesos: { consumidor: 2, trabalhista: 4, tributario: 1, civel: 1 } },
  { tipo: "Imobiliária", nomes: ["Lar Certo Imóveis", "Chave Mestra Imóveis"], pesos: { consumidor: 2, trabalhista: 1, tributario: 1, civel: 5 } },
  { tipo: "Oficina", nomes: ["Auto Mecânica Pistão", "Oficina Roda Viva"], pesos: { consumidor: 4, trabalhista: 2, tributario: 1, civel: 1 } },
  { tipo: "Hotel", nomes: ["Hotel Central Plaza", "Pousada do Largo"], pesos: { consumidor: 3, trabalhista: 3, tributario: 2, civel: 1 } },
];

const MODELOS = {
  consumidor: {
    tribunal: ["TJ", 8], classes: ["Procedimento do Juizado Especial Cível"],
    casos: [
      ["Produto com defeito não trocado", "Cliente afirma ter comprado um produto que apresentou defeito em poucos dias e que a troca foi recusada. Pede restituição do valor e indenização por danos morais."],
      ["Cobrança indevida no cartão", "Consumidor alega ter sido cobrado duas vezes pela mesma compra e não conseguiu o estorno pelos canais de atendimento."],
      ["Propaganda enganosa em promoção", "Cliente sustenta que o preço anunciado na vitrine não foi respeitado no caixa."],
      ["Serviço não prestado conforme contratado", "Consumidor diz que o serviço contratado foi entregue incompleto e fora do prazo combinado."],
      ["Negativação indevida do nome", "Cliente afirma ter tido o nome incluído em cadastro de inadimplentes por dívida já paga."],
    ],
  },
  trabalhista: {
    tribunal: ["TRT", 5], classes: ["Ação Trabalhista – Rito Ordinário", "Ação Trabalhista – Rito Sumaríssimo"],
    casos: [
      ["Horas extras não pagas", "Ex-funcionário pede o pagamento de horas extras que afirma ter feito sem registro no ponto."],
      ["Verbas rescisórias", "Ex-funcionário cobra valores de rescisão que, segundo ele, não foram pagos na demissão."],
      ["Adicional de insalubridade", "Trabalhador alega exposição a agentes insalubres sem o adicional correspondente."],
      ["Reconhecimento de vínculo empregatício", "Prestador de serviço pede o reconhecimento de vínculo de emprego com carteira assinada."],
      ["Intervalo intrajornada suprimido", "Ex-funcionário afirma que não tinha o intervalo mínimo de descanso durante a jornada."],
    ],
  },
  tributario: {
    tribunal: ["TJ", 8], classes: ["Execução Fiscal"],
    casos: [
      ["ICMS não recolhido", "A Fazenda Estadual cobra ICMS declarado e não pago, com multa e juros."],
      ["ISS em atraso", "O Município executa débitos de ISS de competências anteriores."],
      ["Taxa de licença de funcionamento", "A Prefeitura cobra taxas de fiscalização e funcionamento em aberto."],
    ],
  },
  civel: {
    tribunal: ["TJ", 8], classes: ["Procedimento Comum Cível", "Ação de Despejo", "Execução de Título Extrajudicial"],
    casos: [
      ["Aluguel comercial em atraso", "O proprietário do imóvel pede o pagamento de aluguéis atrasados e a desocupação do ponto."],
      ["Cobrança de fornecedor", "Fornecedor cobra notas fiscais vencidas e não pagas."],
      ["Danos ao imóvel vizinho", "Vizinho afirma que uma reforma no estabelecimento causou infiltrações no seu imóvel."],
      ["Quebra de contrato de parceria", "Ex-parceiro comercial pede indenização pelo fim antecipado de contrato."],
    ],
  },
};

const STATUS = [
  { texto: "Em andamento", ativo: true, peso: 5 },
  { texto: "Acordo homologado", ativo: false, peso: 2 },
  { texto: "Sentença proferida", ativo: true, peso: 2 },
  { texto: "Arquivado", ativo: false, peso: 2 },
];

const MOVIMENTOS = [
  "Processo distribuído",
  "Citação da empresa expedida",
  "Contestação apresentada pela empresa",
  "Audiência de conciliação designada",
  "Audiência realizada sem acordo",
  "Juntada de documentos",
  "Concluso para decisão",
  "Perícia designada",
  "Laudo pericial juntado",
];

function escolher(r, lista) { return lista[Math.floor(r() * lista.length)]; }
function escolherPeso(r, pares) {
  const total = pares.reduce((s, [, p]) => s + p, 0);
  let x = r() * total;
  for (const [v, p] of pares) { if ((x -= p) < 0) return v; }
  return pares[0][0];
}
const pad = (n, t) => String(n).padStart(t, "0");

function cnpjFicticio(r) {
  const b = () => pad(Math.floor(r() * 100), 2);
  return `${b()}.${pad(Math.floor(r() * 1000), 3)}.${pad(Math.floor(r() * 1000), 3)}/0001-${b()}`;
}

function numeroCNJ(r, ano, j, tr) {
  return `${pad(Math.floor(r() * 9999999), 7)}-${pad(Math.floor(r() * 99), 2)}.${ano}.${j}.${pad(tr, 2)}.${pad(Math.floor(r() * 9999), 4)}`;
}

function gerarProcesso(r, ramo, i) {
  const categoria = escolherPeso(r, Object.entries(ramo.pesos));
  const m = MODELOS[categoria];
  const [titulo, resumo] = escolher(r, m.casos);
  const ano = 2019 + Math.floor(r() * 7);
  const inicio = new Date(ano, Math.floor(r() * 12), 1 + Math.floor(r() * 27));
  const status = escolherPeso(r, STATUS.map((s) => [s, s.peso]));
  const polo = categoria === "civel" && r() < 0.35 ? "autora" : "ré";

  const movs = [];
  let d = new Date(inicio);
  const qtd = 3 + Math.floor(r() * 5);
  for (let k = 0; k < qtd; k++) {
    movs.push({ data: new Date(d), texto: k === 0 ? MOVIMENTOS[0] : escolher(r, MOVIMENTOS.slice(1)) });
    d = new Date(d.getTime() + (20 + r() * 160) * 864e5);
    if (d > new Date()) break;
  }
  if (!status.ativo || status.texto === "Sentença proferida") movs.push({ data: new Date(d > new Date() ? Date.now() - 864e5 * 10 : d), texto: status.texto });

  const valor = categoria === "tributario" ? 4000 + r() * 180000
    : categoria === "trabalhista" ? 8000 + r() * 90000
    : categoria === "consumidor" ? 1500 + r() * 25000
    : 10000 + r() * 250000;

  return {
    id: `p${i}`,
    numero: numeroCNJ(r, ano, m.tribunal[1], 21),
    tribunal: m.tribunal[0],
    categoria,
    classe: escolher(r, m.classes),
    assunto: titulo,
    resumo,
    polo,
    outraParte: categoria === "tributario" ? (titulo.includes("ICMS") ? "Fazenda Pública Estadual" : "Município") : "Pessoa física (nome omitido)",
    status: status.texto,
    ativo: status.ativo,
    valor: Math.round(valor),
    distribuicao: inicio,
    movimentacoes: movs.reverse(),
  };
}

export function gerarEmpresas(centro, quantidade = 70, raioMetros = 950) {
  const r = semente(centro.lat, centro.lng);
  const usados = new Set();
  const empresas = [];
  let pid = 0;

  for (let i = 0; i < quantidade; i++) {
    const ramo = escolher(r, RAMOS);
    let nome = escolher(r, ramo.nomes);
    if (usados.has(nome)) nome = `${nome} ${escolher(r, ["Centro", "II", "Express", "Matriz", "Filial Sul"])}`;
    if (usados.has(nome)) continue;
    usados.add(nome);

    // Distribui com mais densidade no centro (raiz do aleatório deixa uniforme; potência maior concentra)
    const ang = r() * Math.PI * 2;
    const dist = Math.pow(r(), 0.75) * raioMetros;
    const lat = centro.lat + (dist * Math.cos(ang)) / 111320;
    const lng = centro.lng + (dist * Math.sin(ang)) / (111320 * Math.cos((centro.lat * Math.PI) / 180));

    const x = r();
    const qtd = x < 0.35 ? 0 : x < 0.7 ? 1 + Math.floor(r() * 2) : x < 0.92 ? 3 + Math.floor(r() * 5) : 9 + Math.floor(r() * 18);
    const processos = Array.from({ length: qtd }, () => gerarProcesso(r, ramo, pid++))
      .sort((a, b) => b.distribuicao - a.distribuicao);

    empresas.push({ id: `e${i}`, nome, tipo: ramo.tipo, cnpj: cnpjFicticio(r), lat, lng, processos });
  }
  return empresas;
}
