// NEM Lens Replays: the event map.
//
// One moment of the event on a map of the NEM regions: each region shaded by
// its price, an arrow per interconnector where it crosses a border, the event
// region's plant, and a numbered key of the links and constraints that matter
// at that interval. Every figure is AEMO's, from the event's public files.
//
// Time runs continuously: the scene is built once per event and updated on
// each animation frame, gliding between 5-minute intervals. Numbers always
// show the nearest interval's AEMO figure; only colours, sizes and positions
// are blended. The page's chart panels follow the map's playhead.

const NS = "http://www.w3.org/2000/svg";
const NAMES = { NSW1: "NSW", QLD1: "Queensland", VIC1: "Victoria", SA1: "South Australia", TAS1: "Tasmania" };
const SHORT = { NSW1: "NSW", QLD1: "QLD", VIC1: "VIC", SA1: "SA", TAS1: "TAS" };
const LINK_NAMES = { "NSW1-QLD1": "QNI", "N-Q-MNSP1": "Directlink", "VIC1-NSW1": "VNI", "V-SA": "Heywood", "V-S-MNSP1": "Murraylink", "T-V-MNSP1": "Basslink", "NSW1-SA1": "EnergyConnect" };

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
function svg(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
const set = (e, attrs) => { for (const k in attrs) e.setAttribute(k, attrs[k]); };
const num = (v, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("en-AU", { maximumFractionDigits: d, minimumFractionDigits: d }));
const money = (v) => (v == null || !Number.isFinite(v) ? "–" : (v <= -0.005 ? "−$" : "$") + num(Math.abs(v), Math.abs(v) < 100 && v % 1 ? 2 : 0));
const hhmm = (t) => t.slice(11, 16);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The market price cap at an interval end, by financial year (as aemo's market_price_cap). */
export function marketPriceCap(t) {
  const d = new Date(Date.parse(t) - 5 * 60000 + 10 * 3600000);
  const fy = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return { 2019: 14700, 2020: 15000, 2021: 15100, 2022: 15500, 2023: 16600, 2024: 17500, 2025: 20300 }[fy] ?? (fy <= 2018 ? 14500 : 23200);
}

// ------------------------------------------------------------- event data

/** The event's public files, reshaped for the map. */
function prepare({ h, series, dispatch, ics, cons, unav, span }) {
  const E = { h, times: series.intervals, span, regions: {}, ics: [], cons: {}, units: [], fuels: dispatch.fuels || {} };
  for (const [r, v] of Object.entries(series.regions)) {
    E.regions[r] = {
      price: v.price, demand: v.demand, avail: v.available_generation, net: v.net_interchange,
      crr: v.crr || [], cont: v.contingency || [], cont_mw: v.contingency_mw || [], reserve: v.reserve_mw || [],
    };
  }
  E.regionIds = Object.keys(E.regions);
  E.ics = ics.interconnectors.map((c) => ({ id: c.id, from: c.from_region, to: c.to_region, flow: c.flow, imp: c.import_limit, exp: c.export_limit, imp_by: c.import_set_by, exp_by: c.export_set_by }));
  for (const c of cons.constraints) {
    const viol = c.violation || [];
    E.cons[c.id] = { d: c.description || "", outage: !!c.outage, bind: c.marginal.map((m) => (m ? 1 : 0)), viol: viol.some((v) => v != null && Math.abs(v) >= 1) ? viol : null };
  }
  E.units = unav.units.map((u) => ({ duid: u.duid, region: u.region, fuel: u.fuel || "", cap: u.capacity_mw, kind: u.kind, avail: u.availability }));
  E.peak = Math.max(0, E.times.indexOf(h.peak_at));
  E.cap = Math.max(marketPriceCap(h.peak_at), h.peak_price);
  E.plant = E.times.map((_, i) => plantAt(E, i));
  // One bar scale for the whole event, so the bar's length means the same MW at every interval.
  E.barMax = Math.max(1, ...E.plant.map((p) => Math.max(p.avail ?? 0, p.demand ?? 0) + p.out));
  return E;
}

/** A series at fractional time t, linear between the two intervals either side. */
function at(arr, t) {
  const i0 = clamp(Math.floor(t), 0, arr.length - 1), i1 = Math.min(arr.length - 1, i0 + 1), u = t - i0;
  const a = arr[i0], b = arr[i1];
  if (a == null) return b; if (b == null || u <= 0) return a;
  return a + (b - a) * u;
}

/** One interconnector at interval i: direction, limit state, and what forced it. */
function linkAt(E, c, i) {
  const f = c.flow[i] ?? 0, imp = c.imp[i], exp = c.exp[i];
  const src = f >= 0 ? c.from : c.to, dst = f >= 0 ? c.to : c.from;
  const psrc = E.regions[src]?.price[i], pdst = E.regions[dst]?.price[i];
  // Against the price: at least 5 MW into a region more than $20/MWh cheaper.
  const against = Math.abs(f) >= 5 && psrc != null && pdst != null && psrc - pdst > 20;
  const atExp = exp != null && f >= exp - 1, atImp = imp != null && f <= imp + 1;
  const past = (exp != null && f > exp + 1) || (imp != null && f < imp - 1);
  // A limit on the far side of zero forces flow the other way; AEMO names the constraint that set it.
  let forcedBy = null;
  if (exp != null && exp < -1) forcedBy = c.exp_by[i];
  else if (imp != null && imp > 1) forcedBy = c.imp_by[i];
  const limitBy = atExp ? c.exp_by[i] : atImp ? c.imp_by[i] : null;
  return { c, f, imp, exp, src, dst, psrc, pdst, mag: Math.abs(f), against, atLimit: atExp || atImp, past, forcedBy, limitBy };
}

function plantAt(E, i) {
  const R = E.h.region;
  let out = 0, n = 0;
  for (const u of E.units) {
    if (u.region !== R) continue;
    const s = u.cap - (u.avail[i] ?? 0);
    if (s >= 1) { out += s; n++; }
  }
  const r = E.regions[R];
  return { out, n, demand: r.demand[i], avail: r.avail[i], crr: r.crr[i], cont: r.cont[i], contMw: r.cont_mw[i], reserve: r.reserve[i] };
}

/** Numbered items for the key: links that are notable now, then constraints not met. */
function keyItems(E, i) {
  const items = [];
  for (const c of E.ics) {
    const L = linkAt(E, c, i);
    // Routine limits away from the event region are left to the map; a link with no capacity (limits 0 and 0) is left out.
    const touches = c.from === E.h.region || c.to === E.h.region;
    const closed = Math.abs(L.imp ?? 0) < 1 && Math.abs(L.exp ?? 0) < 1;
    if (closed || !(L.against || L.past || (L.atLimit && touches))) continue;
    const name = LINK_NAMES[c.id] ? `${c.id} (${LINK_NAMES[c.id]})` : c.id;
    const why = L.against ? (L.forcedBy || null) : L.limitBy;
    const keys = [`l:${c.id}`]; if (why) keys.push(`c:${why}`);
    let text;
    if (L.mag < 1) text = `${name}: 0 MW, held at a limit of 0.`;
    else text = `${name}: ${num(L.mag)} MW from ${NAMES[L.src]} to ${NAMES[L.dst]}` + (L.against ? `, towards the cheaper region (${money(L.psrc)} → ${money(L.pdst)}).` : L.past ? ", past its limit." : ", at its limit.");
    let because = "";
    if (L.against && L.forcedBy) because = `${L.forcedBy} set the limit below zero, so flow had to go this way.`;
    else if (L.against) because = "No limit below zero forced it; finding why needs deeper analysis.";
    else if (L.limitBy) because = `Limit set by ${L.limitBy}.`;
    const d = why && E.cons[why] ? E.cons[why].d : "";
    items.push({ kind: L.against ? "against" : "limit", keys, text, because, d, link: c.id });
  }
  const unmet = Object.entries(E.cons).filter(([, c]) => c.viol && Math.abs(c.viol[i] ?? 0) >= 1).sort((a, b) => Math.abs(b[1].viol[i]) - Math.abs(a[1].viol[i]));
  for (const [id, c] of unmet.slice(0, 3)) items.push({ kind: "against", keys: [`c:${id}`], text: `${id} not met by ${num(Math.abs(c.viol[i]))} MW.`, because: "Its penalty can set prices, up to the cap.", d: c.d });
  if (unmet.length > 3) items.push({ kind: "against", keys: [], text: `${unmet.length - 3} more constraints not met at this interval.`, because: "", d: "" });
  items.forEach((x, k) => (x.n = k + 1));
  return items;
}

// ------------------------------------------------------------- price colour

const STOPS = [[-1000, "#1f4e99"], [-1, "#8fb3df"], [0, "#d9d6cc"], [100, "#e9dcb6"], [300, "#f2c46b"], [1000, "#ec9440"], [5000, "#d9542b"], [15000, "#a3172b"], [23200, "#5e0d26"]];
const tf = (p) => Math.sign(p) * Math.log10(1 + Math.abs(p) / 10);
const itf = (x) => Math.sign(x) * (Math.pow(10, Math.abs(x)) - 1) * 10;
const RGB = STOPS.map(([p, c]) => [tf(p), c.match(/\w\w/g).map((h) => parseInt(h, 16))]);
function priceColour(p) {
  if (p == null) return "#999";
  const x = tf(p);
  for (let k = 1; k < RGB.length; k++) {
    const [x1, a] = RGB[k - 1], [x2, b] = RGB[k];
    if (x <= x2 || k === RGB.length - 1) {
      const t = clamp((x - x1) / (x2 - x1), 0, 1);
      return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * t)).join(",")})`;
    }
  }
}
/** A region's price at fractional time, blended on the colour scale's own log axis. */
function priceAtT(E, r, t) {
  const p = E.regions[r].price, i0 = clamp(Math.floor(t), 0, p.length - 1), i1 = Math.min(p.length - 1, i0 + 1);
  if (p[i0] == null || p[i1] == null) return p[i0] ?? p[i1];
  return itf(tf(p[i0]) + (tf(p[i1]) - tf(p[i0])) * (t - i0));
}

// ------------------------------------------------------------- geography

// Hand-drawn region outlines (lon, lat), enough to place each region and border.
const REGION_POLY = {
  QLD1: [[141, 29], [141, 26], [138, 26], [138, 16.5], [139.3, 17.4], [140.8, 17.5], [141.4, 16], [141.6, 14], [141.6, 12.6], [142, 11.5], [142.5, 10.7], [143, 11.9], [143.5, 13.6], [144.5, 14.2], [145.3, 15.5], [145.4, 16.6], [146, 17.8], [146.3, 18.9], [147.3, 19.4], [148.2, 20], [149, 20.9], [149.5, 22.2], [150.6, 22.4], [150.8, 23.5], [151.6, 24], [152.6, 25.3], [153.1, 25.9], [153.2, 27.4], [153.55, 28.17], [152.4, 28.4], [151.6, 28.9], [150.5, 28.65], [149.6, 28.9], [148.9, 29]],
  NSW1: [[141, 29], [148.9, 29], [149.6, 28.9], [150.5, 28.65], [151.6, 28.9], [152.4, 28.4], [153.55, 28.17], [153.64, 28.64], [153.35, 29.4], [153.1, 30.3], [152.9, 31.4], [152.5, 32.4], [151.8, 32.9], [151.3, 33.6], [151.25, 33.9], [150.9, 34.4], [150.75, 35.1], [150.2, 35.7], [150, 36.4], [149.9, 37.07], [149.98, 37.5], [148.2, 36.8], [148, 36.2], [147, 36.1], [146, 35.95], [144.75, 36.1], [144, 35.75], [143.5, 35.3], [142.4, 34.6], [142.1, 34.2], [141, 34]],
  VIC1: [[141, 34], [142.1, 34.2], [142.4, 34.6], [143.5, 35.3], [144, 35.75], [144.75, 36.1], [146, 35.95], [147, 36.1], [148, 36.2], [148.2, 36.8], [149.98, 37.5], [149, 37.8], [148, 37.9], [147, 38.4], [146.4, 39.1], [145.9, 38.7], [145.4, 38.5], [144.95, 38.4], [144.65, 38.3], [144.4, 38.25], [143.5, 38.85], [142.5, 38.4], [141.6, 38.35], [141, 38.06]],
  SA1: [[129, 26], [141, 26], [141, 38.06], [140.4, 37.9], [139.7, 37], [139.3, 35.8], [138.6, 35.6], [138.1, 35.6], [138.5, 35], [138.15, 34.2], [137.8, 35], [136.9, 35.3], [137.4, 34.1], [137.8, 32.6], [137.1, 33.6], [136.2, 34.4], [135.6, 34.9], [135.1, 34], [134.2, 33.1], [133.7, 32.1], [132.2, 32], [131.2, 31.5], [129, 31.65]],
  TAS1: [[144.6, 40.7], [145.5, 40.85], [146.6, 41.1], [148.3, 40.9], [148.3, 42.1], [147.9, 43.2], [146.9, 43.6], [146, 43.5], [145.2, 42.2], [144.65, 41.3]],
};
// Where each region's price sits, and where each link crosses a border (lon, lat).
const ANCHOR = { QLD1: [145.6, 23.2], NSW1: [146.6, 31.8], VIC1: [144.2, 36.9], SA1: [135.6, 29.4], TAS1: [146.4, 42.1] };
const CROSS = { "NSW1-QLD1": [151.0, 28.85], "N-Q-MNSP1": [153.3, 28.3], "VIC1-NSW1": [146.9, 36.05], "V-SA": [141, 37.3], "V-S-MNSP1": [141, 35.0], "T-V-MNSP1": [146.6, 40.0], "NSW1-SA1": [141, 32.4] };
// Fixed label and badge offsets (px) where links crowd a border; others sit either side of their arrow.
const PLACE = { "NSW1-QLD1": { lab: [-20, 14], bdg: [-24, -16] }, "N-Q-MNSP1": { lab: [20, 4], bdg: [14, -26] } };
const geo = (lon, lat) => [(lon - 128.5) * 21 * 0.87 + 10, (lat - 10) * 21 + 10];
const BAR = { x: 22, y: 58, w: 176, h: 12 };

function buildScene(E, onPick) {
  const W = 486, H = 734, R = E.h.region;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Map of the NEM regions shaded by price, with interconnector flows" },
    svg("defs", {}, svg("pattern", { id: "emap-hatch", width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      svg("rect", { width: 5, height: 5, fill: "var(--panel)" }), svg("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 5 }))));
  root.append(svg("rect", { class: "m-sea", x: 0, y: 0, width: W, height: H }));
  const sc = { root, regions: {}, links: [], ticks: {} };

  const lp = svg("g", {});
  for (const [r, poly] of Object.entries(REGION_POLY)) {
    const title = svg("title");
    const shape = svg("polygon", { class: "m-region", points: poly.map(([a, b]) => geo(a, b).join(",")).join(" "), "data-keys": `r:${r}`, tabindex: 0 }, title);
    lp.append(shape);
    sc.regions[r] = { poly: shape, title };
  }
  lp.append(svg("polygon", { class: "m-focus", points: REGION_POLY[R].map(([a, b]) => geo(a, b).join(",")).join(" "), "pointer-events": "none" }));
  for (const r of E.regionIds) {
    if (!ANCHOR[r]) continue;
    const [x, y] = geo(...ANCHOR[r]);
    lp.append(svg("text", { class: "lbl", x, y: y - 8, "text-anchor": "middle", "font-size": 12, "font-weight": 600, "pointer-events": "none" }, NAMES[r]));
    sc.regions[r].price = svg("text", { class: "lbl", x, y: y + 10, "text-anchor": "middle", "font-size": r === R ? 19 : 15, "font-weight": 700, "pointer-events": "none" });
    lp.append(sc.regions[r].price);
  }
  root.append(lp);

  // Plant card in the empty interior, with a leader to the event region.
  const conts = [...new Set(E.regions[R].cont.filter((c) => c && !c.includes("MNSP")))];
  const lc = svg("g", { "data-keys": ["plant", ...E.units.map((u) => `u:${u.duid}`), ...conts.map((c) => `u:${c}`)].join(" "), tabindex: 0 });
  const cx = 12, cy = 14, cw = 196, ch = 132, [ax, ay] = geo(...ANCHOR[R]);
  lc.append(svg("path", { d: `M${cx + cw},${cy + ch / 2} L${ax - 20},${ay - 26}`, stroke: "var(--muted)", "stroke-dasharray": "3 3", fill: "none" }));
  lc.append(svg("rect", { class: "card-bg", x: cx, y: cy, width: cw, height: ch, rx: 6 }));
  lc.append(svg("text", { class: "ink", x: cx + 10, y: cy + 18, "font-size": 12, "font-weight": 650 }, `Plant in ${NAMES[R]}`));
  const t = (cls, y, size, weight) => { const e = svg("text", { class: cls, x: cx + 10, y: cy + y, "font-size": size, "font-weight": weight }); lc.append(e); return e; };
  sc.pOut = t("ink", 36, 11);
  sc.bar = { d: svg("rect", { class: "seg-d", y: BAR.y, height: BAR.h }), s: svg("rect", { class: "seg-s", y: BAR.y, height: BAR.h }), x: svg("rect", { class: "seg-x", y: BAR.y, height: BAR.h }), o: svg("rect", { class: "seg-o", y: BAR.y, height: BAR.h }) };
  lc.append(svg("rect", { x: BAR.x, y: BAR.y, width: BAR.w, height: BAR.h, fill: "none", stroke: "var(--line)" }), sc.bar.d, sc.bar.s, sc.bar.x, sc.bar.o);
  sc.pLine = t("inkm", 70, 10);
  sc.pCrr = t("ink", 92, 12, 650);
  sc.pRes = t("inkm", 108, 10);
  sc.pCont = t("inkm", 121, 10);
  lc.append(svg("rect", { class: "hlring", x: cx - 3, y: cy - 3, width: cw + 6, height: ch + 6, rx: 8 }));
  root.append(lc);

  // Interconnector arrows at their border crossings.
  const ln = svg("g", {});
  for (const c of E.ics) {
    if (!CROSS[c.id] || !ANCHOR[c.from] || !ANCHOR[c.to]) continue;
    const [mx, my] = geo(...CROSS[c.id]), [fx, fy] = geo(...ANCHOR[c.from]), [tx, ty] = geo(...ANCHOR[c.to]);
    const n = Math.hypot(tx - fx, ty - fy);
    const k = {
      c, mx, my, ux: (tx - fx) / n, uy: (ty - fy) / n, side: c.id === "N-Q-MNSP1" || c.id === "T-V-MNSP1" ? 1 : -1, phase: 0, speed: 0,
      g: svg("g", { class: "lk", "data-keys": `l:${c.id}`, tabindex: 0 }), title: svg("title"),
      zero: svg("circle", { class: "zero", cx: mx, cy: my, r: 5 }),
      shaft: svg("line", { class: "shaft" }), head: svg("path", { class: "head" }), flow: svg("line", { class: "flow" }),
      past: svg("circle", { class: "past", cx: mx, cy: my, opacity: 0 }),
      lab: svg("text", { class: "lbl", "text-anchor": "middle", "font-size": 10.5, "font-weight": 600 }),
      bdg: svg("g", { class: "bdg", opacity: 0 }),
      bc: svg("circle", { r: 8 }), bt: svg("text", { "text-anchor": "middle", y: 3.5, "font-size": 10, "font-weight": 700, fill: "#fff" }),
    };
    k.bdg.append(k.bc, k.bt);
    k.g.append(k.title, k.zero, k.shaft, k.head, k.flow, k.past, k.lab, k.bdg, svg("circle", { class: "hlring", cx: mx, cy: my, r: 28 }));
    ln.append(k.g);
    sc.links.push(k);
  }
  root.append(ln);

  // Price legend in the Bight, with each region's price as a tick on the scale.
  const lx = 14, ly = 640, lw = 200, lo = tf(-1000), hi = tf(E.cap);
  sc.legendX = (p) => clamp(lx + ((tf(clamp(p, -1000, E.cap)) - lo) / (hi - lo)) * lw, lx, lx + lw);
  sc.legendY = ly;
  const lg = svg("g", {});
  for (let j = 0; j < 60; j++) lg.append(svg("rect", { x: lx + (lw * j) / 60, y: ly, width: lw / 60 + 0.5, height: 10, fill: priceColour(itf(lo + ((hi - lo) * j) / 60)) }));
  lg.append(svg("text", { class: "inkm", x: lx, y: ly - 10, "font-size": 10 }, "Price, $/MWh (▾ each region now)"));
  for (const v of [-1000, 0, 300, 1000, 5000, Math.round(E.cap)]) lg.append(svg("text", { class: "inkm", x: sc.legendX(v), y: ly + 22, "text-anchor": "middle", "font-size": 9 }, v === Math.round(E.cap) ? "cap" : v >= 1000 ? `${v / 1000}k` : v <= -1000 ? "−1k" : v));
  for (const r of E.regionIds) { sc.ticks[r] = svg("path", { d: "M0,-1 l-3,-5 h6 z", fill: "var(--fg)" }); lg.append(sc.ticks[r]); }
  root.append(lg);
  root.append(svg("text", { class: "inkm", x: 14, y: 712, "font-size": 9.5 }, "Arrows: MW across each border; dashes run with the flow."));
  root.append(svg("text", { class: "inkm", x: 14, y: 724, "font-size": 9.5 }, "Orange at a limit; red towards the cheaper region. Numbers match the key."));

  root.querySelectorAll("[data-keys]").forEach((e) => {
    e.addEventListener("click", () => onPick(e.dataset.keys.split(" ")[0]));
    e.addEventListener("keydown", (ev) => { if (ev.key === "Enter") onPick(e.dataset.keys.split(" ")[0]); });
  });
  return sc;
}

// ------------------------------------------------------------- the map

/**
 * Mount the map in `box`. `hooks.onTime(t)` gets the fractional playhead on
 * every frame it moves, `hooks.onInterval(i, playing)` the nearest interval
 * when it changes, `hooks.onStop(i)` the interval where Play stopped, and
 * `hooks.onReveal(key)` a click on a map element or key item
 * (r:REGION, l:LINK, c:CONSTRAINT, u:DUID or plant).
 */
export function mountMap(box, files, start, hooks) {
  const E = prepare(files);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let T = start, target = start, N = -1, shownT = NaN, playing = false, dragging = false, smooth = !reduced, rate = 1.5, focusKey = null, keyMin = 0;

  const when = el("span", { class: "t" }), whenSub = el("span", { class: "muted small" });
  const mapBox = el("div", { class: "emap-map" });
  const strip = el("div", { class: "emap-strip" });
  const play = el("button", { type: "button" }, "Play");
  const keyTime = el("span"), keyList = el("ul", { class: "emap-key" });
  const motion = ["smooth", "step"].map((m) => el("button", { type: "button", "data-m": m }, m === "smooth" ? "Smooth" : "Stepped"));
  const speeds = [[0.75, "Slow"], [1.5, "Normal"], [3, "Fast"]].map(([r, l]) => el("button", { type: "button", "data-r": r }, l));
  const btn = (label, aria, f) => el("button", { type: "button", "aria-label": aria, onclick: f }, label);
  box.replaceChildren(
    el("div", { class: "emap-main" },
      el("div", { class: "emap-head" }, when, whenSub),
      mapBox,
      el("div", { class: "emap-controls" },
        btn("◀", "Previous interval", () => { stop(); goTo(Math.round(target) - 1); }), play,
        btn("▶", "Next interval", () => { stop(); goTo(Math.round(target) + 1); }),
        btn("Peak", null, () => { stop(); goTo(E.peak); }),
        el("span", { class: "emap-opts" }, el("span", { class: "muted small" }, "Speed"), speeds, el("span", { class: "muted small" }, "Motion"), motion)),
      strip),
    el("aside", { class: "emap-side" },
      el("h2", {}, "On the map at ", keyTime), keyList,
      el("p", { class: "note" }, "Click the map or an item for its chart. Flows towards the cheaper region are explained by the limit AEMO reports as forcing them; constraints not met are AEMO's violation degree.")));

  const S = buildScene(E, (k) => hooks.onReveal(k));
  mapBox.replaceChildren(S.root);
  const stripCursor = buildStrip();

  function goTo(i) { target = clamp(i, 0, E.times.length - 1); }
  function stop() {
    const was = playing;
    playing = false; target = Math.round(target); play.textContent = "Play";
    if (was) hooks.onStop?.(clamp(Math.round(T), 0, E.times.length - 1));
  }
  play.addEventListener("click", () => {
    if (playing) return stop();
    if (Math.round(target) >= E.times.length - 1) T = target = 0;
    playing = true; play.textContent = "Pause";
  });
  const setMotion = (m) => { smooth = m === "smooth"; box.classList.toggle("calm", !smooth); motion.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === m))); shownT = NaN; };
  const setRate = (r) => { rate = r; speeds.forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.r === r))); };
  motion.forEach((b) => b.addEventListener("click", () => setMotion(b.dataset.m)));
  speeds.forEach((b) => b.addEventListener("click", () => setRate(+b.dataset.r)));
  setMotion(smooth ? "smooth" : "step");
  setRate(1.5);

  function buildStrip() {
    const W = 640, H = 104, L = 34, Rm = 4, n = E.times.length, ev = E.regions[E.h.region].price;
    const all = E.regionIds.flatMap((r) => E.regions[r].price).filter((v) => v != null);
    // Log scale, as the map's colours: tf is linear within ±$10 so negative prices still plot.
    const hi = tf(Math.max(...all, 100)), lo = tf(Math.min(...all, 0));
    const x = (i) => L + ((W - L - Rm) * i) / Math.max(n - 1, 1), y = (v) => 6 + (H - 22) * (1 - (tf(v) - lo) / (hi - lo));
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "slider", tabindex: 0, "aria-label": "Interval", "aria-valuemin": 0, "aria-valuemax": n - 1 });
    g.append(svg("rect", { x: x(E.span[0]), y: 4, width: Math.max(2, x(E.span[1]) - x(E.span[0])), height: H - 18, fill: "var(--span)" }));
    for (const v of [-1000, -100, 0, 100, 1000, 10000]) {
      if (tf(v) < lo || tf(v) > hi) continue;
      const yy = y(v).toFixed(1);
      g.append(svg("line", { x1: L, x2: W - Rm, y1: yy, y2: yy, stroke: "var(--grid)", "stroke-width": 0.6 }),
        svg("text", { x: L - 3, y: +yy + 3, "text-anchor": "end" }, v === 0 ? "$0" : `${v < 0 ? "−" : ""}$${Math.abs(v) >= 1000 ? Math.abs(v) / 1000 + "k" : Math.abs(v)}`));
    }
    for (const r of E.regionIds) if (r !== E.h.region) g.append(svg("path", { d: E.regions[r].price.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v ?? 0).toFixed(1)}`).join(""), fill: "none", stroke: "var(--muted)", "stroke-width": 0.8, opacity: 0.6 }));
    g.append(svg("path", { d: ev.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v ?? 0).toFixed(1)}`).join(""), fill: "none", stroke: "var(--accent)", "stroke-width": 2 }));
    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) g.append(svg("text", { x: x(i), y: H - 2, "text-anchor": "middle" }, hhmm(E.times[i])));
    const line = svg("line", { y1: 2, y2: H - 14, stroke: "var(--fg)", "stroke-width": 1.5 }), dot = svg("circle", { r: 4, fill: "var(--accent)", stroke: "var(--panel)" });
    g.append(line, dot);
    // Dragging follows the pointer between intervals; letting go settles on the nearest one.
    const pick = (e) => { const r = g.getBoundingClientRect(); goTo((((e.clientX - r.left) / r.width) * W - L) / (W - L - Rm) * (n - 1)); };
    g.addEventListener("pointerdown", (e) => { stop(); dragging = true; g.setPointerCapture(e.pointerId); pick(e); });
    g.addEventListener("pointermove", (e) => dragging && pick(e));
    const up = () => { if (dragging) { dragging = false; target = Math.round(target); } };
    g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
    g.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { stop(); goTo(Math.round(target) + (e.key === "ArrowLeft" ? -1 : 1)); e.preventDefault(); }
    });
    strip.replaceChildren(g, el("p", { class: "note" }, `${SHORT[E.h.region]} price on a log scale, other regions grey, the event shaded. Drag to move through the event.`));
    S.slider = g;
    return (t) => { const xx = x(t).toFixed(1); set(line, { x1: xx, x2: xx }); set(dot, { cx: xx, cy: y(at(ev, t) ?? 0).toFixed(1) }); };
  }

  /** Everything that moves smoothly: colours, arrow sizes and positions, bars, ticks. */
  function updateContinuous(t) {
    for (const r of E.regionIds) {
      const p = priceAtT(E, r, t);
      if (S.regions[r]) S.regions[r].poly.setAttribute("fill", priceColour(p));
      if (S.ticks[r] && p != null) S.ticks[r].setAttribute("transform", `translate(${S.legendX(p).toFixed(1)},${S.legendY})`);
    }
    for (const k of S.links) {
      const f = at(k.c.flow, t) ?? 0, mag = Math.abs(f), s = f >= 0 ? 1 : -1;
      const dx = k.ux * s, dy = k.uy * s, px = -dy, py = dx;
      // Near zero the arrow shrinks to a dot, so a reversal passes through nothing instead of flipping.
      const grow = clamp(mag / 40, 0, 1), w = 2.5 + 8 * Math.sqrt(Math.min(mag, 2000) / 2000);
      const len = 22 * grow, hl = (w + 5) * grow, hw = (w / 2 + 3.5) * grow;
      const x0 = k.mx - dx * len, y0 = k.my - dy * len, x1 = k.mx + dx * len, y1 = k.my + dy * len, bx = x1 - dx * hl, by = y1 - dy * hl;
      const ends = { x1: x0.toFixed(1), y1: y0.toFixed(1), x2: bx.toFixed(1), y2: by.toFixed(1) };
      set(k.shaft, { ...ends, "stroke-width": (w * grow).toFixed(2), opacity: grow > 0.02 ? 1 : 0 });
      set(k.flow, { ...ends, "stroke-width": Math.max(0.8, w * 0.38 * grow).toFixed(2), "stroke-dasharray": `2 ${(5 + w * 0.3).toFixed(1)}` });
      k.head.setAttribute("d", grow > 0.02 ? `M${x1.toFixed(1)},${y1.toFixed(1)} L${(bx + px * hw).toFixed(1)},${(by + py * hw).toFixed(1)} L${(bx - px * hw).toFixed(1)},${(by - py * hw).toFixed(1)} z` : "");
      k.zero.setAttribute("opacity", (1 - grow).toFixed(2));
      k.past.setAttribute("r", (w + 5).toFixed(1));
      const qx = -k.uy * k.side, qy = k.ux * k.side, pl = PLACE[k.c.id];
      const [lx, ly] = pl ? pl.lab : [qx * 16, qy * 16 + 4], [gx, gy] = pl ? pl.bdg : [-qx * 18, -qy * 18];
      set(k.lab, { x: (k.mx + lx).toFixed(1), y: (k.my + ly).toFixed(1) });
      k.bdg.setAttribute("transform", `translate(${(k.mx + gx).toFixed(1)},${(k.my + gy).toFixed(1)})`);
      k.speed = smooth ? 6 + 34 * Math.sqrt(Math.min(mag, 2000) / 2000) : 0;
    }
    const P = E.plant, sc = BAR.w / E.barMax;
    const d = at(P.map((p) => p.demand), t) ?? 0, a = at(P.map((p) => p.avail), t) ?? 0, out = at(P.map((p) => p.out), t) ?? 0;
    set(S.bar.d, { x: BAR.x, width: (Math.min(d, a) * sc).toFixed(1) });
    set(S.bar.s, { x: (BAR.x + d * sc).toFixed(1), width: (Math.max(0, a - d) * sc).toFixed(1) });
    set(S.bar.x, { x: (BAR.x + a * sc).toFixed(1), width: (Math.max(0, d - a) * sc).toFixed(1) });
    set(S.bar.o, { x: (BAR.x + Math.max(a, d) * sc).toFixed(1), width: (out * sc).toFixed(1) });
    stripCursor(t);
    hooks.onTime?.(t);
  }

  /** Everything that belongs to one interval: figures, states, the key. */
  function updateDiscrete(i) {
    const R = E.h.region, items = keyItems(E, i);
    for (const r of E.regionIds) {
      const p = E.regions[r].price[i];
      if (S.regions[r]?.price) S.regions[r].price.textContent = money(p);
      if (S.regions[r]) S.regions[r].title.textContent = `${NAMES[r]} ${money(p)}/MWh`;
    }
    for (const k of S.links) {
      const L = linkAt(E, k.c, i), kind = L.against ? "against" : L.atLimit || L.past ? "limit" : "fg";
      k.g.setAttribute("class", `lk ${kind}`);
      const why = L.against ? L.forcedBy : L.limitBy;
      k.g.dataset.keys = [`l:${k.c.id}`, why ? `c:${why}` : ""].join(" ").trim();
      k.title.textContent = `${k.c.id}: ${num(L.mag)} MW ${SHORT[L.src]} → ${SHORT[L.dst]}`;
      k.lab.textContent = num(L.mag);
      k.past.setAttribute("opacity", L.past ? 1 : 0);
      const it = items.find((x) => x.link === k.c.id);
      k.bdg.setAttribute("opacity", it ? 1 : 0);
      if (it) { k.bc.setAttribute("fill", `var(--${it.kind})`); k.bt.textContent = it.n; }
    }
    const P = E.plant[i];
    S.pOut.textContent = `${P.n} units out or derated: ${num(P.out)} MW`;
    S.pLine.textContent = `MW: demand ${num(P.demand)} · spare ${num(P.avail - P.demand)} · out ${num(P.out)}`;
    S.pCrr.setAttribute("class", P.crr == null ? "inkm" : P.crr < 1 ? "lbl red" : P.crr < 1.5 ? "lbl org" : "ink");
    S.pCrr.textContent = `Reserve ratio ${P.crr == null ? "–" : P.crr.toFixed(2)}`;
    S.pRes.textContent = `${num(P.reserve)} MW to cover the largest loss,`;
    S.pCont.textContent = `${P.cont || "–"} at ${num(P.contMw)} MW`;
    const inSpan = i >= E.span[0] && i <= E.span[1];
    when.textContent = `${hhmm(E.times[i])} · ${NAMES[R]} ${money(E.regions[R].price[i])}/MWh`;
    whenSub.textContent = `interval ending, market time${i === E.peak ? " · the peak" : inSpan ? " · in the event" : " · outside the event"}`;
    S.slider.setAttribute("aria-valuenow", i);
    S.slider.setAttribute("aria-valuetext", hhmm(E.times[i]));
    keyTime.textContent = hhmm(E.times[i]);
    keyList.replaceChildren(...(items.length ? items.map((it) => el("li", { tabindex: 0, onmouseenter: () => focus(it.keys[0]), onmouseleave: () => focus(null), onclick: () => it.keys[0] && hooks.onReveal(it.keys[0]) },
      el("span", { class: `badge ${it.kind}` }, String(it.n)),
      el("span", {}, it.text, " ", it.because, it.d ? el("div", { class: "desc" }, `“${it.d.length > 170 ? it.d.slice(0, 168) + "…" : it.d}”`) : null)))
      : [el("li", {}, el("span"), el("span", { class: "muted" }, "No interconnector at a limit or flowing against the price, and no constraint unmet, at this interval."))]));
    // The key only grows during an event, so the page below it doesn't bounce while playing.
    keyMin = Math.max(keyMin, keyList.offsetHeight);
    keyList.style.minHeight = `${keyMin}px`;
    if (focusKey) focus(focusKey);
    hooks.onInterval?.(i, playing);
  }

  function focus(k) {
    focusKey = k;
    let any = false;
    mapBox.querySelectorAll("[data-keys]").forEach((e) => {
      const on = !!k && e.dataset.keys.split(" ").includes(k);
      e.classList.toggle("hl", on); any ||= on;
    });
    mapBox.classList.toggle("focusing", !!k && any);
  }

  let last = performance.now(), alive = true;
  function frame(now) {
    if (!alive || !box.isConnected) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const end = E.times.length - 1;
    if (playing) { target += dt * rate; if (target >= end) { target = end; stop(); } }
    if (smooth) {
      // A critically damped follow: quick to start, no overshoot, settles in about a third of a second.
      T += (target - T) * (1 - Math.exp(-dt / (dragging ? 0.06 : 0.1)));
      if (Math.abs(target - T) < 0.002) T = target;
    } else T = playing ? Math.floor(target) : Math.round(target);
    if (T !== shownT) { updateContinuous(T); shownT = T; }
    const i = clamp(Math.round(T), 0, end);
    if (i !== N) { N = i; updateDiscrete(i); }
    for (const k of S.links) {
      if (!k.speed) { if (k.phase) { k.phase = 0; k.flow.setAttribute("stroke-dashoffset", 0); } continue; }
      k.phase = (k.phase + dt * k.speed) % 1000;
      k.flow.setAttribute("stroke-dashoffset", (-k.phase).toFixed(2));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    goTo: (i) => { stop(); goTo(i); },
    get t() { return T; },
    get playing() { return playing; },
    focus,
    destroy: () => { alive = false; },
    linkName: (id) => (LINK_NAMES[id] ? `${id} (${LINK_NAMES[id]})` : id),
    data: E,
  };
}
