// ============================================================================
//  src/servicios/combos.js — reglas de negocio de los combos (paquetes)
//
//  Reglas:
//   • el id sale del nombre ("Combo grande" → combo-grande); si ya existe se le
//     agrega un sufijo corto al azar para que dos combos nunca choquen
//   • el formulario solo puede usar equipos que existen (mapaEquipos)
// ============================================================================

const crypto = require('node:crypto');
const db = require('../db');
const catalogo = require('./catalogo');
const { slugCombo } = require('../validadores/combos');

const listar = () => db.listar('combos', { orden: 'orden' });
const obtener = id => db.obtener('combos', id);

// Equipos para los selectores del formulario + mapa por id para validar.
async function equiposParaFormulario() {
  const equipos = await db.listar('equipos', { orden: 'orden' });
  return { equipos, mapa: catalogo.mapaPorId(equipos) };
}

async function crear(datos) {
  const base = slugCombo(datos.nombre);
  const id = (await db.obtener('combos', base)) ? `${base}-${crypto.randomUUID().slice(0, 4)}` : base;
  return db.insertar('combos', { ...datos, id });
}

const actualizar = (id, datos) => db.actualizar('combos', id, datos);

// Devuelve el nuevo valor de "publicado" o null si el combo no existe.
async function alternarPublicado(id) {
  const c = await db.obtener('combos', id);
  if (!c) return null;
  await db.actualizar('combos', c.id, { publicado: !c.publicado });
  return !c.publicado;
}

const eliminar = id => db.eliminar('combos', id);

module.exports = { listar, obtener, equiposParaFormulario, crear, actualizar, alternarPublicado, eliminar };
