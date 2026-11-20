import { TIPOS_PROCESSO } from "./dados/demo.js";

const gaveta = document.getElementById("gaveta");
const conteudo = document.getElementById("gaveta-conteudo");
const fechar = document.getElementById("gaveta-fechar");
let aoFechar = null;

fechar.addEventListener("click", () => aoFechar?.());

const data = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const dinheiro = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MOVIMENTOS_VISIVEIS = 3;

export const gavetaAberta = () => gaveta.classList.contains("aberta");

export function fecharGaveta() {
  gaveta.classList.remove("aberta");
  gaveta.setAttribute("aria-hidden", "true");
}

// "COMERCIAL ZAFFARI LTDA" → "Comercial Zaffari Ltda" (siglas curtas como S/A ficam em maiúsculas).
const nomeBonito = (s) => s.toLowerCase().replace(/(^|[\s/.-])(\p{L})/gu, (_, a, l) => a + l.toUpperCase())
  .replace(/\b(S\/?a|Me|Epp|Cia)\b/g, (m) => m.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());

// Quando o letreiro não é o nome da empresa (Stok Center é da Comercial Zaffari), a ficha diz de quem
// a loja é: os processos saem com o nome da empresa e valem para todas as unidades dela.
function avisoMarca(emp) {
  if (!emp.marcaDe && !(emp.unidades > 1)) return "";
  const outras = emp.unidades - 1;
  const quem = emp.marcaDe && emp.razaoPessoal
    ? "Esta loja está registrada no nome de uma empresa que leva o nome de uma pessoa. Por privacidade, esse nome não aparece aqui. Os processos valem para a empresa inteira, não só para esta unidade."
    : emp.marcaDe
    // "registrada no nome de" serve para marca própria (Stok Center) e para franquia (O Boticário de um franqueado).
    ? `Esta loja está registrada no nome de <strong>${esc(nomeBonito(emp.marcaDe))}</strong>. É esse nome que aparece nos processos, e eles valem para a empresa inteira, não só para esta unidade.`
    : "Os processos valem para a empresa inteira, não só para esta unidade.";
  const irmas = outras > 0 ? ` Outras ${outras} ${outras === 1 ? "loja" : "lojas"} neste mapa são da mesma empresa.` : "";
  return `<p class="emp-marca">${quem}${irmas}</p>`;
}

// Quando não dá para saber qual unidade da empresa é esta loja, mostrar o CNPJ completo de outra unidade
// seria errado: quem conferisse na Receita veria outro endereço. Mostra o da empresa e diz por quê.
function linhaCnpj(emp) {
  if (emp.filialCerta !== false) return `CNPJ ${esc(emp.cnpj)}`;
  const n = emp.unidadesNaCidade;
  return `CNPJ da empresa ${esc(emp.cnpj.slice(0, 10))}/…<br><small>Ela tem ${n > 1 ? `${n} unidades` : "outras unidades"} na cidade e não deu para saber qual delas é esta.</small>`;
}

function cabeca(emp, cat) {
  return `
    <header class="emp-cabeca" style="--cor:var(--${cat})">
      <div class="emp-tipo">${esc(emp.tipo)}</div>
      <h2 class="emp-nome">${esc(emp.nome)}</h2>
      <div class="emp-cnpj">${linhaCnpj(emp)}</div>
      ${avisoMarca(emp)}
    </header>`;
}

function mostrar() {
  gaveta.classList.add("aberta");
  gaveta.setAttribute("aria-hidden", "false");
}

// Modo ao vivo: a gaveta abre na hora e vai contando o que está consultando.
// Chamada várias vezes durante a busca; da segunda em diante só troca o texto.
export function gavetaBuscando(emp, texto, fecharCb) {
  aoFechar = fecharCb;
  const atual = conteudo.querySelector(`.buscando[data-emp="${CSS.escape(emp.id)}"] .buscando-texto`);
  if (atual) { atual.textContent = texto; return; }
  conteudo.innerHTML = `${cabeca(emp, "sem")}
    <div class="buscando" data-emp="${esc(emp.id)}" role="status">
      <span class="buscando-roda" aria-hidden="true"></span>
      <p class="buscando-texto">${esc(texto)}</p>
    </div>`;
  mostrar();
  gaveta.scrollTop = 0;
}

export function gavetaFalhou(emp, motivo, fecharCb, tentarDeNovo) {
  aoFechar = fecharCb;
  conteudo.innerHTML = `${cabeca(emp, "sem")}
    <div class="vazio">
      <p><strong>Não deu para consultar os processos agora.</strong></p>
      <p>${esc(motivo)}</p>
      <button class="tentar">Tentar de novo</button>
    </div>`;
  conteudo.querySelector(".tentar").addEventListener("click", tentarDeNovo);
  mostrar();
}

// cat: categoria dominante ("consumidor", "trabalhista"…) ou "sem"; a cor vem do CSS do tema atual.
export function abrirGaveta(emp, processos, leitura, cat, fecharCb, comoAutora = []) {
  aoFechar = fecharCb;
  const n = processos.length;
  const ativos = processos.filter((p) => p.ativo).length;

  const porTipo = Object.keys(TIPOS_PROCESSO)
    .map((k) => [k, processos.filter((p) => p.categoria === k).length])
    .filter(([, q]) => q);

  conteudo.innerHTML = `${cabeca(emp, cat)}

    ${n ? `
    <div class="emp-placar">
      <div class="placar-num" data-alvo="${n}">0</div>
      <div class="placar-texto">
        processo${n > 1 ? "s" : ""} contra a empresa, ${ativos} em andamento
        <div class="barra-tipos" role="img" aria-label="${porTipo.map(([k, q]) => `${q} ${TIPOS_PROCESSO[k].nome}`).join(", ")}">
          ${porTipo.map(([k, q]) => `<span style="flex:${q};--cor:var(--${k})"></span>`).join("")}
        </div>
      </div>
    </div>
    <p class="nivel">${esc(leitura.frase)}</p>
    <ul class="lista-proc">
      ${processos.map((p, i) => cartao(p, i)).join("")}
    </ul>
    ${emp.totalProcessos > emp.processos?.length ? `<p class="aviso-partes">Mostrando os ${emp.processos.length} mais recentes de ${emp.totalProcessos.toLocaleString("pt-BR")} processos da empresa no país todo.</p>` : ""}
    ` : `
    <div class="vazio">
      <p><strong>Nenhum processo contra a empresa.</strong></p>
      <p>Nos tipos de processo selecionados, este CNPJ não aparece como réu em nenhuma ação.</p>
    </div>`}
    ${secaoAutora(comoAutora)}
    ${n || comoAutora.length ? `<p class="aviso-partes">Nomes de pessoas físicas ficam ocultos. Ter processo não significa culpa: muitos são arquivados ou terminam em acordo.</p>` : ""}
  `;

  conteudo.querySelectorAll(".proc-botao").forEach((b) =>
    b.addEventListener("click", () => {
      const item = b.closest(".proc");
      const abre = !item.classList.contains("aberto");
      item.classList.toggle("aberto", abre);
      b.setAttribute("aria-expanded", abre);
    }));

  conteudo.querySelectorAll(".copiar").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.numero); b.textContent = "Copiado"; }
      catch { b.textContent = "Não deu para copiar"; }
      setTimeout(() => (b.textContent = "Copiar número"), 1800);
    }));

  const num = conteudo.querySelector(".placar-num");
  if (num) contar(num, n);

  mostrar();
  gaveta.scrollTop = 0;
  gaveta.focus({ preventScroll: true });
}

// Processos em que a empresa é quem processa: cobranças, execuções, ações contra fornecedores.
// Ficam recolhidos e numa cor neutra, porque não pesam contra ela. Lista longa é cortada.
const AUTORA_VISIVEIS = 30;
function secaoAutora(lista) {
  if (!lista.length) return "";
  const cobrancas = lista.filter((p) => /execu|cumprimento|cobran|monit/i.test(`${p.classe} ${p.assunto}`)).length;
  const resumo = cobrancas >= lista.length / 2 ? ", a maioria cobranças" : "";
  return `
    <details class="como-autora">
      <summary><strong>${lista.length}</strong> processo${lista.length > 1 ? "s" : ""} movido${lista.length > 1 ? "s" : ""} pela empresa${resumo}</summary>
      <ul class="lista-proc">${lista.slice(0, AUTORA_VISIVEIS).map((p, i) => cartao(p, i)).join("")}</ul>
      ${lista.length > AUTORA_VISIVEIS ? `<p class="aviso-partes">E mais ${lista.length - AUTORA_VISIVEIS}.</p>` : ""}
    </details>`;
}

function cartao(p, i) {
  const t = TIPOS_PROCESSO[p.categoria];
  const movs = p.movimentacoes.slice(0, MOVIMENTOS_VISIVEIS);
  return `
  <li class="proc" style="--cor:var(--${p.categoria});--i:${i}">
    <button class="proc-botao" aria-expanded="false">
      <div class="proc-topo">
        <span class="proc-tipo">${t.nome}</span>
        <span class="status ${p.ativo ? "andamento" : "encerrado"}">${esc(p.status)}</span>
      </div>
      <div class="proc-assunto">${esc(p.assunto)}</div>
    </button>
    <div class="proc-detalhe"><div><div class="proc-corpo">
      ${p.resumo ? `<p class="proc-resumo">${esc(p.resumo)}</p>` : ""}
      <dl class="proc-fatos">
        ${p.distribuicao && !isNaN(p.distribuicao) ? `<div><dt>Início</dt><dd>${data.format(p.distribuicao)}</dd></div>` : ""}
        ${p.valor != null ? `<div><dt>Valor da causa</dt><dd>${dinheiro.format(p.valor)}</dd></div>` : ""}
        ${p.outraParte ? `<div><dt>${p.polo === "autora" ? "Contra" : p.polo === "ré" ? "Movido por" : "Outra parte"}</dt><dd>${esc(p.outraParte)}</dd></div>` : ""}
      </dl>
      <ol class="linha-tempo" aria-label="Últimas movimentações">
        ${movs.map((m) => `<li><time>${data.format(m.data)}</time>${esc(m.texto)}</li>`).join("")}
      </ol>
      <div class="proc-num">${esc(p.numero)}, ${esc(p.tribunal)}</div>
      ${conferir(p)}
    </div></div></div>
  </li>`;
}

// Para quem quiser conferir que o processo existe: fontes oficiais primeiro, Google por último.
// Google recebe o número entre aspas, para achar exatamente aquele processo.
function conferir(p) {
  const num = encodeURIComponent(p.numero);
  const links = [
    p.link && [p.link, "Documento no tribunal"],
    [`https://comunica.pje.jus.br/consulta?numeroProcesso=${num}`, "Diário de Justiça"],
    [`https://www.google.com/search?q=${encodeURIComponent(`"${p.numero}"`)}`, "Google"],
  ].filter(Boolean);
  return `
      <div class="proc-conferir" aria-label="Conferir o processo">
        <button class="copiar" data-numero="${esc(p.numero)}">Copiar número</button>
        ${links.map(([href, rotulo]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${rotulo}</a>`).join("")}
      </div>`;
}

function contar(el, alvo) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = alvo; return; }
  const t0 = performance.now();
  const passo = (t) => {
    const k = Math.min(1, (t - t0) / 700);
    el.textContent = Math.round(alvo * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
