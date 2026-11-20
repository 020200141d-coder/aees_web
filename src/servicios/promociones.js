// ============================================================================
//  src/servicios/promociones.js — códigos de descuento del panel
//
//  Regla: el código es único (no puede haber dos promociones "BIENVENIDA5").
//  Al editar, la propia promoción puede conservar su código.
// ============================================================================

const db = require('../db');

const listar = () => db.listar('promociones', { orden: 'codigo' });
const obtener = id => db.obtener('promociones', id);
const eliminar = id => db.eliminar('promociones', id);

// Crea o actualiza (si llega `editando`). `errores` trae los del validador;
// devuelve los errores finales (vacío si se guardó).
async function guardar(datos, editando, errores = {}) {
  const repetido = await db.buscarUno('promociones', { codigo: datos.codigo });
  if (repetido && repetido.id !== editando) errores.codigo = 'Ya existe ese código.';
  if (Object.keys(errores).length) return errores;
  if (editando) await db.actualizar('promociones', editando, datos);
  else await db.insertar('promociones', datos);
  return {};
}

module.exports = { listar, obtener, eliminar, guardar };
