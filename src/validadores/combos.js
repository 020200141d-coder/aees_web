// ============================================================================
//  src/validadores/combos.js — lee y valida el formulario de un combo
//
//  `mapa` = { idEquipo: equipo } con los equipos existentes: los items y
//  adicionales que no correspondan a un equipo real se descartan aquí, antes
//  de llegar al servicio. Devuelve { datos, errores } como todos los validadores.
// ============================================================================

const { TIPOS_EVENTO, texto, numero } = require('../lib/util');
const { marcado, entero, urlImagen, filas } = require('./formulario');

const NIVELES = ['esencial', 'fiesta', 'produccion'];

function leerCombo(b, mapa) {
  const items = filas(b.items).map(it => ({ equipo_id: String(it.equipo_id || ''), cantidad: entero(it.cantidad) })).filter(it => mapa[it.equipo_id] && it.cantidad > 0);
  const adicionales = filas(b.adicionales)
    .map(it => ({ equipo_id: String(it.equipo_id || ''), cantidad: entero(it.cantidad), precio: numero(it.precio, NaN), etiqueta: texto(it.etiqueta, 80) }))
    .filter(it => mapa[it.equipo_id] && it.cantidad > 0);
  const d = {
    nombre: texto(b.nombre, 100),
    nivel: NIVELES.includes(b.nivel) ? b.nivel : 'esencial',
    descripcion: String(b.descripcion || '').trim().slice(0, 1500),
    tipos_evento: [].concat(b.tipos_evento || []).filter(t => TIPOS_EVENTO[t]),
    personas_min: entero(b.personas_min),
    personas_max: entero(b.personas_max, 100),
    horas_base: entero(b.horas_base, 4),
    precio: numero(b.precio, NaN),
    items,
    // Sin etiqueta escrita, el adicional se describe solo: "2× JBL EON615".
    adicionales: adicionales.map(x => ({ ...x, etiqueta: x.etiqueta || `${x.cantidad}× ${mapa[x.equipo_id].nombre}` })),
    imagen: urlImagen(b.imagen),
    imagen_fuente: texto(b.imagen_fuente, 120),
    publicado: marcado(b.publicado),
    destacado: marcado(b.destacado),
    orden: entero(b.orden)
  };
  const e = {};
  if (d.nombre.length < 3) e.nombre = 'El nombre es obligatorio.';
  if (!(d.precio >= 0)) e.precio = 'El precio debe ser 0 o mayor.';
  if (!d.items.length) e.items = 'Agrega al menos un equipo al combo.';
  if (d.adicionales.some(x => !(x.precio >= 0))) e.adicionales = 'Cada adicional necesita un precio de 0 o más.';
  if (!d.tipos_evento.length) e.tipos_evento = 'Marca al menos un tipo de evento (lo usa el asistente para sugerirlo).';
  if (d.personas_min < 0 || d.personas_max < d.personas_min) e.personas_max = 'El máximo debe ser mayor o igual al mínimo.';
  if (!(d.horas_base >= 1 && d.horas_base <= 24)) e.horas_base = 'Entre 1 y 24 horas.';
  if (d.imagen === null) e.imagen = 'Pega una URL https o sube una foto.';
  return { datos: d, errores: e };
}

// Id legible a partir del nombre: "Combo Grande · DJ" → "combo-grande-dj".
const slugCombo = nombre => String(nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

module.exports = { leerCombo, slugCombo, NIVELES };
