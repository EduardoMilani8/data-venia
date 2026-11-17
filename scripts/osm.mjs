// Passo 1 dos dados reais: lojas, restaurantes e serviços de uma cidade, direto do OpenStreetMap.
// Uso: node scripts/osm.mjs "Passo Fundo"
// Saída: dados-reais/osm-<cidade>.json

import { writeFile, mkdir } from "node:fs/promises";
import net from "node:net";

// O Node dá só 250 ms para cada endereço do servidor responder; em conexões lentas isso não basta.
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const cidade = process.argv[2] || "Passo Fundo";
const slug = cidade.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-");

// Tipos de lugar que costumam ser empresas com CNPJ.
const AMENIDADES = "restaurant|cafe|fast_food|bar|pub|pharmacy|bank|ice_cream|fuel|clinic|dentist|doctors|veterinary|car_rental|car_wash|cinema|nightclub|driving_school";

const consulta = `
[out:json][timeout:120];
area["name"="${cidade}"]["boundary"="administrative"]["admin_level"="8"]->.cidade;
(
  nwr(area.cidade)["shop"]["name"];
  nwr(area.cidade)["amenity"~"^(${AMENIDADES})$"]["name"];
  nwr(area.cidade)["office"]["name"];
  nwr(area.cidade)["craft"]["name"];
  nwr(area.cidade)["tourism"~"^(hotel|motel|hostel|guest_house)$"]["name"];
  nwr(area.cidade)["leisure"~"^(fitness_centre|sports_centre)$"]["name"];
);
out center tags;`;

const r = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "data-venia/0.1 (projeto pessoal)" },
  body: "data=" + encodeURIComponent(consulta),
});
if (!r.ok) throw new Error(`Overpass respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
const { elements } = await r.json();

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
