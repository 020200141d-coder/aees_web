// ============================================================================
//  src/servicios/equipos.js — reglas de negocio del inventario de equipos
//
//  Capa de servicio (Service Layer): aquí está lo que el NEGOCIO decide sobre
//  un equipo, sin saber nada de HTTP ni de vistas. Antes estas reglas estaban
//  mezcladas en src/rutas/admin.js junto con req/res.
//
//  Reglas:
//   • el código es único (id = código en minúsculas)          → 409
//   • no se elimina un equipo que forma parte de un combo      → 409
//     (ni como equipo base ni como adicional), porque el combo
//     publicado quedaría roto en la web
//   • el estado solo puede ser operativo, mantenimiento o baja
//
//  Acceso a datos: solo a través de src/db (patrón Repository), así el
//  servicio funciona igual con Supabase o con la base local.
// ============================================================================

const db = require('../db');
const catalogo = require('./catalogo');
const { ErrorNegocio } = require('../lib/errores');
const { CATEGORIAS, hoyLima } = require('../lib/util');
const { ESTADOS_EQUIPO } = require('../validadores/equipos');

const idDesdeCodigo = codigo => String(codigo).toLowerCase();

// Lista para la tabla del panel, con búsqueda por texto y filtro de categoría.
async function listar({ q = '', categoria = '' } = {}) {
  let equipos = await db.listar('equipos', { orden: 'orden' });
  if (CATEGORIAS[categoria]) equipos = equipos.filter(e => e.categoria === categoria);
  if (q) equipos = equipos.filter(e => `${e.nombre} ${e.marca} ${e.modelo} ${e.codigo}`.toLowerCase().includes(q));
  return equipos;
}

// Cuántas unidades de cada equipo están libres hoy (se muestra en la tabla).
const libresHoy = () => catalogo.disponibilidad(hoyLima());

// Roles que ya existen (el formulario los sugiere para no escribirlos distinto).
async function rolesConocidos() {
  return [...new Set((await db.listar('equipos')).map(e => e.rol))].sort();
}

const obtener = id => db.obtener('equipos', id);

async function crear(datos) {
  const id = idDesdeCodigo(datos.codigo);
  if (await db.obtener('equipos', id)) throw new ErrorNegocio('Ya existe un equipo con ese código.', 409, { campo: 'codigo' });
  return db.insertar('equipos', { id, ...datos });
}

const actualizar = (id, datos) => db.actualizar('equipos', id, datos);

// Interruptor "publicado" de la tabla. Devuelve el nuevo valor (o null si no existe).
async function alternarPublicado(id) {
  const e = await db.obtener('equipos', id);
  if (!e) return null;
  await db.actualizar('equipos', e.id, { publicado: !e.publicado });
  return !e.publicado;
}

// Cambio rápido de estado. Devuelve false si el equipo no existe o el estado es inválido.
async function cambiarEstado(id, estado) {
  const e = await db.obtener('equipos', id);
  if (!e || !ESTADOS_EQUIPO.includes(estado)) return false;
  await db.actualizar('equipos', e.id, { estado });
  return true;
}

// Combos que usan el equipo (como parte base o como adicional).
async function combosQueLoUsan(id) {
  return (await db.listar('combos')).filter(c => [...(c.items || []), ...(c.adicionales || [])].some(it => it.equipo_id === id));
}

async function eliminar(id) {
  const enCombos = await combosQueLoUsan(id);
  if (enCombos.length) {
    throw new ErrorNegocio(`No se puede eliminar: está en ${enCombos.map(c => `«${c.nombre}»`).join(', ')}. Quítalo de esos combos o despublícalo.`, 409);
  }
  await db.eliminar('equipos', id);
}

module.exports = { listar, libresHoy, rolesConocidos, obtener, crear, actualizar, alternarPublicado, cambiarEstado, combosQueLoUsan, eliminar };
