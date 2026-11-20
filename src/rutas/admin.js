// ============================================================================
//  src/rutas/admin.js — panel de administración (/admin)
//
//  Páginas EJS clásicas: el formulario hace POST, Express valida, guarda y
//  redirige (patrón PRG: Post → Redirect → Get, así recargar no reenvía).
//  Si hay errores, se vuelve a mostrar el formulario con lo escrito y el
//  mensaje junto a cada campo.
//
//  Quién ve qué:
//   publicador → Inicio, Combos, Galería (publicaciones) y subir fotos.
//   admin      → todo lo anterior + Equipos, Reservas, Clientes, Mensajes,
//                Promociones, Ajustes, Usuarios y Respaldo.
// ============================================================================

const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const catalogo = require('../servicios/catalogo');
const reservasSrv = require('../servicios/reservas');
const precios = require('../servicios/precios');
const resenas = require('../servicios/resenas');
const puntosSrv = require('../servicios/puntos');
const negocio = require('../servicios/negocio');
const { requiereStaff, requiereClave, claveVigente, iniciarSesionPersonal, emailPrincipal, CONFIRMACION_MIN } = require('../middleware/auth');
const { hashClave, verificarClave, limitar } = require('../lib/seguridad');
const { CATEGORIAS, TIPOS_EVENTO, ESTADOS_RESERVA, texto, numero, hoyLima } = require('../lib/util');
const util = require('../lib/util');
const TABLAS = require('../db/tablas');
const { a, volverSeguro, volverA } = require('../controladores/comun');
const ctlEquipos = require('../controladores/admin/equipos');
const ctlCombos = require('../controladores/admin/combos');
const ctlGaleria = require('../controladores/admin/galeria');
const ctlReservas = require('../controladores/admin/reservas');
const ctlClientes = require('../controladores/admin/clientes');

const router = express.Router();
const soloAdmin = requiereStaff();
const staff = requiereStaff('publicador');

// Variables comunes de todas las vistas del panel.
router.use(async (req, res, next) => {
  res.locals.seccion = req.path.split('/')[1] || 'inicio';
  res.locals.CATEGORIAS = CATEGORIAS;
  res.locals.TIPOS_EVENTO = TIPOS_EVENTO;
  res.locals.ESTADOS_RESERVA = ESTADOS_RESERVA;
  res.locals.pendientes = { mensajes: 0, yape: 0, resenas: 0 };
  // admin.js lo lee para no pedir la contraseña otra vez si se confirmó hace poco.
  res.locals.claveVigente = claveVigente(req);
  res.locals.CONFIRMACION_MIN = CONFIRMACION_MIN;
  if (['admin'].includes(req.usuario?.rol)) {
    try {
      const [msjs, pagos] = await Promise.all([db.listar('mensajes', { filtro: { leido: false } }), db.listar('pagos', { filtro: { estado: 'pendiente' } })]);
      res.locals.pendientes = { mensajes: msjs.length, yape: pagos.filter(p => p.metodo === 'yape').length, resenas: (await resenas.todas()).filter(x => !x.publicado && x.origen === 'cliente').length };
    } catch (err) { return next(err); }
  }
  next();
});

// Conversores de campos de formulario (compartidos con los validadores).
const { marcado, entero, urlImagen, opcional } = require('../validadores/formulario');

// ── Ingreso del personal ────────────────────────────────────────────────────
const HASH_FALSO = hashClave(crypto.randomBytes(12).toString('hex'));
const limiteLogin = limitar({ clave: 'admin-login', max: 8, ventanaMin: 15, mensaje: 'Demasiados intentos. Espera 15 minutos.' });
router.get('/ingresar', (req, res) => {
  if (['admin', 'publicador'].includes(req.usuario?.rol)) return res.redirect('/admin');
  // Aviso de una sola vez cuando la sesión se cerró por inactividad.
  const aviso = req.session.aviso || null;
  req.session.aviso = null;
  res.render('admin/ingresar', { titulo: 'Ingreso del personal', error: null, aviso, email: '', volver: volverSeguro(req.query.volver) });
});

router.post('/ingresar', limiteLogin, a(async (req, res) => {
  const email = texto(req.body.email, 120).toLowerCase();
  const u = email && await db.buscarUno('usuarios', { email });
  // Si el correo no existe igual se calcula un hash: así la respuesta tarda lo mismo
  // y no se puede averiguar qué correos tienen cuenta midiendo el tiempo.
  const claveOk = verificarClave(req.body.clave || '', u?.clave_hash || HASH_FALSO);
  const ok = u && ['admin', 'publicador'].includes(u.rol) && claveOk;
  if (!ok) {
    return res.status(401).render('admin/ingresar', { titulo: 'Ingreso del personal', error: 'Correo o contraseña incorrectos.', aviso: null, email, volver: volverSeguro(req.body.volver) });
  }
  iniciarSesionPersonal(req, u);
  res.redirect(volverSeguro(req.body.volver));
}));

router.post('/salir', (req, res) => {
  req.session = null;
  res.redirect('/admin/ingresar');
});

// Acciones delicadas: piden la contraseña (ver requiereClave en middleware/auth.js).
// Se decide por la ruta para que ninguna nueva ruta de eliminar quede sin protección.
const esDelicada = req => req.method === 'POST' && (req.path.endsWith('/eliminar') || req.path.endsWith('/precio') || req.path.startsWith('/usuarios') || req.path.startsWith('/respaldo'));
router.use((req, res, next) => (esDelicada(req) ? requiereClave(req, res, next) : next()));

// ── Inicio / agenda ─────────────────────────────────────────────────────────
// La agenda muestra el mes con los eventos de cada día y la lista de los
// próximos con botones rápidos (confirmar, completar) para no tener que
// entrar a cada reserva.
router.get('/', staff, a(async (req, res) => {
  const hoy = hoyLima();
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoy.slice(0, 7);
  const [reservas, mensajes, pagos, equipos, combos] = await Promise.all([
    db.listar('reservas', { orden: 'fecha_evento' }),
    db.listar('mensajes', { orden: 'creado_en', desc: true }),
    db.listar('pagos', { orden: 'creado_en', desc: true }),
    db.listar('equipos'),
    db.listar('combos')
  ]);
  const activas = reservas.filter(r => !['cancelada', 'expirada'].includes(r.estado));
  res.render('admin/inicio', {
    titulo: 'Inicio',
    hoy, mes,
    delMes: activas.filter(r => r.fecha_evento.startsWith(mes)),
    proximas: activas.filter(r => r.fecha_evento >= hoy && r.estado !== 'completada').slice(0, 12),
    solicitudes: mensajes.filter(m => m.tipo === 'fecha_ocupada' && !m.leido),
    yapePendientes: pagos.filter(p => p.metodo === 'yape' && p.estado === 'pendiente').map(p => ({ ...p, reserva: reservas.find(r => r.id === p.reserva_id) })),
    stats: {
      porPagar: activas.filter(r => r.estado === 'pendiente_pago').length,
      confirmadas: activas.filter(r => ['adelanto_pagado', 'confirmada'].includes(r.estado) && r.fecha_evento >= hoy).length,
      adelantosMes: pagos.filter(p => p.estado === 'aprobado' && (p.creado_en || '').startsWith(hoy.slice(0, 7))).reduce((s, p) => s + Number(p.monto), 0),
      equipos: equipos.length,
      combos: combos.filter(c => c.publicado).length
    }
  });
}));

// ── Fotos (publicador y admin) ──────────────────────────────────────────────
// El navegador ya reduce la foto a máx. 1600 px (admin.js del front) y la manda
// en base64. Aquí validamos tipo y tamaño y la guardamos (disco o Supabase Storage).
const TIPOS_FOTO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
router.post('/fotos', staff, a(async (req, res) => {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.datos || '');
  if (!m) return res.status(400).json({ ok: false, error: 'Solo se aceptan fotos JPG, PNG o WEBP.' });
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 4 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'La foto pesa más de 4 MB incluso reducida.' });
  const nombre = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${TIPOS_FOTO[m[1]]}`;
  res.json({ ok: true, url: await db.guardarFoto(nombre, buffer, m[1]) });
}));

// ── Equipos (admin) ─────────────────────────────────────────────────────────
// Solo URL + permiso: la lógica está en controladores/admin/equipos.js,
// las reglas en servicios/equipos.js y la validación en validadores/equipos.js.
router.get('/equipos', soloAdmin, a(ctlEquipos.lista));
router.get('/equipos/nuevo', soloAdmin, a(ctlEquipos.nuevo));
router.post('/equipos', soloAdmin, a(ctlEquipos.crear));
router.get('/equipos/:id/editar', soloAdmin, a(ctlEquipos.editar));
router.post('/equipos/:id', soloAdmin, a(ctlEquipos.guardar));
router.post('/equipos/:id/publicado', soloAdmin, a(ctlEquipos.alternarPublicado));
router.post('/equipos/:id/estado', soloAdmin, a(ctlEquipos.cambiarEstado));
router.post('/equipos/:id/eliminar', soloAdmin, a(ctlEquipos.eliminar));

// ── Combos (publicador y admin) ─────────────────────────────────────────────
router.get('/combos', staff, a(ctlCombos.lista));
router.get('/combos/nuevo', staff, a(ctlCombos.nuevo));
router.post('/combos', staff, a(ctlCombos.crear));
router.get('/combos/:id/editar', staff, a(ctlCombos.editar));
router.post('/combos/:id', staff, a(ctlCombos.guardar));
router.post('/combos/:id/publicado', staff, a(ctlCombos.alternarPublicado));
router.post('/combos/:id/eliminar', staff, a(ctlCombos.eliminar));

// ── Galería / publicaciones (publicador y admin) ────────────────────────────
router.get('/galeria', staff, a(ctlGaleria.lista));
router.get('/galeria/nueva', staff, ctlGaleria.nueva);
router.post('/galeria', staff, a(ctlGaleria.crear));
router.get('/galeria/:id/editar', staff, a(ctlGaleria.editar));
router.post('/galeria/:id', staff, a(ctlGaleria.guardar));
router.post('/galeria/:id/publicado', staff, a(ctlGaleria.alternarPublicado));
router.post('/galeria/:id/eliminar', staff, a(ctlGaleria.eliminar));

// ── Reservas y pagos (admin) ────────────────────────────────────────────────
// Reglas en servicios/reservas-admin.js; respuesta en controladores/admin/reservas.js.
router.get('/reservas', soloAdmin, a(ctlReservas.lista));
router.get('/reservas/nueva', soloAdmin, a(ctlReservas.nueva));
router.post('/reservas/cotizar', soloAdmin, a(ctlReservas.cotizar));
router.post('/reservas/nueva', soloAdmin, a(ctlReservas.crear));
router.get('/reservas/:codigo', soloAdmin, a(ctlReservas.ficha));
router.post('/reservas/:codigo/estado', soloAdmin, a(ctlReservas.cambiarEstado));
router.post('/reservas/:codigo/editar', soloAdmin, a(ctlReservas.editar));
router.post('/reservas/:codigo/eliminar', soloAdmin, a(ctlReservas.eliminar));
router.post('/reservas/:codigo/reunion', soloAdmin, a(ctlReservas.reunion));
router.post('/reservas/:codigo/notas', soloAdmin, a(ctlReservas.notas));
router.post('/reservas/:codigo/precio', soloAdmin, a(ctlReservas.precio));
router.post('/reservas/:codigo/pago-manual', soloAdmin, a(ctlReservas.pagoManual));
router.get('/pagos/:id/comprobante', soloAdmin, a(ctlReservas.comprobante));
router.post('/pagos/:id/:accion', soloAdmin, a(ctlReservas.resolverPago));

// ── Reseñas (admin y publicador) ────────────────────────────────────────────
router.get('/resenas', staff, a(ctlGaleria.resenasLista));
router.post('/resenas', staff, a(ctlGaleria.resenaCrear));
router.post('/resenas/:id', staff, a(ctlGaleria.resenaGuardar));
router.post('/resenas/:id/publicado', staff, a(ctlGaleria.resenaAlternarPublicado));
router.post('/resenas/:id/eliminar', staff, a(ctlGaleria.resenaEliminar));

// ── Clientes (admin) ────────────────────────────────────────────────────────
router.post('/clientes', soloAdmin, a(ctlClientes.crear));
router.get('/clientes/:id', soloAdmin, a(ctlClientes.ficha));
router.post('/clientes/:id', soloAdmin, a(ctlClientes.guardar));
router.post('/clientes/:id/eliminar', soloAdmin, a(ctlClientes.eliminar));
router.get('/clientes', soloAdmin, a(ctlClientes.lista));

// ── Mensajes y solicitudes (admin) ──────────────────────────────────────────
router.get('/mensajes', soloAdmin, a(async (req, res) => {
  res.render('admin/mensajes', { titulo: 'Mensajes', mensajes: await db.listar('mensajes', { orden: 'creado_en', desc: true }) });
}));

router.post('/mensajes/:id/leido', soloAdmin, a(async (req, res) => {
  const m = await db.obtener('mensajes', req.params.id);
  if (m) await db.actualizar('mensajes', m.id, { leido: !m.leido });
  res.redirect('/admin/mensajes');
}));

router.post('/mensajes/:id/eliminar', soloAdmin, a(async (req, res) => {
  await db.eliminar('mensajes', req.params.id);
  req.flash('exito', 'Mensaje eliminado.');
  res.redirect('/admin/mensajes');
}));

// ── Promociones (admin) ─────────────────────────────────────────────────────
function leerPromo(b) {
  const d = {
    codigo: texto(b.codigo, 20).toUpperCase(),
    descripcion: texto(b.descripcion, 200),
    porcentaje: numero(b.porcentaje, NaN),
    solo_frecuentes: marcado(b.solo_frecuentes),
    activo: marcado(b.activo),
    vence: /^\d{4}-\d{2}-\d{2}$/.test(b.vence || '') ? b.vence : null
  };
  const e = {};
  if (!/^[A-Z0-9]{3,20}$/.test(d.codigo)) e.codigo = 'De 3 a 20 letras o números, sin espacios.';
  if (!(d.porcentaje > 0 && d.porcentaje <= 50)) e.porcentaje = 'Entre 1 y 50 %.';
  return { datos: d, errores: e };
}

router.get('/promociones', soloAdmin, a(async (req, res) => {
  res.render('admin/promociones', { titulo: 'Promociones', promociones: await db.listar('promociones', { orden: 'codigo' }), p: { activo: true }, errores: {}, editando: null });
}));

router.get('/promociones/:id/editar', soloAdmin, a(async (req, res, next) => {
  const p = await db.obtener('promociones', req.params.id);
  if (!p) return next();
  res.render('admin/promociones', { titulo: 'Promociones', promociones: await db.listar('promociones', { orden: 'codigo' }), p, errores: {}, editando: p.id });
}));

router.post('/promociones', soloAdmin, a(async (req, res) => {
  const editando = req.body.id || null;
  const { datos, errores } = leerPromo(req.body);
  const repetido = await db.buscarUno('promociones', { codigo: datos.codigo });
  if (repetido && repetido.id !== editando) errores.codigo = 'Ya existe ese código.';
  if (Object.keys(errores).length) {
    return res.status(400).render('admin/promociones', { titulo: 'Promociones', promociones: await db.listar('promociones', { orden: 'codigo' }), p: { ...datos, id: editando }, errores, editando });
  }
  if (editando) await db.actualizar('promociones', editando, datos);
  else await db.insertar('promociones', datos);
  req.flash('exito', `Promoción ${datos.codigo} guardada.`);
  res.redirect('/admin/promociones');
}));

router.post('/promociones/:id/eliminar', soloAdmin, a(async (req, res) => {
  await db.eliminar('promociones', req.params.id);
  req.flash('exito', 'Promoción eliminada.');
  res.redirect('/admin/promociones');
}));

// ── Ajustes del negocio (admin) ─────────────────────────────────────────────
router.get('/ajustes', soloAdmin, a(async (req, res) => {
  // Las reglas se leen con sus valores por defecto (precios.reglas) para que los campos nuevos no salgan vacíos.
  const [n, vehiculos, portada, reglas] = await Promise.all([...['negocio', 'vehiculos', 'portada'].map(k => db.ajuste(k)), precios.reglas()]);
  res.render('admin/ajustes', { titulo: 'Ajustes', n: n || {}, reglas, vehiculos: vehiculos || [], portada: portada || {}, errores: {} });
}));

router.post('/ajustes/negocio', soloAdmin, a(async (req, res) => {
  const b = req.body;
  const actual = (await db.ajuste('negocio')) || {};
  const errores = [];
  const whatsapp = String(b.whatsapp || '').replace(/\D/g, '');
  if (!/^51\d{9}$/.test(whatsapp)) errores.push('WhatsApp: código de país 51 + 9 dígitos (ej. 51987166001).');
  const lat = numero(b.almacen_lat, NaN), lng = numero(b.almacen_lng, NaN);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) errores.push('Ubicación del almacén inválida.');
  if (errores.length) { req.flash('error', errores.join(' ')); return res.redirect('/admin/ajustes'); }
  await db.guardarAjuste('negocio', {
    ...actual,
    nombre: texto(b.nombre, 80) || actual.nombre,
    eslogan: texto(b.eslogan, 120),
    descripcion: texto(b.descripcion, 400),
    telefono: String(b.telefono || '').replace(/\D/g, '').slice(0, 12),
    whatsapp,
    correo: texto(b.correo, 120),
    direccion: texto(b.direccion, 160),
    horario: texto(b.horario, 80),
    eventos_realizados: Math.max(0, Math.round(numero(b.eventos_realizados, 0))) || null,
    redes: { instagram: urlImagen(b.instagram) ?? '', facebook: urlImagen(b.facebook) ?? '', tiktok: urlImagen(b.tiktok) ?? '' },
    almacen: { lat, lng, direccion: texto(b.almacen_direccion, 160) },
    yape: { numero: String(b.yape_numero || '').replace(/\D/g, '').slice(0, 9), titular: texto(b.yape_titular, 80), qr_url: urlImagen(b.yape_qr) || '' },
    plin: { numero: String(b.plin_numero || '').replace(/\D/g, '').slice(0, 9), titular: texto(b.plin_titular, 80), qr_url: urlImagen(b.plin_qr) || '' },
    // Una condición por línea. Vacío = se usan las condiciones por defecto (servicios/negocio.js).
    clausulas: String(b.clausulas || '').split(/\r?\n/).map(l => texto(l, 300)).filter(l => l.length > 3).slice(0, 12)
  });
  negocio.invalidar();
  req.flash('exito', 'Datos del negocio guardados.');
  res.redirect('/admin/ajustes');
}));

router.post('/ajustes/reglas', soloAdmin, a(async (req, res) => {
  const b = req.body;
  // Se parte de lo guardado: así no se pierden reglas que este formulario no muestra.
  const actuales = await precios.reglas();
  const vehiculosGratis = [].concat(b.vehiculos_transporte_gratis || []).map(v => texto(v, 20)).filter(Boolean);
  const r = {
    ...actuales,
    adelanto_pct: numero(b.adelanto_pct, NaN),
    horas_bloqueo: entero(b.horas_bloqueo, NaN),
    horas_jornada: entero(b.horas_jornada, NaN),
    factor_hora_extra: numero(b.factor_hora_extra, NaN),
    tecnico_por_evento: numero(b.tecnico_por_evento, NaN),
    descuento_frecuente_pct: numero(b.descuento_frecuente_pct, NaN),
    reservas_para_frecuente: entero(b.reservas_para_frecuente, NaN),
    vehiculos_transporte_gratis: vehiculosGratis,
    km_transporte_gratis: numero(b.km_transporte_gratis, NaN),
    altura_max_gratis_m: entero(b.altura_max_gratis_m, NaN),
    recargo_sin_acceso: numero(b.recargo_sin_acceso, NaN),
    // Puntos por frecuencia (ver src/servicios/puntos.js)
    puntos_cada_soles: numero(b.puntos_cada_soles, NaN),
    puntos_canje: entero(b.puntos_canje, NaN),
    soles_canje: numero(b.soles_canje, NaN)
  };
  delete r.factor_jornada_extra; delete r.tecnico_por_jornada; // nombres de la versión anterior
  const ok = r.adelanto_pct >= 10 && r.adelanto_pct <= 100 && r.horas_bloqueo >= 1 && r.horas_bloqueo <= 168 && r.horas_jornada >= 1 && r.horas_jornada <= 12 &&
    r.factor_hora_extra >= 0 && r.factor_hora_extra <= 2 && r.tecnico_por_evento >= 0 && r.descuento_frecuente_pct >= 0 && r.descuento_frecuente_pct <= 50 && r.reservas_para_frecuente >= 1 &&
    r.km_transporte_gratis >= 0 && r.km_transporte_gratis <= 200 && r.altura_max_gratis_m >= 0 && r.altura_max_gratis_m <= 6000 && r.recargo_sin_acceso >= 0 &&
    r.puntos_cada_soles >= 1 && r.puntos_canje >= 1 && r.soles_canje >= 0;
  if (!ok) { req.flash('error', 'Revisa los valores: adelanto 10–100 %, bloqueo 1–168 h, horas del evento 1–12, factor 0–2, descuento 0–50 %, km 0–200, altura 0–6000 m.'); return res.redirect('/admin/ajustes#reglas'); }
  await db.guardarAjuste('reglas', r);
  req.flash('exito', 'Reglas de precios guardadas.');
  res.redirect('/admin/ajustes#reglas');
}));

router.post('/ajustes/vehiculos', soloAdmin, a(async (req, res) => {
  const filas = Array.isArray(req.body.vehiculos) ? req.body.vehiculos : Object.values(req.body.vehiculos || {});
  const vehiculos = filas.map(v => ({
    id: texto(v.id, 20) || crypto.randomUUID().slice(0, 6),
    nombre: texto(v.nombre, 60),
    descripcion: texto(v.descripcion, 200),
    capacidad_l: numero(v.capacidad_l, NaN),
    capacidad_kg: numero(v.capacidad_kg, NaN),
    largo_max_cm: numero(v.largo_max_cm, NaN),
    base: numero(v.base, NaN),
    por_km: numero(v.por_km, NaN)
  })).filter(v => v.nombre);
  const valido = vehiculos.length && vehiculos.every(v => ['capacidad_l', 'capacidad_kg', 'largo_max_cm', 'base', 'por_km'].every(k => v[k] >= 0));
  if (!valido) { req.flash('error', 'Cada vehículo necesita nombre y valores numéricos de 0 o más.'); return res.redirect('/admin/ajustes#vehiculos'); }
  await db.guardarAjuste('vehiculos', vehiculos);
  req.flash('exito', 'Vehículos y tarifas guardados.');
  res.redirect('/admin/ajustes#vehiculos');
}));

router.post('/ajustes/portada', soloAdmin, a(async (req, res) => {
  const p = {};
  for (const k of ['hero', 'boda', 'electronica', 'corporativo']) p[k] = urlImagen(req.body[k]) || '';
  if (!p.hero) { req.flash('error', 'La foto de fondo de la portada necesita una URL válida o una foto subida.'); return res.redirect('/admin/ajustes#portada'); }
  p.fuentes = texto(req.body.fuentes, 200);
  await db.guardarAjuste('portada', p);
  negocio.invalidar();
  req.flash('exito', 'Fotos de portada guardadas.');
  res.redirect('/admin/ajustes#portada');
}));

// ── Usuarios del personal (admin) ───────────────────────────────────────────
// CRUD completo: crear, editar (nombre, rol, nueva contraseña) y eliminar.
// Reglas que protegen al negocio de quedarse sin dueño:
//  • la cuenta principal (ADMIN_EMAIL, la del dueño) no se borra ni baja de rol;
//  • nadie se borra ni se quita el rol de admin a sí mismo;
//  • siempre queda al menos un administrador.
// Todas estas rutas piden la contraseña de quien las usa (esDelicada).
const ROLES = { admin: 'Administrador', publicador: 'Publicador' };
const correoValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
// Contraseña del personal: 10+ caracteres con letras y números.
const claveDebil = c => (c.length < 10 || !/[a-zA-Z]/.test(c) || !/\d/.test(c) ? 'Mínimo 10 caracteres, con letras y números.' : null);
const esPrincipal = u => Boolean(u?.email && u.email === emailPrincipal());

async function vistaUsuarios(res, { errores = {}, datos = { rol: 'publicador' }, editar = null, estado = 200 } = {}) {
  const todos = await db.listar('usuarios', { orden: 'creado_en' });
  res.status(estado).render('admin/usuarios', {
    titulo: 'Usuarios', personal: todos.filter(u => u.rol !== 'cliente'), errores, datos, editar, ROLES, esPrincipal
  });
}

router.get('/usuarios', soloAdmin, a(async (req, res) => {
  const editar = req.query.editar ? await db.obtener('usuarios', String(req.query.editar)) : null;
  await vistaUsuarios(res, { editar: editar && editar.rol !== 'cliente' ? editar : null });
}));

router.post('/usuarios', soloAdmin, a(async (req, res) => {
  const datos = { nombre: texto(req.body.nombre, 80), email: texto(req.body.email, 120).toLowerCase(), rol: ROLES[req.body.rol] ? req.body.rol : 'publicador' };
  const errores = {};
  if (datos.nombre.length < 2) errores.nombre = 'Escribe el nombre.';
  if (!correoValido(datos.email)) errores.email = 'Correo inválido.';
  else if (await db.buscarUno('usuarios', { email: datos.email })) errores.email = 'Ese correo ya tiene cuenta.';
  const debil = claveDebil(String(req.body.clave || ''));
  if (debil) errores.clave = debil;
  if (Object.keys(errores).length) return vistaUsuarios(res, { errores, datos, estado: 400 });
  await db.insertar('usuarios', { ...datos, clave_hash: hashClave(req.body.clave) });
  req.flash('exito', `Cuenta creada para ${datos.email} (${ROLES[datos.rol]}).`);
  res.redirect('/admin/usuarios');
}));

router.post('/usuarios/:id', soloAdmin, a(async (req, res, next) => {
  const u = await db.obtener('usuarios', req.params.id);
  if (!u || u.rol === 'cliente') return next();
  const cambios = { nombre: texto(req.body.nombre, 80), rol: ROLES[req.body.rol] ? req.body.rol : u.rol };
  const errores = {};
  if (cambios.nombre.length < 2) errores.nombre = 'Escribe el nombre.';
  if (cambios.rol !== 'admin' && u.rol === 'admin') {
    if (esPrincipal(u)) errores.rol = 'La cuenta principal del negocio siempre es administradora.';
    else if (u.id === req.usuario.id) errores.rol = 'No puedes quitarte el rol de administrador a ti mismo.';
    else if ((await db.listar('usuarios', { filtro: { rol: 'admin' } })).length <= 1) errores.rol = 'Debe quedar al menos un administrador.';
  }
  const nueva = String(req.body.clave_nueva || '');
  if (nueva) { const debil = claveDebil(nueva); if (debil) errores.clave_nueva = debil; else cambios.clave_hash = hashClave(nueva); }
  if (Object.keys(errores).length) return vistaUsuarios(res, { errores, editar: { ...u, ...cambios }, estado: 400 });
  await db.actualizar('usuarios', u.id, cambios);
  req.flash('exito', `Cuenta de ${u.email} actualizada${nueva ? ' (con contraseña nueva)' : ''}.`);
  res.redirect('/admin/usuarios');
}));

router.post('/usuarios/:id/eliminar', soloAdmin, a(async (req, res) => {
  const u = await db.obtener('usuarios', req.params.id);
  if (!u || u.rol === 'cliente') req.flash('error', 'Esa cuenta no existe.');
  else if (u.id === req.usuario.id) req.flash('error', 'No puedes eliminar tu propia cuenta.');
  else if (esPrincipal(u)) req.flash('error', 'La cuenta principal del negocio no se puede eliminar.');
  else if (u.rol === 'admin' && (await db.listar('usuarios', { filtro: { rol: 'admin' } })).length <= 1) req.flash('error', 'Debe quedar al menos un administrador.');
  else { await db.eliminar('usuarios', u.id); req.flash('exito', `Se quitó el acceso de ${u.email}.`); }
  res.redirect('/admin/usuarios');
}));

// ── Respaldo (admin) ────────────────────────────────────────────────────────
// Útil siempre (copia de seguridad) y obligatorio si usas el modo local en un
// hosting gratis, donde el disco se borra al redesplegar.
router.get('/respaldo', soloAdmin, a(async (req, res) => {
  const tareas = require('../servicios/tareas');
  const automaticos = await tareas.listar().catch(() => []);
  res.render('admin/respaldo', { titulo: 'Respaldo', motor: db.motor, automaticos, dias: tareas.DIAS_RESPALDO, tareaActiva: Boolean(process.env.TAREAS_TOKEN?.trim()) });
}));

// Descargar un respaldo automático (pide contraseña: ruta delicada /respaldo...).
router.post('/respaldo/automatico', soloAdmin, a(async (req, res, next) => {
  const nombre = texto(req.body.nombre, 120);
  const archivo = await require('../servicios/tareas').leer(nombre);
  if (!archivo) return next();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre.split('/').pop()}"`);
  res.send(archivo);
}));

// Hacer un respaldo automático ahora mismo (sin esperar a la tarea del día).
router.post('/respaldo/ahora', soloAdmin, a(async (req, res) => {
  const r = await require('../servicios/tareas').respaldoDiario();
  req.flash('exito', `Respaldo guardado: ${r.archivo.split('/').pop()} (${r.kb} KB).`);
  res.redirect('/admin/respaldo');
}));

// POST (no GET) para poder pedir la contraseña: el respaldo trae TODOS los datos,
// incluidos los de los clientes, así que no debe bajarse con solo abrir un enlace.
router.post('/respaldo/descargar', soloAdmin, a(async (req, res) => {
  const datos = await db.exportar();
  res.setHeader('Content-Disposition', `attachment; filename="aees-respaldo-${hoyLima()}.json"`);
  res.json({ version: 1, generado: new Date().toISOString(), ...datos });
}));

router.post('/respaldo/restaurar', soloAdmin, a(async (req, res) => {
  const b = req.body || {};
  const tablas = TABLAS.filter(t => Array.isArray(b[t]));
  if (!tablas.length || !Array.isArray(b.equipos) || b.equipos.some(e => !e.id || !e.nombre)) {
    return res.status(400).json({ ok: false, error: 'Ese archivo no parece un respaldo de AeeS (faltan tablas o equipos válidos).' });
  }
  await db.importar(Object.fromEntries(tablas.map(t => [t, b[t]])));
  negocio.invalidar();
  res.json({ ok: true, tablas, equipos: b.equipos.length });
}));

module.exports = router;
