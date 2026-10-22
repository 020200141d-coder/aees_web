// ============================================================================
//  src/rutas/cuenta.js — registro e ingreso de clientes, "sin rodeos"
//
//  Dos formas, y en ambas registrarse e ingresar es el MISMO paso:
//   1. Google: el botón oficial (Google Identity Services) nos da un
//      "ID token" firmado por Google. Lo validamos preguntándole a Google
//      (endpoint tokeninfo) y comprobamos que fue emitido para NUESTRO
//      GOOGLE_CLIENT_ID. Si el correo no existe, se crea la cuenta.
//   2. Celular + PIN de 6 dígitos: si el celular no existe, se crea la cuenta
//      con ese PIN; si existe, se verifica el PIN. El PIN se guarda con hash.
//      (Más adelante se puede reemplazar el PIN por un código por WhatsApp.)
//
//  El DNI y demás datos se piden recién al reservar, no al registrarse.
// ============================================================================

const express = require('express');
const db = require('../db');
const { hashClave, verificarClave, limitar } = require('../lib/seguridad');
const { requiereCliente } = require('../middleware/auth');
const { texto } = require('../lib/util');

const router = express.Router();
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Solo aceptamos rutas internas en "volver" (evita redirigir a sitios ajenos).
const volverSeguro = v => (typeof v === 'string' && /^\/(?!\/)/.test(v) ? v : '/cuenta');

const limiteLogin = limitar({ clave: 'login', max: 10, ventanaMin: 15, mensaje: 'Demasiados intentos. Espera 15 minutos.' });

router.get('/ingresar', (req, res) => {
  if (req.usuario) return res.redirect(volverSeguro(req.query.volver));
  res.render('cuenta/ingresar', { titulo: 'Ingresar', volver: volverSeguro(req.query.volver), error: null, datos: {} });
});

router.post('/google', limiteLogin, a(async (req, res) => {
  const idCliente = process.env.GOOGLE_CLIENT_ID;
  const credencial = String(req.body?.credential || '');
  if (!idCliente || !credencial) return res.status(400).json({ ok: false, error: 'El ingreso con Google no está configurado.' });

  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credencial)}`, { signal: AbortSignal.timeout(8000) });
  const info = await r.json().catch(() => ({}));
  if (!r.ok || info.aud !== idCliente || info.email_verified !== 'true') {
    return res.status(401).json({ ok: false, error: 'No pudimos verificar tu cuenta de Google.' });
  }

  const email = info.email.toLowerCase();
  let u = (await db.buscarUno('usuarios', { google_sub: info.sub })) || (await db.buscarUno('usuarios', { email }));
  if (!u) {
    u = await db.insertar('usuarios', { rol: 'cliente', nombre: info.name || email.split('@')[0], email, google_sub: info.sub });
  } else if (!u.google_sub) {
    u = await db.actualizar('usuarios', u.id, { google_sub: info.sub });
  }
  req.session.uid = u.id;
  res.json({ ok: true, volver: volverSeguro(req.body?.volver) });
}));

router.post('/celular', limiteLogin, a(async (req, res) => {
  const celular = String(req.body.celular || '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');
  const pin = String(req.body.pin || '');
  const nombre = texto(req.body.nombre, 80);
  const volver = volverSeguro(req.body.volver);
  const mostrar = error => res.status(400).render('cuenta/ingresar', { titulo: 'Ingresar', volver, error, datos: { celular, nombre } });

  if (!/^9\d{8}$/.test(celular)) return mostrar('Escribe tu celular de 9 dígitos (empieza en 9).');
  if (!/^\d{6}$/.test(pin)) return mostrar('El PIN tiene 6 dígitos.');

  let u = await db.buscarUno('usuarios', { celular });
  if (u) {
    if (!verificarClave(pin, u.clave_hash)) return mostrar('El PIN no coincide con ese celular.');
  } else {
    if (nombre.length < 2) return mostrar('Es tu primera vez: escribe tu nombre para crear la cuenta.');
    u = await db.insertar('usuarios', { rol: 'cliente', nombre, celular, clave_hash: hashClave(pin) });
  }
  req.session.uid = u.id;
  res.redirect(volver);
}));

router.post('/salir', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// Mis reservas
router.get('/', requiereCliente, a(async (req, res) => {
  const mias = await db.listar('reservas', { filtro: { usuario_id: req.usuario.id }, orden: 'creado_en', desc: true });
  res.render('cuenta/panel', { titulo: 'Mi cuenta', reservas: mias });
}));

module.exports = router;
