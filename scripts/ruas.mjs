// Passo 1b dos dados reais: as ruas com nome de uma cidade, com o traçado, direto do OpenStreetMap.
// Serve para descobrir em que rua fica uma loja que não tem endereço no mapa.
// Uso: node scripts/ruas.mjs "Passo Fundo"
// Saída: dados-reais/ruas-<cidade>.json  →  [{ nome, pontos: [[lat, lng], ...] }]

import { writeFile, mkdir } from "node:fs/promises";
import net from "node:net";

net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const cidade = process.argv[2] || "Passo Fundo";
const slug = cidade.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-");

const consulta = `
[out:json][timeout:180];
area["name"="${cidade}"]["boundary"="administrative"]["admin_level"="8"]->.cidade;
way(area.cidade)["highway"]["name"];
out geom tags;`;

// O Overpass é público e às vezes lota: tenta de novo com espera crescente, alternando servidores.
const SERVIDORES = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
async function perguntar() {
  for (let i = 0, espera = 5000; i < 6; i++, espera *= 2) {
    const url = SERVIDORES[i % SERVIDORES.length];
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "data-venia/0.1 (projeto pessoal)" },
        body: "data=" + encodeURIComponent(consulta),
      });
      if (r.ok) return r.json();
      console.warn(`  ${new URL(url).host} respondeu ${r.status}; nova tentativa em ${espera / 1000}s`);
    } catch (e) {
      console.warn(`  ${new URL(url).host} falhou (${e.cause?.code || e.message}); nova tentativa em ${espera / 1000}s`);
    }
    await new Promise((ok) => setTimeout(ok, espera));
  }
  throw new Error("Overpass indisponível depois de 6 tentativas");
}
const { elements } = await perguntar();

const ruas = elements.filter((e) => e.geometry?.length > 1).map((e) => ({
  nome: e.tags.name,
  pontos: e.geometry.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]),
}));

await mkdir("dados-reais", { recursive: true });
await writeFile(`dados-reais/ruas-${slug}.json`, JSON.stringify(ruas));
console.log(`${cidade}: ${ruas.length} trechos de rua, ${new Set(ruas.map((r) => r.nome)).size} nomes diferentes`);
