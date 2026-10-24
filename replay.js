// NEM Lens Replays: each event in AEMO's own published figures.
//
// Reads the event library next to this page (schema 2, the public view of
// the NEM Lens event record): index.json, then for one event
// events/<id>/{headline,series,dispatch,interconnectors,constraints,
// unavailability,notices,manifest}.json. Nothing here is modelled: every
// figure is AEMO's (dispatch pricing run) or arithmetic on it.
//
// The event map (map.js) leads the page and owns the playhead: every chart's
// cursor follows it, and clicking a chart moves it. ?id=<event>&t=HH:MM
// opens an event at an interval, and #<panel> at a panel.

import { mountMap } from "./map.js";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const REGION_COLOURS = { NSW1: "#0b5cad", QLD1: "#b3261e", VIC1: "#3f9e6a", SA1: "#d08c2a", TAS1: "#8a5cc4" };
const FUEL_ORDER = ["coal", "gas", "liquid", "hydro", "wind", "solar", "battery", "bioenergy", "other"];

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...children) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

const num = (v, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("en-AU", { maximumFractionDigits: d, minimumFractionDigits: d }));
const money = (v) => (v == null || !Number.isFinite(v) ? "–" : (v < 0 ? "−$" : "$") + num(Math.abs(v)));
const big = (v) => (Math.abs(v) >= 1e6 ? "$" + num(v / 1e6, 1) + "M" : money(v));
const hhmm = (t) => t.slice(11, 16);
const day = (t) => new Date(t).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane" });

// ------------------------------------------------------------- charts

// Charts are drawn narrower on phones so their text stays legible.
const chartWidth = () => (window.innerWidth < 600 ? 380 : 640);

// Each chart's cursor is a function of fractional time, collected by the panel
// drawing it, so the map's playhead can move every cursor on each frame.
let collecting = null;
let playhead = null;
function cursorLine(g, x, T, H, B, cursor) {
  if (cursor == null) return;
  const line = svg("line", { class: "cursor", y1: T, y2: H - B });
  const place = (t) => { const v = x(t).toFixed(1); line.setAttribute("x1", v); line.setAttribute("x2", v); };
  place(playhead ?? cursor);
  g.append(line);
  collecting?.push(place);
}

/** Lines over intervals, with the event span shaded and a click cursor. */
function lineChart({ times, series, span, height = 220, yfmt = (v) => num(v), cursor, onPick, marks = [] }) {
  const W = chartWidth(), H = height, L = 54, R = 8, T = 8, B = 22;
  const n = times.length;
  const vals = series.flatMap((s) => s.values.filter((v) => v != null && Number.isFinite(v)));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (!vals.length) { lo = 0; hi = 1; }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.06;
  lo -= pad; hi += pad;
  const x = (i) => L + ((W - L - R) * i) / Math.max(n - 1, 1);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const g = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img" });
  if (span) g.append(svg("rect", { class: "span", x: x(span[0]), y: T, width: Math.max(1, x(span[1]) - x(span[0])), height: H - T - B }));
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    g.append(svg("line", { class: "gridline", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    g.append(svg("text", { x: L - 4, y: y(v) + 3, "text-anchor": "end" }, yfmt(v)));
  }
  const step = Math.max(1, Math.ceil(n / (W < 600 ? 5 : 8)));
  for (let i = 0; i < n; i += step) g.append(svg("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, hhmm(times[i])));
  for (const m of marks) g.append(svg("rect", { class: "atlimit", x: x(m) - 2, y: H - B - 4, width: 4, height: 4 }));
  for (const s of series) {
    let d = "", pen = false;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    if (d) g.append(svg("path", { class: s.cls || "line", d, stroke: s.colour, ...(s.width ? { "stroke-width": s.width } : {}) }, svg("title", {}, s.name)));
  }
  cursorLine(g, x, T, H, B, cursor);
  if (onPick) {
    const hit = svg("rect", { class: "hit", x: L, y: T, width: W - L - R, height: H - T - B });
    hit.addEventListener("click", (ev) => {
      const r = g.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      onPick(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
    });
    g.append(hit);
  }
  return g;
}

function stackChart({ times, layers, span, cursor, onPick, height = 220 }) {
  const W = chartWidth(), H = height, L = 54, R = 8, T = 8, B = 22;
  const n = times.length;
  const pos = layers.map((l) => l.values.map((v) => Math.max(0, v || 0)));
  const tot = times.map((_, i) => pos.reduce((a, p) => a + p[i], 0));
  const hi = Math.max(...tot, 1) * 1.05;
  const x = (i) => L + ((W - L - R) * i) / Math.max(n - 1, 1);
  const y = (v) => T + (H - T - B) * (1 - v / hi);
  const g = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img" });
  if (span) g.append(svg("rect", { class: "span", x: x(span[0]), y: T, width: Math.max(1, x(span[1]) - x(span[0])), height: H - T - B }));
  for (let k = 0; k <= 4; k++) {
    const v = (hi * k) / 4;
    g.append(svg("line", { class: "gridline", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    g.append(svg("text", { x: L - 4, y: y(v) + 3, "text-anchor": "end" }, num(v)));
  }
  const step = Math.max(1, Math.ceil(n / (W < 600 ? 5 : 8)));
  for (let i = 0; i < n; i += step) g.append(svg("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, hhmm(times[i])));
  const base = new Array(n).fill(0);
  layers.forEach((l, k) => {
    const top = base.map((b, i) => b + pos[k][i]);
    let d = `M${x(0)},${y(top[0])}`;
    for (let i = 1; i < n; i++) d += `L${x(i)},${y(top[i])}`;
    for (let i = n - 1; i >= 0; i--) d += `L${x(i)},${y(base[i])}`;
    g.append(svg("path", { d: d + "Z", fill: `var(--${l.name})`, opacity: 0.9 }, svg("title", {}, l.name)));
    top.forEach((v, i) => (base[i] = v));
  });
  cursorLine(g, x, T, H, B, cursor);
  if (onPick) {
    const hit = svg("rect", { class: "hit", x: L, y: T, width: W - L - R, height: H - T - B });
    hit.addEventListener("click", (ev) => {
      const r = g.getBoundingClientRect();
      onPick(Math.max(0, Math.min(n - 1, Math.round(((((ev.clientX - r.left) / r.width) * W - L) / (W - L - R)) * (n - 1)))));
    });
    g.append(hit);
  }
  return g;
}

function table(head, rows, textCols = []) {
  return el("div", { class: "scroll" }, el("table", {},
    el("thead", {}, el("tr", {}, head.map((h, i) => el("th", { class: textCols.includes(i) ? "text" : null }, h)))),
    el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c, i) => el("td", { class: textCols.includes(i) ? "text" : null }, c)))))));
}

/** A panel with a chart-or-table toggle; render() returns {chart, table, note}. `id` is its anchor. */
function panel(title, render, wide = false, id = null) {
  const body = el("div", { class: "body" });
  const note = el("p", { class: "note" });
  let asTable = false;
  const toggle = el("button", { type: "button" }, "Table");
  const draw = () => {
    p.cursors = [];
    collecting = p.cursors;
    const out = render();
    collecting = null;
    body.replaceChildren((asTable ? out.table : out.chart) || out.table || el("p", { class: "muted" }, "Not in this event's data."));
    note.textContent = out.note || "";
    toggle.hidden = !out.chart || !out.table;
  };
  toggle.addEventListener("click", () => {
    asTable = !asTable;
    toggle.textContent = asTable ? "Chart" : "Table";
    draw();
  });
  const p = el("section", { class: `panel${wide ? " wide" : ""}`, id }, el("header", {}, el("h2", {}, title), toggle), body, note);
  p.redraw = draw;
  return p;
}

// ------------------------------------------------------------- map links

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Scroll to a panel and outline it briefly. */
function revealPanel(anchor) {
  const p = document.getElementById(anchor);
  if (!p) return;
  p.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  p.classList.remove("flash");
  void p.offsetWidth;
  p.classList.add("flash");
}

/**
 * The chart under the map for a clicked link, constraint or unit. Regions and
 * the plant card go to their own panels instead (prices, contingency reserve).
 */
function mapDetail({ times, span, ics, cons, unav, region, pick, cursorAt, reveal }) {
  const box = $("emap-detail");
  const self = { cursors: [], key: null };
  const go = (anchor, label) => el("a", { href: `#${anchor}`, onclick: (e) => { e.preventDefault(); reveal(anchor); } }, `${label} panel ↓`);
  const close = el("button", { type: "button", "aria-label": "Close" }, "Close");
  close.addEventListener("click", () => { self.key = null; box.hidden = true; self.cursors = []; });
  const draw = () => {
    const k = self.key;
    if (!k) return;
    const [kind, id] = [k.slice(0, 1), k.slice(2)], i = cursorAt();
    let title = id, body = [], note = "", link = null;
    self.cursors = [];
    collecting = self.cursors;
    if (kind === "l") {
      const c = ics.interconnectors.find((x) => x.id === id);
      title = `${id}: flow and AEMO's limits`;
      body = [el("div", { class: "legend" }, [["Flow", "#0b5cad"], ["Limits", "var(--limit)"]].map(([n, col]) => el("span", {}, el("i", { style: `background:${col}` }), n))),
        lineChart({ times, span, cursor: i, onPick: pick, height: 170, series: [{ name: "Flow", values: c.flow, colour: "#0b5cad" }, { name: "Export limit", values: c.export_limit, cls: "limit" }, { name: "Import limit", values: c.import_limit, cls: "limit" }] })];
      note = `MW, positive from ${c.from_region} to ${c.to_region}. At ${hhmm(times[i])} the import limit was set by ${c.import_set_by[i] || "–"} and the export limit by ${c.export_set_by[i] || "–"}.`;
      if (c.from_region === region || c.to_region === region) link = go("interconnectors", "Interconnectors");
    } else if (kind === "c") {
      const c = cons.constraints.find((x) => x.id === id);
      if (!c) return;
      const marks = c.marginal.map((m, j) => (m ? j : -1)).filter((j) => j >= 0);
      const viol = (c.violation || []).some((v) => v != null && Math.abs(v) >= 1);
      body = [el("p", { class: "note" }, c.description || ""),
        lineChart({ times, span, cursor: i, onPick: pick, height: 150, marks, series: viol
          ? [{ name: "Not met by (MW)", values: c.violation.map((v) => (v == null ? 0 : Math.abs(v))), colour: "#c62828" }]
          : [{ name: "Binding", values: c.marginal.map((m) => (m ? 1 : 0)), cls: "limit" }] })];
      note = viol ? "MW by which AEMO's dispatch could not meet it (violation degree); orange ticks: binding." : "1 when binding (non-zero marginal value); orange ticks mark the same.";
      link = go("constraints", "Network constraints");
    } else if (kind === "u") {
      const u = unav.units.find((x) => x.duid === id);
      if (!u) { collecting = null; return reveal("reserve"); }
      title = `${u.duid} (${u.fuel || "unit"}, ${num(u.capacity_mw)} MW): availability`;
      body = [lineChart({ times, span, cursor: i, onPick: pick, height: 150, series: [{ name: "Available", values: u.availability, colour: "#0b5cad" }, { name: "Capacity", values: times.map(() => u.capacity_mw), cls: "limit" }] })];
      note = `MW AEMO had available from the unit; dashed: its registered capacity. At ${hhmm(times[i])}: ${num(u.availability[i])} MW.`;
      link = go("plant", "Plant unavailable");
    }
    collecting = null;
    box.replaceChildren(el("header", {}, el("h2", {}, title), link, close), ...body, el("p", { class: "note" }, note, " Click the chart to move the map there."));
    box.hidden = false;
  };
  self.show = (k) => {
    if (!k) return;
    if (k.startsWith("r:")) return reveal("prices");
    if (k === "plant") return reveal("reserve");
    self.key = k;
    draw();
    if (!box.hidden) box.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
  };
  self.redraw = draw;
  return self;
}

// ------------------------------------------------------------- event view

async function showEvent(id) {
  const base = `events/${encodeURIComponent(id)}/`;
  const files = ["headline", "series", "dispatch", "interconnectors", "constraints", "unavailability", "notices"];
  const [h, series, dispatch, ics, cons, unav, notices] = await Promise.all(files.map((f) => getJSON(base + f + ".json")));
  const times = series.intervals;
  const t0 = Date.parse(h.start), t1 = Date.parse(h.end);
  const inSpan = times.map((t) => Date.parse(t) >= t0 && Date.parse(t) <= t1);
  const span = [inSpan.indexOf(true), inSpan.lastIndexOf(true)];
  let cursor = times.indexOf(h.peak_at);
  if (cursor < 0) cursor = span[0];
  // ?t=HH:MM (or HHMM) opens at that interval instead of the peak.
  const tParam = (params.get("t") || "").replace(":", "");
  const tIndex = tParam ? times.findIndex((t) => hhmm(t).replace(":", "") === tParam) : -1;
  if (tIndex >= 0) cursor = tIndex;
  const region = h.region;

  document.title = `${region} ${h.trading_day} · NEM Lens Replays`;
  $("ev-tags").replaceChildren(...(h.tags || []).filter((t) => !t.startsWith("region:") && !t.startsWith("year:")).map((t) => el("span", { class: "tag-chip" }, tagLabel(t))));
  $("ev-title").textContent = `${region.replace(/1$/, "")} price event, ${day(h.start)}`;
  $("ev-sub").textContent = `${hhmm(h.start)} to ${hhmm(h.end)} market time (AEST), ${h.duration_minutes} minutes. Shaded on each chart; the window runs from two hours before to one hour after.`;
  const card = (label, v, n) => el("div", { class: "card" }, el("h3", {}, label), el("div", { class: "v" }, v), el("div", { class: "n" }, n));
  $("cards").replaceChildren(
    card("Peak price", money(h.peak_price), `$/MWh at ${hhmm(h.peak_at)}`),
    card("Average price", money(h.mean_price), "$/MWh over the event"),
    card("Intervals ≥ $5,000", num(h.intervals_above_5000), `of ${h.duration_minutes / 5} five-minute intervals`),
    card("Cost to consumers", big(h.cost_to_load), "price × demand, energy only"),
    card("Peak demand", num(h.max_demand_mw) + " MW", `${region} operational demand`),
  );

  const panels = [];
  const redraw = () => { panels.forEach((p) => p.redraw()); detail?.redraw(); };
  let map = null, detail = null;
  // Clicking a chart moves the map, whose playhead then moves every panel.
  const pick = (i) => { if (map) map.goTo(i); else { cursor = i; redraw(); } };
  const regions = Object.keys(series.regions);

  panels.push(panel("Prices", () => ({
    chart: el("div", {},
      el("div", { class: "legend" }, regions.map((r) => el("span", {}, el("i", { style: `background:${REGION_COLOURS[r] || "#888"}` }), r))),
      lineChart({ times, span, cursor, onPick: pick, yfmt: money, series: regions.map((r) => ({ name: r, values: series.regions[r].price, colour: REGION_COLOURS[r], cls: r === region ? "line focus" : "line" })) })),
    table: table(["Interval end", ...regions], times.map((t, i) => [hhmm(t), ...regions.map((r) => money(series.regions[r].price[i]))])),
    note: `Regional reference prices, $/MWh, every five minutes. Click a point to see that interval below; now ${hhmm(times[cursor])}.`,
  }), true));

  const ev = series.regions[region];
  panels.push(panel(`${region} demand and supply`, () => ({
    chart: el("div", {},
      el("div", { class: "legend" }, [["Demand", "#0b5cad"], ["Available generation", "#3f9e6a"], ["Net interchange (export +)", "#a3a097"]].map(([k, c]) => el("span", {}, el("i", { style: `background:${c}` }), k))),
      lineChart({ times, span, cursor, onPick: pick, yfmt: (v) => num(v), series: [
        { name: "Demand", values: ev.demand, colour: "#0b5cad" },
        { name: "Available generation", values: ev.available_generation, colour: "#3f9e6a" },
        { name: "Net interchange", values: ev.net_interchange, colour: "#a3a097" },
      ] })),
    table: table(["Interval end", "Demand", "Available generation", "Net interchange"], times.map((t, i) => [hhmm(t), num(ev.demand[i]), num(ev.available_generation[i]), num(ev.net_interchange[i])])),
    note: "MW. Available generation is what scheduled and semi-scheduled plant offered; net interchange is positive when the region exports.",
  })));

  const hasCrr = (ev.crr || []).some((v) => v != null);
  const ratio = (v) => (v == null ? "" : v.toFixed(2));
  panels.push(panel(`${region} contingency reserve`, () => hasCrr ? ({
    chart: el("div", {},
      el("div", { class: "legend" }, [["Reserve ÷ largest contingency", "#0b5cad"], ["1: just enough", "var(--limit)"]].map(([k, c]) => el("span", {}, el("i", { style: `background:${c}` }), k))),
      lineChart({ times, span, cursor, onPick: pick, yfmt: ratio, series: [
        { name: "Contingency reserve ratio", values: ev.crr, colour: "#0b5cad" },
        { name: "1", values: times.map(() => 1), cls: "limit" },
      ] })),
    table: table(["Interval end", "Largest contingency", "MW", "Reserve MW", "Reserve − contingency", "Ratio"],
      times.map((t, i) => [hhmm(t), ev.contingency[i] || "", num(ev.contingency_mw[i]), num(ev.reserve_mw[i]),
        ev.reserve_mw[i] == null ? "" : num(ev.reserve_mw[i] - ev.contingency_mw[i]), ratio(ev.crr[i])]), [1]),
    note: `At ${hhmm(times[cursor])} the largest single loss was ${ev.contingency[cursor] || "–"} (${num(ev.contingency_mw[cursor])} MW); reserve to replace it ${num(ev.reserve_mw[cursor])} MW, ratio ${ratio(ev.crr[cursor])}. ` +
      "The largest contingency is the biggest unit's output or DC link's inflow (Basslink, Murraylink, Directlink). Reserve is every other unit's available headroom plus room to raise imports to AEMO's limits. Below 1, the region could not replace that loss. Plant only: network outages are not counted, and neighbours are assumed to have the spare to send. " +
      "Inspired by WattClarity's IRPM (surplus available generation over demand); the library README (github.com/nem-lens/library) says how it differs and why.",
  }) : {}));

  const fuels = FUEL_ORDER.filter((f) => dispatch.fuels[f] && dispatch.fuels[f].some((v) => Math.abs(v) > 0.5));
  panels.push(panel(`${region} dispatch by fuel`, () => ({
    chart: el("div", {},
      el("div", { class: "legend" }, fuels.map((f) => el("span", {}, el("i", { style: `background:var(--${f})` }), f))),
      stackChart({ times, span, cursor, onPick: pick, layers: fuels.map((f) => ({ name: f, values: dispatch.fuels[f] })) })),
    table: table(["Fuel", `At ${hhmm(times[cursor])}`, "Peak in window"], fuels.map((f) => [f, num(dispatch.fuels[f][cursor]), num(Math.max(...dispatch.fuels[f]))])),
    note: "MW dispatched by scheduled and semi-scheduled plant; batteries net of charging. Rooftop solar and other non-scheduled plant are not in AEMO's dispatch.",
  })));

  const touching = ics.interconnectors.filter((c) => c.from_region === region || c.to_region === region);
  const atLimit = (c, i) => c.flow[i] != null && ((c.export_limit[i] != null && c.flow[i] >= c.export_limit[i] - 1) || (c.import_limit[i] != null && c.flow[i] <= c.import_limit[i] + 1));
  panels.push(panel(`Interconnectors into ${region}`, () => ({
    chart: el("div", {}, touching.map((c) => el("div", {},
      el("p", { class: "note" }, `${c.id} (${c.from_region} → ${c.to_region} positive)${times.some((_, i) => atLimit(c, i)) ? "; orange ticks: at a limit" : ""}`),
      lineChart({ times, span, cursor, onPick: pick, height: 150, marks: times.map((_, i) => i).filter((i) => atLimit(c, i)), series: [
        { name: "Flow", values: c.flow, colour: "#0b5cad" },
        { name: "Export limit", values: c.export_limit, cls: "limit" },
        { name: "Import limit", values: c.import_limit, cls: "limit" },
      ] })))),
    table: table(["Interconnector", "Flow", "Import limit", "Export limit", "Import limit set by", "Export limit set by"],
      touching.map((c) => [c.id, num(c.flow[cursor]), num(c.import_limit[cursor]), num(c.export_limit[cursor]), c.import_set_by[cursor] || "", c.export_set_by[cursor] || ""]), [4, 5]),
    note: `MW. Dashed lines are AEMO's limits; the table shows ${hhmm(times[cursor])} and the constraint AEMO reports as setting each limit.`,
  })));

  const notMet = (c) => (c.violation || []).some((v) => v != null && Math.abs(v) >= 1);
  const top = cons.constraints.slice(0, 40);
  panels.push(panel("Network constraints that bound", () => ({
    table: table(["Constraint", "What it represents", "Intervals binding", `Marginal at ${hhmm(times[cursor])}`, "Largest marginal"],
      top.map((c) => [c.id, el("span", {}, c.outage ? el("span", { class: "tag out" }, "outage") : null, " ", notMet(c) ? el("span", { class: "tag out" }, "not met") : null, " ", c.description || ""), num(c.intervals_binding), c.marginal[cursor] ? num(c.marginal[cursor]) : "", num(Math.max(...c.marginal.map((m) => Math.abs(m || 0))))]), [1]),
    note: `Generic constraints with a non-zero marginal value or a violation in the window (${cons.constraints.length}; the first ${top.length} shown), most often binding first. "Outage": AEMO's description names a network element out of service. "Not met": AEMO's dispatch could not meet it in at least one interval (AEMO's violation degree); a constraint's penalty can then set prices, up to the market price cap. Marginal values are AEMO's, $/MWh per MW.`,
  }), true));

  panels.push(panel("Plant unavailable", () => ({
    table: table(["Unit", "Fuel", "Capacity", "Status", `Available at ${hhmm(times[cursor])}`, "Participant's rebid reasons (latest last)"],
      unav.units.map((u) => [u.duid, u.fuel || "", num(u.capacity_mw), u.kind, num(u.availability[cursor]), el("span", {}, u.rebids.map((r) => el("div", {}, `${hhmm(r.offer_time)} ${r.explanation}`)))]), [5]),
    note: `${region} scheduled generators of 30 MW or more whose AEMO availability was zero throughout the window (outage) or averaged well below capacity (derated), MW. Reasons are the participants' own rebid explanations as published by AEMO.`,
  }), true));

  panels.push(panel("AEMO market notices", () => ({
    table: notices.notices.length
      ? el("div", { class: "scroll" }, notices.notices.map((x) => el("details", { class: "notice" },
          el("summary", {}, `${hhmm(x.issued)} · ${x.kind} · ${x.title}`), el("pre", {}, x.reason))))
      : el("p", { class: "muted" }, "No market notices were kept for this event."),
    note: "Notices AEMO issued from six hours before the window to its end, as published.",
  }), true));

  panels.push(panel("Sources", () => ({
    table: el("p", { class: "small" }, "Every figure on this page comes from AEMO's published data: DispatchIS (prices, region totals, interconnectors, constraints), next-day dispatch and bids, the MMSDM archive (constraint descriptions, unit registrations and fuels) and market notices. ",
      el("a", { href: base + "manifest.json" }, "manifest.json"), " lists each source file with its URL and SHA-256."),
  }), true));

  // Anchors, so a link can open a panel: ?id=<event>&t=14:35#interconnectors.
  const anchors = { "Prices": "prices", "demand and supply": "demand", "contingency reserve": "reserve", "dispatch by fuel": "fuel", "Interconnectors": "interconnectors", "Network constraints": "constraints", "Plant unavailable": "plant", "AEMO market notices": "notices", "Sources": "sources" };
  for (const p of panels) {
    const title = p.querySelector("h2").textContent;
    p.id = Object.entries(anchors).find(([k]) => title.includes(k))?.[1] || null;
  }
  $("panels").replaceChildren(...panels);

  // The map, and a chart for whatever is clicked on it that has no panel of its own.
  let startAt = cursor;
  detail = mapDetail({ times, span, ics, cons, unav, region, pick, cursorAt: () => cursor, reveal: revealPanel });
  map = mountMap($("emap"), { h, series, dispatch, ics, cons, unav, span }, cursor, {
    onTime: (t) => { playhead = t; for (const p of [...panels, detail]) for (const f of p.cursors || []) f(t); },
    onInterval: (i, playing) => {
      cursor = i;
      // While playing only the cursors move; tables and notes catch up when it stops.
      if (playing) return;
      redraw();
      // Keep the address on the interval shown, so it can be shared.
      if (i !== startAt) history.replaceState(null, "", `?id=${encodeURIComponent(id)}&t=${hhmm(times[i])}${location.hash}`);
      startAt = -1;
    },
    onStop: (i) => { cursor = i; redraw(); },
    onReveal: (k) => detail.show(k),
  });
  redraw();
  $("events-view").hidden = true;
  $("event-view").hidden = false;
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

// ------------------------------------------------------------- index view

// Tags are key:value facets from AEMO data (event schema TAG_KEYS).
const TAG_LABELS = {
  "price:at-cap": "price at the cap",
  "price:negative": "negative prices",
  "price:floor": "price at the floor",
  "pricing:administered": "administered pricing",
  "pricing:suspended": "market suspended",
  "intervention:yes": "intervention",
  "settlement:5-minute": "5-minute settlement",
  "settlement:30-minute": "30-minute settlement",
  "bids:missing": "bids not archived",
  "bids:no-band-availability": "bid bands not archived",
};
const tagOf = (e, key) => (e.tags || []).find((t) => t.startsWith(key + ":"))?.slice(key.length + 1);
const tagLabel = (t) => TAG_LABELS[t] || t.split(":")[1];

function eventItem(e) {
  return el("li", {}, el("a", { href: `?id=${encodeURIComponent(e.event_id)}` },
    el("span", { class: "when" }, `${e.region} · ${day(e.start)}`),
    el("span", { class: "facts" }, `${hhmm(e.start)}–${hhmm(e.end)}, ${e.duration_minutes} min · peak ${money(e.peak_price)}/MWh · average ${money(e.mean_price)}/MWh · ${e.intervals_above_5000} intervals ≥ $5,000`),
    el("span", { class: "tags" }, (e.tags || []).filter((t) => TAG_LABELS[t] || t.startsWith("severity:") || t.startsWith("season:")).map((t) => el("span", { class: "tag-chip" }, tagLabel(t))))));
}

async function showIndex() {
  const index = await getJSON("index.json");
  const events = index.events;
  const state = { region: params.get("region") || "", season: params.get("season") || "", severity: params.get("severity") || "", tags: new Set((params.get("tags") || "").split(",").filter(Boolean)) };
  const values = (key) => [...new Set(events.map((e) => tagOf(e, key)).filter(Boolean))].sort();
  const select = (label, key, options) => {
    const s = el("select", { "aria-label": label }, el("option", { value: "" }, "All"), options.map((o) => el("option", { value: o, selected: state[key] === o }, o)));
    s.addEventListener("change", () => { state[key] = s.value; render(); });
    return el("label", {}, label, s);
  };
  const flagTags = Object.keys(TAG_LABELS).filter((t) => events.some((e) => (e.tags || []).includes(t)));
  const chips = el("div", { class: "chips", "aria-label": "Conditions" }, flagTags.map((t) => {
    const b = el("button", { type: "button", class: "chip", "aria-pressed": String(state.tags.has(t)) }, tagLabel(t));
    b.addEventListener("click", () => {
      state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t);
      b.setAttribute("aria-pressed", String(state.tags.has(t)));
      render();
    });
    return b;
  }));
  $("filters").replaceChildren(
    select("Region", "region", values("region")),
    select("Season", "season", ["summer", "autumn", "winter", "spring"].filter((s) => values("season").includes(s))),
    select("Severity", "severity", ["cap", "extreme", "high"].filter((s) => values("severity").includes(s))),
    chips);

  function render() {
    const shown = events.filter((e) =>
      (!state.region || tagOf(e, "region") === state.region || e.region === state.region) &&
      (!state.season || tagOf(e, "season") === state.season) &&
      (!state.severity || tagOf(e, "severity") === state.severity) &&
      [...state.tags].every((t) => (e.tags || []).includes(t)));
    const byYear = new Map();
    for (const e of shown) {
      const y = tagOf(e, "year") || e.start.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(e);
    }
    const years = [...byYear.keys()].sort().reverse();
    $("years").replaceChildren(...years.map((y, i) => el("details", { class: "year", open: i === 0 || shown.length <= 40 },
      el("summary", {}, y, " ", el("span", { class: "muted" }, `${byYear.get(y).length} event${byYear.get(y).length > 1 ? "s" : ""}`)),
      el("ul", { class: "events" }, byYear.get(y).map(eventItem)))));
    $("events-status").textContent = events.length
      ? `${shown.length} of ${events.length} events, newest first, by year.`
      : "No events yet.";
    const p = new URLSearchParams();
    for (const k of ["region", "season", "severity"]) if (state[k]) p.set(k, state[k]);
    if (state.tags.size) p.set("tags", [...state.tags].join(","));
    history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
  }
  render();
}

(params.get("id") ? showEvent(params.get("id")) : showIndex()).catch((e) => {
  $("events-status").textContent = `Could not load: ${e.message}`;
  $("events-view").hidden = false;
  $("event-view").hidden = true;
  console.error(e);
});
