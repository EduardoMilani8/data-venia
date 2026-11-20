// Consulta ao Overpass (OpenStreetMap), usada por osm.mjs e ruas.mjs.
import net from "node:net";

// O Node dá só 250 ms para cada endereço do servidor responder; em conexões lentas isso não basta.
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

// O Overpass é público e às vezes lota: tenta de novo com espera crescente, alternando servidores.
const SERVIDORES = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
export async function perguntar(consulta) {
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
