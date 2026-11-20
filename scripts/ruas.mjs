// Passo 1b dos dados reais: as ruas com nome de uma cidade, com o traçado, direto do OpenStreetMap.
// Serve para descobrir em que rua fica uma loja que não tem endereço no mapa.
// Uso: node scripts/ruas.mjs "Passo Fundo" [RS]
// Saída: dados-reais/ruas-<cidade>.json  →  [{ nome, pontos: [[lat, lng], ...] }]

import { writeFile, mkdir } from "node:fs/promises";
import { perguntar } from "./overpass.mjs";

const cidade = process.argv[2] || "Passo Fundo";
// UF opcional: há nomes de cidade repetidos entre estados (ex.: "Bom Jesus"). Com ela, só vale a do estado.
const uf = process.argv[3];
const AREA = uf
  ? `area["ISO3166-2"="BR-${uf}"]->.uf;\nrel(area.uf)["name"="${cidade}"]["boundary"="administrative"]["admin_level"="8"];\nmap_to_area->.cidade;`
  : `area["name"="${cidade}"]["boundary"="administrative"]["admin_level"="8"]->.cidade;`;
const slug = cidade.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-");

const consulta = `
[out:json][timeout:180];
${AREA}
way(area.cidade)["highway"]["name"];
out geom tags;`;

const { elements } = await perguntar(consulta);

const ruas = elements.filter((e) => e.geometry?.length > 1).map((e) => ({
  nome: e.tags.name,
  pontos: e.geometry.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]),
}));

await mkdir("dados-reais", { recursive: true });
await writeFile(`dados-reais/ruas-${slug}.json`, JSON.stringify(ruas));
console.log(`${cidade}: ${ruas.length} trechos de rua, ${new Set(ruas.map((r) => r.nome)).size} nomes diferentes`);
