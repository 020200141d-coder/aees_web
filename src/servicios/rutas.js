// ============================================================================
//  src/servicios/rutas.js — API de mapas: buscar lugares y calcular la ruta
//
//  API 1 del proyecto (rol "mapa / rutas" de los ejemplos del docente).
//
//  • Geocodificar ("Urubamba" → lat/lng): Nominatim de OpenStreetMap.
//    Gratis, sin clave; su política exige identificarse con User-Agent y
//    no pasar de 1 petición por segundo, por eso cacheamos resultados.
//  • Ruta (almacén → lugar del evento): distancia y tiempo REALES por
//    carretera, no en línea recta.
//      1. OpenRouteService si hay ORS_API_KEY (gratis con registro).
//      2. Si no, el servidor público de OSRM (sin clave, uso moderado).
//      3. Si ambos fallan: línea recta × 1.35 (factor típico de carreteras de
//         sierra) y lo marcamos como "estimado".
//  • El link para el conductor usa Google Maps por URL (no necesita clave).
//
//  Todo pasa por nuestro servidor (no desde el navegador) para poder poner
//  caché, ocultar claves y cambiar de proveedor sin tocar el front.
// ============================================================================

const AGENTE = 'AeeS-Acustico-Web/1.0 (reservas de equipos, Cusco)';
const cache = new Map();

async function pedirJSON(url, opciones = {}) {
  const res = await fetch(url, { ...opciones, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).host}`);
  return res.json();
}

function enCache(clave, crear) {
  if (cache.has(clave)) return cache.get(clave);
  const promesa = crear().catch(err => { cache.delete(clave); throw err; });
  cache.set(clave, promesa);
  return promesa;
}

// Busca lugares dando prioridad a la región Cusco (viewbox), dentro de Perú.
function geocodificar(consulta) {
  const q = String(consulta || '').trim().slice(0, 120);
  if (q.length < 3) return Promise.resolve([]);
  return enCache(`geo:${q.toLowerCase()}`, async () => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      q, format: 'jsonv2', countrycodes: 'pe', limit: '5', 'accept-language': 'es',
      viewbox: '-73.2,-12.4,-70.6,-14.6', bounded: '0'
    });
    const datos = await pedirJSON(url, { headers: { 'User-Agent': AGENTE } });
    // Primero los lugares reales (pueblos, calles, locales) y al final los límites
    // administrativos: "Calca" como provincia tiene su centro en plena selva, a 130 km,
    // mientras que el pueblo de Calca está a ~50 km. El orden de Nominatim se respeta dentro de cada grupo.
    const esLimite = d => d.category === 'boundary';
    return datos
      .map((d, i) => ({ d, i }))
      .sort((a, b) => esLimite(a.d) - esLimite(b.d) || a.i - b.i)
      .map(({ d }) => ({ nombre: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
  });
}

// Distancia en línea recta (fórmula de Haversine), en km.
function lineaRecta(a, b) {
  const R = 6371, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function rutaORS(origen, destino) {
  const datos = await pedirJSON('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: [[origen.lng, origen.lat], [destino.lng, destino.lat]] })
  });
  const f = datos.features[0];
  return { km: f.properties.summary.distance / 1000, minutos: f.properties.summary.duration / 60, linea: f.geometry.coordinates, fuente: 'OpenRouteService' };
}

async function rutaOSRM(origen, destino) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=simplified&geometries=geojson`;
  const datos = await pedirJSON(url, { headers: { 'User-Agent': AGENTE } });
  if (datos.code !== 'Ok' || !datos.routes?.length) throw new Error('OSRM sin ruta');
  const r = datos.routes[0];
  return { km: r.distance / 1000, minutos: r.duration / 60, linea: r.geometry.coordinates, fuente: 'OSRM (OpenStreetMap)' };
}

// Devuelve { km, minutos, linea:[[lng,lat]...], fuente, estimado, enlace_conductor }
function ruta(origen, destino) {
  const clave = `ruta:${origen.lat.toFixed(4)},${origen.lng.toFixed(4)}>${destino.lat.toFixed(4)},${destino.lng.toFixed(4)}`;
  return enCache(clave, async () => {
    let r;
    try {
      r = process.env.ORS_API_KEY ? await rutaORS(origen, destino) : await rutaOSRM(origen, destino);
    } catch (err) {
      console.warn('[rutas] proveedor falló, uso estimación:', err.message);
      const km = lineaRecta(origen, destino) * 1.35;
      r = { km, minutos: km * 1.6, linea: [[origen.lng, origen.lat], [destino.lng, destino.lat]], fuente: 'estimación en línea recta', estimado: true };
    }
    r.km = Math.round(r.km * 10) / 10;
    r.minutos = Math.round(r.minutos);
    r.enlace_conductor = `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lng}&destination=${destino.lat},${destino.lng}&travelmode=driving`;
    return r;
  });
}

module.exports = { geocodificar, ruta, lineaRecta };
