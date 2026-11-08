// negocio.js — datos del negocio y fotos de portada, con caché corta.
// Se muestran en TODAS las páginas (header, footer, WhatsApp), así que los
// guardamos 30 s en memoria para no consultar la BD en cada visita. Cuando el
// admin guarda los ajustes, llamamos a invalidar() y se ven al instante.

const db = require('../db');

// Condiciones que el cliente acepta al reservar (editables en Admin → Ajustes).
// Si el admin no escribió las suyas, se usan estas.
const CLAUSULAS_BASE = [
  'El local debe garantizar energía eléctrica estable para los equipos durante todo el evento.',
  'Si el evento es al aire libre, el local debe garantizar protección ante la lluvia y el sol (toldo o techo) para los equipos y la consola.',
  'El adelanto separa la fecha y los equipos. El evento queda confirmado solo después de la reunión o llamada de confirmación que agenda AeeS Acústico.',
  'El saldo se paga el día del evento, antes del montaje.'
];

let cache = null;
let vence = 0;

async function obtener() {
  if (cache && Date.now() < vence) return cache;
  const [negocio, portada] = await Promise.all([db.ajuste('negocio'), db.ajuste('portada')]);
  const n = negocio || {};
  cache = { negocio: { ...n, clausulas: Array.isArray(n.clausulas) && n.clausulas.length ? n.clausulas : CLAUSULAS_BASE }, portada: portada || {} };
  vence = Date.now() + 30 * 1000;
  return cache;
}

function invalidar() {
  cache = null;
}

module.exports = { obtener, invalidar, CLAUSULAS_BASE };
