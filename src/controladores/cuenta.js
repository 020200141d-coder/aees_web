// ============================================================================
//  src/controladores/cuenta.js — registro, ingreso y "Mi cuenta" del cliente (/cuenta)
//
//  ruta → controlador → validador (cuenta) → servicio (cuentas) → db
//  Las reglas (celular que no coincide, cuenta del personal, PIN antiguo…)
//  están en servicios/cuentas.js; aquí se elige cómo mostrar cada resultado.
// ============================================================================

const cuentas = require('../servicios/cuentas');
const { DIAS_CLIENTE } = require('../middleware/auth');
const { leerIngreso, volverCliente } = require('../validadores/cuenta');
const { limpiarCelular } = require('../validadores/clientes');
const { texto } = require('../lib/util');
const { esErrorNegocio } = require('../lib/errores');

const MEDIO_ANIO = DIAS_CLIENTE * 24 * 3600 * 1000;

function formIngreso(req, res) {
  if (req.usuario) return res.redirect(volverCliente(req.query.volver));
  res.render('cuenta/ingresar', { titulo: 'Ingresar', volver: volverCliente(req.query.volver), error: null, datos: {} });
}

// Correo + celular. Si una regla falla se vuelve a mostrar el formulario con lo escrito.
async function ingresar(req, res) {
  const datos = leerIngreso(req.body);
  const volver = volverCliente(req.body.volver);
  let u;
  try {
    u = await cuentas.ingresar(datos);
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    return res.status(400).render('cuenta/ingresar', { titulo: 'Ingresar', volver, error: err.message, datos: { email: datos.email, celular: datos.celular, nombre: datos.nombre, ...(err.extra || {}) } });
  }
  // Sesión nueva (se conserva el token CSRF) y recordada medio año en el dispositivo.
  const csrfActual = req.session.csrf;
  req.session = { uid: u.id, csrf: csrfActual };
  req.sessionOptions.maxAge = MEDIO_ANIO;
  req.flash('exito', `¡Hola, ${u.nombre.split(' ')[0]}! Quedarás recordado en este dispositivo.`);
  res.redirect(volver);
}

// Botón de Google (fetch → JSON). Si falta el celular, se manda a /cuenta/completar.
async function google(req, res) {
  let u;
  try {
    const info = await cuentas.verificarTokenGoogle(String(req.body?.credential || ''), process.env.GOOGLE_CLIENT_ID);
    u = await cuentas.ingresarConGoogle(info);
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    return res.status(err.status).json({ ok: false, error: err.message });
  }
  req.session.uid = u.id;
  req.sessionOptions.maxAge = MEDIO_ANIO;
  const volver = volverCliente(req.body?.volver);
  res.json({ ok: true, volver: u.celular ? volver : `/cuenta/completar?volver=${encodeURIComponent(volver)}` });
}

function formCompletar(req, res) {
  const volver = volverCliente(req.query.volver);
  if (req.usuario.celular) return res.redirect(volver);
  res.render('cuenta/completar', { titulo: 'Tu celular', volver, error: null, datos: { nombre: req.usuario.nombre } });
}

async function completar(req, res) {
  const volver = volverCliente(req.body.volver);
  const celular = limpiarCelular(req.body.celular);
  const nombre = texto(req.body.nombre, 80) || req.usuario.nombre;
  try {
    await cuentas.completarRegistro(req.usuario, { celular, nombre });
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    return res.status(400).render('cuenta/completar', { titulo: 'Tu celular', volver, error: err.message, datos: { celular, nombre } });
  }
  req.flash('exito', `¡Listo, ${nombre.split(' ')[0]}! Tu cuenta quedó lista y te recordaremos en este dispositivo.`);
  res.redirect(volver);
}

// Ruta anterior (celular + PIN): se mantiene para no romper formularios viejos.
const celularAntiguo = (req, res) => res.redirect(303, `/cuenta/ingresar?volver=${encodeURIComponent(volverCliente(req.body.volver))}`);

function salir(req, res) {
  req.session = null;
  res.redirect('/');
}

async function panel(req, res) {
  res.render('cuenta/panel', { titulo: 'Mi cuenta', ...(await cuentas.miCuenta(req.usuario)) });
}

async function resena(req, res) {
  try {
    await cuentas.dejarResena(req.usuario, req.body, texto(req.body.codigo, 20));
    req.flash('exito', '¡Gracias por tu reseña! La publicaremos después de revisarla.');
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    req.flash(err.extra?.tipo || 'error', err.message);
  }
  res.redirect('/cuenta');
}

module.exports = { formIngreso, ingresar, google, formCompletar, completar, celularAntiguo, salir, panel, resena };
