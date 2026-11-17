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
  // "2023-03-11" sozinho vira meia-noite em UTC, que no Brasil ainda é dia 10. Lê como data local.
  const dataLocal = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s));
  for (const e of empresas) for (const p of e.processos) {
    p.distribuicao = p.distribuicao ? dataLocal(p.distribuicao) : null;
    p.movimentacoes.forEach((m) => (m.data = dataLocal(m.data)));
  }
  return empresas;
}
