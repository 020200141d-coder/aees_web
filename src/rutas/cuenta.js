// ============================================================================
//  src/rutas/cuenta.js — registro e ingreso de clientes, "sin rodeos"
//
//  Registrarse e ingresar es el MISMO paso:
//   1. Gmail + celular (la forma principal, pedida por el negocio): el cliente
//      habitual solo escribe su Gmail y su celular. Si es nuevo, se crea la
//      cuenta con su nombre; si ya existe, el celular debe coincidir con el
//      de ese Gmail. Queda recordado 6 meses en su dispositivo.
//      Cuentas antiguas (celular + PIN): la primera vez se pide el PIN una sola
//      vez para unirles el Gmail; después ya no se vuelve a pedir.
//   2. Google (si hay GOOGLE_CLIENT_ID): botón oficial de Google; validamos el
//      "ID token" con Google y que sea para NUESTRO GOOGLE_CLIENT_ID.
//
//  Ojo de seguridad: Gmail + celular no envía un código de verificación (eso
//  cuesta dinero por SMS/WhatsApp). Para que nadie pruebe combinaciones, hay
//  límite de intentos por IP, y el botón de Google sí verifica la identidad.
//
//  El DNI y demás datos se piden recién al reservar, no al registrarse.
// ============================================================================

const express = require('express');
const db = require('../db');
const { verificarClave, limitar } = require('../lib/seguridad');
const precios = require('../servicios/precios');
const puntos = require('../servicios/puntos');
const resenas = require('../servicios/resenas');
const { TIPOS_EVENTO } = require('../lib/util');
const { requiereCliente, DIAS_CLIENTE } = require('../middleware/auth');
const { texto } = require('../lib/util');

const router = express.Router();
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Solo aceptamos rutas internas en "volver" (evita redirigir a sitios ajenos).
const volverSeguro = v => (typeof v === 'string' && /^\/(?!\/)/.test(v) ? v : '/cuenta');

const limiteLogin = limitar({ clave: 'login', max: 10, ventanaMin: 15, mensaje: 'Demasiados intentos. Espera 15 minutos.' });

const limpiarCelularGoogle = v => String(v || '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');

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
  // Las cuentas del personal entran solo por /admin con contraseña, nunca con Google.
  if (u && u.rol !== 'cliente') return res.status(403).json({ ok: false, error: 'Ese correo es del personal: ingresa por el panel.' });
  if (!u) {
    u = await db.insertar('usuarios', { rol: 'cliente', nombre: info.name || email.split('@')[0], email, google_sub: info.sub });
  } else if (!u.google_sub) {
    u = await db.actualizar('usuarios', u.id, { google_sub: info.sub });
  }
  req.session.uid = u.id;
  req.sessionOptions.maxAge = DIAS_CLIENTE * 24 * 3600 * 1000;
  // Cliente nuevo (o sin celular): Google ya nos dio su nombre y correo verificado;
  // solo falta el celular (WhatsApp), que se pide en una pantalla de un solo campo.
  const volver = volverSeguro(req.body?.volver);
  res.json({ ok: true, volver: u.celular ? volver : `/cuenta/completar?volver=${encodeURIComponent(volver)}` });
}));

// ── Completar el registro: pedir el celular después de entrar con Google ─────
router.get('/completar', requiereCliente, (req, res) => {
  const volver = volverSeguro(req.query.volver);
  if (req.usuario.celular) return res.redirect(volver);
  res.render('cuenta/completar', { titulo: 'Tu celular', volver, error: null, datos: { nombre: req.usuario.nombre } });
});

router.post('/completar', requiereCliente, limiteLogin, a(async (req, res) => {
  const volver = volverSeguro(req.body.volver);
  const celular = limpiarCelularGoogle(req.body.celular);
  const nombre = texto(req.body.nombre, 80) || req.usuario.nombre;
  const mostrar = error => res.status(400).render('cuenta/completar', { titulo: 'Tu celular', volver, error, datos: { celular, nombre } });
  if (!/^9\d{8}$/.test(celular)) return mostrar('Escribe tu celular de 9 dígitos (empieza en 9).');
  if (nombre.length < 2) return mostrar('Escribe tu nombre.');
  const otro = await db.buscarUno('usuarios', { celular });
  if (otro && otro.id !== req.usuario.id) return mostrar('Ese celular ya está registrado en otra cuenta. Si es tuyo, escríbenos por WhatsApp y lo unimos.');
  await db.actualizar('usuarios', req.usuario.id, { celular, nombre });
  req.flash('exito', `¡Listo, ${nombre.split(' ')[0]}! Tu cuenta quedó lista y te recordaremos en este dispositivo.`);
  res.redirect(volver);
}));

// Cualquier correo válido (Gmail, Hotmail, Outlook, Yahoo, el de la universidad...).
// Antes solo Gmail; ahora Gmail sigue recomendado por el botón de Google (un toque),
// pero quien no tiene Gmail igual puede crear su cuenta con correo + celular.
const esCorreo = e => /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e);
const limpiarCelular = v => String(v || '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');
// Para los mensajes: muestra el correo a medias (a•••z@gmail.com).
const ocultarCorreo = e => e.replace(/^(.)(.*)(.)@/, (m, a, b, c) => `${a}${'•'.repeat(Math.min(b.length, 5))}${c}@`);

router.post('/ingresar', limiteLogin, a(async (req, res) => {
  const email = texto(req.body.email, 120).toLowerCase();
  const celular = limpiarCelular(req.body.celular);
  const nombre = texto(req.body.nombre, 80);
  const pin = String(req.body.pin || '');
  const volver = volverSeguro(req.body.volver);
  const mostrar = (error, extra = {}) => res.status(400).render('cuenta/ingresar', { titulo: 'Ingresar', volver, error, datos: { email, celular, nombre, ...extra } });

  if (!esCorreo(email)) return mostrar('Escribe un correo válido, por ejemplo tunombre@gmail.com.');
  if (!/^9\d{8}$/.test(celular)) return mostrar('Escribe tu celular de 9 dígitos (empieza en 9).');

  let u = await db.buscarUno('usuarios', { email });
  if (u) {
    if (u.rol !== 'cliente') return mostrar('Ese correo es del personal: ingresa por el panel.');
    if (u.celular && u.celular !== celular) return mostrar('El celular no coincide con el de ese correo. Si cambiaste de número, escríbenos por WhatsApp.');
    if (!u.celular) u = await db.actualizar('usuarios', u.id, { celular });
  } else {
    const porCelular = await db.buscarUno('usuarios', { celular });
    if (porCelular?.email) return mostrar(`Ese celular ya está registrado con otro correo (${ocultarCorreo(porCelular.email)}).`);
    if (porCelular) {
      // Cuenta antigua de celular + PIN: se pide el PIN una sola vez para unirle este correo.
      if (!pin) return mostrar('Tu celular ya tiene una cuenta con PIN. Escríbelo esta única vez para unirle tu correo.', { pedirPin: true });
      if (!verificarClave(pin, porCelular.clave_hash)) return mostrar('El PIN no coincide con ese celular.', { pedirPin: true });
      u = await db.actualizar('usuarios', porCelular.id, { email });
    } else {
      if (nombre.length < 2) return mostrar('Es tu primera vez: escribe tu nombre para crear tu cuenta.', { nuevo: true });
      u = await db.insertar('usuarios', { rol: 'cliente', nombre, email, celular });
    }
  }
  const csrfActual = req.session.csrf;
  req.session = { uid: u.id, csrf: csrfActual };
  req.sessionOptions.maxAge = DIAS_CLIENTE * 24 * 3600 * 1000;
  req.flash('exito', `¡Hola, ${u.nombre.split(' ')[0]}! Quedarás recordado en este dispositivo.`);
  res.redirect(volver);
}));

// Ruta anterior (celular + PIN): se mantiene para no romper formularios viejos; ahora pide correo + celular.
router.post('/celular', (req, res) => res.redirect(303, `/cuenta/ingresar?volver=${encodeURIComponent(volverSeguro(req.body.volver))}`));

router.post('/salir', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// Mi cuenta: puntos, si ya es cliente habitual, y sus reservas con "Repetir".
router.get('/', requiereCliente, a(async (req, res) => {
  const [mias, r] = await Promise.all([
    db.listar('reservas', { filtro: { usuario_id: req.usuario.id }, orden: 'creado_en', desc: true }),
    precios.reglas()
  ]);
  const saldo = puntos.calcularSaldo(mias, r);
  const frecuente = await precios.esFrecuente(req.usuario.id, r);
  // "Repetir": arma el carrito de una reserva anterior (combo + adicionales o equipos sueltos).
  const combos = Object.fromEntries((await db.listar('combos')).map(c => [c.id, c]));
  const repetir = Object.fromEntries(mias.map(x => {
    const combo = x.combo_id && combos[x.combo_id]?.publicado ? combos[x.combo_id] : null;
    const carrito = combo
      ? { combo_id: combo.id, adicionales: (x.adicionales || []).map(ad => (combo.adicionales || []).findIndex(c => c.etiqueta === ad.etiqueta)).filter(i => i >= 0), items: [] }
      : { combo_id: null, adicionales: [], items: (x.items || []).map(({ equipo_id, cantidad }) => ({ equipo_id, cantidad })) };
    return [x.codigo, { ...carrito, horas: x.horas, personas: x.personas, espacio: x.espacio, tipo_evento: x.tipo_evento, lugar: x.lat ? { texto: x.lugar, lat: x.lat, lng: x.lng } : null, acceso_vehicular: x.encuesta?.acceso_vehicular ?? null }];
  }));
  // Reseñas: una por cada evento completado; se muestra cuáles ya tienen la suya.
  const conResena = new Set((await resenas.todas()).filter(x => x.usuario_id === req.usuario.id).map(x => x.reserva_codigo));
  res.render('cuenta/panel', { titulo: 'Mi cuenta', reservas: mias, saldo, frecuente, reglas: r, repetir, conResena });
}));

// El cliente deja su reseña de un evento COMPLETADO (una por reserva).
// Llega sin publicar: el admin la revisa en Admin → Reseñas.
router.post('/resenas', requiereCliente, a(async (req, res) => {
  const codigo = texto(req.body.codigo, 20);
  const reserva = await db.buscarUno('reservas', { codigo });
  if (!reserva || reserva.usuario_id !== req.usuario.id || reserva.estado !== 'completada') {
    req.flash('error', 'Solo puedes dejar una reseña de tus eventos ya realizados.');
    return res.redirect('/cuenta');
  }
  if ((await resenas.todas()).some(x => x.reserva_codigo === codigo)) {
    req.flash('aviso', 'Ya dejaste tu reseña de ese evento. ¡Gracias!');
    return res.redirect('/cuenta');
  }
  const tipo = TIPOS_EVENTO[reserva.tipo_evento]?.label || 'Evento';
  const { datos, errores } = resenas.validar({ ...req.body, nombre: req.usuario.nombre, evento: `${tipo} · ${reserva.fecha_evento.slice(0, 4)}` });
  if (Object.keys(errores).length) {
    req.flash('error', Object.values(errores).join(' '));
    return res.redirect('/cuenta');
  }
  // Para la portada basta el nombre y la inicial del apellido.
  const partes = datos.nombre.split(' ');
  datos.nombre = partes.length > 1 ? `${partes[0]} ${partes[1][0]}.` : partes[0];
  await resenas.agregar(datos, { origen: 'cliente', reserva_codigo: codigo, usuario_id: req.usuario.id });
  req.flash('exito', '¡Gracias por tu reseña! La publicaremos después de revisarla.');
  res.redirect('/cuenta');
}));

module.exports = router;
