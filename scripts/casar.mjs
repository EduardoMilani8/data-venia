// Passo 3 dos dados reais: liga cada lugar do OpenStreetMap ao CNPJ dele na base da Receita.
// Uso: node scripts/casar.mjs dados-reais/osm-passo-fundo.json dados-reais/receita-passo-fundo
// Saída: dados-reais/casamento-<cidade>.json e um relatório com a taxa de acerto.

import { readFile, writeFile } from "node:fs/promises";

const [arqOsm, pastaRf] = process.argv.slice(2);
if (!arqOsm || !pastaRf) throw new Error("Uso: node scripts/casar.mjs <osm.json> <pasta da receita>");

// ---------- Normalização de nomes ----------
const PALAVRAS_VAZIAS = new Set(`LTDA ME EPP EIRELI SA S A CIA COMPANHIA E DE DA DO DAS DOS EM COM COMERCIO COMERCIAL
  INDUSTRIA SERVICOS SERVICO FILIAL MATRIZ UNIDADE LOJA THE AND & - . CENTRO RS BRASIL BRASILEIRA LIMITADA
  SOCIEDADE EMPRESARIAL ADMINISTRACAO PARTICIPACOES`.split(/\s+/));

const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
function fichas(nome) {
  if (!nome) return [];
  return [...new Set(semAcento(nome).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 2 && !PALAVRAS_VAZIAS.has(t)))];
}
// Nome de rua comparável: sem tipo, sem títulos (CEL/CORONEL), sem conectivos, sem a faixa
// de numeração que a Receita às vezes anexa ("SETE DE SETEMBRO - DE 1/2 A 99997/99998").
const RUA_VAZIAS = new Set(`RUA R AVENIDA AV TRAVESSA TV ALAMEDA AL ESTRADA EST RODOVIA ROD PRACA PCA BECO VIA
  GENERAL GEN CORONEL CEL CAPITAO CAP DOUTOR DR PRESIDENTE PRES PADRE PE MAJOR MARECHAL MAL TENENTE TEN
  PROFESSOR PROF PROFESSORA SENADOR SEN DEPUTADO DEP ENGENHEIRO ENG SARGENTO SGT ALMIRANTE ALM
  DE DA DO DAS DOS E`.split(/\s+/));
const normalRua = (s) => semAcento(s || "").toUpperCase()
  .replace(/\(.*?\)/g, " ").replace(/\s+-\s+.*$/, "")
  .replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !RUA_VAZIAS.has(t)).join(" ");
const normalNumero = (s) => (s || "").replace(/\D/g, "").replace(/^0+/, "");

// ---------- Atividade: tipo do OSM → início do CNAE esperado ----------
const CNAE = {
  "amenity=pharmacy": ["4771"], "amenity=restaurant": ["5611"], "amenity=fast_food": ["5611"],
  "amenity=cafe": ["5611"], "amenity=bar": ["5611"], "amenity=pub": ["5611"], "amenity=ice_cream": ["5611", "1053"],
  "amenity=bank": ["642"], "amenity=fuel": ["4731"], "amenity=dentist": ["8630"], "amenity=clinic": ["86"],
  "amenity=doctors": ["86"], "amenity=veterinary": ["7500"], "amenity=driving_school": ["8599"],
  "amenity=cinema": ["5914"], "amenity=car_wash": ["4520"], "amenity=car_rental": ["7711"],
  "shop=supermarket": ["4711", "4712"], "shop=convenience": ["4711", "4712", "4729"], "shop=clothes": ["4781"],
  "shop=shoes": ["4782"], "shop=books": ["4761"], "shop=bakery": ["1091", "4721"], "shop=optician": ["4774"],
  "shop=hardware": ["4744"], "shop=furniture": ["4754"], "shop=electronics": ["4752", "4753"],
  "shop=mobile_phone": ["4752"], "shop=car": ["4511"], "shop=car_repair": ["4520"], "shop=butcher": ["4722"],
  "shop=hairdresser": ["9602"], "shop=beauty": ["9602"], "shop=pet": ["4789"], "shop=florist": ["4789"],
  "shop=jewelry": ["4783"], "shop=sports": ["4763"], "shop=cosmetics": ["4772"], "shop=chemist": ["4772", "4771"],
  "shop=mall": ["6810", "6822"], "tourism=hotel": ["5510"], "tourism=motel": ["5510"],
  "leisure=fitness_centre": ["9313"], "leisure=sports_centre": ["9313", "9311", "9319"],
};
const cnaeCompativel = (tipo, cnae) => (CNAE[tipo] || (tipo.startsWith("shop=") ? ["47"] : [])).some((p) => cnae.startsWith(p));

// ---------- Leitura da Receita ----------
const ler = async (n) => (await readFile(`${pastaRf}/${n}`, "utf8")).split("\n").filter(Boolean).map((l) => l.split(";"));
const empresas = new Map((await ler("empresas.csv")).map(([b, razao, natureza, porte]) => [b, { razao, natureza, porte }]));
const mei = new Set((await ler("simples.csv")).filter((c) => c[1] === "S").map((c) => c[0]));

const NATUREZA_PESSOA = new Set(["2135"]); // empresário individual: o nome da empresa é o nome de uma pessoa
const estabs = (await ler("estabelecimentos.csv")).map((c) => {
  // O complemento pode conter ";" ("BLOCO C;APT 201"): os 11 primeiros campos e os 4 últimos são fixos.
  const [basico, ordem, dv, matriz, fantasia, , inicio, cnae, tipoLog, logradouro, numero] = c;
  const [bairro, cep] = c.slice(-4);
  const emp = empresas.get(basico) || {};
  return {
    cnpj: `${basico}${ordem}${dv}`, basico, matriz: matriz === "1", fantasia, razao: emp.razao || "",
    natureza: emp.natureza || "", porte: emp.porte || "", cnae, inicio,
    rua: normalRua(`${tipoLog} ${logradouro}`), numero: normalNumero(numero), bairro, cep,
    pessoa: mei.has(basico) || NATUREZA_PESSOA.has(emp.natureza),
    fichas: [...new Set([...fichas(fantasia), ...fichas(emp.razao)])],
    fichasFantasia: fichas(fantasia), fichasRazao: fichas(emp.razao),
  };
});

// Índice invertido: ficha → estabelecimentos que a contêm
const indice = new Map();
for (const e of estabs) for (const f of e.fichas) (indice.get(f) || indice.set(f, []).get(f)).push(e);
// Fichas muito comuns (ex.: "FARMACIA") não servem sozinhas para achar candidatos
const comum = (f) => (indice.get(f)?.length || 0) > 400;

// ---------- Pontuação ----------
// Cada palavra pesa pela raridade (IDF): acertar "TIBOLA" diz muito, acertar "SUSHI" ou "MERCADO" diz pouco.
// Palavra que não existe na Receita recebe o peso máximo: se o nome do mapa a tem, ela precisava aparecer.
const LOG_N = Math.log(estabs.length);
const peso = (t) => LOG_N - Math.log(1 + (indice.get(t)?.length || 0));
const somaPesos = (ts) => ts.reduce((s, t) => s + peso(t), 0);

// Palavras "quase iguais": até uma letra trocada, sobrando ou faltando (CEZAR/CESAR, VENETO/VENETTO).
// Só em palavras de 5+ letras; em palavras curtas uma letra muda tudo (BAR/BAU).
function quase(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, erros = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++erros > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return erros + (a.length - i) + (b.length - j) <= 1;
}

// Compara ruas já normalizadas. "igual": mesmas palavras. "parecida": uma é começo ou fim da outra,
// como "BRASIL" × "BRASIL OESTE" (a avenida é dividida) ou "PELEGRINI" × "CCORONEL PELEGRINI" (erro de digitação).
function compararRua(a, b) {
  const x = a.split(" "), y = b.split(" ");
  const [curta, longa] = x.length <= y.length ? [x, y] : [y, x];
  const bate = (deslocamento) => curta.every((t, i) => quase(t, longa[i + deslocamento]));
  if (curta.length === longa.length) return bate(0) ? "igual" : null;
  return bate(0) || bate(longa.length - curta.length) ? "parecida" : null;
}

function similaridade(a, b) {
  if (!a.length || !b.length) return 0;
  const comuns = somaPesos(a.filter((t) => b.some((u) => quase(t, u))));
  const contem = comuns / somaPesos(a);        // quanto do nome do mapa aparece na Receita
  const dice = (2 * comuns) / (somaPesos(a) + somaPesos(b));
  return Math.min(1, 0.6 * contem + 0.4 * dice);
}

function pontuar(lugar, fl, e) {
  const nome = Math.max(similaridade(fl, e.fichasFantasia), similaridade(fl, e.fichasRazao));
  let total = nome, motivos = [`nome ${nome.toFixed(2)}`];
  const rua = lugar.rua ? normalRua(lugar.rua) : "";
  if (rua && e.rua) {
    // Endereço escrito no mapa: pista forte, e rua diferente pesa contra.
    const comparacao = compararRua(rua, e.rua);
    if (comparacao) {
      total += comparacao === "igual" ? 0.25 : 0.15; motivos.push(comparacao === "igual" ? "rua" : "rua parecida");
      if (lugar.numero && normalNumero(lugar.numero) === e.numero) { total += 0.25; motivos.push("número"); }
    } else { total -= 0.1; motivos.push("rua diferente"); }
  } else if (e.rua && lugar.ruasPerto.some((r) => compararRua(r, e.rua))) {
    // Sem endereço no mapa, mas a rua da Receita passa ao lado do ponto: pista média.
    // Não pune quem não bate, porque o ponto pode estar no meio da quadra ou na esquina errada.
    total += 0.2; motivos.push("rua próxima");
  }
  if (cnaeCompativel(lugar.tipo, e.cnae)) { total += 0.15; motivos.push("atividade"); }
  return { total, nome, motivos };
}

// ---------- Ruas perto de cada lugar ----------
// Distância de um ponto a um segmento, em metros, numa projeção plana local (boa para dezenas de metros).
function distanciaSegmento([lat, lng], [a1, o1], [a2, o2]) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  const px = (lng - o1) * kx, py = (lat - a1) * ky, dx = (o2 - o1) * kx, dy = (a2 - a1) * ky;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - t * dx, py - t * dy);
}
const RAIO_RUA = 50; // metros
const arqRuas = arqOsm.replace(/osm-([^/]+)\.json$/, "ruas-$1.json");
const ruas = await readFile(arqRuas, "utf8").then(JSON.parse).catch(() => {
  console.warn(`(sem ${arqRuas}: rode scripts/ruas.mjs para usar as ruas próximas)`);
  return [];
});
function ruasPerto(lat, lng) {
  const perto = new Set();
  for (const r of ruas) {
    for (let i = 1; i < r.pontos.length; i++) {
      if (distanciaSegmento([lat, lng], r.pontos[i - 1], r.pontos[i]) <= RAIO_RUA) { perto.add(normalRua(r.nome)); break; }
    }
  }
  return [...perto];
}

// ---------- Revisão manual ----------
// dados-reais/revisao-<cidade>.csv: uma linha por opção de cada lugar duvidoso. Quem revisa marca "x" na
// coluna "certo" da opção correta (ou da linha "nenhuma destas"). As marcas valem nas próximas execuções.
const slug = arqOsm.match(/osm-(.+)\.json$/)?.[1] || "cidade";
const arqRevisao = `dados-reais/revisao-${slug}.csv`;
const NENHUMA = "nenhuma destas";
const decisoes = new Map(); // osm → cnpj escolhido ou NENHUMA
for (const linha of (await readFile(arqRevisao, "utf8").catch(() => "")).replace(/^﻿/, "").split("\n").slice(1)) {
  const [certo, osm, , , cnpj] = linha.split(";");
  if (certo?.trim()) decisoes.set(osm, cnpj || NENHUMA);
}
const porCnpj = new Map(estabs.map((e) => [e.cnpj, e]));

// ---------- Casamento ----------
const lugares = JSON.parse(await readFile(arqOsm, "utf8"));
for (const l of lugares) l.ruasPerto = ruasPerto(l.lat, l.lng);
const resultado = [];
const paraRevisar = [];
for (const lugar of lugares) {
  const fl = fichas(lugar.nome);
  const raras = fl.filter((f) => !comum(f));
  const candidatos = new Set((raras.length ? raras : fl).flatMap((f) => indice.get(f) || []));

  const ranking = [...candidatos].map((e) => ({ e, ...pontuar(lugar, fl, e) }))
    .filter((c) => c.nome >= 0.5).sort((a, b) => b.total - a.total);
  let melhor = ranking[0];

  let confianca = "nenhuma";
  if (melhor) {
    // Empate entre empresas DIFERENTES (CNPJ básico diferente) torna a ligação duvidosa.
    // Empate entre filiais da MESMA empresa não importa: os processos são da empresa.
    const rival = ranking.find((c) => c.e.basico !== melhor.e.basico);
    const folga = rival ? melhor.total - rival.total : Infinity;
    if (melhor.total >= 1.1 && folga >= 0.15) confianca = "alta";
    else if (melhor.total >= 0.85 && folga >= 0.1) confianca = "média";
  }

  // Duvidosos vão para a revisão: confiança média, ou bom resultado travado por empate.
  if (confianca === "média" || (confianca === "nenhuma" && melhor?.total >= 0.85)) {
    const vistas = new Set();
    const opcoes = ranking.filter((c) => !vistas.has(c.e.basico) && vistas.add(c.e.basico)).slice(0, 3);
    paraRevisar.push({ lugar, opcoes });
  }

  // Decisão humana vale mais que a pontuação.
  const decisao = decisoes.get(lugar.osm);
  if (decisao === NENHUMA) { confianca = "nenhuma"; melhor = null; }
  else if (decisao && porCnpj.has(decisao)) {
    const e = porCnpj.get(decisao);
    melhor = ranking.find((c) => c.e === e) || { e, total: 0, motivos: [] };
    confianca = "revisada";
  }

  resultado.push({
    ...lugar,
    confianca,
    cnpj: confianca !== "nenhuma" ? melhor.e.cnpj : null,
    basico: confianca !== "nenhuma" ? melhor.e.basico : null,
    pessoa: confianca !== "nenhuma" ? melhor.e.pessoa : null,
    razao: melhor && !melhor.e.pessoa ? melhor.e.razao : melhor ? "(empresa individual: nome omitido)" : null,
    fantasia: melhor?.e.fantasia || null,
    cnae: melhor?.e.cnae || null,
    pontos: melhor ? +melhor.total.toFixed(2) : 0,
    motivos: melhor?.motivos || [],
    candidatos: ranking.length,
  });
}

// Depuração: DEPURAR="Nome 1|Nome 2" node scripts/casar.mjs ... mostra os 4 melhores candidatos de cada lugar.
if (process.env.DEPURAR) {
  const alvo = process.env.DEPURAR.split("|");
  for (const lugar of lugares.filter((l) => alvo.includes(l.nome))) {
    const fl = fichas(lugar.nome);
    const raras = fl.filter((f) => !comum(f));
    const cand = new Set((raras.length ? raras : fl).flatMap((f) => indice.get(f) || []));
    console.log(`\n${lugar.nome} [${fl}] rua=${lugar.rua} perto=${lugar.ruasPerto}`);
    for (const c of [...cand].map((e) => ({ e, ...pontuar(lugar, fl, e) })).sort((a, b) => b.total - a.total).slice(0, 4))
      console.log(`   ${c.total.toFixed(2)} ${c.e.basico} ${c.e.fantasia || c.e.razao} / rua ${c.e.rua} ${c.e.numero} [${c.motivos}]`);
  }
  process.exit();
}

await writeFile(`dados-reais/casamento-${slug}.json`, JSON.stringify(resultado, null, 1));

// Planilha de revisão, preservando as marcas já feitas. Empresa individual aparece sem nome.
const celula = (s) => String(s ?? "").replace(/[;\n]/g, " ");
const linhas = ["certo;osm;lugar no mapa;tipo;cnpj;empresa na Receita;endereço na Receita;pontos;motivos"];
for (const { lugar, opcoes } of paraRevisar) {
  const d = decisoes.get(lugar.osm);
  for (const c of opcoes) {
    const nome = c.e.pessoa ? "(empresa individual: nome omitido)" : c.e.fantasia ? `${c.e.fantasia} (${c.e.razao})` : c.e.razao;
    linhas.push([d === c.e.cnpj ? "x" : "", lugar.osm, lugar.nome, lugar.tipo, c.e.cnpj, nome,
      `${c.e.rua} ${c.e.numero}`, c.total.toFixed(2), c.motivos.join(", ")].map(celula).join(";"));
  }
  linhas.push([d === NENHUMA ? "x" : "", lugar.osm, lugar.nome, lugar.tipo, "", NENHUMA, "", "", ""].map(celula).join(";"));
}
await writeFile(arqRevisao, "﻿" + linhas.join("\n") + "\n");

// ---------- Relatório ----------
const n = resultado.length;
const pct = (k) => `${k} (${Math.round((100 * k) / n)}%)`;
const alta = resultado.filter((r) => r.confianca === "alta");
const media = resultado.filter((r) => r.confianca === "média");
const revisada = resultado.filter((r) => r.confianca === "revisada");
const ligados = [...alta, ...media, ...revisada];
console.log(`Receita: ${estabs.length} estabelecimentos ativos, ${estabs.filter((e) => e.pessoa).length} são MEI ou empresário individual`);
console.log(`Mapa: ${n} lugares`);
console.log(`  ligados com confiança alta:  ${pct(alta.length)}`);
console.log(`  ligados com confiança média: ${pct(media.length)}`);
console.log(`  ligados por revisão manual:  ${pct(revisada.length)}`);
console.log(`  sem ligação:                 ${pct(n - ligados.length)}`);
console.log(`  para revisar: ${paraRevisar.length} lugares em ${arqRevisao} (${decisoes.size} já decididos)`);
console.log(`  dos ligados, pessoa física (sairiam do app): ${ligados.filter((r) => r.pessoa).length}`);
console.log(`  dos ligados, empresas distintas (consultas de processo necessárias): ${new Set(ligados.filter((r) => !r.pessoa).map((r) => r.basico)).size}`);

const amostra = (lista, k) => lista.slice().sort(() => Math.random() - 0.5).slice(0, k);
console.log("\nAmostra, confiança alta:");
for (const r of amostra(alta, 8)) console.log(`  ${r.nome}  →  ${r.fantasia || r.razao}  [${r.motivos.join(", ")}]`);
console.log("\nAmostra, confiança média:");
for (const r of amostra(media, 8)) console.log(`  ${r.nome}  →  ${r.fantasia || r.razao}  [${r.motivos.join(", ")}]`);
console.log("\nAmostra, sem ligação:");
for (const r of amostra(resultado.filter((x) => x.confianca === "nenhuma"), 6)) console.log(`  ${r.nome}  (${r.tipo}, ${r.candidatos} candidatos, melhor: ${r.fantasia || r.razao || "-"} ${r.pontos})`);
