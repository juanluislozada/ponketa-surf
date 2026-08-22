// Proxy de datos para Ponketa Surf.
// Corre en los servidores de Vercel (no en el teléfono del usuario),
// así que pide el pronóstico a Open-Meteo sin depender de la red local
// de República Dominicana. Guarda en caché la última respuesta buena.
//
// v2 — cambios:
// - Se pide también `sea_level_height_msl` (marea, modelo Copernicus SMOC).
// - `cell_selection=sea` en la Marine API: fuerza celda de agua, refuerza
//   la estrategia del punto de muestreo mar adentro.
// - Las coordenadas recibidas se LIMITAN a una caja alrededor del spot.
//   Antes el endpoint era un proxy abierto: cualquiera podía usarlo para
//   pedir pronósticos de cualquier punto del planeta con tu cuota.

export default async function handler(req, res) {
  // Coordenadas del punto de muestreo (mar adentro, sobre el peak).
  // Se reciben desde la app; si no llegan o salen de la caja permitida,
  // se usa el valor por defecto del spot.
  const DEFAULT_LAT = 18.224;
  const DEFAULT_LON = -70.1977;
  // Caja permitida: costa sur dominicana alrededor de Nizao (~±30 km).
  const clamp = (v, min, max, fallback) =>
    Number.isFinite(v) && v >= min && v <= max ? v : fallback;

  const lat = clamp(Number(req.query.lat), 17.9, 18.5, DEFAULT_LAT);
  const lon = clamp(Number(req.query.lon), -70.6, -69.8, DEFAULT_LON);
  const tz = "America/Santo_Domingo";

  const marineUrl =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}` +
    `&longitude=${lon}` +
    `&hourly=wave_height,wave_direction,wave_period,swell_wave_height,` +
    `swell_wave_direction,swell_wave_period,swell_wave_peak_period,` +
    `sea_surface_temperature,sea_level_height_msl` +
    `&cell_selection=sea` +
    `&timezone=${encodeURIComponent(tz)}&forecast_days=7`;

  const windUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}` +
    `&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m` +
    `&wind_speed_unit=kn&timezone=${encodeURIComponent(tz)}&forecast_days=7`;

  // Timeout de 9s por si Open-Meteo tarda.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const [marineRes, windRes] = await Promise.all([
      fetch(marineUrl, { signal: controller.signal }),
      fetch(windUrl, { signal: controller.signal }),
    ]);

    if (!marineRes.ok || !windRes.ok) {
      return res.status(502).json({ error: "upstream_error" });
    }

    const [marine, wind] = await Promise.all([
      marineRes.json(),
      windRes.json(),
    ]);

    // Caché en el borde de Vercel: 30 min fresco, 1h sirviendo mientras revalida.
    res.setHeader(
      "Cache-Control",
      "s-maxage=1800, stale-while-revalidate=3600"
    );
    return res.status(200).json({ marine, wind });
  } catch (e) {
    return res.status(504).json({ error: "timeout_or_network" });
  } finally {
    clearTimeout(timer);
  }
}
