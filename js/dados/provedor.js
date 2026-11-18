// Ponto único de entrada dos dados. O resto do app só conversa com este arquivo.
//   ?modo=demo (padrão) → empresas fictícias geradas no navegador;
//   ?modo=api           → lugares e processos já baixados (server.js lê dados-reais/cidade-*.json);
//   ?modo=vivo          → só os lugares vêm prontos; os processos de cada loja são buscados no DJEN
//                         quando alguém toca nela (js/dados/aovivo.js). É o modo que escala para o país.

import { gerarEmpresas } from "./demo.js";
export { buscarAoVivo, jaGuardadas, iniciarVarredura } from "./aovivo.js";

const pedido = new URLSearchParams(location.search).get("modo");
export const MODO = ["api", "vivo"].includes(pedido) ? pedido : "demo";

// "2023-03-11" sozinho vira meia-noite em UTC, que no Brasil ainda é dia 10. Lê como data local.
const dataLocal = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s));
export function prepararDatas(processos) {
  for (const p of processos) {
    p.distribuicao = p.distribuicao ? dataLocal(p.distribuicao) : null;
    p.movimentacoes.forEach((m) => (m.data = dataLocal(m.data)));
  }
  return processos;
}

export async function carregarEmpresas(centro) {
  if (MODO === "demo") return gerarEmpresas(centro);

  const r = await fetch(`/api/empresas?lat=${centro.lat}&lng=${centro.lng}${MODO === "vivo" ? "&so-lugares=1" : ""}`);
  if (!r.ok) throw new Error(`O servidor respondeu ${r.status}. Confira o server.js e a chave da API.`);
  const empresas = await r.json();
  for (const e of empresas) prepararDatas(e.processos);
  return empresas;
}
