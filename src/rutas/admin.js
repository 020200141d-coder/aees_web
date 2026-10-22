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
const negocio = require('../servicios/negocio');
const { requiereStaff } = require('../middleware/auth');
const { hashClave, verificarClave, limitar } = require('../lib/seguridad');
const { CATEGORIAS, TIPOS_EVENTO, ESTADOS_RESERVA, texto, numero, hoyLima } = require('../lib/util');
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
  res.locals.pendientes = { mensajes: 0, yape: 0 };
  if (['admin'].includes(req.usuario?.rol)) {
    try {
      const [msjs, pagos] = await Promise.all([db.listar('mensajes', { filtro: { leido: false } }), db.listar('pagos', { filtro: { estado: 'pendiente' } })]);
      res.locals.pendientes = { mensajes: msjs.length, yape: pagos.filter(p => p.metodo === 'yape').length };
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
  res.render('admin/ingresar', { titulo: 'Ingreso del personal', error: null, email: '', volver: volverSeguro(req.query.volver) });
});

router.post('/ingresar', limiteLogin, a(async (req, res) => {
  const email = texto(req.body.email, 120).toLowerCase();
  const u = email && await db.buscarUno('usuarios', { email });
  const ok = u && ['admin', 'publicador'].includes(u.rol) && verificarClave(req.body.clave || '', u.clave_hash);
  if (!ok) {
    return res.status(401).render('admin/ingresar', { titulo: 'Ingreso del personal', error: 'Correo o contraseña incorrectos.', email, volver: volverSeguro(req.body.volver) });
  }
  req.session.uid = u.id;
  res.redirect(volverSeguro(req.body.volver));
}));

router.post('/salir', (req, res) => {
  req.session = null;
  res.redirect('/admin/ingresar');
});

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
    imagen_fuente: texto(b.imagen_fuente, 120),
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
  const cambios = { estado: req.body.estado };
  if (req.body.estado !== 'pendiente_pago') cambios.expira_en = null;
  await db.actualizar('reservas', r.id, cambios);
  req.flash('exito', `Reserva ${r.codigo}: ${ESTADOS_RESERVA[req.body.estado]}.`);
  res.redirect(req.body.volver ? volverSeguro(req.body.volver) : `/admin/reservas/${r.codigo}`);
}));

router.post('/reservas/:codigo/notas', soloAdmin, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r) return next();
  await db.actualizar('reservas', r.id, { notas_admin: String(req.body.notas_admin || '').slice(0, 3000) });
  req.flash('exito', 'Notas guardadas.');
  res.redirect(`/admin/reservas/${r.codigo}`);
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
router.post('/pagos/:id/:accion', soloAdmin, a(async (req, res, next) => {
  const p = await db.obtener('pagos', req.params.id);
  if (!p || !['aprobar', 'rechazar'].includes(req.params.accion)) return next();
  await db.actualizar('pagos', p.id, { estado: req.params.accion === 'aprobar' ? 'aprobado' : 'rechazado' });
  const r = await reservasSrv.recalcular(p.reserva_id);
  req.flash('exito', req.params.accion === 'aprobar' ? `Pago aprobado. Reserva ${r.codigo}: ${ESTADOS_RESERVA[r.estado]}.` : 'Pago rechazado.');
  res.redirect(req.body.volver ? volverSeguro(req.body.volver) : `/admin/reservas/${r.codigo}`);
}));

// ── Clientes (admin) ────────────────────────────────────────────────────────
router.get('/clientes', soloAdmin, a(async (req, res) => {
  const [usuarios, reservas] = await Promise.all([db.listar('usuarios', { filtro: { rol: 'cliente' }, orden: 'creado_en', desc: true }), db.listar('reservas')]);
  const pagadas = r => ['adelanto_pagado', 'confirmada', 'completada'].includes(r.estado);
  const lista = usuarios.map(u => {
    const suyas = reservas.filter(r => r.usuario_id === u.id);
    return { ...u, reservas: suyas.length, pagadas: suyas.filter(pagadas).length, gastado: suyas.filter(pagadas).reduce((s, r) => s + Number(r.total), 0), ultima: suyas.map(r => r.fecha_evento).sort().pop() };
  });
  const reglas = (await db.ajuste('reglas')) || {};
  res.render('admin/clientes', { titulo: 'Clientes', clientes: lista, minimo: reglas.reservas_para_frecuente || 2 });
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
  const [n, reglas, vehiculos, portada] = await Promise.all(['negocio', 'reglas', 'vehiculos', 'portada'].map(k => db.ajuste(k)));
  res.render('admin/ajustes', { titulo: 'Ajustes', n: n || {}, reglas: reglas || {}, vehiculos: vehiculos || [], portada: portada || {}, errores: {} });
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
    redes: { instagram: urlImagen(b.instagram) ?? '', facebook: urlImagen(b.facebook) ?? '', tiktok: urlImagen(b.tiktok) ?? '' },
    almacen: { lat, lng, direccion: texto(b.almacen_direccion, 160) },
    yape: { numero: String(b.yape_numero || '').replace(/\D/g, '').slice(0, 9), titular: texto(b.yape_titular, 80), qr_url: urlImagen(b.yape_qr) || '' }
  });
  negocio.invalidar();
  req.flash('exito', 'Datos del negocio guardados.');
  res.redirect('/admin/ajustes');
}));

router.post('/ajustes/reglas', soloAdmin, a(async (req, res) => {
  const b = req.body;
  const r = {
    adelanto_pct: numero(b.adelanto_pct, NaN),
    horas_bloqueo: entero(b.horas_bloqueo, NaN),
    horas_jornada: entero(b.horas_jornada, NaN),
    factor_jornada_extra: numero(b.factor_jornada_extra, NaN),
    tecnico_por_jornada: numero(b.tecnico_por_jornada, NaN),
    descuento_frecuente_pct: numero(b.descuento_frecuente_pct, NaN),
    reservas_para_frecuente: entero(b.reservas_para_frecuente, NaN)
  };
  const ok = r.adelanto_pct >= 10 && r.adelanto_pct <= 100 && r.horas_bloqueo >= 1 && r.horas_bloqueo <= 168 && r.horas_jornada >= 1 && r.horas_jornada <= 12 &&
    r.factor_jornada_extra >= 0 && r.factor_jornada_extra <= 2 && r.tecnico_por_jornada >= 0 && r.descuento_frecuente_pct >= 0 && r.descuento_frecuente_pct <= 50 && r.reservas_para_frecuente >= 1;
  if (!ok) { req.flash('error', 'Revisa los valores: adelanto 10–100 %, bloqueo 1–168 h, jornada 1–12 h, factor 0–2, descuento 0–50 %.'); return res.redirect('/admin/ajustes#reglas'); }
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
  for (const k of ['hero', 'boda', 'electronica', 'corporativo']) {
    p[k] = urlImagen(req.body[k]);
    if (!p[k]) { req.flash('error', 'Cada foto de portada necesita una URL válida o una foto subida.'); return res.redirect('/admin/ajustes#portada'); }
  }
  p.fuentes = texto(req.body.fuentes, 200);
  await db.guardarAjuste('portada', p);
  negocio.invalidar();
  req.flash('exito', 'Fotos de portada guardadas.');
  res.redirect('/admin/ajustes#portada');
}));

// ── Usuarios del personal (admin) ───────────────────────────────────────────
router.get('/usuarios', soloAdmin, a(async (req, res) => {
  const todos = await db.listar('usuarios', { orden: 'creado_en' });
  res.render('admin/usuarios', { titulo: 'Usuarios', personal: todos.filter(u => u.rol !== 'cliente'), errores: {}, datos: { rol: 'publicador' } });
}));

router.post('/usuarios', soloAdmin, a(async (req, res) => {
  const datos = { nombre: texto(req.body.nombre, 80), email: texto(req.body.email, 120).toLowerCase(), rol: req.body.rol === 'admin' ? 'admin' : 'publicador' };
  const errores = {};
  if (datos.nombre.length < 2) errores.nombre = 'Escribe el nombre.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(datos.email)) errores.email = 'Correo inválido.';
  else if (await db.buscarUno('usuarios', { email: datos.email })) errores.email = 'Ese correo ya tiene cuenta.';
  if (String(req.body.clave || '').length < 8) errores.clave = 'Mínimo 8 caracteres.';
  if (Object.keys(errores).length) {
    const todos = await db.listar('usuarios', { orden: 'creado_en' });
    return res.status(400).render('admin/usuarios', { titulo: 'Usuarios', personal: todos.filter(u => u.rol !== 'cliente'), errores, datos });
  }
  await db.insertar('usuarios', { ...datos, clave_hash: hashClave(req.body.clave) });
  req.flash('exito', `Cuenta creada para ${datos.email} (${datos.rol}).`);
  res.redirect('/admin/usuarios');
}));

router.post('/usuarios/:id/eliminar', soloAdmin, a(async (req, res) => {
  if (req.params.id === req.usuario.id) {
    req.flash('error', 'No puedes eliminar tu propia cuenta.');
  } else {
    const u = await db.obtener('usuarios', req.params.id);
    if (u && u.rol !== 'cliente') { await db.eliminar('usuarios', u.id); req.flash('exito', 'Cuenta eliminada.'); }
  }
  res.redirect('/admin/usuarios');
}));

// ── Respaldo (admin) ────────────────────────────────────────────────────────
// Útil siempre (copia de seguridad) y obligatorio si usas el modo local en un
// hosting gratis, donde el disco se borra al redesplegar.
router.get('/respaldo', soloAdmin, (req, res) => {
  res.render('admin/respaldo', { titulo: 'Respaldo', motor: db.motor });
});

router.get('/respaldo/descargar', soloAdmin, a(async (req, res) => {
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
