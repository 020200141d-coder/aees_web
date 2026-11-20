// ============================================================================
//  src/controladores/admin/clientes.js — Clientes (/admin/clientes)
//
//  ruta → controlador → validador (clientes) → servicio (clientes) → db
// ============================================================================

const clientes = require('../../servicios/clientes');
const { leerCliente } = require('../../validadores/clientes');
const { texto } = require('../../lib/util');
const { accionPanel } = require('../comun');

async function lista(req, res) {
  const q = texto(req.query.q, 60).toLowerCase();
  const { clientes: filtrados, total, minimo } = await clientes.tabla(q);
  res.render('admin/clientes', { titulo: 'Clientes', clientes: filtrados, total, q, nuevo: Boolean(req.query.nuevo), minimo });
}

// Registrar: si marcó "y reservar", va directo a la nueva reserva con ese cliente.
async function crear(req, res) {
  let creado = null;
  await accionPanel(req, res, {
    hacer: async () => (creado = await clientes.crear(leerCliente(req.body))),
    exito: u => `Cliente ${u.nombre} registrado.`,
    volver: () => (!creado ? '/admin/clientes?nuevo=1' : req.body.y_reservar ? `/admin/reservas/nueva?cliente=${creado.id}` : `/admin/clientes/${creado.id}`)
  });
}

async function ficha(req, res, next) {
  const u = await clientes.obtener(req.params.id);
  if (!u) return next();
  const { reservas, saldo, frecuente } = await clientes.ficha(u);
  res.render('admin/cliente', { titulo: u.nombre, c: u, reservas, saldo, frecuente });
}

async function guardar(req, res, next) {
  const u = await clientes.obtener(req.params.id);
  if (!u) return next();
  await accionPanel(req, res, {
    hacer: () => clientes.actualizar(u.id, leerCliente(req.body)),
    exito: 'Datos del cliente guardados.',
    volver: `/admin/clientes/${u.id}`
  });
}

// Solo sin reservas (regla del servicio). Si falla, vuelve a su ficha.
async function eliminar(req, res, next) {
  const u = await clientes.obtener(req.params.id);
  if (!u) return next();
  let ok = false;
  await accionPanel(req, res, {
    hacer: async () => { await clientes.eliminar(u); ok = true; },
    exito: `Cliente ${u.nombre} eliminado.`,
    volver: () => (ok ? '/admin/clientes' : `/admin/clientes/${u.id}`)
  });
}

module.exports = { lista, crear, ficha, guardar, eliminar };
