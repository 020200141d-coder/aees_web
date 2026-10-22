// negocio.js — datos del negocio y fotos de portada, con caché corta.
// Se muestran en TODAS las páginas (header, footer, WhatsApp), así que los
// guardamos 30 s en memoria para no consultar la BD en cada visita. Cuando el
// admin guarda los ajustes, llamamos a invalidar() y se ven al instante.

const db = require('../db');

let cache = null;
let vence = 0;

async function obtener() {
  if (cache && Date.now() < vence) return cache;
  const [negocio, portada] = await Promise.all([db.ajuste('negocio'), db.ajuste('portada')]);
  cache = { negocio: negocio || {}, portada: portada || {} };
  vence = Date.now() + 30 * 1000;
  return cache;
}

function invalidar() {
  cache = null;
}

module.exports = { obtener, invalidar };
