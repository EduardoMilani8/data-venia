// Passo 5 dos dados reais: junta lugares do mapa + processos baixados no formato que o app lê.
// Uso: node scripts/cidade.mjs dados-reais/casamento-passo-fundo.json [--uf RS]
// Cada lugar leva também "busca" (razão social, comarca, tribunais): é o que a busca ao vivo
// no navegador usa para consultar o DJEN quando alguém toca na loja.
// Saída: dados-reais/cidade-<cidade>.json (fica só na sua máquina; o server.js serve dali).

import { readFile, writeFile } from "node:fs/promises";
import { converterProcesso, maisRecentes } from "../js/dados/converter.js";
import { tribunaisDaUf } from "../js/dados/djen.js";

const arqCasamento = process.argv[2];
if (!arqCasamento) throw new Error("Uso: node scripts/cidade.mjs <casamento.json>");
const slug = arqCasamento.match(/casamento-(.+)\.json$/)?.[1] || "cidade";
const iUf = process.argv.indexOf("--uf");
const UF = iUf > 0 ? process.argv[iUf + 1] : "RS";
const COMARCA = slug.replace(/-/g, " ").toUpperCase();
const TRIBUNAIS = tribunaisDaUf(UF);

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

const formatarCnpj = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

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
  if (!dados) semConsulta++;
  const processos = (dados?.processos || []).map((p, i) => converterProcesso(p, l.basico, i)).sort(maisRecentes);
  empresas.push({
    id: l.osm, nome: l.nome, tipo: tipoDe(l.tipo), cnpj: formatarCnpj(l.cnpj), lat: l.lat, lng: l.lng,
    confianca: l.confianca, totalProcessos: dados?.envolvido.quantidade_processos ?? processos.length,
    consultado: Boolean(dados), processos,
    busca: { basico: l.basico, razao: l.razao, comarca: COMARCA, tribunais: TRIBUNAIS },
  });
}

await writeFile(`dados-reais/cidade-${slug}.json`, JSON.stringify(empresas));
const total = empresas.reduce((s, e) => s + e.processos.length, 0);
const porCat = empresas.flatMap((e) => e.processos).reduce((a, p) => ((a[p.categoria] = (a[p.categoria] || 0) + 1), a), {});
console.log(`${empresas.length} lugares no mapa, ${total} processos (${JSON.stringify(porCat)}); ${semConsulta} lugares ainda sem consulta (vão para o mapa e podem ser buscados ao vivo).`);
