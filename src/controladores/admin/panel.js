// ============================================================================
//  src/controladores/admin/panel.js — partes generales del panel
//
//  • variablesComunes: middleware que deja en res.locals lo que usan todas
//    las vistas (sección activa, catálogos, contadores del menú)
//  • ingreso y salida del personal
//  • Inicio (agenda del mes), Mensajes y subida de fotos
// ============================================================================

const panel = require('../../servicios/panel');
const usuarios = require('../../servicios/usuarios');
const { claveVigente, iniciarSesionPersonal, CONFIRMACION_MIN } = require('../../middleware/auth');
const { CATEGORIAS, TIPOS_EVENTO, ESTADOS_RESERVA, texto, hoyLima } = require('../../lib/util');
const { esErrorNegocio } = require('../../lib/errores');
const { volverSeguro } = require('../comun');

// Middleware: variables comunes de todas las vistas del panel.
async function variablesComunes(req, res, next) {
  res.locals.seccion = req.path.split('/')[1] || 'inicio';
  res.locals.CATEGORIAS = CATEGORIAS;
  res.locals.TIPOS_EVENTO = TIPOS_EVENTO;
  res.locals.ESTADOS_RESERVA = ESTADOS_RESERVA;
  res.locals.pendientes = { mensajes: 0, yape: 0, resenas: 0 };
  // public/js/admin.js lo lee para no pedir la contraseña otra vez si se confirmó hace poco.
  res.locals.claveVigente = claveVigente(req);
  res.locals.CONFIRMACION_MIN = CONFIRMACION_MIN;
  if (req.usuario?.rol === 'admin') {
    try { res.locals.pendientes = await panel.pendientes(); } catch (err) { return next(err); }
  }
  next();
}

// ── Ingreso del personal ───────────────────────────────────────────────────
function formIngreso(req, res) {
  if (usuarios.ROLES_PERSONAL.includes(req.usuario?.rol)) return res.redirect('/admin');
  // Aviso de una sola vez cuando la sesión se cerró por inactividad.
  const aviso = req.session.aviso || null;
  req.session.aviso = null;
  res.render('admin/ingresar', { titulo: 'Ingreso del personal', error: null, aviso, email: '', volver: volverSeguro(req.query.volver) });
}

async function ingresar(req, res) {
  const email = texto(req.body.email, 120).toLowerCase();
  const u = await usuarios.autenticar(email, req.body.clave);
  if (!u) {
    return res.status(401).render('admin/ingresar', { titulo: 'Ingreso del personal', error: 'Correo o contraseña incorrectos.', aviso: null, email, volver: volverSeguro(req.body.volver) });
  }
  iniciarSesionPersonal(req, u);
  res.redirect(volverSeguro(req.body.volver));
}

function salir(req, res) {
  req.session = null;
  res.redirect('/admin/ingresar');
}

// ── Inicio / agenda ────────────────────────────────────────────────────────
// El mes con los eventos de cada día y la lista de los próximos con botones
// rápidos (confirmar, completar) para no tener que entrar a cada reserva.
async function inicio(req, res) {
  const hoy = hoyLima();
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoy.slice(0, 7);
  res.render('admin/inicio', { titulo: 'Inicio', hoy, mes, ...(await panel.agenda(mes, hoy)) });
}

// ── Mensajes y solicitudes ─────────────────────────────────────────────────
async function mensajes(req, res) {
  res.render('admin/mensajes', { titulo: 'Mensajes', mensajes: await panel.mensajes() });
}

async function alternarLeido(req, res) {
  await panel.alternarLeido(req.params.id);
  res.redirect('/admin/mensajes');
}

async function eliminarMensaje(req, res) {
  await panel.eliminarMensaje(req.params.id);
  req.flash('exito', 'Mensaje eliminado.');
  res.redirect('/admin/mensajes');
}

// ── Fotos (JSON: lo llama el recortador de fotos del panel con fetch) ───────
async function subirFoto(req, res) {
  try {
    res.json({ ok: true, url: await panel.guardarFoto(req.body?.datos) });
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    res.status(err.status).json({ ok: false, error: err.message });
  }
}

module.exports = { variablesComunes, formIngreso, ingresar, salir, inicio, mensajes, alternarLeido, eliminarMensaje, subirFoto };
