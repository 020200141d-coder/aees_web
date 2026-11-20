// ============================================================================
//  src/controladores/admin/configuracion.js — Promociones, Ajustes, Usuarios y Respaldo
//
//  Son las secciones de "configuración del negocio", solo para el admin.
//  Las de Usuarios y Respaldo piden la contraseña (rutas delicadas, ver
//  esDelicada en rutas/admin.js).
// ============================================================================

const promociones = require('../../servicios/promociones');
const ajustes = require('../../servicios/ajustes');
const usuarios = require('../../servicios/usuarios');
const respaldo = require('../../servicios/respaldo');
const { leerPromo } = require('../../validadores/promociones');
const { ROLES, leerCuentaNueva } = require('../../validadores/usuarios');
const { hayErrores } = require('../../validadores/formulario');
const { texto, hoyLima } = require('../../lib/util');
const { esErrorNegocio } = require('../../lib/errores');
const { accionPanel } = require('../comun');

// ── Promociones ────────────────────────────────────────────────────────────
async function pintarPromos(res, { p = { activo: true }, errores = {}, editando = null, status = 200 } = {}) {
  res.status(status).render('admin/promociones', { titulo: 'Promociones', promociones: await promociones.listar(), p, errores, editando });
}

const promosLista = (req, res) => pintarPromos(res);

async function promoEditar(req, res, next) {
  const p = await promociones.obtener(req.params.id);
  if (!p) return next();
  await pintarPromos(res, { p, editando: p.id });
}

async function promoGuardar(req, res) {
  const editando = req.body.id || null;
  const { datos, errores } = leerPromo(req.body);
  const finales = await promociones.guardar(datos, editando, errores);
  if (hayErrores(finales)) return pintarPromos(res, { p: { ...datos, id: editando }, errores: finales, editando, status: 400 });
  req.flash('exito', `Promoción ${datos.codigo} guardada.`);
  res.redirect('/admin/promociones');
}

async function promoEliminar(req, res) {
  await promociones.eliminar(req.params.id);
  req.flash('exito', 'Promoción eliminada.');
  res.redirect('/admin/promociones');
}

// ── Ajustes ────────────────────────────────────────────────────────────────
async function ajustesForm(req, res) {
  res.render('admin/ajustes', { titulo: 'Ajustes', ...(await ajustes.paraFormulario()), errores: {} });
}

// Cada bloque de Ajustes se guarda igual: validar → guardar → flash → volver a su ancla.
const guardarBloque = (guardar, exito, volver) => (req, res) => accionPanel(req, res, { hacer: () => guardar(req.body), exito, volver });
const ajustesNegocio = guardarBloque(ajustes.guardarNegocio, 'Datos del negocio guardados.', '/admin/ajustes');
const ajustesReglas = guardarBloque(ajustes.guardarReglas, 'Reglas de precios guardadas.', '/admin/ajustes#reglas');
const ajustesVehiculos = guardarBloque(ajustes.guardarVehiculos, 'Vehículos y tarifas guardados.', '/admin/ajustes#vehiculos');
const ajustesPortada = guardarBloque(ajustes.guardarPortada, 'Fotos de portada guardadas.', '/admin/ajustes#portada');

// ── Usuarios del personal ──────────────────────────────────────────────────
async function pintarUsuarios(res, { errores = {}, datos = { rol: 'publicador' }, editar = null, estado = 200 } = {}) {
  res.status(estado).render('admin/usuarios', {
    titulo: 'Usuarios', personal: await usuarios.personal(), errores, datos, editar, ROLES, esPrincipal: usuarios.esPrincipal
  });
}

async function usuariosLista(req, res) {
  const editar = req.query.editar ? await usuarios.cuentaDelPersonal(req.query.editar) : null;
  await pintarUsuarios(res, { editar });
}

async function usuarioCrear(req, res) {
  const { datos, clave, errores } = leerCuentaNueva(req.body);
  const r = await usuarios.crear(datos, clave, errores);
  if (r.errores) return pintarUsuarios(res, { errores: r.errores, datos, estado: 400 });
  req.flash('exito', `Cuenta creada para ${datos.email} (${ROLES[datos.rol]}).`);
  res.redirect('/admin/usuarios');
}

async function usuarioGuardar(req, res, next) {
  const u = await usuarios.cuentaDelPersonal(req.params.id);
  if (!u) return next();
  const claveNueva = String(req.body.clave_nueva || '');
  const { errores, cambios } = await usuarios.actualizar(u, { nombre: texto(req.body.nombre, 80), rol: req.body.rol, claveNueva }, req.usuario);
  if (errores) return pintarUsuarios(res, { errores, editar: { ...u, ...cambios }, estado: 400 });
  req.flash('exito', `Cuenta de ${u.email} actualizada${claveNueva ? ' (con contraseña nueva)' : ''}.`);
  res.redirect('/admin/usuarios');
}

const usuarioEliminar = (req, res) => accionPanel(req, res, {
  hacer: () => usuarios.eliminar(req.params.id, req.usuario),
  exito: u => `Se quitó el acceso de ${u.email}.`,
  volver: '/admin/usuarios'
});

// ── Respaldo ───────────────────────────────────────────────────────────────
async function respaldoPagina(req, res) {
  res.render('admin/respaldo', { titulo: 'Respaldo', ...(await respaldo.estado()) });
}

// Descargar un respaldo automático (pide contraseña).
async function respaldoAutomatico(req, res, next) {
  const nombre = texto(req.body.nombre, 120);
  const archivo = await respaldo.leerAutomatico(nombre);
  if (!archivo) return next();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre.split('/').pop()}"`);
  res.send(archivo);
}

async function respaldoAhora(req, res) {
  const r = await respaldo.respaldarAhora();
  req.flash('exito', `Respaldo guardado: ${r.archivo.split('/').pop()} (${r.kb} KB).`);
  res.redirect('/admin/respaldo');
}

// POST (no GET) para poder pedir la contraseña: el respaldo trae TODOS los
// datos, incluidos los de los clientes.
async function respaldoDescargar(req, res) {
  res.setHeader('Content-Disposition', `attachment; filename="aees-respaldo-${hoyLima()}.json"`);
  res.json(await respaldo.exportar());
}

async function respaldoRestaurar(req, res) {
  try {
    res.json({ ok: true, ...(await respaldo.restaurar(req.body)) });
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    res.status(err.status).json({ ok: false, error: err.message });
  }
}

module.exports = {
  promosLista, promoEditar, promoGuardar, promoEliminar,
  ajustesForm, ajustesNegocio, ajustesReglas, ajustesVehiculos, ajustesPortada,
  usuariosLista, usuarioCrear, usuarioGuardar, usuarioEliminar,
  respaldoPagina, respaldoAutomatico, respaldoAhora, respaldoDescargar, respaldoRestaurar
};
