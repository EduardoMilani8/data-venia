import { carregarEmpresas, MODO } from "./dados/provedor.js";
import { TIPOS_PROCESSO } from "./dados/demo.js";
import { lerHistorico } from "./classificacao.js";
import { abrirGaveta, fecharGaveta, gavetaAberta } from "./gaveta.js";
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
function processosVisiveis(e) {
  return e.processos.filter((p) => estado.filtros.has(p.categoria));
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
      "circle-color": corPorCategoria(),
      "circle-radius": raioPonto(1 - Math.pow(1 - estado.revelar, 3)),
      "circle-stroke-color": ["case",
        ["boolean", ["feature-state", "sel"], false], tema.atual === "claro" ? "#0f172a" : "#ffffff",
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
    ["interpolate", ["linear"], ["get", "qtd"], 0, 4.5, 1, 8, 8, 13, 25, 19],
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
  const vis = processosVisiveis(emp);
  abrirGaveta(emp, vis, lerHistorico(vis), categoriaDominante(vis), desselecionar);
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
function montarFiltros() {
  const caixa = document.getElementById("filtros");
  const contagem = {};
  for (const e of estado.empresas) for (const p of e.processos) contagem[p.categoria] = (contagem[p.categoria] || 0) + 1;

  caixa.innerHTML = Object.entries(TIPOS_PROCESSO).map(([k, t]) => `
    <button class="chip" data-cat="${k}" aria-pressed="true" style="--cor:var(--${k})">
      <span class="tarja"></span>${t.nome}<span class="qtd">${contagem[k] || 0}</span>
    </button>`).join("");

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
    map.flyTo({ center: [estado.centro.lng, estado.centro.lat], zoom: 16.2, pitch: 55, bearing: -18, duration: 1600 });
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
  contarAte(caixa.querySelector('[data-k="emp"]'), estado.empresas.length);
  contarAte(caixa.querySelector('[data-k="com"]'), vis.filter((v) => v.length).length);
  contarAte(caixa.querySelector('[data-k="proc"]'), vis.reduce((s, v) => s + v.length, 0));
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
          <span><strong>${esc(e.nome)}</strong><small>${e.tipo}, ${e.processos.length} processo${e.processos.length === 1 ? "" : "s"}</small></span></button>`).join("")
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
function ondeEstou() {
  const q = new URLSearchParams(location.search);
  if (q.get("lat") && q.get("lng")) return Promise.resolve({ lat: +q.get("lat"), lng: +q.get("lng"), nome: "Ponto escolhido" });
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(CENTRO_PADRAO);
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, nome: "Perto de você" }),
      () => ok({ ...CENTRO_PADRAO, nome: `${CENTRO_PADRAO.nome} (localização não permitida)` }),
      { timeout: 7000, maximumAge: 60000 },
    );
  });
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------- Início ----------
async function iniciar() {
  const status = document.getElementById("intro-status");
  const centro = await ondeEstou();
  estado.centro = centro;
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
  document.getElementById("local-label").textContent = `${centro.nome}, raio de 1 km`;
  if (MODO !== "demo") document.getElementById("selo-demo").hidden = true;

  const voce = document.createElement("div");
  voce.className = "voce";
  voce.setAttribute("aria-label", "Você está aqui");
  new maplibregl.Marker({ element: voce }).setLngLat([centro.lng, centro.lat]).addTo(map);

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
  });
}

iniciar();
