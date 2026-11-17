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

// cat: categoria dominante ("consumidor", "trabalhista"…) ou "sem"; a cor vem do CSS do tema atual.
export function abrirGaveta(emp, processos, leitura, cat, fecharCb) {
  aoFechar = fecharCb;
  const n = processos.length;
  const ativos = processos.filter((p) => p.ativo).length;

  const porTipo = Object.keys(TIPOS_PROCESSO)
    .map((k) => [k, processos.filter((p) => p.categoria === k).length])
    .filter(([, q]) => q);

  conteudo.innerHTML = `
    <header class="emp-cabeca" style="--cor:var(--${cat})">
      <div class="emp-tipo">${esc(emp.tipo)}</div>
      <h2 class="emp-nome">${esc(emp.nome)}</h2>
      <div class="emp-cnpj">CNPJ ${esc(emp.cnpj)}</div>
    </header>

    ${n ? `
    <div class="emp-placar">
      <div class="placar-num" data-alvo="${n}">0</div>
      <div class="placar-texto">
        processo${n > 1 ? "s" : ""}, ${ativos} em andamento
        <div class="barra-tipos" role="img" aria-label="${porTipo.map(([k, q]) => `${q} ${TIPOS_PROCESSO[k].nome}`).join(", ")}">
          ${porTipo.map(([k, q]) => `<span style="flex:${q};--cor:var(--${k})"></span>`).join("")}
        </div>
      </div>
    </div>
    <p class="nivel">${esc(leitura.frase)}</p>
    <ul class="lista-proc">
      ${processos.map((p, i) => cartao(p, i)).join("")}
    </ul>
    <p class="aviso-partes">Nomes de pessoas físicas ficam ocultos. Ter processo não significa culpa: muitos são arquivados ou terminam em acordo.</p>
    ` : `
    <div class="vazio">
      <p><strong>Nenhum processo encontrado.</strong></p>
      <p>Nos tipos de processo selecionados, este CNPJ não aparece em nenhuma ação.</p>
    </div>`}
  `;

  conteudo.querySelectorAll(".proc-botao").forEach((b) =>
    b.addEventListener("click", () => {
      const item = b.closest(".proc");
      const abre = !item.classList.contains("aberto");
      item.classList.toggle("aberto", abre);
      b.setAttribute("aria-expanded", abre);
    }));

  const num = conteudo.querySelector(".placar-num");
  if (num) contar(num, n);

  gaveta.classList.add("aberta");
  gaveta.setAttribute("aria-hidden", "false");
  gaveta.scrollTop = 0;
  gaveta.focus({ preventScroll: true });
}

function cartao(p, i) {
  const t = TIPOS_PROCESSO[p.categoria];
  const movs = p.movimentacoes.slice(0, MOVIMENTOS_VISIVEIS);
  return `
  <li class="proc" style="--cor:var(--${p.categoria});--i:${i}">
    <button class="proc-botao" aria-expanded="false">
      <div class="proc-topo">
        <span class="proc-tipo">${t.nome}</span>
        <span class="status ${p.ativo ? "andamento" : "encerrado"}">${p.status}</span>
      </div>
      <div class="proc-assunto">${esc(p.assunto)}</div>
    </button>
    <div class="proc-detalhe"><div><div class="proc-corpo">
      <p class="proc-resumo">${esc(p.resumo)}</p>
      <dl class="proc-fatos">
        <div><dt>Início</dt><dd>${data.format(p.distribuicao)}</dd></div>
        <div><dt>Valor da causa</dt><dd>${dinheiro.format(p.valor)}</dd></div>
      </dl>
      <ol class="linha-tempo" aria-label="Últimas movimentações">
        ${movs.map((m) => `<li><time>${data.format(m.data)}</time>${esc(m.texto)}</li>`).join("")}
      </ol>
      <div class="proc-num">${p.numero}, ${p.tribunal}${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">abrir no tribunal</a>` : ""}</div>
    </div></div></div>
  </li>`;
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
