// Passo 1 dos dados reais: lojas, restaurantes e serviços de uma cidade, direto do OpenStreetMap.
// Uso: node scripts/osm.mjs "Passo Fundo" [RS]
// Saída: dados-reais/osm-<cidade>.json

import { writeFile, mkdir } from "node:fs/promises";
import { perguntar } from "./overpass.mjs";

const cidade = process.argv[2] || "Passo Fundo";
// UF opcional: há nomes de cidade repetidos entre estados (ex.: "Bom Jesus"). Com ela, só vale a do estado.
const uf = process.argv[3];
const AREA = uf
  ? `area["ISO3166-2"="BR-${uf}"]->.uf;\nrel(area.uf)["name"="${cidade}"]["boundary"="administrative"]["admin_level"="8"];\nmap_to_area->.cidade;`
  : `area["name"="${cidade}"]["boundary"="administrative"]["admin_level"="8"]->.cidade;`;
const slug = cidade.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-");

// Tipos de lugar que costumam ser empresas com CNPJ.
const AMENIDADES = "restaurant|cafe|fast_food|bar|pub|pharmacy|bank|ice_cream|fuel|clinic|dentist|doctors|veterinary|car_rental|car_wash|cinema|nightclub|driving_school";

const consulta = `
[out:json][timeout:120];
${AREA}
(
  nwr(area.cidade)["shop"]["name"];
  nwr(area.cidade)["amenity"~"^(${AMENIDADES})$"]["name"];
  nwr(area.cidade)["office"]["name"];
  nwr(area.cidade)["craft"]["name"];
  nwr(area.cidade)["tourism"~"^(hotel|motel|hostel|guest_house)$"]["name"];
  nwr(area.cidade)["leisure"~"^(fitness_centre|sports_centre)$"]["name"];
);
out center tags;`;

const { elements } = await perguntar(consulta);

const lugares = elements.map((e) => {
  const t = e.tags;
  return {
    osm: `${e.type}/${e.id}`,
    nome: t.name,
    tipo: t.shop ? `shop=${t.shop}` : t.amenity ? `amenity=${t.amenity}` : t.office ? `office=${t.office}` : t.craft ? `craft=${t.craft}` : t.tourism ? `tourism=${t.tourism}` : `leisure=${t.leisure}`,
    marca: t.brand || null,
    rua: t["addr:street"] || null,
    numero: t["addr:housenumber"] || null,
    cnpj: t["ref:vatin"] || t["ref:CNPJ"] || t["cnpj"] || null,
    lat: e.lat ?? e.center?.lat,
    lng: e.lon ?? e.center?.lon,
  };
}).filter((l) => l.lat && l.lng);

await mkdir("dados-reais", { recursive: true });
await writeFile(`dados-reais/osm-${slug}.json`, JSON.stringify(lugares, null, 1));

const pct = (n) => `${n} (${Math.round((100 * n) / lugares.length)}%)`;
const tipos = Object.entries(lugares.reduce((a, l) => ((a[l.tipo] = (a[l.tipo] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 12);
const lats = lugares.map((l) => l.lat), lngs = lugares.map((l) => l.lng);

console.log(`${cidade}: ${lugares.length} lugares com nome`);
console.log(`  com rua no endereço: ${pct(lugares.filter((l) => l.rua).length)}`);
console.log(`  com rua e número:    ${pct(lugares.filter((l) => l.rua && l.numero).length)}`);
console.log(`  com CNPJ no próprio OSM: ${pct(lugares.filter((l) => l.cnpj).length)}`);
console.log(`  área: lat ${Math.min(...lats).toFixed(3)} a ${Math.max(...lats).toFixed(3)}, lng ${Math.min(...lngs).toFixed(3)} a ${Math.max(...lngs).toFixed(3)}`);
console.log("  tipos mais comuns:", tipos.map(([t, n]) => `${t} ${n}`).join(", "));
