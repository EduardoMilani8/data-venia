// Tema claro de dia, escuro de noite, com o nascer e o pôr do sol calculados para onde você está.
// A pessoa pode fixar um tema no botão; a escolha fica guardada neste navegador.

const CHAVE = "data-venia-tema";
const ORDEM = ["auto", "claro", "escuro"];
const ROTULO = { auto: "Tema automático", claro: "Tema claro", escuro: "Tema escuro" };

// Fórmula aproximada da NOAA; erro de poucos minutos, suficiente para trocar o tema.
export function horariosDoSol(lat, lng, data = new Date()) {
  const rad = Math.PI / 180;
  const inicioAno = Date.UTC(data.getUTCFullYear(), 0, 0);
  const dia = Math.floor((data.getTime() - inicioAno) / 864e5);
  const g = ((2 * Math.PI) / 365) * (dia - 1);
  const eqTempo = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH > 1 || cosH < -1) return null; // sol da meia-noite ou noite polar
  const h = Math.acos(cosH) / rad;
  const meiaNoiteUTC = Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
  const minutos = (m) => new Date(meiaNoiteUTC + m * 60000);
  return { nascer: minutos(720 - 4 * (lng + h) - eqTempo), por: minutos(720 - 4 * (lng - h) - eqTempo) };
}

function temaPeloSol(centro) {
  const agora = new Date();
  const sol = centro && horariosDoSol(centro.lat, centro.lng, agora);
  if (!sol) { const h = agora.getHours(); return h >= 6 && h < 18 ? "claro" : "escuro"; }
  return agora >= sol.nascer && agora < sol.por ? "claro" : "escuro";
}

function lerPreferencia() {
  try { const v = localStorage.getItem(CHAVE); return ORDEM.includes(v) ? v : "auto"; } catch { return "auto"; }
}
function salvarPreferencia(v) { try { localStorage.setItem(CHAVE, v); } catch { /* modo privado */ } }

export function criarTema(aoMudar) {
  let preferencia = lerPreferencia();
  let centro = null;
  let atual = null;

  const resolver = () => (preferencia === "auto" ? temaPeloSol(centro) : preferencia);

  function aplicar(forcar = false) {
    const novo = resolver();
    document.documentElement.dataset.tema = novo;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", novo === "claro" ? "#eef1f5" : "#0f1a2a");
    if (novo !== atual || forcar) { const antes = atual; atual = novo; if (antes) aoMudar(novo); }
  }

  aplicar();
  setInterval(aplicar, 5 * 60 * 1000); // confere a cada 5 minutos se o sol nasceu ou se pôs

  return {
    get atual() { return atual; },
    definirCentro(c) { centro = c; aplicar(); },
    ligarBotao(botao) {
      const pintar = () => { botao.textContent = ROTULO[preferencia]; botao.dataset.pref = preferencia; };
      pintar();
      botao.addEventListener("click", () => {
        preferencia = ORDEM[(ORDEM.indexOf(preferencia) + 1) % ORDEM.length];
        salvarPreferencia(preferencia);
        pintar();
        aplicar();
      });
    },
  };
}
