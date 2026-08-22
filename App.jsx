import React, { useState, useEffect } from "react";

/*
  ============================================================
  PONKETA SURF — Pronóstico para Don Gregorio / Ponketa, Nizao
  ============================================================
  v2 — resumen de cambios (detalle en CAMBIOS.md):
  1. BUG ARREGLADO: `tz` se usaba sin definir en el cliente
     (ReferenceError silencioso -> la app caía siempre a "error").
  2. MAREA: se lee `sea_level_height_msl` (Open-Meteo / Copernicus).
     Se muestra tendencia (subiendo/bajando) + próxima pleamar/bajamar.
     NO entra en el veredicto: primero valida en el agua qué marea
     le conviene al banco.
  3. VIENTO: etiquetas de 16 rumbos (NNE, ENE...) y la calidad se
     calcula sobre el CENTRO del sector etiquetado -> color y etiqueta
     nunca se contradicen (problema #4 del README).
  4. VEREDICTO recalibrado (suave): con viento limpio, el periodo corto
     penaliza menos. Tu caso real (3.5 ft · 5 s · offshore) ahora sale
     BUENO, no solo SURFEABLE. Constantes tuneables abajo.
  5. Cada día muestra su MEJOR VENTANA (mejor hora de luz), no la hora
     de más ola (que podía ser una tarde onshore).
  6. Datos marine y wind se alinean POR TIMESTAMP, no por índice.
  7. Último pronóstico bueno se guarda en localStorage: si no hay señal
     en la playa, se muestra con aviso de "datos de hace X h".

  AJUSTA AQUÍ EL PIN EXACTO DEL SPOT:
  - COAST_FACING: hacia dónde "mira" la playa en grados.
    Costa sur del Caribe => mira al sur (~180°).
    El viento offshore (limpio) viene del lado opuesto (norte, ~0°).
*/
const SPOT = {
  name: "Playa Ponketa · Don Gregorio",
  area: "Nizao · Costa Sur",
  // Pin exacto de la orilla (Google Maps). El peak rompe justo al frente (al sur).
  lat: 18.231302,
  lon: -70.197746,
  coastFacing: 180, // la playa mira al sur
  // Punto de muestreo del modelo: ~0.8 km mar adentro, sobre el peak,
  // para caer en celda de agua y no "agarrar arena".
  sampleLat: 18.224,
  sampleLon: -70.1977,
};

const TZ = "America/Santo_Domingo";
const CACHE_KEY = "ponketa:lastForecast";
const CACHE_MAX_AGE_H = 24; // más viejo que esto no se muestra ni offline

const T = {
  es: {
    now: "Ahora",
    today: "Hoy",
    verdictFlat: "PLANO",
    verdictTiny: "CHIQUITO",
    verdictRide: "SURFEABLE",
    verdictGood: "BUENO",
    verdictEpic: "ÉPICO",
    wave: "Ola",
    period: "Periodo",
    swell: "Swell",
    wind: "Viento",
    gust: "Racha",
    water: "Agua",
    tide: "Marea",
    rising: "subiendo",
    falling: "bajando",
    energy: "Energía",
    energyLow: "Baja",
    energyMed: "Media",
    energyHigh: "Alta",
    energyMax: "Muy alta",
    highTide: "pleamar",
    lowTide: "bajamar",
    best: "mejor",
    clean: "Limpio · offshore",
    crossoff: "Cross-offshore",
    cross: "Cruzado",
    onshore: "Onshore · sucio",
    nextDays: "Próximos días",
    tapDay: "toca un día para ver las horas",
    loading: "Leyendo el mar…",
    errorTitle: "No pude leer el pronóstico",
    errorBody: "Revisa tu conexión y vuelve a intentar.",
    retry: "Reintentar",
    stale: "Sin conexión · datos de hace {h} h",
    source: "Datos: Open-Meteo Marine · modelo global de oleaje",
    estimate:
      "Estimación del modelo offshore. En un beachbreak de desembocadura la marea y los bancos de arena mandan: confirma en el agua.",
    tideNote:
      "Marea: modelo global (~8 km), orientativa en tendencia y horario.",
    feet: "pies",
    today2: "Hoy",
    days: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
    createdBy: "App creada por",
    visitSite: "Visitar portal",
  },
  en: {
    now: "Now",
    today: "Today",
    verdictFlat: "FLAT",
    verdictTiny: "TINY",
    verdictRide: "RIDEABLE",
    verdictGood: "GOOD",
    verdictEpic: "EPIC",
    wave: "Wave",
    period: "Period",
    swell: "Swell",
    wind: "Wind",
    gust: "Gust",
    water: "Water",
    tide: "Tide",
    rising: "rising",
    falling: "falling",
    energy: "Energy",
    energyLow: "Low",
    energyMed: "Medium",
    energyHigh: "High",
    energyMax: "Very high",
    highTide: "high",
    lowTide: "low",
    best: "best",
    clean: "Clean · offshore",
    crossoff: "Cross-offshore",
    cross: "Cross-shore",
    onshore: "Onshore · choppy",
    nextDays: "Next days",
    tapDay: "tap a day for the hours",
    loading: "Reading the sea…",
    errorTitle: "Couldn't load the forecast",
    errorBody: "Check your connection and try again.",
    retry: "Retry",
    stale: "Offline · data from {h} h ago",
    source: "Data: Open-Meteo Marine · global wave model",
    estimate:
      "Offshore model estimate. At a river-mouth beachbreak, tide and sandbars rule: confirm in the water.",
    tideNote: "Tide: global model (~8 km), use for trend and timing only.",
    feet: "ft",
    today2: "Today",
    days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    createdBy: "App created by",
    visitSite: "Visit site",
  },
};

// 16 rumbos: mejor resolución que 8 y, sobre todo, permite que la
// CALIDAD del viento se calcule sobre el centro del sector etiquetado.
// Resultado: la etiqueta y el color siempre cuentan la misma historia.
const DIRS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];
const dirSector = (deg) => Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
const dirLabel = (deg) => (deg == null ? "—" : DIRS[dirSector(deg)]);

const mToFt = (m) => (m == null ? null : m * 3.28084);

// Ángulo más corto entre dos rumbos (0-180)
function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Calidad del viento relativa a la orientación de la playa.
// El viento "viene de" windFrom. Offshore = viene de tierra
// = del rumbo opuesto al que mira la playa.
// v2: se evalúa el CENTRO del sector de 22.5° (el mismo que la etiqueta),
// y los umbrales caen en fronteras de sector -> cada rumbo tiene UNA
// calidad fija. Para Ponketa (offshore = N):
//   clean:    NNW · N · NNE
//   crossoff: NW · NE · WNW · ENE
//   cross:    W · E · WSW · ESE
//   onshore:  SW · SSW · S · SSE · SE
function windQuality(windFrom, coastFacing) {
  const offshoreSource = (coastFacing + 180) % 360; // de dónde viene el offshore puro
  const sectorCenter = dirSector(windFrom) * 22.5;
  const d = angleDiff(sectorCenter, offshoreSource); // 0 = offshore puro, 180 = onshore puro
  if (d < 34) return "clean";
  if (d < 79) return "crossoff";
  if (d < 124) return "cross";
  return "onshore";
}

/*
  Veredicto — VERSIÓN FIRME (el periodo manda).
  Nota: se probó una recalibración que subía "3.5 pies · 5s · limpio" de
  SURFEABLE a BUENO, pero las sesiones con foto del 19–21 jul lo
  desmintieron: ese día se confirmó SURFEABLE en el agua ("pequeño pero
  surfeable"). Así que se mantiene la calibración firme y validada:
  - Escalones de periodo: <6 / <8 / <10 / <13 s
  - "ride" (surfeable) hasta score 5; "good" (bueno) desde 6.
  - Tope duro: periodo <6s => máx surfeable, aunque haya tamaño.
  - Épico exige tamaño real (5 pies+) + groundswell.
  Tunea aquí solo con más evidencia del agua, no por teoría.
*/
function verdict(hFt, periodS, quality) {
  if (hFt == null || hFt < 1.0) return "flat";
  const p = periodS ?? 5;

  // Tamaño (0–4)
  let size;
  if (hFt < 1.5) size = 0;
  else if (hFt < 2.5) size = 1;
  else if (hFt < 3.5) size = 2;
  else if (hFt < 5) size = 3;
  else size = 4;

  // Calidad por periodo (0–4), ajustada por viento
  let qual;
  if (p < 6) qual = 0; // mar de viento, floja
  else if (p < 8) qual = 1; // periodo corto
  else if (p < 10) qual = 2; // decente
  else if (p < 13) qual = 3; // groundswell
  else qual = 4; // potente
  if (quality === "clean") qual += 1; // offshore: mejora
  else if (quality === "crossoff") qual += 0; // cross-offshore: neutral, aceptable
  else if (quality === "cross") qual -= 1; // cruzado/sideshore: ensucia un poco
  else if (quality === "onshore") qual -= 2; // onshore: arruina
  if (qual < 0) qual = 0;

  const s = size + qual; // 0–9
  let v;
  if (s <= 2) v = "tiny";
  else if (s <= 5) v = "ride";
  else if (s <= 7) v = "good";
  else v = "epic";

  // Topes realistas — VERSIÓN FIRME, validada con sesiones reales (19–21 jul):
  // 3.5 pies · 5s · limpio se confirmó SURFEABLE en el agua, no BUENO.
  if (p < 6 && (v === "good" || v === "epic")) v = "ride"; // periodo corto: máx surfeable
  if (p < 8 && v === "epic") v = "good"; // corto: no épico
  if (quality === "onshore" && v === "epic") v = "good"; // onshore: no épico
  if (v === "epic" && size < 4) v = "good"; // épico necesita tamaño real
  return v;
}

const VERDICT_RANK = { flat: 0, tiny: 1, ride: 2, good: 3, epic: 4 };

const PALETTE = {
  ink: "#08222E",
  ink2: "#0E2E3C",
  card: "#103744",
  teal: "#1AA6A0",
  aqua: "#36C5D6",
  foam: "#EAF6F4",
  muted: "#7FA7AE",
  sand: "#E9DFC7",
  coral: "#F0653F",
  gold: "#F4B740",
  green: "#54C98A",
  line: "rgba(234,246,244,0.12)",
};

function verdictColor(v) {
  switch (v) {
    case "epic":
      return PALETTE.gold;
    case "good":
      return PALETTE.aqua;
    case "ride":
      return PALETTE.teal;
    case "tiny":
      return PALETTE.muted;
    default:
      return PALETTE.muted;
  }
}

function qualityColor(q) {
  if (q === "clean") return PALETTE.aqua;
  if (q === "crossoff") return PALETTE.green;
  if (q === "cross") return PALETTE.gold;
  return PALETTE.coral; // onshore
}

// ---------- Energía de la ola (pegada) ----------
// La fuerza real de una ola ~ altura² × periodo (lo que surf-forecast
// muestra como kJ). Aquí se traduce a lenguaje humano (Baja/Media/Alta),
// no como número crudo. NO entra al veredicto: el veredicto ya pondera
// tamaño + periodo; esto es solo lectura rápida de "cuánta fuerza trae".
// level 0–3 → 4 segmentos de barra. Umbrales calibrados al rango de
// Ponketa (H ~1–1.8 m, T ~5–8 s).
function waveEnergy(hM, periodS) {
  if (hM == null) return null;
  const p = periodS ?? 5;
  const e = hM * hM * p; // índice relativo (altura² × periodo)
  let level, key;
  if (e < 8) { level = 0; key = "energyLow"; }
  else if (e < 16) { level = 1; key = "energyMed"; }
  else if (e < 30) { level = 2; key = "energyHigh"; }
  else { level = 3; key = "energyMax"; }
  return { level, key };
}

function energyColor(level) {
  if (level >= 3) return PALETTE.gold;
  if (level === 2) return PALETTE.aqua;
  if (level === 1) return PALETTE.teal;
  return PALETTE.muted; // baja
}


// ---------- Marea ----------
// Extremos (pleamar/bajamar) a partir del nivel del mar horario.
// El ajuste parabólico con los 3 puntos alrededor del extremo afina
// la hora a ~minutos (la serie es horaria).
function tideExtremes(times, levels) {
  const out = [];
  if (!levels) return out;
  for (let i = 1; i < levels.length - 1; i++) {
    const a = levels[i - 1], b = levels[i], c = levels[i + 1];
    if (a == null || b == null || c == null) continue;
    const isHigh = b >= a && b > c;
    const isLow = b <= a && b < c;
    if (!isHigh && !isLow) continue;
    const denom = a - 2 * b + c;
    const offset = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    const hour = parseInt(times[i].slice(11, 13), 10) + offset;
    const hh = Math.floor(((hour % 24) + 24) % 24);
    const mm = Math.round((hour - Math.floor(hour)) * 60);
    out.push({
      time: times[i],
      type: isHigh ? "high" : "low",
      height: b,
      label: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    });
  }
  return out;
}

// Hora local del spot en formato ISO corto ("YYYY-MM-DDTHH")
function nowIsoLocal() {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: TZ })
    .replace(" ", "T")
    .slice(0, 13);
}

// ---------- Construcción del estado a partir del JSON crudo ----------
// Separado de load() para poder reutilizarlo con la caché offline.
function buildForecast(m, w) {
  const times = m.hourly.time;
  const sea = m.hourly.sea_level_height_msl || null;

  // Alinear viento por TIMESTAMP (no por índice): si alguna API
  // devuelve series de largo distinto, no se corren los datos.
  const windIdx = {};
  (w.hourly.time || []).forEach((tt, i) => (windIdx[tt] = i));

  const rows = times.map((time, i) => {
    const wi = windIdx[time];
    const waveM = m.hourly.wave_height[i];
    const period =
      m.hourly.swell_wave_peak_period[i] ??
      m.hourly.swell_wave_period[i] ??
      m.hourly.wave_period[i];
    const windFrom = wi != null ? w.hourly.wind_direction_10m[wi] : null;
    const q = windFrom == null ? "crossoff" : windQuality(windFrom, SPOT.coastFacing);
    const hFt = mToFt(waveM);
    // Tendencia de marea: hacia dónde va en la próxima hora
    let tideTrend = null;
    if (sea && sea[i] != null) {
      const next = sea[i + 1] != null ? sea[i + 1] : sea[i];
      const prev = sea[i - 1] != null ? sea[i - 1] : sea[i];
      const delta = sea[i + 1] != null ? next - sea[i] : sea[i] - prev;
      tideTrend = delta >= 0 ? "rising" : "falling";
    }
    return {
      time,
      date: time.slice(0, 10),
      hour: parseInt(time.slice(11, 13), 10),
      waveM,
      waveFt: hFt,
      swellM: m.hourly.swell_wave_height[i],
      period,
      waveDir: m.hourly.wave_direction[i],
      swellDir: m.hourly.swell_wave_direction[i],
      sst: m.hourly.sea_surface_temperature[i],
      tide: sea ? sea[i] : null,
      tideTrend,
      windKn: wi != null ? w.hourly.wind_speed_10m[wi] : null,
      windFrom,
      gustKn: wi != null ? w.hourly.wind_gusts_10m[wi] : null,
      airTemp: wi != null ? w.hourly.temperature_2m[wi] : null,
      quality: q,
      verdict: verdict(hFt, period, q),
    };
  });

  // Agrupar por día. El resumen del día es su MEJOR VENTANA de luz
  // (6–18 h): mejor veredicto y, a igual veredicto, más ola. Antes se
  // usaba la hora de más ola, que podía ser una tarde onshore y hacía
  // ver el día peor que su mejor momento real.
  const byDate = {};
  rows.forEach((r) => {
    (byDate[r.date] = byDate[r.date] || []).push(r);
  });
  const days = Object.keys(byDate)
    .sort()
    .slice(0, 7)
    .map((date) => {
      const all = byDate[date];
      const daylight = all.filter((r) => r.hour >= 6 && r.hour <= 18);
      const pool = daylight.length ? daylight : all;
      const maxWave = Math.max(...pool.map((r) => r.waveFt ?? 0));
      const best = pool.reduce((a, b) => {
        const ra = VERDICT_RANK[a.verdict], rb = VERDICT_RANK[b.verdict];
        if (rb !== ra) return rb > ra ? b : a;
        return (b.waveFt ?? 0) > (a.waveFt ?? 0) ? b : a;
      }, pool[0]);
      const avgWind =
        pool.reduce((s, r) => s + (r.windKn ?? 0), 0) / pool.length;
      return {
        date,
        maxWaveFt: maxWave,
        best,
        avgWindKn: avgWind,
        verdict: best.verdict,
        quality: best.quality,
        period: best.period,
        swellDir: best.swellDir,
        energy: waveEnergy(best.waveM, best.period),
        hours: all,
      };
    });

  const nowIso = nowIsoLocal();
  const nowRow = rows.find((r) => r.time.slice(0, 13) >= nowIso) || rows[0];

  // Próximo extremo de marea desde "ahora"
  const extremes = tideExtremes(times, sea);
  const nextTide =
    extremes.find((e) => e.time.slice(0, 13) >= nowIso) || null;

  return { now: nowRow, days, nextTide, hasTide: !!sea };
}

export default function App() {
  const [lang, setLang] = useState("es");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [staleH, setStaleH] = useState(null); // horas de antigüedad si mostramos caché
  const [openDay, setOpenDay] = useState(0);
  const t = T[lang];

  async function load() {
    setStatus("loading");
    setStaleH(null);
    // Timeout: si en 12s no responde, cortamos y mostramos error (no colgar para siempre)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      // Los datos se piden a NUESTRO proxy en Vercel (no directo a Open-Meteo),
      // para esquivar bloqueos de región y aprovechar caché.
      const res = await fetch(
        `/api/forecast?lat=${SPOT.sampleLat}&lon=${SPOT.sampleLon}`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error("bad response");
      const { marine: m, wind: w } = await res.json();
      if (!m || !w || !m.hourly || !w.hourly) throw new Error("bad data");

      // Guardar el crudo para modo offline (playa sin señal)
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ ts: Date.now(), marine: m, wind: w })
        );
      } catch (_) {}

      setData(buildForecast(m, w));
      setStatus("ok");
    } catch (e) {
      // Sin red o respuesta mala: intentar el último pronóstico bueno
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const { ts, marine: m, wind: w } = JSON.parse(raw);
          const ageH = (Date.now() - ts) / 3600000;
          if (ageH < CACHE_MAX_AGE_H && m?.hourly && w?.hourly) {
            setData(buildForecast(m, w));
            setStaleH(Math.max(1, Math.round(ageH)));
            setStatus("ok");
            clearTimeout(timer);
            return;
          }
        }
      } catch (_) {}
      setStatus("error");
    } finally {
      clearTimeout(timer);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const verdictWord = (v) =>
    ({
      flat: t.verdictFlat,
      tiny: t.verdictTiny,
      ride: t.verdictRide,
      good: t.verdictGood,
      epic: t.verdictEpic,
    }[v]);

  const qualityWord = (q) =>
    ({
      clean: t.clean,
      crossoff: t.crossoff,
      cross: t.cross,
      onshore: t.onshore,
    }[q]);

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Inter:wght@400;500;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    .ps-root {
      font-family: 'Inter', system-ui, sans-serif;
      background:
        radial-gradient(120% 80% at 50% -10%, #14495a 0%, ${PALETTE.ink} 55%, #051821 100%);
      color: ${PALETTE.foam};
      min-height: 100vh; width: 100%;
      padding: 22px 18px 40px;
    }
    .ps-wrap { max-width: 460px; margin: 0 auto; }
    .ps-eyebrow {
      font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase;
      color: ${PALETTE.aqua}; font-weight: 600; display:flex;
      align-items:center; gap:8px;
    }
    .ps-eyebrow::after { content:''; flex:1; height:1px; background:${PALETTE.line}; }
    .ps-title {
      font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800;
      font-size: clamp(30px, 9vw, 42px); line-height: 0.98; margin-top: 10px;
      letter-spacing: -0.02em;
    }
    .ps-title .slash { color: ${PALETTE.teal}; }
    .ps-hero {
      margin-top: 22px; border-radius: 22px; padding: 22px 20px 20px;
      background: linear-gradient(165deg, ${PALETTE.card} 0%, #0a2a35 100%);
      border: 1px solid ${PALETTE.line};
      position: relative; overflow: hidden;
    }
    .ps-hero::before {
      content:''; position:absolute; inset:0;
      background:
        repeating-linear-gradient(115deg, transparent 0 34px, rgba(54,197,214,0.05) 34px 35px);
      pointer-events:none;
    }
    .ps-stale {
      display:inline-block; margin-bottom:10px; font-size:11px; font-weight:600;
      color:${PALETTE.gold}; background:rgba(244,183,64,0.12);
      border:1px solid rgba(244,183,64,0.35);
      padding:5px 10px; border-radius:999px;
    }
    .ps-nowtag {
      font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
      color: ${PALETTE.muted}; font-weight: 600;
    }
    .ps-verdict {
      font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800;
      font-size: clamp(46px, 16vw, 76px); line-height: 0.9; margin: 4px 0 2px;
      letter-spacing: -0.03em;
    }
    .ps-heroline { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
    .ps-bigwave {
      font-family:'Bricolage Grotesque',sans-serif; font-weight:700;
      font-size: 30px; letter-spacing:-0.02em;
    }
    .ps-bigwave small { font-size: 14px; color:${PALETTE.muted}; font-weight:500; margin-left:3px;}
    .ps-chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
    .ps-quality {
      display:inline-flex; align-items:center; gap:7px;
      font-size: 13px; font-weight:600; padding: 7px 12px; border-radius: 999px;
      background: rgba(255,255,255,0.05);
    }
    .ps-ebar { display:inline-flex; gap:3px; margin-left:2px; }
    .ps-ebar i { width:6px; height:12px; border-radius:2px; display:block; }
    .ps-dot { width:8px; height:8px; border-radius:50%; }
    .ps-stats {
      display:grid; grid-template-columns: repeat(4, 1fr); gap:1px;
      margin-top:18px; border-radius:14px; overflow:hidden;
      background:${PALETTE.line};
    }
    .ps-stat { background:${PALETTE.ink2}; padding:12px 8px; text-align:center; }
    .ps-stat .k { font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${PALETTE.muted}; }
    .ps-stat .v { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:18px; margin-top:3px;}
    .ps-stat .u { font-size:10px; color:${PALETTE.muted}; }
    .ps-section { margin-top:30px; }
    .ps-sechead { display:flex; align-items:baseline; justify-content:space-between; }
    .ps-sechead h2 {
      font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:17px;
      letter-spacing:0.01em;
    }
    .ps-sechead span { font-size:11px; color:${PALETTE.muted}; }
    .ps-day {
      margin-top:10px; border:1px solid ${PALETTE.line}; border-radius:16px;
      overflow:hidden; background:${PALETTE.ink2};
    }
    .ps-dayhead {
      display:grid; grid-template-columns: 56px 1fr auto; align-items:center;
      gap:12px; padding:14px 16px; cursor:pointer;
    }
    .ps-dayname { font-weight:700; font-size:14px; }
    .ps-daydate { font-size:11px; color:${PALETTE.muted}; }
    .ps-daybar { height:8px; border-radius:6px; background:rgba(255,255,255,0.07); position:relative; }
    .ps-daybar i { position:absolute; left:0; top:0; bottom:0; border-radius:6px; }
    .ps-dayverdict {
      font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:13px;
      text-align:right; min-width:78px;
    }
    .ps-daysub { font-size:11px; color:${PALETTE.muted}; font-weight:500; }
    .ps-hours { border-top:1px solid ${PALETTE.line}; padding: 6px 6px 10px; }
    .ps-hr {
      display:grid; grid-template-columns: 52px 1fr 56px 66px; gap:8px;
      align-items:center; padding:8px 10px; font-size:12px;
    }
    .ps-hr + .ps-hr { border-top:1px solid rgba(234,246,244,0.05); }
    .ps-hr .hh { color:${PALETTE.muted}; font-weight:600; }
    .ps-hr .hh .td { color:${PALETTE.aqua}; font-weight:700; }
    .ps-hr .wv { font-family:'Bricolage Grotesque',sans-serif; font-weight:700; }
    .ps-hr .wd { text-align:right; color:${PALETTE.foam}; }
    .ps-hr .qb { width:8px;height:8px;border-radius:50%; display:inline-block; margin-right:5px;}
    .ps-foot { margin-top:26px; font-size:11px; color:${PALETTE.muted}; line-height:1.55; }
    .ps-foot b { color:${PALETTE.sand}; font-weight:600; }
    .ps-credit {
      margin-top:22px; padding-top:20px; border-top:1px solid ${PALETTE.line};
      text-align:center;
    }
    .ps-credit-by { font-size:12px; color:${PALETTE.muted}; letter-spacing:0.02em; }
    .ps-credit-by b { color:${PALETTE.foam}; font-weight:700; }
    .ps-credit-link {
      display:inline-flex; align-items:center; gap:6px; margin-top:12px;
      font-size:12px; font-weight:700; letter-spacing:0.04em;
      color:${PALETTE.ink}; background:${PALETTE.teal};
      padding:9px 18px; border-radius:999px; text-decoration:none;
    }
    .ps-lang {
      position: sticky; top:0; float:right; display:flex; gap:2px;
      background:${PALETTE.ink2}; border:1px solid ${PALETTE.line};
      border-radius:999px; padding:3px; margin-bottom:-30px;
    }
    .ps-lang button {
      border:none; background:transparent; color:${PALETTE.muted};
      font-size:11px; font-weight:700; padding:5px 11px; border-radius:999px;
      cursor:pointer; font-family:inherit;
    }
    .ps-lang button.on { background:${PALETTE.teal}; color:${PALETTE.ink}; }
    .ps-center { text-align:center; padding:60px 0; color:${PALETTE.muted}; }
    .ps-spin {
      width:34px;height:34px;border-radius:50%; margin:0 auto 16px;
      border:3px solid rgba(255,255,255,0.12); border-top-color:${PALETTE.aqua};
      animation: ps-rot 0.9s linear infinite;
    }
    @keyframes ps-rot { to { transform: rotate(360deg); } }
    .ps-btn {
      margin-top:14px; background:${PALETTE.teal}; color:${PALETTE.ink};
      border:none; padding:10px 20px; border-radius:999px; font-weight:700;
      font-family:inherit; cursor:pointer; font-size:13px;
    }
    @media (prefers-reduced-motion: reduce) { .ps-spin { animation:none; } }
  `;

  const now = data?.now;

  function WindCompass({ windFrom, quality, size = 86 }) {
    const r = size / 2;
    const facing = SPOT.coastFacing;
    // viento sopla HACIA (windFrom + 180)
    const blowTo = ((windFrom ?? 0) + 180) % 360;
    const rad = (deg) => ((deg - 90) * Math.PI) / 180;
    const x2 = r + Math.cos(rad(blowTo)) * (r - 16);
    const y2 = r + Math.sin(rad(blowTo)) * (r - 16);
    // costa al frente (facing)
    const cx = r + Math.cos(rad(facing)) * (r - 6);
    const cy = r + Math.sin(rad(facing)) * (r - 6);
    const c = qualityColor(quality);
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={r} cy={r} r={r - 3} fill="none" stroke={PALETTE.line} strokeWidth="2" />
        {/* línea de costa */}
        <line x1={r} y1={r} x2={cx} y2={cy} stroke={PALETTE.sand} strokeWidth="3" strokeLinecap="round" opacity="0.5" />
        <circle cx={cx} cy={cy} r="3" fill={PALETTE.sand} opacity="0.7" />
        {/* flecha viento */}
        <line x1={r} y1={r} x2={x2} y2={y2} stroke={c} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx={x2} cy={y2} r="4.5" fill={c} />
        <circle cx={r} cy={r} r="3" fill={PALETTE.foam} />
      </svg>
    );
  }

  return (
    <div className="ps-root">
      <style>{css}</style>
      <div className="ps-wrap">
        <div className="ps-lang">
          <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
          <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
        </div>

        <div className="ps-eyebrow">{SPOT.area}</div>
        <h1 className="ps-title">
          Don Gregorio <span className="slash">/</span> Ponketa
        </h1>

        {status === "loading" && (
          <div className="ps-center">
            <div className="ps-spin" />
            {t.loading}
          </div>
        )}

        {status === "error" && (
          <div className="ps-center">
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, color: PALETTE.foam }}>
              {t.errorTitle}
            </div>
            <div style={{ marginTop: 6 }}>{t.errorBody}</div>
            <button className="ps-btn" onClick={load}>{t.retry}</button>
          </div>
        )}

        {status === "ok" && now && (
          <>
            <div className="ps-hero">
              {staleH != null && (
                <div className="ps-stale">{t.stale.replace("{h}", staleH)}</div>
              )}
              <div className="ps-nowtag">{t.now}</div>
              <div className="ps-verdict" style={{ color: verdictColor(now.verdict) }}>
                {verdictWord(now.verdict)}
              </div>
              <div className="ps-heroline" style={{ justifyContent: "space-between" }}>
                <div className="ps-bigwave">
                  {now.waveFt != null ? now.waveFt.toFixed(1) : "—"}
                  <small> {t.feet}</small>
                  <span style={{ color: PALETTE.muted, fontSize: 14, fontWeight: 500, marginLeft: 8 }}>
                    {now.waveM != null ? `${now.waveM.toFixed(1)}m` : ""}
                  </span>
                </div>
                <WindCompass windFrom={now.windFrom} quality={now.quality} />
              </div>

              <div className="ps-chips">
                <div className="ps-quality" style={{ color: qualityColor(now.quality) }}>
                  <span className="ps-dot" style={{ background: qualityColor(now.quality) }} />
                  {qualityWord(now.quality)} · {now.windKn != null ? Math.round(now.windKn) : "—"} kn {dirLabel(now.windFrom)}
                </div>
                {data.hasTide && now.tideTrend && (
                  <div className="ps-quality" style={{ color: PALETTE.foam }}>
                    <span style={{ color: PALETTE.aqua, fontWeight: 800 }}>
                      {now.tideTrend === "rising" ? "↑" : "↓"}
                    </span>
                    {t.tide} {now.tideTrend === "rising" ? t.rising : t.falling}
                    {data.nextTide && (
                      <span style={{ color: PALETTE.muted }}>
                        · {data.nextTide.type === "high" ? t.highTide : t.lowTide} ~{data.nextTide.label}
                      </span>
                    )}
                  </div>
                )}
                {(() => {
                  const en = waveEnergy(now.waveM, now.period);
                  if (!en) return null;
                  return (
                    <div className="ps-quality" style={{ color: energyColor(en.level) }}>
                      {t.energy}: {t[en.key]}
                      <span className="ps-ebar">
                        {[0, 1, 2, 3].map((i) => (
                          <i
                            key={i}
                            style={{
                              background:
                                i <= en.level ? energyColor(en.level) : "rgba(234,246,244,0.15)",
                            }}
                          />
                        ))}
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div className="ps-stats">
                <div className="ps-stat">
                  <div className="k">{t.period}</div>
                  <div className="v">{now.period != null ? now.period.toFixed(0) : "—"}<span className="u">s</span></div>
                </div>
                <div className="ps-stat">
                  <div className="k">{t.swell}</div>
                  <div className="v">{dirLabel(now.swellDir)}</div>
                </div>
                <div className="ps-stat">
                  <div className="k">{t.gust}</div>
                  <div className="v">{now.gustKn != null ? Math.round(now.gustKn) : "—"}<span className="u">kn</span></div>
                </div>
                <div className="ps-stat">
                  <div className="k">{t.water}</div>
                  <div className="v">{now.sst != null ? now.sst.toFixed(0) : "—"}<span className="u">°C</span></div>
                </div>
              </div>
            </div>

            <div className="ps-section">
              <div className="ps-sechead">
                <h2>{t.nextDays}</h2>
                <span>{t.tapDay}</span>
              </div>

              {data.days.map((d, idx) => {
                const dt = new Date(d.date + "T12:00:00");
                const dayName = idx === 0 ? t.today2 : t.days[dt.getDay()];
                const barW = Math.min(100, (d.maxWaveFt / 6) * 100);
                const open = openDay === idx;
                return (
                  <div className="ps-day" key={d.date}>
                    <div className="ps-dayhead" onClick={() => setOpenDay(open ? -1 : idx)}>
                      <div>
                        <div className="ps-dayname">{dayName}</div>
                        <div className="ps-daydate">
                          {dt.getDate()}/{dt.getMonth() + 1}
                        </div>
                      </div>
                      <div>
                        <div className="ps-daybar">
                          <i style={{ width: `${barW}%`, background: verdictColor(d.verdict) }} />
                        </div>
                        <div className="ps-daysub" style={{ marginTop: 6 }}>
                          {d.maxWaveFt.toFixed(1)} {t.feet} · {d.period?.toFixed(0)}s ·{" "}
                          <span style={{ color: qualityColor(d.quality) }}>{qualityWord(d.quality)}</span>
                          {d.energy && (
                            <>
                              {" "}·{" "}
                              <span style={{ color: energyColor(d.energy.level) }}>
                                {t.energy.toLowerCase()} {t[d.energy.key].toLowerCase()}
                              </span>
                            </>
                          )}
                          {" "}· {t.best} ~{String(d.best.hour).padStart(2, "0")}h
                        </div>
                      </div>
                      <div className="ps-dayverdict" style={{ color: verdictColor(d.verdict) }}>
                        {verdictWord(d.verdict)}
                      </div>
                    </div>

                    {open && (
                      <div className="ps-hours">
                        {d.hours.map((h) => (
                          <div className="ps-hr" key={h.time}>
                            <span className="hh">
                              {String(h.hour).padStart(2, "0")}h
                              {h.tideTrend && (
                                <span className="td"> {h.tideTrend === "rising" ? "↑" : "↓"}</span>
                              )}
                            </span>
                            <span>
                              <span className="qb" style={{ background: qualityColor(h.quality) }} />
                              <span style={{ color: PALETTE.muted }}>
                                {h.windKn != null ? Math.round(h.windKn) : "—"}kn {dirLabel(h.windFrom)}
                              </span>
                            </span>
                            <span className="wv" style={{ color: verdictColor(h.verdict) }}>
                              {h.waveFt != null ? h.waveFt.toFixed(1) : "—"}{t.feet}
                            </span>
                            <span className="wd">{h.period != null ? h.period.toFixed(0) : "—"}s {dirLabel(h.swellDir)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="ps-foot">
              <b>{SPOT.name}</b> · {SPOT.lat}, {SPOT.lon}<br />
              {t.estimate}<br />
              {data.hasTide && <>{t.tideNote}<br /></>}
              {t.source}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
