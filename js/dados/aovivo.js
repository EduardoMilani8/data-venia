// Busca ao vivo: o navegador consulta o DJEN empresa por empresa, sem servidor no meio.
// A API do CNJ aceita chamadas do navegador (CORS liberado), e o limite de 20 pedidos por minuto
// vale para quem está usando, não para o site inteiro.
//
// Dois jeitos de chegar aqui:
//   - a pessoa toca numa loja: busca com prioridade, a gaveta mostra o andamento;
//   - a varredura em segundo plano: vai consultando as lojas mais próximas com as sobras do limite,
//     e cada uma ganha cor no mapa quando a resposta chega.
// Uma empresa pequena custa 3 pedidos (um por tribunal); uma grande, até 15. O resultado já
// convertido fica guardado neste navegador por um dia, para não gastar o limite de novo.

import { API_DJEN, PAGINAS, consultarEmpresa } from "./djen.js";
import { converterProcesso, maisRecentes } from "./converter.js";

const VALIDADE_MS = 24 * 3600 * 1000;
const PAUSA_LIMITE_S = 15;           // espera quando o DJEN responde 429; o cabeçalho de reset não é exposto ao navegador
const TENTATIVAS = 6;
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------- Orçamento de pedidos ----------
// Janela deslizante de 60 s. O clique pode usar quase tudo (19 de 20); a varredura só até 10, e
// congela no meio da empresa enquanto houver clique, para o clique não esperar atrás dela.
const JANELA_MS = 60_000;
const TETO = { clique: 19, fundo: 10 };
const momentos = [];
let cliquesEmAndamento = 0;
// O clique nunca espera uma busca da varredura: cada um tem a sua (profundidades diferentes),
// e a da varredura fica congelada enquanto houver clique.
async function aguardarVez(busca, aoAviso) {
  for (;;) {
    const agora = Date.now(), tipo = busca.tipo;
    if (tipo === "fundo" && cliquesEmAndamento > 0) { await espera(500); continue; }
    while (momentos.length && agora - momentos[0] > JANELA_MS) momentos.shift();
    if (momentos.length < TETO[tipo]) { momentos.push(agora); return; }
    const falta = Math.ceil((momentos[momentos.length - TETO[tipo]] + JANELA_MS - agora) / 1000);
    aoAviso?.(`Esperando a vez no limite do DJEN (20 consultas por minuto)… ${falta}s`);
    await espera(1000);
  }
}

// O navegador não deixa ler os cabeçalhos de limite (o CNJ não os expõe), então em 429 a gente
// pausa e tenta de novo, contando a pausa para a gaveta mostrar.
function criarPedir(busca) {
  return async function pedir(params) {
    const url = new URL(API_DJEN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (let tentativa = 1; ; tentativa++) {
      const aoAviso = (t) => busca.aoAviso?.(t);
      await aguardarVez(busca, aoAviso);
      let r;
      try { r = await fetch(url, { headers: { Accept: "application/json" } }); }
      catch { if (tentativa >= TENTATIVAS) throw new Error("Sem conexão com o DJEN."); await espera(2000 * tentativa); continue; }
      if (r.ok) return r.json();
      if ((r.status === 429 || r.status >= 500) && tentativa < TENTATIVAS) {
        const s = r.status === 429 ? PAUSA_LIMITE_S : 3 * tentativa;
        for (let falta = s; falta > 0; falta--) { aoAviso?.(r.status === 429 ? `O DJEN pediu uma pausa. Continuando em ${falta}s…` : `O DJEN está instável. Tentando de novo em ${falta}s…`); await espera(1000); }
        continue;
      }
      throw new Error(`O DJEN respondeu ${r.status}.`);
    }
  };
}

// ---------- Guardado neste navegador ----------
// v2: os resultados passaram a trazer o link do documento no tribunal.
// "parcial" = veio da varredura rápida (1 página por tribunal) e a empresa tinha mais.
const chave = (basico) => `data-venia:djen:v2:${basico}`;
function lerGuardado(basico) {
  try {
    const g = JSON.parse(localStorage.getItem(chave(basico)));
    return g && Date.now() - g.quando < VALIDADE_MS ? g : null;
  } catch { return null; }
}
function guardar(basico, dados) {
  if (dados.parcial && lerGuardado(basico)?.parcial === false) return;   // não troca completo por parcial
  try { localStorage.setItem(chave(basico), JSON.stringify({ quando: Date.now(), ...dados })); } catch { /* sem espaço ou bloqueado: só não guarda */ }
}

// Ao abrir o mapa: o que já foi consultado aqui nas últimas 24 h volta na hora, sem pedido nenhum.
// Devolve [empresa, dados] para quem chama aplicar.
export const jaGuardadas = (empresas) =>
  empresas.filter((e) => e.consultado === false && e.busca).map((e) => [e, lerGuardado(e.busca.basico)]).filter(([, g]) => g);

// ---------- Busca de uma empresa ----------
// Duas profundidades: a varredura faz 1 pedido só, de todos os tribunais juntos (completo para a
// maioria das lojas; parcial nas grandes, mas basta para a cor no mapa); o clique lê cada tribunal
// até 5 páginas (a lista completa na gaveta). Cada uma tem sua busca em andamento; tocar de novo
// na mesma loja reaproveita a busca completa que já está correndo.
const emAndamento = new Map();
const PAGINAS_VARREDURA = 1;

// emp.busca = { basico, razao, comarca, tribunais } (gerado por scripts/cidade.mjs).
// Devolve { processos, totalProcessos, parcial } no formato do app, com datas ainda como texto.
export function buscarAoVivo(emp, { aoProgresso, aoAviso, tipo = "clique" } = {}) {
  const { basico } = emp.busca;
  const guardado = lerGuardado(basico);
  if (guardado && (tipo === "fundo" || !guardado.parcial)) return Promise.resolve(guardado);
  const paginas = tipo === "fundo" ? PAGINAS_VARREDURA : PAGINAS;
  const busca = emAndamento.get(`${basico}:${paginas}`) || iniciar(emp, tipo, paginas);
  if (tipo === "clique") {
    Object.assign(busca, { aoProgresso, aoAviso });
    cliquesEmAndamento++;
    const fim = () => cliquesEmAndamento--;
    busca.promessa.then(fim, fim);
  }
  return busca.promessa;
}

function iniciar(emp, tipo, paginas) {
  const { basico } = emp.busca;
  const cnpj = emp.cnpj.replace(/\D/g, "");
  const busca = { tipo, aoProgresso: null, aoAviso: null };
  const id = `${basico}:${paginas}`;
  // Os tribunais correm juntos; o texto conta quantas páginas já chegaram. Empresa grande tem várias.
  busca.promessa = consultarEmpresa({ ...emp.busca, cnpj }, criarPedir(busca), ({ pedidos }) =>
    busca.aoProgresso?.(`Lendo o Diário de Justiça… ${pedidos} ${pedidos > 1 ? "páginas lidas" : "página lida"}`),
    { emParalelo: true, paginas, rapida: tipo === "fundo" })
    .then((r) => {
      const processos = r.processos.map((p, i) => converterProcesso(p, basico, i)).sort(maisRecentes);
      const dados = { processos, totalProcessos: processos.length, parcial: r.cortado && paginas < PAGINAS };
      guardar(basico, dados);
      return dados;
    })
    .finally(() => emAndamento.delete(id));
  emAndamento.set(id, busca);
  return busca;
}

// ---------- Varredura em segundo plano ----------
// Consulta as lojas ainda cinzas, da mais perto para a mais longe do centro, uma de cada vez.
// Cede a vez enquanto houver um clique em andamento. Devolve uma função que para a varredura
// (usada quando o mapa muda de lugar).
export function iniciarVarredura(empresas, centro, aoResultado, aoTerminar) {
  let parada = false;
  const kx = Math.cos((centro.lat * Math.PI) / 180);
  const dist = (e) => Math.hypot((e.lng - centro.lng) * kx, e.lat - centro.lat);
  const fila = empresas.filter((e) => e.consultado === false && e.busca).sort((a, b) => dist(a) - dist(b));
  (async () => {
    let falhasSeguidas = 0;
    try {
      for (const e of fila) {
        while (cliquesEmAndamento > 0 && !parada) await espera(500);
        if (parada) return;
        if (e.consultado !== false) continue;   // um clique já resolveu esta
        try {
          aoResultado(e, await buscarAoVivo(e, { tipo: "fundo" }));
          falhasSeguidas = 0;
        } catch {
          // Fica cinza e segue. Muitas falhas seguidas = o DJEN está fora; desiste por agora.
          if (++falhasSeguidas >= 3) return;
          await espera(10_000);
        }
      }
    } finally {
      if (!parada) aoTerminar?.();
    }
  })();
  return () => { parada = true; };
}
