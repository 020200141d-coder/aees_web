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

const router = express.Router();
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
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

// ── Helpers de formularios ──────────────────────────────────────────────────
const marcado = v => v === 'on' || v === 'true' || v === true;
const entero = (v, def = 0) => Math.round(numero(v, def));
const urlImagen = v => {
  const s = texto(v, 600);
  return !s || /^https:\/\/\S+$/.test(s) || /^\/(img|uploads)\/\S+$/.test(s) ? s : null;
};
const opcional = v => (v === '' || v == null ? null : numero(v, null));

// ── Ingreso del personal ────────────────────────────────────────────────────
const HASH_FALSO = hashClave(crypto.randomBytes(12).toString('hex'));
const limiteLogin = limitar({ clave: 'admin-login', max: 8, ventanaMin: 15, mensaje: 'Demasiados intentos. Espera 15 minutos.' });
const volverSeguro = v => (typeof v === 'string' && /^\/admin(\/|$|\?)/.test(v) ? v : '/admin');
// Express 5 ya no acepta redirect('back'): volvemos a la página anterior solo si es del panel.
const volverA = (req, porDefecto) => {
  try {
    const u = new URL(req.get('referer'));
    return u.host === req.get('host') ? volverSeguro(u.pathname + u.search) : porDefecto;
  } catch {
    return porDefecto;
  }
};

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
function leerEquipo(b) {
  const d = {
    codigo: texto(b.codigo, 30).toUpperCase(),
    nombre: texto(b.nombre, 120),
    marca: texto(b.marca, 60),
    modelo: texto(b.modelo, 60),
    categoria: b.categoria,
    rol: texto(b.rol, 30).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    descripcion: String(b.descripcion || '').trim().slice(0, 1500),
    precio: numero(b.precio, NaN),
    precio_mayor: opcional(b.precio_mayor),
    mayor_desde: opcional(b.mayor_desde),
    ajuste_sin_dmx: numero(b.ajuste_sin_dmx, 0),
    precio_adicional: opcional(b.precio_adicional),
    cantidad_total: entero(b.cantidad_total, NaN),
    potencia_w: entero(b.potencia_w),
    spl_db: opcional(b.spl_db),
    cobertura_personas: opcional(b.cobertura_personas),
    dimensiones: texto(b.dimensiones, 80),
    volumen_l: numero(b.volumen_l, 0),
    peso_kg: numero(b.peso_kg, 0),
    largo_cm: entero(b.largo_cm),
    imagen: urlImagen(b.imagen),
    imagen_fuente: texto(b.imagen_fuente, 160),
    // Enlace a la página de la foto: las licencias Creative Commons piden citar autor y fuente.
    imagen_fuente_url: /^https:\/\/\S+$/.test(String(b.imagen_fuente_url || '').trim()) ? String(b.imagen_fuente_url).trim().slice(0, 400) : '',
    estado: ['operativo', 'mantenimiento', 'baja'].includes(b.estado) ? b.estado : 'operativo',
    publicado: marcado(b.publicado),
    destacado: marcado(b.destacado),
    orden: entero(b.orden)
  };
  const e = {};
  if (!/^[A-Z0-9-]{2,30}$/.test(d.codigo)) e.codigo = 'Código de 2 a 30 caracteres: letras, números o guiones.';
  if (d.nombre.length < 2) e.nombre = 'El nombre es obligatorio.';
  if (!CATEGORIAS[d.categoria]) e.categoria = 'Elige una categoría.';
  if (!d.rol) e.rol = 'El rol es obligatorio (lo usa el recomendador).';
  if (!(d.precio >= 0)) e.precio = 'El precio debe ser 0 o mayor.';
  if (d.precio_mayor != null && !(d.precio_mayor >= 0)) e.precio_mayor = 'Debe ser 0 o mayor.';
  if ((d.precio_mayor == null) !== (d.mayor_desde == null)) e.mayor_desde = 'Completa ambos: precio por cantidad y desde cuántas unidades.';
  if (d.mayor_desde != null && !(d.mayor_desde >= 2)) e.mayor_desde = 'Desde 2 unidades o más.';
  if (d.precio_adicional != null && !(d.precio_adicional >= 0)) e.precio_adicional = 'Debe ser 0 o mayor.';
  if (!(d.cantidad_total >= 0)) e.cantidad_total = 'La cantidad debe ser 0 o mayor.';
  if (d.volumen_l < 0 || d.peso_kg < 0 || d.largo_cm < 0) e.volumen_l = 'Medidas en 0 o mayores.';
  if (d.imagen === null) e.imagen = 'Pega una URL https o sube una foto.';
  return { datos: d, errores: e };
}

const rolesConocidos = async () => [...new Set((await db.listar('equipos')).map(e => e.rol))].sort();

router.get('/equipos', soloAdmin, a(async (req, res) => {
  const q = texto(req.query.q, 60).toLowerCase();
  const cat = CATEGORIAS[req.query.categoria] ? req.query.categoria : '';
  let equipos = await db.listar('equipos', { orden: 'orden' });
  if (cat) equipos = equipos.filter(e => e.categoria === cat);
  if (q) equipos = equipos.filter(e => `${e.nombre} ${e.marca} ${e.modelo} ${e.codigo}`.toLowerCase().includes(q));
  const libresHoy = await catalogo.disponibilidad(hoyLima());
  res.render('admin/equipos', { titulo: 'Equipos', equipos, q, cat, libresHoy });
}));

router.get('/equipos/nuevo', soloAdmin, a(async (req, res) => {
  res.render('admin/equipo-form', { titulo: 'Nuevo equipo', e: { categoria: 'audio', estado: 'operativo', publicado: true, precio: '', cantidad_total: 1, ajuste_sin_dmx: 0 }, errores: {}, nuevo: true, roles: await rolesConocidos() });
}));

router.post('/equipos', soloAdmin, a(async (req, res) => {
  const { datos, errores } = leerEquipo(req.body);
  const id = datos.codigo.toLowerCase();
  if (!errores.codigo && await db.obtener('equipos', id)) errores.codigo = 'Ya existe un equipo con ese código.';
  if (Object.keys(errores).length) return res.status(400).render('admin/equipo-form', { titulo: 'Nuevo equipo', e: { ...req.body, ...datos }, errores, nuevo: true, roles: await rolesConocidos() });
  await db.insertar('equipos', { id, ...datos });
  req.flash('exito', `Equipo «${datos.nombre}» creado.`);
  res.redirect('/admin/equipos');
}));

router.get('/equipos/:id/editar', soloAdmin, a(async (req, res, next) => {
  const e = await db.obtener('equipos', req.params.id);
  if (!e) return next();
  res.render('admin/equipo-form', { titulo: `Editar ${e.nombre}`, e, errores: {}, nuevo: false, roles: await rolesConocidos() });
}));

router.post('/equipos/:id', soloAdmin, a(async (req, res, next) => {
  const actual = await db.obtener('equipos', req.params.id);
  if (!actual) return next();
  const { datos, errores } = leerEquipo(req.body);
  if (Object.keys(errores).length) return res.status(400).render('admin/equipo-form', { titulo: `Editar ${actual.nombre}`, e: { ...actual, ...datos }, errores, nuevo: false, roles: await rolesConocidos() });
  await db.actualizar('equipos', actual.id, datos);
  req.flash('exito', `Cambios guardados en «${datos.nombre}».`);
  res.redirect('/admin/equipos');
}));

// Interruptor rápido desde la tabla: publicado sí/no.
router.post('/equipos/:id/publicado', soloAdmin, a(async (req, res, next) => {
  const e = await db.obtener('equipos', req.params.id);
  if (!e) return next();
  await db.actualizar('equipos', e.id, { publicado: !e.publicado });
  if (req.get('accept')?.includes('application/json')) return res.json({ ok: true, publicado: !e.publicado });
  res.redirect(volverA(req, '/admin/equipos'));
}));

router.post('/equipos/:id/estado', soloAdmin, a(async (req, res, next) => {
  const e = await db.obtener('equipos', req.params.id);
  if (!e || !['operativo', 'mantenimiento', 'baja'].includes(req.body.estado)) return next();
  await db.actualizar('equipos', e.id, { estado: req.body.estado });
  if (req.get('accept')?.includes('application/json')) return res.json({ ok: true, estado: req.body.estado });
  res.redirect(volverA(req, '/admin/equipos'));
}));

router.post('/equipos/:id/eliminar', soloAdmin, a(async (req, res) => {
  const enCombos = (await db.listar('combos')).filter(c => [...(c.items || []), ...(c.adicionales || [])].some(it => it.equipo_id === req.params.id));
  if (enCombos.length) {
    req.flash('error', `No se puede eliminar: está en ${enCombos.map(c => `«${c.nombre}»`).join(', ')}. Quítalo de esos combos o despublícalo.`);
  } else {
    await db.eliminar('equipos', req.params.id);
    req.flash('exito', 'Equipo eliminado.');
  }
  res.redirect('/admin/equipos');
}));

// ── Combos (publicador y admin) ─────────────────────────────────────────────
function leerCombo(b, mapa) {
  const filas = v => (Array.isArray(v) ? v : Object.values(v || {}));
  const items = filas(b.items).map(it => ({ equipo_id: String(it.equipo_id || ''), cantidad: entero(it.cantidad) })).filter(it => mapa[it.equipo_id] && it.cantidad > 0);
  const adicionales = filas(b.adicionales)
    .map(it => ({ equipo_id: String(it.equipo_id || ''), cantidad: entero(it.cantidad), precio: numero(it.precio, NaN), etiqueta: texto(it.etiqueta, 80) }))
    .filter(it => mapa[it.equipo_id] && it.cantidad > 0);
  const d = {
    nombre: texto(b.nombre, 100),
    nivel: ['esencial', 'fiesta', 'produccion'].includes(b.nivel) ? b.nivel : 'esencial',
    descripcion: String(b.descripcion || '').trim().slice(0, 1500),
    tipos_evento: [].concat(b.tipos_evento || []).filter(t => TIPOS_EVENTO[t]),
    personas_min: entero(b.personas_min),
    personas_max: entero(b.personas_max, 100),
    horas_base: entero(b.horas_base, 4),
    precio: numero(b.precio, NaN),
    items,
    adicionales: adicionales.map(x => ({ ...x, etiqueta: x.etiqueta || `${x.cantidad}× ${mapa[x.equipo_id].nombre}` })),
    imagen: urlImagen(b.imagen),
    imagen_fuente: texto(b.imagen_fuente, 120),
    publicado: marcado(b.publicado),
    destacado: marcado(b.destacado),
    orden: entero(b.orden)
  };
  const e = {};
  if (d.nombre.length < 3) e.nombre = 'El nombre es obligatorio.';
  if (!(d.precio >= 0)) e.precio = 'El precio debe ser 0 o mayor.';
  if (!d.items.length) e.items = 'Agrega al menos un equipo al combo.';
  if (d.adicionales.some(x => !(x.precio >= 0))) e.adicionales = 'Cada adicional necesita un precio de 0 o más.';
  if (!d.tipos_evento.length) e.tipos_evento = 'Marca al menos un tipo de evento (lo usa el asistente para sugerirlo).';
  if (d.personas_min < 0 || d.personas_max < d.personas_min) e.personas_max = 'El máximo debe ser mayor o igual al mínimo.';
  if (!(d.horas_base >= 1 && d.horas_base <= 24)) e.horas_base = 'Entre 1 y 24 horas.';
  if (d.imagen === null) e.imagen = 'Pega una URL https o sube una foto.';
  return { datos: d, errores: e };
}

const datosForm = async () => {
  const equipos = await db.listar('equipos', { orden: 'orden' });
  return { equipos, mapa: catalogo.mapaPorId(equipos) };
};

router.get('/combos', staff, a(async (req, res) => {
  const [combos, { mapa }] = await Promise.all([db.listar('combos', { orden: 'orden' }), datosForm()]);
  res.render('admin/combos', { titulo: 'Combos', combos, mapa });
}));

router.get('/combos/nuevo', staff, a(async (req, res) => {
  const { equipos } = await datosForm();
  res.render('admin/combo-form', { titulo: 'Nuevo combo', c: { nivel: 'esencial', tipos_evento: [], personas_min: 20, personas_max: 100, horas_base: 4, items: [], adicionales: [], publicado: true }, errores: {}, nuevo: true, equipos });
}));

router.post('/combos', staff, a(async (req, res) => {
  const { equipos, mapa } = await datosForm();
  const { datos, errores } = leerCombo(req.body, mapa);
  if (Object.keys(errores).length) return res.status(400).render('admin/combo-form', { titulo: 'Nuevo combo', c: datos, errores, nuevo: true, equipos });
  const id = datos.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  await db.insertar('combos', { ...datos, id: (await db.obtener('combos', id)) ? `${id}-${crypto.randomUUID().slice(0, 4)}` : id });
  req.flash('exito', `Combo «${datos.nombre}» creado.`);
  res.redirect('/admin/combos');
}));

router.get('/combos/:id/editar', staff, a(async (req, res, next) => {
  const c = await db.obtener('combos', req.params.id);
  if (!c) return next();
  const { equipos } = await datosForm();
  res.render('admin/combo-form', { titulo: `Editar ${c.nombre}`, c, errores: {}, nuevo: false, equipos });
}));

router.post('/combos/:id', staff, a(async (req, res, next) => {
  const actual = await db.obtener('combos', req.params.id);
  if (!actual) return next();
  const { equipos, mapa } = await datosForm();
  const { datos, errores } = leerCombo(req.body, mapa);
  if (Object.keys(errores).length) return res.status(400).render('admin/combo-form', { titulo: `Editar ${actual.nombre}`, c: { ...actual, ...datos }, errores, nuevo: false, equipos });
  await db.actualizar('combos', actual.id, datos);
  req.flash('exito', `Combo «${datos.nombre}» guardado.`);
  res.redirect('/admin/combos');
}));

router.post('/combos/:id/publicado', staff, a(async (req, res, next) => {
  const c = await db.obtener('combos', req.params.id);
  if (!c) return next();
  await db.actualizar('combos', c.id, { publicado: !c.publicado });
  if (req.get('accept')?.includes('application/json')) return res.json({ ok: true, publicado: !c.publicado });
  res.redirect('/admin/combos');
}));

router.post('/combos/:id/eliminar', staff, a(async (req, res) => {
  await db.eliminar('combos', req.params.id);
  req.flash('exito', 'Combo eliminado.');
  res.redirect('/admin/combos');
}));

// ── Galería / publicaciones (publicador y admin) ────────────────────────────
const TIPOS_PUB = { boda: 'Boda', fiesta: 'Fiesta', concierto: 'Concierto', corporativo: 'Corporativo', conferencia: 'Conferencia / ceremonia', electronica: 'Electrónica' };

function leerPublicacion(b) {
  const d = {
    titulo: texto(b.titulo, 100),
    tipo: TIPOS_PUB[b.tipo] ? b.tipo : 'fiesta',
    texto: String(b.texto || '').trim().slice(0, 600),
    imagen: urlImagen(b.imagen),
    imagen_fuente: texto(b.imagen_fuente, 120),
    publicado: marcado(b.publicado),
    orden: entero(b.orden)
  };
  const e = {};
  if (d.titulo.length < 3) e.titulo = 'El título es obligatorio.';
  if (!d.imagen) e.imagen = 'Sube una foto o pega una URL https.';
  return { datos: d, errores: e };
}

router.get('/galeria', staff, a(async (req, res) => {
  res.render('admin/galeria', { titulo: 'Galería', publicaciones: await db.listar('publicaciones', { orden: 'orden' }), TIPOS_PUB });
}));

router.get('/galeria/nueva', staff, (req, res) => {
  res.render('admin/publicacion-form', { titulo: 'Nueva publicación', p: { tipo: 'boda', publicado: true, imagen_fuente: 'AeeS Acústico (foto propia)' }, errores: {}, nuevo: true, TIPOS_PUB });
});

router.post('/galeria', staff, a(async (req, res) => {
  const { datos, errores } = leerPublicacion(req.body);
  if (Object.keys(errores).length) return res.status(400).render('admin/publicacion-form', { titulo: 'Nueva publicación', p: datos, errores, nuevo: true, TIPOS_PUB });
  await db.insertar('publicaciones', datos);
  req.flash('exito', 'Publicación agregada a la galería.');
  res.redirect('/admin/galeria');
}));

router.get('/galeria/:id/editar', staff, a(async (req, res, next) => {
  const p = await db.obtener('publicaciones', req.params.id);
  if (!p) return next();
  res.render('admin/publicacion-form', { titulo: 'Editar publicación', p, errores: {}, nuevo: false, TIPOS_PUB });
}));

router.post('/galeria/:id', staff, a(async (req, res, next) => {
  const actual = await db.obtener('publicaciones', req.params.id);
  if (!actual) return next();
  const { datos, errores } = leerPublicacion(req.body);
  if (Object.keys(errores).length) return res.status(400).render('admin/publicacion-form', { titulo: 'Editar publicación', p: { ...actual, ...datos }, errores, nuevo: false, TIPOS_PUB });
  await db.actualizar('publicaciones', actual.id, datos);
  req.flash('exito', 'Publicación guardada.');
  res.redirect('/admin/galeria');
}));

router.post('/galeria/:id/publicado', staff, a(async (req, res, next) => {
  const p = await db.obtener('publicaciones', req.params.id);
  if (!p) return next();
  await db.actualizar('publicaciones', p.id, { publicado: !p.publicado });
  if (req.get('accept')?.includes('application/json')) return res.json({ ok: true, publicado: !p.publicado });
  res.redirect('/admin/galeria');
}));

router.post('/galeria/:id/eliminar', staff, a(async (req, res) => {
  await db.eliminar('publicaciones', req.params.id);
  req.flash('exito', 'Publicación eliminada.');
  res.redirect('/admin/galeria');
}));

// ── Reservas (admin) ────────────────────────────────────────────────────────
router.get('/reservas', soloAdmin, a(async (req, res) => {
  const estado = ESTADOS_RESERVA[req.query.estado] ? req.query.estado : '';
  const q = texto(req.query.q, 60).toLowerCase();
  let lista = await db.listar('reservas', { orden: 'fecha_evento', desc: true });
  if (estado) lista = lista.filter(r => r.estado === estado);
  if (q) lista = lista.filter(r => `${r.codigo} ${r.datos_cliente?.nombre} ${r.datos_cliente?.celular} ${r.lugar}`.toLowerCase().includes(q));
  res.render('admin/reservas', { titulo: 'Reservas', reservas: lista, estado, q });
}));

// Nueva reserva desde el panel (por ejemplo, tocando un día del calendario).
// Usa el MISMO servicio que la web (reservas.crear): mismos precios, stock,
// transporte y descuentos del cliente. Diferencias: el admin elige al cliente,
// puede registrar el adelanto que ya le pagaron y puede reservar aunque falte
// un equipo (lo pone un proveedor aliado; queda anotado en la reserva).
router.get('/reservas/nueva', soloAdmin, a(async (req, res) => {
  const [clientes, equipos, combos, reglas] = await Promise.all([
    db.listar('usuarios', { filtro: { rol: 'cliente' }, orden: 'nombre' }),
    catalogo.equipos({ soloPublicados: true }),
    catalogo.combos(),
    precios.reglas()
  ]);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '') && req.query.fecha >= hoyLima() ? req.query.fecha : '';
  res.render('admin/reserva-nueva', { titulo: 'Nueva reserva', clientes, equipos, combos, reglas, fecha, clienteId: String(req.query.cliente || ''), hoy: hoyLima() });
}));

// Vista previa del precio para el formulario (con los descuentos de ESE cliente).
router.post('/reservas/cotizar', soloAdmin, a(async (req, res) => {
  const p = await reservasSrv.preparar(req.body?.carrito, { usuarioId: texto(req.body?.cliente_id, 60) || null, promoCodigo: texto(req.body?.promo, 30) });
  res.json({ ok: true, cotizacion: p.cotizacion, faltan: p.faltan, combo: p.combo ? { adicionales: p.combo.adicionales || [] } : null });
}));

router.post('/reservas/nueva', soloAdmin, a(async (req, res) => {
  const b = req.body || {};
  const cliente = await db.obtener('usuarios', texto(b.cliente_id, 60));
  if (!cliente || cliente.rol !== 'cliente') return res.status(400).json({ ok: false, error: 'Elige el cliente (o regístralo primero).' });
  const datosCliente = { nombre: cliente.nombre, dni: cliente.dni || '', celular: cliente.celular || '', correo: cliente.email || '' };
  const reserva = await reservasSrv.crear({
    usuario: cliente, carrito: b.carrito, datosCliente, promoCodigo: texto(b.promo, 30),
    opciones: { permitirFaltantes: b.permitir_faltantes === true, creadoPor: req.usuario.email }
  });
  // Adelanto o pago que el cliente ya hizo (efectivo, Yape revisado, transferencia).
  const monto = numero(b.pago_monto, 0);
  if (monto > 0) await reservasSrv.registrarPago(reserva, { metodo: 'yape', monto, referencia: texto(b.pago_referencia, 40) || `PANEL-${Date.now()}`, estado: 'aprobado', detalle: { registrado_por: req.usuario.email, nota: 'registrado al crear la reserva en el panel' } });
  res.json({ ok: true, codigo: reserva.codigo, url: `/admin/reservas/${reserva.codigo}` });
}));

router.get('/reservas/:codigo', soloAdmin, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r) return next();
  const [pagos, usuario, combo] = await Promise.all([
    db.listar('pagos', { filtro: { reserva_id: r.id }, orden: 'creado_en' }),
    r.usuario_id ? db.obtener('usuarios', r.usuario_id) : null,
    r.combo_id ? db.obtener('combos', r.combo_id) : null
  ]);
  res.render('admin/reserva', { titulo: `Reserva ${r.codigo}`, r, pagos, cliente: usuario, combo });
}));

// Cambiar estado (también lo usan los botones rápidos de la agenda).
router.post('/reservas/:codigo/estado', soloAdmin, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r || !ESTADOS_RESERVA[req.body.estado]) return next();
  // Regla del negocio: el evento se confirma en la reunión o llamada que agenda AeeS.
  if (req.body.estado === 'confirmada' && r.reunion?.agendada_por !== 'admin') {
    req.flash('error', 'Primero agenda la reunión o llamada de confirmación con el cliente (sección "Reunión o llamada").');
    return res.redirect(`/admin/reservas/${r.codigo}`);
  }
  const cambios = { estado: req.body.estado };
  if (req.body.estado !== 'pendiente_pago') cambios.expira_en = null;
  await db.actualizar('reservas', r.id, cambios);
  req.flash('exito', `Reserva ${r.codigo}: ${ESTADOS_RESERVA[req.body.estado]}.`);
  res.redirect(req.body.volver ? volverSeguro(req.body.volver) : `/admin/reservas/${r.codigo}`);
}));

// Editar los datos del evento. Si cambia la fecha, se revisa que los mismos
// equipos estén libres ese día (sin contar esta misma reserva). El precio NO
// cambia solo (quedó congelado): si hace falta, se usa "Ajustar el precio".
router.post('/reservas/:codigo/editar', soloAdmin, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r) return next();
  const volver = `/admin/reservas/${r.codigo}`;
  if (['completada', 'cancelada', 'expirada'].includes(r.estado)) { req.flash('error', 'Esta reserva ya no se puede editar.'); return res.redirect(volver); }
  const b = req.body;
  const cambios = {
    fecha_evento: /^\d{4}-\d{2}-\d{2}$/.test(b.fecha_evento) ? b.fecha_evento : r.fecha_evento,
    hora_inicio: /^\d{2}:\d{2}$/.test(b.hora_inicio) ? b.hora_inicio : r.hora_inicio,
    horas: Math.min(24, Math.max(1, entero(b.horas, r.horas))),
    personas: Math.max(0, entero(b.personas, r.personas || 0)),
    tipo_evento: TIPOS_EVENTO[b.tipo_evento] ? b.tipo_evento : r.tipo_evento,
    lugar: texto(b.lugar, 200) || r.lugar,
    encuesta: { ...(r.encuesta || {}), acceso_vehicular: b.acceso_vehicular === 'si' ? true : b.acceso_vehicular === 'no' ? false : r.encuesta?.acceso_vehicular ?? null }
  };
  if (cambios.fecha_evento !== r.fecha_evento) {
    if (cambios.fecha_evento < hoyLima()) { req.flash('error', 'La nueva fecha ya pasó.'); return res.redirect(volver); }
    const equipos = await catalogo.equipos({ soloPublicados: false });
    const libres = await catalogo.disponibilidad(cambios.fecha_evento, { excluirReservaId: r.id });
    const faltan = catalogo.faltantes((r.items || []).map(({ equipo_id, cantidad }) => ({ equipo_id, cantidad })), libres, catalogo.mapaPorId(equipos));
    if (faltan.length && b.permitir_faltantes !== 'on') {
      req.flash('error', `El ${cambios.fecha_evento} no alcanzan: ${faltan.map(f => `${f.nombre} (hay ${f.libre} de ${f.pedido})`).join(', ')}. Marca "reservar igual con proveedor aliado" si lo vas a cubrir.`);
      return res.redirect(volver);
    }
  }
  await db.actualizar('reservas', r.id, cambios);
  req.flash('exito', `Reserva ${r.codigo} actualizada.${cambios.horas !== r.horas ? ' Si cambian las horas, revisa el precio.' : ''}`);
  res.redirect(volver);
}));

// Eliminar una reserva (con sus pagos). Pide la contraseña (ruta delicada).
// Para el historial conviene más cambiarla a "Cancelada"; esto es para errores o pruebas.
router.post('/reservas/:codigo/eliminar', soloAdmin, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r) return next();
  for (const p of await db.listar('pagos', { filtro: { reserva_id: r.id } })) await db.eliminar('pagos', p.id);
  await db.eliminar('reservas', r.id);
  req.flash('exito', `Reserva ${r.codigo} eliminada.`);
  res.redirect('/admin/reservas');
}));

// Agendar la reunión o llamada de confirmación (la pone el admin o el dueño).
// Si el cliente propuso un horario, aquí se acepta o se cambia.
router.post('/reservas/:codigo/reunion', soloAdmin, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r) return next();
  const { fecha, hora, modalidad } = req.body;
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && /^\d{2}:\d{2}$/.test(hora) && ['videollamada', 'presencial', 'llamada'].includes(modalidad);
  if (!valida || fecha > r.fecha_evento) {
    req.flash('error', 'Elige una fecha (hasta el día del evento), la hora y la modalidad.');
  } else {
    await db.actualizar('reservas', r.id, { reunion: { ...(r.reunion || {}), fecha, hora, modalidad, nota: texto(req.body.nota, 200), agendada_por: 'admin', agendada_por_email: req.usuario.email, agendada_en: new Date().toISOString() } });
    req.flash('exito', 'Reunión agendada. Avísale al cliente por WhatsApp.');
  }
  res.redirect(`/admin/reservas/${r.codigo}`);
}));

router.post('/reservas/:codigo/notas', soloAdmin, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r) return next();
  await db.actualizar('reservas', r.id, { notas_admin: String(req.body.notas_admin || '').slice(0, 3000) });
  req.flash('exito', 'Notas guardadas.');
  res.redirect(`/admin/reservas/${r.codigo}`);
}));

// Ajuste manual del precio de UNA reserva (descuento especial, cambio de
// equipos acordado en la reunión...). El precio de una reserva queda
// congelado al crearla: cambiar las tarifas en Ajustes NO la modifica. Solo
// este formulario puede cambiarlo, con estas protecciones:
//  • pide la contraseña (esDelicada) y un motivo obligatorio;
//  • no se toca una reserva completada, cancelada o expirada;
//  • el total no puede quedar por debajo de lo que el cliente ya pagó;
//  • cada cambio queda en el historial (quién, cuándo, de cuánto a cuánto, estado y pagado).
const ESTADOS_SIN_CAMBIO_PRECIO = ['completada', 'cancelada', 'expirada'];
router.post('/reservas/:codigo/precio', soloAdmin, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r) return next();
  const volver = `/admin/reservas/${r.codigo}`;
  const nuevo = Math.round(numero(req.body.total_nuevo, NaN) * 100) / 100;
  const motivo = texto(req.body.motivo, 300);
  const pagado = Number(r.pagado || 0);
  let error = null;
  if (ESTADOS_SIN_CAMBIO_PRECIO.includes(r.estado)) error = `La reserva está "${ESTADOS_RESERVA[r.estado]}": su precio ya no se puede cambiar.`;
  else if (!(nuevo >= 0)) error = 'Escribe el nuevo total.';
  else if (nuevo < pagado) error = `El total no puede ser menor a lo que el cliente ya pagó (${util.soles(pagado)}).`;
  else if (motivo.length < 5) error = 'Escribe el motivo del cambio (queda en el historial).';
  else if (nuevo === Number(r.total)) error = 'El total es el mismo.';
  if (error) { req.flash('error', error); return res.redirect(volver); }

  const adelanto = Math.round(nuevo * Number(r.adelanto_pct) / 100 * 100) / 100;
  const historial = [...(r.encuesta?.historial_precios || []), {
    fecha: new Date().toISOString(), por: req.usuario.email, de: Number(r.total), a: nuevo,
    adelanto_de: Number(r.adelanto), adelanto_a: adelanto, motivo, estado: r.estado, pagado
  }];
  await db.actualizar('reservas', r.id, { total: nuevo, adelanto, encuesta: { ...(r.encuesta || {}), historial_precios: historial } });
  // Si con el nuevo adelanto lo pagado ya alcanza, la reserva pasa sola a "adelanto pagado".
  await reservasSrv.recalcular(r.id);
  req.flash('exito', `Total de ${r.codigo}: ${util.soles(r.total)} → ${util.soles(nuevo)}.`);
  res.redirect(volver);
}));

// Pago manual en efectivo / transferencia que el admin registra a mano.
router.post('/reservas/:codigo/pago-manual', soloAdmin, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  const monto = numero(req.body.monto, NaN);
  if (!r) return next();
  if (!(monto > 0)) { req.flash('error', 'El monto debe ser mayor que 0.'); return res.redirect(`/admin/reservas/${r.codigo}`); }
  await reservasSrv.registrarPago(r, { metodo: 'yape', monto, referencia: texto(req.body.referencia, 40) || `MANUAL-${Date.now()}`, estado: 'aprobado', detalle: { registrado_por: req.usuario.email, nota: 'registro manual' } });
  req.flash('exito', 'Pago registrado.');
  res.redirect(`/admin/reservas/${r.codigo}`);
}));

// Aprobar o rechazar un Yape informado por el cliente (tras revisarlo en la app Yape).
router.get('/pagos/:id/comprobante', soloAdmin, a(async (req, res, next) => {
  const p = await db.obtener('pagos', req.params.id);
  const archivo = p?.detalle?.comprobante && await db.leerPrivado(p.detalle.comprobante);
  if (!archivo) return next();
  res.setHeader('Content-Type', p.detalle.tipo_foto || 'image/webp');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(archivo);
}));

router.post('/pagos/:id/:accion', soloAdmin, a(async (req, res, next) => {
  const p = await db.obtener('pagos', req.params.id);
  if (!p || !['aprobar', 'rechazar'].includes(req.params.accion)) return next();
  await db.actualizar('pagos', p.id, { estado: req.params.accion === 'aprobar' ? 'aprobado' : 'rechazado' });
  const r = await reservasSrv.recalcular(p.reserva_id);
  req.flash('exito', req.params.accion === 'aprobar' ? `Pago aprobado. Reserva ${r.codigo}: ${ESTADOS_RESERVA[r.estado]}.` : 'Pago rechazado.');
  res.redirect(req.body.volver ? volverSeguro(req.body.volver) : `/admin/reservas/${r.codigo}`);
}));

// ── Reseñas (admin y publicador) ────────────────────────────────────────────
// CRUD sobre src/servicios/resenas.js. Las de clientes llegan sin publicar.
router.get('/resenas', staff, a(async (req, res) => {
  const lista = await resenas.todas();
  const editar = req.query.editar ? lista.find(x => x.id === req.query.editar) || null : null;
  res.render('admin/resenas', { titulo: 'Reseñas', lista: [...lista].reverse(), editar, datos: editar || {}, errores: {} });
}));

async function guardarResena(req, res, id) {
  const { datos, errores } = resenas.validar(req.body);
  datos.publicado = marcado(req.body.publicado);
  datos.orden = entero(req.body.orden, 0);
  if (Object.keys(errores).length) {
    const lista = await resenas.todas();
    return res.status(400).render('admin/resenas', { titulo: 'Reseñas', lista: [...lista].reverse(), editar: id ? { id } : null, datos, errores });
  }
  if (id) await resenas.actualizar(id, datos); else await resenas.agregar(datos, { origen: 'admin', publicado: datos.publicado });
  req.flash('exito', id ? 'Reseña actualizada.' : 'Reseña agregada.');
  res.redirect('/admin/resenas');
}
router.post('/resenas', staff, a((req, res) => guardarResena(req, res, null)));
router.post('/resenas/:id', staff, a((req, res) => guardarResena(req, res, req.params.id)));

router.post('/resenas/:id/publicado', staff, a(async (req, res, next) => {
  const x = (await resenas.todas()).find(r => r.id === req.params.id);
  if (!x) return next();
  await resenas.actualizar(x.id, { publicado: !x.publicado });
  if (req.get('accept')?.includes('application/json')) return res.json({ ok: true, publicado: !x.publicado });
  res.redirect('/admin/resenas');
}));

router.post('/resenas/:id/eliminar', staff, a(async (req, res) => {
  await resenas.eliminar(req.params.id);
  req.flash('exito', 'Reseña eliminada.');
  res.redirect('/admin/resenas');
}));

// ── Clientes (admin) ────────────────────────────────────────────────────────
// El admin registra clientes que llegan por WhatsApp o en persona: con su
// Gmail y celular, el cliente después puede entrar solo a la web (ve sus
// reservas y puntos). El correo puede no ser Gmail, pero entonces el cliente
// no podrá ingresar por sí mismo (el ingreso pide Gmail).
const celularValido = c => /^9\d{8}$/.test(c);
const limpiarCel = v => String(v || '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');
function leerCliente(b) {
  return {
    nombre: texto(b.nombre, 80),
    email: texto(b.email, 120).toLowerCase() || null,
    celular: limpiarCel(b.celular),
    dni: String(b.dni || '').replace(/\D/g, '').slice(0, 12) || null
  };
}
async function erroresCliente(d, idActual) {
  const e = {};
  if (d.nombre.length < 2) e.nombre = 'Escribe el nombre.';
  if (!celularValido(d.celular)) e.celular = 'Celular de 9 dígitos (empieza en 9).';
  else { const otro = await db.buscarUno('usuarios', { celular: d.celular }); if (otro && otro.id !== idActual) e.celular = `Ese celular ya es de ${otro.nombre}.`; }
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) e.email = 'Correo inválido.';
  else if (d.email) { const otro = await db.buscarUno('usuarios', { email: d.email }); if (otro && otro.id !== idActual) e.email = `Ese correo ya es de ${otro.nombre}.`; }
  if (d.dni && !/^\d{8,12}$/.test(d.dni)) e.dni = 'DNI de 8 dígitos (o CE).';
  return e;
}

router.post('/clientes', soloAdmin, a(async (req, res) => {
  const d = leerCliente(req.body);
  const e = await erroresCliente(d, null);
  if (Object.keys(e).length) { req.flash('error', Object.values(e).join(' ')); return res.redirect('/admin/clientes?nuevo=1'); }
  const u = await db.insertar('usuarios', { rol: 'cliente', ...d });
  req.flash('exito', `Cliente ${u.nombre} registrado.${d.email && !/@(gmail|googlemail)\.com$/.test(d.email) ? ' Ojo: sin Gmail no podrá entrar solo a la web.' : ''}`);
  res.redirect(req.body.y_reservar ? `/admin/reservas/nueva?cliente=${u.id}` : `/admin/clientes/${u.id}`);
}));

router.get('/clientes/:id', soloAdmin, a(async (req, res, next) => {
  const u = await db.obtener('usuarios', req.params.id);
  if (!u || u.rol !== 'cliente') return next();
  const [suyas, r] = await Promise.all([db.listar('reservas', { filtro: { usuario_id: u.id }, orden: 'fecha_evento', desc: true }), precios.reglas()]);
  res.render('admin/cliente', { titulo: u.nombre, c: u, reservas: suyas, saldo: puntosSrv.calcularSaldo(suyas, r), frecuente: await precios.esFrecuente(u.id, r) });
}));

router.post('/clientes/:id', soloAdmin, a(async (req, res, next) => {
  const u = await db.obtener('usuarios', req.params.id);
  if (!u || u.rol !== 'cliente') return next();
  const d = leerCliente(req.body);
  const e = await erroresCliente(d, u.id);
  if (Object.keys(e).length) { req.flash('error', Object.values(e).join(' ')); return res.redirect(`/admin/clientes/${u.id}`); }
  await db.actualizar('usuarios', u.id, d);
  req.flash('exito', 'Datos del cliente guardados.');
  res.redirect(`/admin/clientes/${u.id}`);
}));

// Solo se elimina un cliente SIN reservas (las reservas son el historial del negocio).
router.post('/clientes/:id/eliminar', soloAdmin, a(async (req, res, next) => {
  const u = await db.obtener('usuarios', req.params.id);
  if (!u || u.rol !== 'cliente') return next();
  const suyas = await db.listar('reservas', { filtro: { usuario_id: u.id } });
  if (suyas.length) { req.flash('error', `${u.nombre} tiene ${suyas.length} reserva(s): no se puede eliminar. Puedes editar sus datos.`); return res.redirect(`/admin/clientes/${u.id}`); }
  await db.eliminar('usuarios', u.id);
  req.flash('exito', `Cliente ${u.nombre} eliminado.`);
  res.redirect('/admin/clientes');
}));

router.get('/clientes', soloAdmin, a(async (req, res) => {
  const [usuarios, reservas] = await Promise.all([db.listar('usuarios', { filtro: { rol: 'cliente' }, orden: 'creado_en', desc: true }), db.listar('reservas')]);
  const pagadas = r => ['adelanto_pagado', 'confirmada', 'completada'].includes(r.estado);
  const lista = usuarios.map(u => {
    const suyas = reservas.filter(r => r.usuario_id === u.id);
    return { ...u, reservas: suyas.length, pagadas: suyas.filter(pagadas).length, gastado: suyas.filter(pagadas).reduce((s, r) => s + Number(r.total), 0), ultima: suyas.map(r => r.fecha_evento).sort().pop() };
  });
  const reglas = (await db.ajuste('reglas')) || {};
  const q = texto(req.query.q, 60).toLowerCase();
  const filtrados = q ? lista.filter(c => `${c.nombre} ${c.email || ''} ${c.celular || ''} ${c.dni || ''}`.toLowerCase().includes(q)) : lista;
  res.render('admin/clientes', { titulo: 'Clientes', clientes: filtrados, total: lista.length, q, nuevo: Boolean(req.query.nuevo), minimo: reglas.reservas_para_frecuente || 2 });
}));

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
