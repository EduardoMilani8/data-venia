import { carregarEmpresas, MODO, buscarAoVivo, prepararDatas, jaGuardadas, iniciarVarredura } from "./dados/provedor.js";
import { TIPOS_PROCESSO } from "./dados/demo.js";
import { lerHistorico } from "./classificacao.js";
import { abrirGaveta, fecharGaveta, gavetaAberta, gavetaBuscando, gavetaFalhou } from "./gaveta.js";
import { criarTema } from "./tema.js";

const CENTRO_PADRAO = { lat: -23.5503, lng: -46.6339, nome: "Centro de São Paulo" };
const FONTE = ["Montserrat Medium"];
const calmo = matchMedia("(prefers-reduced-motion: reduce)").matches;
const celular = () => innerWidth <= 720;

// Tudo o que muda entre dia e noite no mapa fica aqui.
const VISUAL = {
  escuro: {
    estilo: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    fundo: "#0f1a2a", agua: "#0a1424", verde: "#132238", rua: "#22344f",
    predio: ["#142238", "#1b2d48"], predioOpacidade: 0.88,
    cores: { consumidor: "#f2b33d", trabalhista: "#4cc3e0", tributario: "#a487f5", civel: "#5fd3a0", sem: "#5b6b82" },
    borda: "#0f1a2a", texto: "#c9d5e4", textoHalo: "#0f1a2a",
    grupo: "rgba(22,36,58,0.92)", grupoTexto: "#e8edf4",
    calor: ["rgba(15,26,42,0)", "rgba(76,195,224,0.35)", "#a487f5", "#f2b33d", "#fff3d1"],
  },
  claro: {
    estilo: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    fundo: "#eef1f5", agua: "#c9d8e8", verde: "#e2eadf", rua: null,
    predio: ["#f3f5f9", "#eceff5"], predioOpacidade: 0.92,
    cores: { consumidor: "#d18a00", trabalhista: "#0f8fb3", tributario: "#7253e0", civel: "#1e9a6b", sem: "#9aa6b6" },
    borda: "#ffffff", texto: "#334155", textoHalo: "#ffffff",
    grupo: "rgba(255,255,255,0.95)", grupoTexto: "#1e293b",
    calor: ["rgba(238,241,245,0)", "rgba(15,143,179,0.3)", "#7253e0", "#e39a12", "#c2410c"],
  },
};

const estado = {
  empresas: [],
  porId: new Map(),
  filtros: new Set(Object.keys(TIPOS_PROCESSO)),
  selecionada: null,
  hover: null,
  centro: null,
  calor: false,
  revelar: 0, // 0 → 1 enquanto os pins "brotam" depois da chegada da câmera
};

// ---------- WebGL ----------
const teste = document.createElement("canvas");
if (!(teste.getContext("webgl2") || teste.getContext("webgl"))) {
  document.getElementById("intro-status").textContent =
    "Este navegador está sem aceleração gráfica (WebGL), e o mapa precisa dela. Ative a aceleração de hardware nas configurações ou abra em outro navegador.";
  throw new Error("WebGL indisponível");
}

// ---------- Tema ----------
const tema = criarTema((novo) => trocarEstilo(novo));
const V = () => VISUAL[tema.atual];

// ---------- Mapa ----------
const map = new maplibregl.Map({
  container: "map",
  style: V().estilo,
  center: [CENTRO_PADRAO.lng, CENTRO_PADRAO.lat],
  zoom: 2.6,
  pitch: 0,
  attributionControl: { compact: true },
  maxPitch: 70,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), "bottom-right");

const mapaPronto = new Promise((ok) => map.once("load", ok));

function tingirMapa() {
  const v = V();
  for (const camada of map.getStyle().layers) {
    const id = camada.id;
    try {
      if (camada.type === "background") map.setPaintProperty(id, "background-color", v.fundo);
      else if (/^water/.test(id) && camada.type === "fill") map.setPaintProperty(id, "fill-color", v.agua);
      else if (/landuse|park|landcover/.test(id) && camada.type === "fill") map.setPaintProperty(id, "fill-color", v.verde);
      else if (/building/.test(id)) map.setLayoutProperty(id, "visibility", "none");
      else if (v.rua && /road|bridge|tunnel/.test(id) && camada.type === "line") map.setPaintProperty(id, "line-color", v.rua);
    } catch { /* algumas camadas não aceitam a propriedade */ }
  }

  // Luz mais suave de dia, para os prédios não ficarem com laterais escuras demais.
  map.setLight({ anchor: "viewport", intensity: tema.atual === "claro" ? 0.18 : 0.4, color: "#ffffff" });

  const primeiroRotulo = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  const fonte = map.getSource("protomaps") ? "protomaps" : map.getSource("carto") ? "carto" : null;
  if (!fonte) return;
  map.addLayer({
    id: "predios-3d",
    type: "fill-extrusion",
    source: fonte,
    "source-layer": fonte === "protomaps" ? "buildings" : "building",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": ["interpolate", ["linear"], ["zoom"], 15, v.predio[0], 18, v.predio[1]],
      "fill-extrusion-opacity-transition": { duration: 600 },
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5,
        ["coalesce", ["get", "height"], ["get", "render_height"], 12]],
      "fill-extrusion-base": ["coalesce", ["get", "min_height"], ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": estado.calor ? 0.18 : v.predioOpacidade,
      "fill-extrusion-vertical-gradient": true,
    },
  }, primeiroRotulo);
}

// ---------- Dados → GeoJSON ----------
// O mapa mede processos CONTRA a empresa. Quando ela é a autora (ex.: uma ótica cobrando o crediário
// de clientes), o processo não diz nada de ruim sobre ela: fica à parte, na gaveta.
// Polo desconhecido ("parte") conta junto, para não esconder o que não sabemos classificar.
const ehAutora = (p) => p.polo === "autora";
function processosVisiveis(e) {
  return e.processos.filter((p) => !ehAutora(p) && estado.filtros.has(p.categoria));
}
function processosComoAutora(e) {
  return e.processos.filter((p) => ehAutora(p) && estado.filtros.has(p.categoria));
}

function categoriaDominante(processos) {
  if (!processos.length) return "sem";
  const conta = {};
  for (const p of processos) conta[p.categoria] = (conta[p.categoria] || 0) + 1;
  return Object.entries(conta).sort((a, b) => b[1] - a[1])[0][0];
}

function geojson() {
  return {
    type: "FeatureCollection",
    features: estado.empresas.map((e, i) => {
      const vis = processosVisiveis(e);
      return {
        type: "Feature",
        id: i,
        geometry: { type: "Point", coordinates: [e.lng, e.lat] },
        properties: {
          eid: e.id, nome: e.nome, tipo: e.tipo,
          qtd: vis.length, cat: categoriaDominante(vis), nivel: vis.length ? lerHistorico(vis).nivel : 0,
          // Modo ao vivo: ainda não sabemos os processos. Inclui a rede nacional cuja varredura rápida só
          // trouxe publicações de outras cidades: 0 ali não quer dizer "sem processos".
          pendente: e.consultado === false || (e.parcial === true && vis.length === 0),
        },
      };
    }),
  };
}

// A cor vem do tema atual: ["match", categoria, "consumidor", "#...", ...]
const corPorCategoria = () => ["match", ["get", "cat"], ...Object.entries(V().cores).flat(), V().cores.sem];

function montarCamadas() {
  const v = V();
  map.addSource("empresas", {
    type: "geojson",
    data: geojson(),
    cluster: true,
    clusterRadius: 42,
    clusterMaxZoom: 15,
    clusterProperties: { soma: ["+", ["get", "qtd"]] },
  });

  // Círculo de precisão da sua posição (encolhe conforme o GPS melhora)
  map.addSource("precisao", { type: "geojson", data: circuloPrecisao(estado.posicao) });
  map.addLayer({
    id: "precisao-area", type: "fill", source: "precisao",
    paint: { "fill-color": v.cores.trabalhista, "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: "precisao-borda", type: "line", source: "precisao",
    paint: { "line-color": v.cores.trabalhista, "line-opacity": 0.45, "line-width": 1.2 },
  });

  map.addLayer({
    id: "calor", type: "heatmap", source: "empresas",
    layout: { visibility: estado.calor ? "visible" : "none" },
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["coalesce", ["get", "soma"], ["get", "qtd"]], 0, 0, 12, 1],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 12, 1.4, 17, 2.6],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 12, 34, 15, 70, 17, 110],
      "heatmap-opacity": 0.85,
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
        0, v.calor[0], 0.2, v.calor[1], 0.45, v.calor[2], 0.7, v.calor[3], 1, v.calor[4]],
    },
  });

  const pinos = estado.calor ? "none" : "visible";
  map.addLayer({
    id: "grupos", type: "circle", source: "empresas", filter: ["has", "point_count"],
    layout: { visibility: pinos },
    paint: {
      "circle-color": v.grupo,
      "circle-stroke-color": ["step", ["get", "soma"], v.cores.sem, 1, v.cores.trabalhista, 15, v.cores.tributario, 40, v.cores.consumidor],
      "circle-stroke-width": 2,
      "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 16, 20, 28],
    },
  });
  map.addLayer({
    id: "grupos-num", type: "symbol", source: "empresas", filter: ["has", "point_count"],
    layout: { visibility: pinos, "text-field": ["get", "point_count_abbreviated"], "text-font": FONTE, "text-size": 13, "text-allow-overlap": true },
    paint: { "text-color": v.grupoTexto },
  });

  // Halo pulsante: só empresas com processos, mais forte quanto maior o nível
  map.addLayer({
    id: "halo", type: "circle", source: "empresas",
    filter: ["all", ["!", ["has", "point_count"]], [">", ["get", "qtd"], 0]],
    layout: { visibility: pinos },
    paint: { "circle-color": corPorCategoria(), "circle-radius": 0, "circle-opacity": 0, "circle-blur": 0.6, "circle-pitch-alignment": "viewport" },
  });

  map.addLayer({
    id: "pontos", type: "circle", source: "empresas", filter: ["!", ["has", "point_count"]],
    layout: { visibility: pinos },
    paint: {
      // Modo ao vivo: loja ainda não consultada vira um anel vazado (fundo da cor do mapa, borda do texto),
      // para ficar visível sem fingir que já sabemos a cor dos processos.
      "circle-color": ["case", ["get", "pendente"], v.borda, corPorCategoria()],
      "circle-radius": raioPonto(1 - Math.pow(1 - estado.revelar, 3)),
      "circle-stroke-color": ["case",
        ["boolean", ["feature-state", "sel"], false], tema.atual === "claro" ? "#0f172a" : "#ffffff",
        ["get", "pendente"], v.texto,
        v.borda],
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "sel"], false], 3, 2],
      "circle-pitch-alignment": "viewport",
    },
  });

  map.addLayer({
    id: "rotulos", type: "symbol", source: "empresas", minzoom: 16.6,
    filter: ["!", ["has", "point_count"]],
    layout: {
      visibility: pinos,
      "text-field": ["get", "nome"], "text-font": FONTE, "text-size": 12,
      "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true,
    },
    paint: { "text-color": v.texto, "text-halo-color": v.textoHalo, "text-halo-width": 1.4 },
  });

  if (estado.revelar >= 1) pintarHaloParado();
}

function raioPonto(escala) {
  // O tamanho cresce com a quantidade de processos; "escala" anima o surgimento.
  return ["*", escala, ["+",
    ["case", ["get", "pendente"], 8, ["interpolate", ["linear"], ["get", "qtd"], 0, 4.5, 1, 8, 8, 13, 25, 19]],
    ["case", ["boolean", ["feature-state", "hover"], false], 3, 0],
    ["case", ["boolean", ["feature-state", "sel"], false], 4, 0]]];
}

function pintarHaloParado() {
  if (!calmo) return;
  map.setPaintProperty("halo", "circle-radius", ["+", 10, ["*", ["get", "nivel"], 5]]);
  map.setPaintProperty("halo", "circle-opacity", ["*", 0.25, ["/", ["get", "nivel"], 3]]);
}

// Troca o mapa base e remonta as camadas; a seleção e o mapa de calor são preservados.
function trocarEstilo(novo) {
  if (!estado.empresas.length) { map.setStyle(VISUAL[novo].estilo, { diff: false }); return; }
  const sel = estado.selecionada;
  map.setStyle(VISUAL[novo].estilo, { diff: false });
  map.once("style.load", () => {
    tingirMapa();
    montarCamadas();
    if (sel != null) marcar("sel", sel, true);
    if (sel != null) abrirSelecionada();
  });
}

// ---------- Animação (um único laço, leve) ----------
function laco(t) {
  if (!map.getLayer("pontos")) return requestAnimationFrame(laco);
  const ease = 1 - Math.pow(1 - estado.revelar, 3);
  if (estado.revelar < 1) {
    estado.revelar = Math.min(1, estado.revelar + 0.022);
    map.setPaintProperty("pontos", "circle-radius", raioPonto(ease));
  }
  if (calmo) {
    if (estado.revelar >= 1) return pintarHaloParado();
    return requestAnimationFrame(laco);
  }
  const fase = (t % 2400) / 2400; // 0 → 1
  const forca = tema.atual === "claro" ? 0.4 : 0.5;
  map.setPaintProperty("halo", "circle-radius",
    ["*", ease, ["+", 8, ["*", ["get", "nivel"], 4], ["*", fase, ["+", 8, ["*", ["get", "nivel"], 6]]]]]);
  map.setPaintProperty("halo", "circle-opacity", ["*", ease, (1 - fase) * forca, ["/", ["get", "nivel"], 3]]);
  requestAnimationFrame(laco);
}

// ---------- Interação ----------
const dica = new maplibregl.Popup({ className: "dica", closeButton: false, closeOnClick: false, offset: 14 });

function marcar(campo, id, valor) {
  if (id == null || !map.getSource("empresas")) return;
  map.setFeatureState({ source: "empresas", id }, { [campo]: valor });
}

function ligarInteracoes() {
  map.on("mousemove", "pontos", (ev) => {
    const f = ev.features[0];
    map.getCanvas().style.cursor = "pointer";
    if (estado.hover !== f.id) { marcar("hover", estado.hover, false); estado.hover = f.id; marcar("hover", f.id, true); }
    const q = f.properties.qtd;
    dica.setLngLat(f.geometry.coordinates)
      .setHTML(`<strong>${esc(f.properties.nome)}</strong><span>${q ? `${q} processo${q > 1 ? "s" : ""}` : "Sem processos"}</span>`)
      .addTo(map);
  });
  map.on("mouseleave", "pontos", () => {
    map.getCanvas().style.cursor = "";
    marcar("hover", estado.hover, false); estado.hover = null; dica.remove();
  });
  map.on("click", "pontos", (ev) => selecionar(ev.features[0].properties.eid));

  map.on("mouseenter", "grupos", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "grupos", () => (map.getCanvas().style.cursor = ""));
  map.on("click", "grupos", async (ev) => {
    const f = ev.features[0];
    const zoom = await map.getSource("empresas").getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.3, duration: 700 });
  });

  map.on("click", (ev) => {
    if (!map.getLayer("pontos")) return;
    if (!map.queryRenderedFeatures(ev.point, { layers: ["pontos", "grupos"] }).length && gavetaAberta()) desselecionar();
  });
}

function indiceDe(eid) { return estado.empresas.findIndex((e) => e.id === eid); }

function abrirSelecionada() {
  const emp = estado.empresas[estado.selecionada];
  if (emp.consultado === false || emp.parcial) return consultarAoVivo(emp);
  const vis = processosVisiveis(emp);
  abrirGaveta(emp, vis, lerHistorico(vis), categoriaDominante(vis), desselecionar, processosComoAutora(emp));
}

// ---------- Modo ao vivo ----------
// Resultado chegou (de um clique, da varredura ou do guardado no navegador): a loja ganha cor.
// Vários resultados no mesmo quadro viram um redesenho só.
let redesenhoPendente = false;
// Resultado parcial (varredura rápida) colore o mapa; o completo (clique) substitui o parcial, nunca o contrário.
function aplicarResultado(emp, { processos, totalProcessos, parcial = false }) {
  const podeTrocar = emp.consultado === false || (emp.parcial && !parcial);
  if (!podeTrocar) return;
  Object.assign(emp, { processos: prepararDatas(processos), totalProcessos, consultado: true, parcial });
  if (redesenhoPendente) return;
  redesenhoPendente = true;
  requestAnimationFrame(() => {
    redesenhoPendente = false;
    map.getSource("empresas")?.setData(geojson());
    atualizarContagens();
    atualizarResumo();
  });
}

let pararVarredura = null;
function comecarVarredura() {
  pararVarredura?.();
  for (const [e, dados] of jaGuardadas(estado.empresas)) aplicarResultado(e, dados);
  estado.varredura = "rodando";
  pararVarredura = iniciarVarredura(estado.empresas, estado.centro, aplicarResultado, () => {
    estado.varredura = "parada";
    atualizarResumo();
  });
}

// A gaveta abre já, mostrando o andamento, e se preenche quando o DJEN responder.
// Se a pessoa trocar de loja no meio, o resultado ainda é guardado na empresa certa e pinta o mapa.
async function consultarAoVivo(emp) {
  const aindaEla = () => estado.selecionada != null && estado.empresas[estado.selecionada] === emp;
  const avisar = (texto) => aindaEla() && gavetaBuscando(emp, texto, desselecionar);
  avisar("Procurando processos no Diário de Justiça…");
  try {
    aplicarResultado(emp, await buscarAoVivo(emp, { aoProgresso: avisar, aoAviso: avisar }));
    if (aindaEla()) abrirSelecionada();
  } catch (err) {
    if (aindaEla()) gavetaFalhou(emp, err.message, desselecionar, () => consultarAoVivo(emp));
  }
}

function selecionar(eid) {
  const emp = estado.porId.get(eid);
  if (!emp) return;
  if (estado.calor) document.getElementById("btn-calor").click();
  marcar("sel", estado.selecionada, false);
  estado.selecionada = indiceDe(eid);
  marcar("sel", estado.selecionada, true);
  dica.remove();

  abrirSelecionada();
  document.body.classList.add("gaveta-aberta");

  const padding = celular()
    ? { top: 40, bottom: innerHeight * 0.55, left: 20, right: 20 }
    : { top: 60, bottom: 60, left: 60, right: 460 };
  map.flyTo({
    center: [emp.lng, emp.lat], zoom: Math.max(map.getZoom(), 17.2), pitch: 62,
    bearing: map.getBearing() + 18, padding, duration: calmo ? 0 : 1400, essential: true,
  });
}

function desselecionar() {
  marcar("sel", estado.selecionada, false);
  estado.selecionada = null;
  fecharGaveta();
  document.body.classList.remove("gaveta-aberta");
  map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, pitch: 55, duration: 800 });
}

// ---------- Filtros, resumo, busca ----------
function atualizarContagens() {
  const contagem = {};
  for (const e of estado.empresas) for (const p of e.processos) if (!ehAutora(p)) contagem[p.categoria] = (contagem[p.categoria] || 0) + 1;
  document.querySelectorAll("#filtros .chip").forEach((c) => (c.querySelector(".qtd").textContent = contagem[c.dataset.cat] || 0));
}

function montarFiltros() {
  const caixa = document.getElementById("filtros");
  caixa.innerHTML = Object.entries(TIPOS_PROCESSO).map(([k, t]) => `
    <button class="chip" data-cat="${k}" aria-pressed="true" style="--cor:var(--${k})">
      <span class="tarja"></span>${t.nome}<span class="qtd"></span>
    </button>`).join("");
  atualizarContagens();

  caixa.addEventListener("click", (ev) => {
    const b = ev.target.closest(".chip");
    if (!b) return;
    const cat = b.dataset.cat;
    // Se todos estão ligados, o primeiro clique isola aquele tipo (mais útil que desligar um só).
    if (estado.filtros.size === Object.keys(TIPOS_PROCESSO).length) estado.filtros = new Set([cat]);
    else if (estado.filtros.has(cat)) estado.filtros.delete(cat);
    else estado.filtros.add(cat);
    if (estado.filtros.size === 0) estado.filtros = new Set(Object.keys(TIPOS_PROCESSO));
    caixa.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", estado.filtros.has(c.dataset.cat)));
    atualizarDados();
  });

  const calor = document.getElementById("btn-calor");
  calor.addEventListener("click", () => {
    estado.calor = !estado.calor;
    calor.setAttribute("aria-pressed", estado.calor);
    map.setLayoutProperty("calor", "visibility", estado.calor ? "visible" : "none");
    for (const id of ["halo", "pontos", "grupos", "grupos-num", "rotulos"]) map.setLayoutProperty(id, "visibility", estado.calor ? "none" : "visible");
    // O calor é desenhado no chão: prédios ficam translúcidos e a câmera sobe para ver o bairro inteiro.
    if (map.getLayer("predios-3d")) map.setPaintProperty("predios-3d", "fill-extrusion-opacity", estado.calor ? 0.18 : V().predioOpacidade);
    if (estado.calor) {
      if (gavetaAberta()) desselecionar();
      map.flyTo({ center: [estado.centro.lng, estado.centro.lat], zoom: 14.9, pitch: 35, duration: calmo ? 0 : 1400 });
    }
  });

  document.getElementById("btn-centro").addEventListener("click", () => {
    const alvo = estado.posicao ?? estado.centro;
    estado.mexeuNoMapa = false; // voltou para si: o refinamento pode acompanhar de novo
    map.flyTo({ center: [alvo.lng, alvo.lat], zoom: 16.2, pitch: 55, bearing: -18, duration: 1600 });
  });

  tema.ligarBotao(document.getElementById("btn-tema"));
}

function atualizarDados() {
  map.getSource("empresas").setData(geojson());
  atualizarResumo();
  if (estado.selecionada != null) abrirSelecionada();
}

function contarAte(el, alvo) {
  if (calmo) { el.textContent = alvo; return; }
  const inicio = Number(el.textContent) || 0, t0 = performance.now();
  const passo = (t) => {
    const k = Math.min(1, (t - t0) / 900);
    el.textContent = Math.round(inicio + (alvo - inicio) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function atualizarResumo() {
  const caixa = document.getElementById("resumo");
  if (!caixa.children.length) {
    caixa.innerHTML = `
      <div><div class="num" data-k="emp">0</div><div class="rot">empresas</div></div>
      <div><div class="num" data-k="com">0</div><div class="rot">com processos</div></div>
      <div><div class="num" data-k="proc">0</div><div class="rot">processos</div></div>`;
  }
  const vis = estado.empresas.map(processosVisiveis);
  if (MODO === "vivo") mostrarVarredura(caixa);
  contarAte(caixa.querySelector('[data-k="emp"]'), estado.empresas.length);
  contarAte(caixa.querySelector('[data-k="com"]'), vis.filter((v) => v.length).length);
  contarAte(caixa.querySelector('[data-k="proc"]'), vis.reduce((s, v) => s + v.length, 0));
}

// Modo ao vivo: quantas lojas ainda não foram consultadas. O anel é a mesma marca do mapa,
// então esta linha também serve de legenda.
function mostrarVarredura(caixa) {
  let linha = caixa.querySelector(".varredura");
  if (!linha) {
    caixa.insertAdjacentHTML("beforeend", `
      <div class="varredura">
        <span class="anel" aria-hidden="true"></span><span class="varredura-texto"></span>
        <span class="varredura-barra" aria-hidden="true"><i></i></span>
      </div>`);
    linha = caixa.querySelector(".varredura");
  }
  const total = estado.empresas.length;
  const faltam = estado.empresas.filter((e) => e.consultado === false).length;
  const abrirParaVer = estado.empresas.filter((e) => e.parcial && !processosVisiveis(e).length).length;
  linha.classList.toggle("completa", faltam === 0);
  linha.querySelector(".varredura-texto").textContent = faltam === 0
    ? `Todas as ${total} lojas consultadas no DJEN`
    : `${total - faltam} de ${total} lojas consultadas${estado.varredura === "rodando" ? ", das mais próximas para as mais longe" : ""}. O anel marca as que faltam.`;
  if (faltam === 0 && abrirParaVer) linha.querySelector(".varredura-texto").textContent =
    `Todas consultadas. ${abrirParaVer} ${abrirParaVer > 1 ? "redes grandes ficaram" : "rede grande ficou"} com anel: toque para a busca completa.`;
  linha.querySelector(".varredura-barra i").style.width = `${((total - faltam) / Math.max(1, total)) * 100}%`;
}

function montarBusca() {
  const campo = document.getElementById("busca");
  const lista = document.getElementById("busca-resultados");
  const normal = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  campo.addEventListener("input", () => {
    const q = normal(campo.value.trim());
    const qNum = q.replace(/\D/g, "");
    if (!q) { lista.hidden = true; return; }
    const achados = estado.empresas
      .filter((e) => normal(e.nome).includes(q) || normal(e.tipo).includes(q) || (qNum.length >= 3 && e.cnpj.replace(/\D/g, "").includes(qNum)))
      .slice(0, 8);
    lista.innerHTML = achados.length
      ? achados.map((e) => `<button class="busca-item" role="option" data-eid="${e.id}">
          <span><strong>${esc(e.nome)}</strong><small>${esc(e.tipo)}, ${(() => { const n = e.processos.filter((p) => !ehAutora(p)).length; return n ? `${n} processo${n === 1 ? "" : "s"} contra` : "nenhum processo contra"; })()}</small></span></button>`).join("")
      : `<div class="busca-item"><span>Nenhuma empresa com esse nome por perto.</span></div>`;
    lista.hidden = false;
  });
  lista.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-eid]");
    if (!b) return;
    lista.hidden = true; campo.value = "";
    selecionar(b.dataset.eid);
  });
  campo.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") lista.querySelector("[data-eid]")?.click();
    if (ev.key === "Escape") { lista.hidden = true; campo.blur(); }
  });
}

document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && gavetaAberta()) desselecionar(); });

// ---------- Localização ----------
// O navegador diz exatamente por que falhou; cada motivo tem uma saída diferente para a pessoa.
const MOTIVO_LOCAL = {
  1: "O acesso à localização está bloqueado para este site. Libere nas permissões do navegador e tente de novo.",
  2: "O aparelho não conseguiu descobrir onde você está. Confira se a localização do sistema está ligada.",
  3: "A localização demorou demais para chegar. Em lugares fechados o GPS pode levar um tempo.",
};

function pedirPosicao(opcoes) {
  return new Promise((ok, falha) => navigator.geolocation.getCurrentPosition(ok, falha, opcoes));
}

// ---------- Endereço digitado ----------
// PC não tem GPS: o navegador chuta a posição pelo IP ou pelo Wi-Fi, e pode errar por quilômetros.
// Quem digita o endereço uma vez fica com ele neste navegador; da próxima vez, se a localização do
// aparelho vier imprecisa, o endereço guardado vale mais. No celular com GPS bom, o GPS continua mandando.
// Só no PC (mouse e sem toque): no celular o GPS é mais preciso que qualquer endereço digitado.
const CHAVE_ENDERECO = "data-venia:endereco";
const ehPc = matchMedia("(hover: hover) and (pointer: fine)").matches && !matchMedia("(any-pointer: coarse)").matches;
function enderecoGuardado() {
  if (!ehPc) return null;
  try {
    const e = JSON.parse(localStorage.getItem(CHAVE_ENDERECO));
    return Number.isFinite(e?.lat) && Number.isFinite(e?.lng) ? { lat: e.lat, lng: e.lng, nome: String(e.nome || "Endereço guardado"), deGps: false } : null;
  } catch { return null; }
}

// Tenta primeiro o modo rápido (Wi-Fi e antenas). Se não der, liga o GPS de alta precisão.
async function ondeEstou({ ignorarUrl = false, aoDemorar } = {}) {
  const q = new URLSearchParams(location.search);
  if (!ignorarUrl && q.get("lat") && q.get("lng")) {
    const gps = q.get("origem") === "gps";
    const nome = gps ? "Perto de você" : q.get("nome") || "Ponto escolhido";
    return { lat: +q.get("lat"), lng: +q.get("lng"), nome, deGps: gps };
  }
  const guardado = enderecoGuardado();
  if (!navigator.geolocation) return guardado || { ...CENTRO_PADRAO, falha: "Este navegador não oferece localização." };

  const demora = setTimeout(() => aoDemorar?.(), 4000);
  try {
    let p;
    try {
      p = await pedirPosicao({ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    } catch (e) {
      if (e.code === 1) throw e; // negado: não adianta insistir
      aoDemorar?.();
      p = await pedirPosicao({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    }
    if (guardado && p.coords.accuracy > PRECISAO_FRACA) return guardado;
    return { lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy, nome: "Perto de você", deGps: true };
  } catch (e) {
    if (guardado) return guardado;
    return { ...CENTRO_PADRAO, falha: MOTIVO_LOCAL[e.code] || `Não deu para usar sua localização (${e.message}).` };
  } finally {
    clearTimeout(demora);
  }
}

// ---------- Refinamento: abre com a posição aproximada e vai afinando pelo GPS ----------
const PRECISAO_BOA = 25;           // metros: abaixo disso, para de procurar
const TEMPO_REFINO = 60000;        // procura por no máximo 1 minuto (GPS gasta bateria)
const DISTANCIA_RECENTRAR = 150;   // metros: se a posição real estiver mais longe que isso, refaz as empresas

let marcadorVoce = null;

function distanciaMetros(a, b) {
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

function formatarDistancia(m) {
  return m < 1000 ? `${Math.max(5, Math.round(m / 5) * 5)} m` : `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

// Círculo da precisão como polígono (o MapLibre não tem círculo em metros nativo).
function circuloPrecisao(p) {
  if (!p?.precisao) return { type: "FeatureCollection", features: [] };
  const passos = 64, coords = [];
  const mLat = 111320, mLng = 111320 * Math.cos((p.lat * Math.PI) / 180);
  for (let i = 0; i <= passos; i++) {
    const a = (i / passos) * 2 * Math.PI;
    coords.push([p.lng + (p.precisao * Math.cos(a)) / mLng, p.lat + (p.precisao * Math.sin(a)) / mLat]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
}

// Acima disso a posição veio do Wi-Fi fraco ou do IP: vale avisar que no celular é melhor.
const PRECISAO_FRACA = 300;

function rotuloLocal() {
  const c = estado.centro, p = estado.posicao;
  const extra = p?.precisao ? `, precisão de ${formatarDistancia(p.precisao)}` : ", raio de 1 km";
  document.getElementById("local-label").textContent = `${c.nome}${extra}`;
  // Posição chutada pelo IP: o convite para digitar o endereço fica mais visível.
  document.getElementById("btn-endereco").classList.toggle("destaque", p?.precisao > PRECISAO_FRACA);
}

function atualizarPosicao(nova) {
  estado.posicao = nova;
  marcadorVoce?.setLngLat([nova.lng, nova.lat]);
  map.getSource("precisao")?.setData(circuloPrecisao(nova));
  rotuloLocal();
}

// Gera as empresas de novo ao redor da posição certa, sem recarregar a página.
async function recentrar(nova) {
  if (gavetaAberta()) desselecionar();
  const empresas = await carregarEmpresas(nova);
  estado.centro = { ...estado.centro, lat: nova.lat, lng: nova.lng };
  estado.empresas = empresas;
  estado.porId = new Map(empresas.map((e) => [e.id, e]));
  estado.selecionada = null;
  estado.hover = null;
  map.removeFeatureState({ source: "empresas" });
  map.getSource("empresas").setData(geojson());
  if (MODO === "vivo") comecarVarredura();
  atualizarContagens();
  atualizarResumo();
  // Só move a câmera se a pessoa não estiver explorando outra parte do mapa.
  if (!estado.mexeuNoMapa && !estado.calor) {
    map.flyTo({ center: [nova.lng, nova.lat], zoom: Math.max(map.getZoom(), 16.2), duration: calmo ? 0 : 1200, essential: true });
  }
}

function refinarPosicao() {
  if (!navigator.geolocation || !estado.centro.deGps) return;
  let melhor = estado.posicao?.precisao ?? Infinity;
  let recentrando = false;

  const id = navigator.geolocation.watchPosition(async (p) => {
    const nova = { lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy };
    if (nova.precisao >= melhor) return; // só aceita posições melhores que a atual
    melhor = nova.precisao;
    atualizarPosicao(nova);
    if (!recentrando && distanciaMetros(estado.centro, nova) > DISTANCIA_RECENTRAR) {
      recentrando = true;
      await recentrar(nova);
      recentrando = false;
    }
    if (melhor <= PRECISAO_BOA) parar();
  }, () => { /* falhas do refinamento são silenciosas: o app já está aberto com a posição aproximada */ },
  { enableHighAccuracy: true, maximumAge: 0, timeout: TEMPO_REFINO });

  const limite = setTimeout(() => parar(), TEMPO_REFINO);
  function parar() { navigator.geolocation.clearWatch(id); clearTimeout(limite); }
}

// Mostra por que a localização falhou e deixa tentar de novo.
function avisarFalhaLocal(motivo) {
  const caixa = document.getElementById("aviso-local");
  caixa.querySelector("p").textContent = `Mostrando o centro de São Paulo. ${motivo}`;
  caixa.hidden = false;
  document.body.classList.add("com-aviso-local");
  const botao = caixa.querySelector(".aviso-tentar");
  botao.onclick = async () => {
    botao.disabled = true;
    botao.textContent = "Procurando…";
    const novo = await ondeEstou({ ignorarUrl: true });
    if (novo.falha) {
      caixa.querySelector("p").textContent = `Mostrando o centro de São Paulo. ${novo.falha}`;
      botao.disabled = false;
      botao.textContent = "Tentar de novo";
      return;
    }
    // Recarrega com a posição achada: o app inteiro (empresas, sol, tema) é refeito a partir dela.
    const url = new URL(location.href);
    url.searchParams.set("lat", novo.lat.toFixed(5));
    url.searchParams.set("lng", novo.lng.toFixed(5));
    url.searchParams.set("origem", "gps");
    location.replace(url);
  };
}

// Busca no Nominatim (OpenStreetMap). A política de uso pede no máximo 1 pedido por segundo e
// proíbe autocompletar a cada tecla, por isso só busca quando a pessoa aperta Buscar.
async function procurarEndereco(texto) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q: texto, format: "jsonv2", countrycodes: "br", limit: "5", "accept-language": "pt-BR", addressdetails: "1" });
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`O OpenStreetMap respondeu ${r.status}.`);
  return (await r.json()).map((x) => {
    const a = x.address || {};
    const rua = [a.road, a.house_number].filter(Boolean).join(", ");
    const cidade = a.city || a.town || a.village || a.municipality || "";
    const bairro = a.suburb || a.neighbourhood || "";
    const curto = [rua || x.name, bairro, cidade].filter(Boolean).join(", ") || x.display_name;
    return { lat: +x.lat, lng: +x.lon, nome: curto, completo: x.display_name };
  });
}

function irPara(lugar) {
  try { localStorage.setItem(CHAVE_ENDERECO, JSON.stringify({ lat: lugar.lat, lng: lugar.lng, nome: lugar.nome })); } catch { /* sem espaço ou bloqueado: vale só agora */ }
  // Recarrega a partir do ponto: empresas, sol e tema são refeitos para ele, como no "Tentar de novo".
  const url = new URL(location.href);
  url.searchParams.set("lat", lugar.lat.toFixed(5));
  url.searchParams.set("lng", lugar.lng.toFixed(5));
  url.searchParams.set("origem", "endereco");
  url.searchParams.set("nome", lugar.nome);
  location.replace(url);
}

function montarEndereco() {
  const botao = document.getElementById("btn-endereco");
  const form = document.getElementById("endereco");
  const campo = document.getElementById("endereco-campo");
  const saida = form.querySelector(".endereco-resultados");
  if (!ehPc) { botao.hidden = true; return; }
  const abrir = (sim) => {
    form.hidden = !sim;
    botao.setAttribute("aria-expanded", sim);
    if (sim) campo.focus();
  };
  botao.addEventListener("click", () => abrir(form.hidden));
  form.querySelector(".endereco-fechar").addEventListener("click", () => abrir(false));
  form.addEventListener("keydown", (ev) => { if (ev.key === "Escape") abrir(false); });
  form.querySelector(".endereco-gps").addEventListener("click", () => {
    try { localStorage.removeItem(CHAVE_ENDERECO); } catch { /* nada guardado */ }
    const url = new URL(location.href);
    for (const k of ["lat", "lng", "origem", "nome"]) url.searchParams.delete(k);
    location.replace(url);
  });
  let ultimo = 0;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const texto = campo.value.trim();
    if (!texto || Date.now() - ultimo < 1000) return;
    ultimo = Date.now();
    saida.innerHTML = "<p>Procurando…</p>";
    try {
      const achados = await procurarEndereco(texto);
      if (!achados.length) { saida.innerHTML = "<p>Nenhum endereço encontrado. Tente com o nome da cidade.</p>"; return; }
      saida.innerHTML = achados.map((a, i) => `<button type="button" class="busca-item" data-i="${i}"><span>${esc(a.nome)}<small>${esc(a.completo)}</small></span></button>`).join("");
      saida.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => irPara(achados[+b.dataset.i])));
      saida.querySelector("[data-i]").focus();
    } catch (e) {
      saida.innerHTML = `<p>Não deu para procurar agora. ${esc(e.message === "Failed to fetch" ? "Confira a internet." : e.message)}</p>`;
    }
  });
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------- Início ----------
async function iniciar() {
  const status = document.getElementById("intro-status");
  const centro = await ondeEstou({
    aoDemorar: () => (status.textContent = "Ainda procurando… o GPS pode levar alguns segundos."),
  });
  estado.centro = centro;
  estado.posicao = centro.deGps ? { lat: centro.lat, lng: centro.lng, precisao: centro.precisao } : null;
  if (centro.falha) avisarFalhaLocal(centro.falha);
  status.textContent = "Abrindo os autos da vizinhança…";

  let empresas;
  try {
    [empresas] = await Promise.all([carregarEmpresas(centro), mapaPronto]);
  } catch (err) {
    status.textContent = `Não deu para carregar as empresas. ${err.message}`;
    return;
  }
  // Com a posição em mãos, o tema passa a seguir o sol daquele lugar. Isso acontece antes de
  // guardar as empresas, para trocarEstilo() só trocar o mapa base sem montar camadas.
  const temaAntes = tema.atual;
  tema.definirCentro(centro);
  if (tema.atual !== temaAntes) await new Promise((ok) => map.once("style.load", ok));

  estado.empresas = empresas;
  empresas.forEach((e) => estado.porId.set(e.id, e));
  tingirMapa();
  montarCamadas();

  ligarInteracoes();
  montarFiltros();
  montarBusca();
  montarEndereco();
  rotuloLocal();
  if (MODO !== "demo") document.getElementById("selo-demo").hidden = true;
  if (MODO === "vivo") comecarVarredura();

  const voce = document.createElement("div");
  voce.className = "voce";
  voce.setAttribute("aria-label", "Você está aqui");
  marcadorVoce = new maplibregl.Marker({ element: voce }).setLngLat([centro.lng, centro.lat]).addTo(map);

  // O momento de abertura: câmera desce do alto até a rua, em 3D.
  map.jumpTo({ center: [centro.lng, centro.lat], zoom: 3.2 });
  document.getElementById("intro").classList.add("saindo");
  map.flyTo({
    center: [centro.lng, centro.lat], zoom: 16.2, pitch: 55, bearing: -18,
    duration: calmo ? 0 : 5200, curve: 1.5, essential: true,
  });
  map.once("moveend", () => {
    atualizarResumo();
    requestAnimationFrame(laco);
    // Depois da abertura: se a pessoa arrastar o mapa, o refinamento não puxa mais a câmera.
    map.on("dragstart", () => (estado.mexeuNoMapa = true));
    refinarPosicao();
  });
}

iniciar();
