// Ponto único de entrada dos dados. O resto do app só conversa com este arquivo.
// Hoje: modo "demo" (dados fictícios). Depois: modo "api", que busca no servidor local
// (server.js), que por sua vez consulta um serviço de dados judiciais com a sua chave.

import { gerarEmpresas } from "./demo.js";

export const MODO = new URLSearchParams(location.search).get("modo") === "api" ? "api" : "demo";

export async function carregarEmpresas(centro) {
  if (MODO === "demo") return gerarEmpresas(centro);

  const r = await fetch(`/api/empresas?lat=${centro.lat}&lng=${centro.lng}`);
  if (!r.ok) throw new Error(`O servidor respondeu ${r.status}. Confira o server.js e a chave da API.`);
  const empresas = await r.json();
  for (const e of empresas) for (const p of e.processos) {
    p.distribuicao = new Date(p.distribuicao);
    p.movimentacoes.forEach((m) => (m.data = new Date(m.data)));
  }
  return empresas;
}
