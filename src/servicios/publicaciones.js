// ============================================================================
//  src/servicios/publicaciones.js — Galería de eventos realizados
//
//  Operaciones sobre la tabla "publicaciones" a través del repositorio (src/db).
//  No tiene reglas complejas, pero al pasar por un servicio el controlador ya
//  no depende de cómo se guardan los datos.
// ============================================================================

const db = require('../db');

const listar = () => db.listar('publicaciones', { orden: 'orden' });
const obtener = id => db.obtener('publicaciones', id);
const crear = datos => db.insertar('publicaciones', datos);
const actualizar = (id, datos) => db.actualizar('publicaciones', id, datos);
const eliminar = id => db.eliminar('publicaciones', id);

// Devuelve el nuevo valor de "publicado" o null si no existe.
async function alternarPublicado(id) {
  const p = await db.obtener('publicaciones', id);
  if (!p) return null;
  await db.actualizar('publicaciones', p.id, { publicado: !p.publicado });
  return !p.publicado;
}

module.exports = { listar, obtener, crear, actualizar, eliminar, alternarPublicado };
