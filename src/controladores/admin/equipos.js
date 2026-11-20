// ============================================================================
//  src/controladores/admin/equipos.js — páginas y acciones de Equipos (/admin/equipos)
//
//  Flujo de cada acción:
//    ruta (URL + permiso) → controlador → validador (form) → servicio (reglas) → db
//  El controlador solo lee la petición, llama al servicio y elige la respuesta:
//   • formulario con errores → se vuelve a pintar con status 400 (lo escrito se conserva)
//   • acción correcta        → flash de éxito + redirect (patrón PRG)
//   • regla rota (ErrorNegocio) → flash de error + redirect, o el error junto al campo
// ============================================================================

const { texto, CATEGORIAS } = require('../../lib/util');
const equipos = require('../../servicios/equipos');
const { leerEquipo } = require('../../validadores/equipos');
const { hayErrores } = require('../../validadores/formulario');
const { esErrorNegocio } = require('../../lib/errores');
const { quiereJson, volverA, accionPanel } = require('../comun');

// Valores iniciales del formulario de equipo nuevo.
const EQUIPO_NUEVO = { categoria: 'audio', estado: 'operativo', publicado: true, precio: '', cantidad_total: 1, ajuste_sin_dmx: 0 };

async function pintarFormulario(res, { titulo, e, errores = {}, nuevo, status = 200 }) {
  res.status(status).render('admin/equipo-form', { titulo, e, errores, nuevo, roles: await equipos.rolesConocidos() });
}

async function lista(req, res) {
  const q = texto(req.query.q, 60).toLowerCase();
  const [lista, libresHoy] = await Promise.all([equipos.listar({ q, categoria: req.query.categoria }), equipos.libresHoy()]);
  const cat = CATEGORIAS[req.query.categoria] ? req.query.categoria : '';
  res.render('admin/equipos', { titulo: 'Equipos', equipos: lista, q, cat, libresHoy });
}

const nuevo = (req, res) => pintarFormulario(res, { titulo: 'Nuevo equipo', e: EQUIPO_NUEVO, nuevo: true });

async function crear(req, res) {
  const { datos, errores } = leerEquipo(req.body);
  if (!hayErrores(errores)) {
    try {
      await equipos.crear(datos);
      req.flash('exito', `Equipo «${datos.nombre}» creado.`);
      return res.redirect('/admin/equipos');
    } catch (err) {
      if (!esErrorNegocio(err)) throw err;
      errores[err.campo || 'codigo'] = err.message; // código repetido → junto al campo
    }
  }
  await pintarFormulario(res, { titulo: 'Nuevo equipo', e: { ...req.body, ...datos }, errores, nuevo: true, status: 400 });
}

async function editar(req, res, next) {
  const e = await equipos.obtener(req.params.id);
  if (!e) return next(); // 404
  await pintarFormulario(res, { titulo: `Editar ${e.nombre}`, e, nuevo: false });
}

async function guardar(req, res, next) {
  const actual = await equipos.obtener(req.params.id);
  if (!actual) return next();
  const { datos, errores } = leerEquipo(req.body);
  if (hayErrores(errores)) return pintarFormulario(res, { titulo: `Editar ${actual.nombre}`, e: { ...actual, ...datos }, errores, nuevo: false, status: 400 });
  await equipos.actualizar(actual.id, datos);
  req.flash('exito', `Cambios guardados en «${datos.nombre}».`);
  res.redirect('/admin/equipos');
}

// Interruptor rápido desde la tabla: publicado sí/no (JSON si lo pide fetch).
async function alternarPublicado(req, res, next) {
  const publicado = await equipos.alternarPublicado(req.params.id);
  if (publicado === null) return next();
  if (quiereJson(req)) return res.json({ ok: true, publicado });
  res.redirect(volverA(req, '/admin/equipos'));
}

async function cambiarEstado(req, res, next) {
  if (!(await equipos.cambiarEstado(req.params.id, req.body.estado))) return next();
  if (quiereJson(req)) return res.json({ ok: true, estado: req.body.estado });
  res.redirect(volverA(req, '/admin/equipos'));
}

// La regla "no eliminar si está en un combo" vive en el servicio; aquí solo
// se traduce su ErrorNegocio en un flash de error.
const eliminar = (req, res) => accionPanel(req, res, {
  hacer: () => equipos.eliminar(req.params.id),
  exito: 'Equipo eliminado.',
  volver: '/admin/equipos'
});

module.exports = { lista, nuevo, crear, editar, guardar, alternarPublicado, cambiarEstado, eliminar };
