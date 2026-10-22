// ============================================================================
//  src/servicios/clima.js — API de clima para eventos al aire libre
//
//  ¿Para qué? En el Valle Sagrado llueve fuerte entre noviembre y marzo. Si
//  el evento es al aire libre y se espera lluvia, el recomendador agrega un
//  toldo para proteger consola y equipos, y se lo avisa al cliente.
//
//  Proveedores:
//   • OpenWeather (si hay OPENWEATHER_API_KEY): pronóstico cada 3 h hasta
//     5 días adelante. Es la API que menciona el docente en sus ejemplos.
//   • Open-Meteo (sin clave, gratis): pronóstico diario hasta 16 días.
//   • Más lejos que eso nadie puede pronosticar: damos un aviso por temporada.
// ============================================================================

const cache = new Map();

// Meses de lluvia en Cusco (0 = enero).
const MESES_LLUVIA = [0, 1, 2, 10, 11];

async function pedirJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const diasHasta = fecha => Math.round((new Date(`${fecha}T12:00:00-05:00`) - Date.now()) / 86400000);

async function openWeather(lat, lng, fecha) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&units=metric&lang=es&appid=${process.env.OPENWEATHER_API_KEY}`;
  const datos = await pedirJSON(url);
  // dt_txt viene en UTC: Lima es UTC−5, así que convertimos antes de filtrar por día.
  const delDia = datos.list.filter(p => new Date((p.dt - 5 * 3600) * 1000).toISOString().slice(0, 10) === fecha);
  if (!delDia.length) return null;
  return {
    fuente: 'OpenWeather',
    temp_min: Math.round(Math.min(...delDia.map(p => p.main.temp_min))),
    temp_max: Math.round(Math.max(...delDia.map(p => p.main.temp_max))),
    prob_lluvia: Math.round(Math.max(...delDia.map(p => p.pop || 0)) * 100),
    resumen: delDia[Math.floor(delDia.length / 2)].weather[0].description
  };
}

const CODIGOS_WMO = { 0: 'despejado', 1: 'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado', 45: 'neblina', 51: 'llovizna', 61: 'lluvia ligera', 63: 'lluvia', 65: 'lluvia fuerte', 80: 'chubascos', 81: 'chubascos', 82: 'chubascos fuertes', 95: 'tormenta' };

async function openMeteo(lat, lng, fecha) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=America%2FLima&start_date=${fecha}&end_date=${fecha}`;
  const d = (await pedirJSON(url)).daily;
  if (!d?.time?.length) return null;
  return {
    fuente: 'Open-Meteo',
    temp_min: Math.round(d.temperature_2m_min[0]),
    temp_max: Math.round(d.temperature_2m_max[0]),
    prob_lluvia: d.precipitation_probability_max[0] ?? null,
    resumen: CODIGOS_WMO[d.weathercode[0]] || 'variable'
  };
}

// Devuelve { disponible, fuente, temp_min, temp_max, prob_lluvia, resumen, aviso, lluvia_probable }
async function pronostico({ lat, lng, fecha }) {
  if (!fecha || !Number.isFinite(lat) || !Number.isFinite(lng)) return { disponible: false };
  const clave = `${lat.toFixed(2)},${lng.toFixed(2)}@${fecha}`;
  const guardado = cache.get(clave);
  if (guardado && Date.now() - guardado.t < 60 * 60 * 1000) return guardado.v;

  const dias = diasHasta(fecha);
  let p = null;
  try {
    if (dias >= 0 && dias <= 4 && process.env.OPENWEATHER_API_KEY) p = await openWeather(lat, lng, fecha);
    if (!p && dias >= 0 && dias <= 15) p = await openMeteo(lat, lng, fecha);
  } catch (err) {
    console.warn('[clima] no disponible:', err.message);
  }

  const mes = new Date(`${fecha}T12:00:00-05:00`).getMonth();
  const temporadaLluvias = MESES_LLUVIA.includes(mes);
  let resultado;
  if (p) {
    const lluvia = (p.prob_lluvia ?? 0) >= 40;
    resultado = {
      disponible: true, ...p, lluvia_probable: lluvia,
      aviso: lluvia ? `Se espera ${p.resumen} (${p.prob_lluvia}% de probabilidad de lluvia). Si es al aire libre, llevamos toldo para proteger los equipos.` : `Pronóstico: ${p.resumen}, entre ${p.temp_min} °C y ${p.temp_max} °C.`
    };
  } else {
    resultado = {
      disponible: false, fuente: 'temporada', lluvia_probable: temporadaLluvias,
      aviso: temporadaLluvias
        ? 'Tu fecha cae en temporada de lluvias en Cusco (nov–mar). El pronóstico exacto estará disponible unos días antes; para eventos al aire libre recomendamos toldo.'
        : 'Tu fecha está en temporada seca, pero en las noches del Valle hace frío: considera la hora de montaje.'
    };
  }
  cache.set(clave, { t: Date.now(), v: resultado });
  return resultado;
}

module.exports = { pronostico };
