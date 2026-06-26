import React, { useState, useEffect, useMemo } from "react";

/*
  ============================================================
  PONKETA SURF — Pronóstico para Don Gregorio / Ponketa, Nizao
  ============================================================
  AJUSTA AQUÍ EL PIN EXACTO DEL SPOT:
  - Coordenadas estimadas de la desembocadura del río Nizao
    (Don Gregorio / Ponketa). Cámbialas por el punto real.
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
    source: "Datos: Open-Meteo Marine · modelo global de oleaje",
    estimate:
      "Estimación del modelo offshore. En un beachbreak de desembocadura la marea y los bancos de arena mandan: confirma en el agua.",
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
    source: "Data: Open-Meteo Marine · global wave model",
    estimate:
      "Offshore model estimate. At a river-mouth beachbreak, tide and sandbars rule: confirm in the water.",
    feet: "ft",
    today2: "Today",
    days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    createdBy: "App created by",
    visitSite: "Visit site",
  },
};

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const dirLabel = (deg) =>
  deg == null ? "—" : DIRS[Math.round(((deg % 360) / 45)) % 8];

const mToFt = (m) => (m == null ? null : m * 3.28084);

// Ángulo más corto entre dos rumbos (0-180)
function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Calidad del viento relativa a la orientación de la playa.
// El viento "viene de" windFrom. Offshore = viene de tierra
// = del rumbo opuesto al que mira la playa.
function windQuality(windFrom, coastFacing) {
  const offshoreSource = (coastFacing + 180) % 360; // de dónde viene el offshore puro
  const d = angleDiff(windFrom, offshoreSource); // 0 = offshore puro, 180 = onshore puro
  if (d <= 35) return "clean"; // offshore, limpio
  if (d <= 70) return "crossoff"; // cross-offshore (de lado, sopla hacia afuera) — favorable
  if (d <= 130) return "cross"; // cruzado / sideshore (E)
  return "onshore"; // onshore, sucio (SE/S)
}

// Veredicto realista: el PERIODO manda. Periodo corto = ola de viento
// (floja y desordenada) y limita el veredicto aunque haya tamaño.
// El viento limpio/sucio ajusta. Lo épico se reserva para tamaño + groundswell.
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
  if (p < 6) qual = 0; // ola de viento, floja
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

  // Topes realistas
  if (p < 6 && (v === "good" || v === "epic")) v = "ride"; // periodo muy corto: máx surfeable
  if (p < 8 && v === "epic") v = "good"; // corto: no épico
  if (quality === "onshore" && v === "epic") v = "good"; // onshore: no épico
  if (v === "epic" && size < 4) v = "good"; // épico necesita tamaño real
  return v;
}

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

export default function App() {
  const [lang, setLang] = useState("es");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [openDay, setOpenDay] = useState(0);
  const t = T[lang];

  async function load() {
    setStatus("loading");
    try {
      const tz = "America/Santo_Domingo";
      const marineUrl =
        `https://marine-api.open-meteo.com/v1/marine?latitude=${SPOT.sampleLat}` +
        `&longitude=${SPOT.sampleLon}` +
        `&hourly=wave_height,wave_direction,wave_period,swell_wave_height,` +
        `swell_wave_direction,swell_wave_period,swell_wave_peak_period,sea_surface_temperature` +
        `&timezone=${encodeURIComponent(tz)}&forecast_days=7`;
      const windUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${SPOT.sampleLat}` +
        `&longitude=${SPOT.sampleLon}` +
        `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m` +
        `&wind_speed_unit=kn&timezone=${encodeURIComponent(tz)}&forecast_days=7`;

      const [mRes, wRes] = await Promise.all([
        fetch(marineUrl),
        fetch(windUrl),
      ]);
      if (!mRes.ok || !wRes.ok) throw new Error("bad response");
      const m = await mRes.json();
      const w = await wRes.json();

      const times = m.hourly.time;
      const rows = times.map((time, i) => {
        const waveM = m.hourly.wave_height[i];
        const swellM = m.hourly.swell_wave_height[i];
        const period =
          m.hourly.swell_wave_peak_period[i] ??
          m.hourly.swell_wave_period[i] ??
          m.hourly.wave_period[i];
        const windFrom = w.hourly.wind_direction_10m[i];
        const q = windFrom == null ? "crossoff" : windQuality(windFrom, SPOT.coastFacing);
        const hFt = mToFt(waveM);
        return {
          time,
          date: time.slice(0, 10),
          hour: parseInt(time.slice(11, 13), 10),
          waveM,
          waveFt: hFt,
          swellM,
          period,
          waveDir: m.hourly.wave_direction[i],
          swellDir: m.hourly.swell_wave_direction[i],
          sst: m.hourly.sea_surface_temperature[i],
          windKn: w.hourly.wind_speed_10m[i],
          windFrom,
          gustKn: w.hourly.wind_gusts_10m[i],
          airTemp: w.hourly.temperature_2m[i],
          quality: q,
          verdict: verdict(hFt, period, q),
        };
      });

      // Agrupar por día y resumir horas de luz (6–18)
      const byDate = {};
      rows.forEach((r) => {
        (byDate[r.date] = byDate[r.date] || []).push(r);
      });
      const days = Object.keys(byDate)
        .sort()
        .slice(0, 7)
        .map((date) => {
          const all = byDate[date];
          const day = all.filter((r) => r.hour >= 6 && r.hour <= 18);
          const pool = day.length ? day : all;
          const maxWave = Math.max(...pool.map((r) => r.waveFt ?? 0));
          const peak = pool.reduce(
            (a, b) => ((b.waveFt ?? 0) > (a.waveFt ?? 0) ? b : a),
            pool[0]
          );
          const avgWind =
            pool.reduce((s, r) => s + (r.windKn ?? 0), 0) / pool.length;
          return {
            date,
            maxWaveFt: maxWave,
            peak,
            avgWindKn: avgWind,
            verdict: peak.verdict,
            quality: peak.quality,
            period: peak.period,
            swellDir: peak.swellDir,
            hours: all,
          };
        });

      const nowIso = new Date()
        .toLocaleString("sv-SE", { timeZone: tz })
        .replace(" ", "T")
        .slice(0, 13);
      let nowRow =
        rows.find((r) => r.time.slice(0, 13) >= nowIso) || rows[0];

      setData({ now: nowRow, days });
      setStatus("ok");
    } catch (e) {
      setStatus("error");
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
    .ps-quality {
      display:inline-flex; align-items:center; gap:7px; margin-top:14px;
      font-size: 13px; font-weight:600; padding: 7px 12px; border-radius: 999px;
      background: rgba(255,255,255,0.05);
    }
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
      display:grid; grid-template-columns: 46px 1fr 56px 60px; gap:8px;
      align-items:center; padding:8px 10px; font-size:12px;
    }
    .ps-hr + .ps-hr { border-top:1px solid rgba(234,246,244,0.05); }
    .ps-hr .hh { color:${PALETTE.muted}; font-weight:600; }
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
              <div className="ps-quality" style={{ color: qualityColor(now.quality) }}>
                <span className="ps-dot" style={{ background: qualityColor(now.quality) }} />
                {qualityWord(now.quality)} · {now.windKn != null ? Math.round(now.windKn) : "—"} kn {dirLabel(now.windFrom)}
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
                          {d.maxWaveFt.toFixed(1)} {t.feet} · {d.period?.toFixed(0)}s · {Math.round(d.avgWindKn)}kn ·{" "}
                          <span style={{ color: qualityColor(d.quality) }}>{qualityWord(d.quality)}</span>
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
                            <span className="hh">{String(h.hour).padStart(2, "0")}h</span>
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
              {t.source}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
