// ============================================================================
//  src/rutas/publico.js — páginas que ve el cliente
//
//   GET  /                         portada: hero, servicios, combos, catálogo, experiencias, contacto
//   GET  /asistente                encuesta guiada + mapa + recomendación con IA
//   GET  /mi-evento                resumen del evento armado y formulario de reserva
//   GET  /reservas/:codigo         estado, pago del adelanto, reunión y WhatsApp
//   POST /reservas/:codigo/reunion agendar la reunión de confirmación
// ============================================================================

const express = require('express');
const db = require('../db');
const catalogo = require('../servicios/catalogo');
const pagos = require('../servicios/pagos');
const precios = require('../servicios/precios');
const resenas = require('../servicios/resenas');
const { TIPOS_EVENTO } = require('../lib/util');
const { requiereCliente } = require('../middleware/auth');
const { hoyLima } = require('../lib/util');

const router = express.Router();
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);


// Tipos de foto de la galería (filtros de /eventos).
const TIPOS_PUB = { boda: 'Bodas', fiesta: 'Fiestas', concierto: 'Conciertos', corporativo: 'Corporativo', conferencia: 'Ceremonias', electronica: 'Electrónica' };

// Combos ordenados (destacados primero) con su "precio suelto": lo que costarían
// los mismos equipos por separado, para mostrar el ahorro con precio tachado.
// El "Más elegido" es el destacado del medio (o el único destacado).
function prepararCombos(combos, mapa) {
  const lista = [...combos].sort((a, b) => (b.destacado - a.destacado) || (a.orden || 0) - (b.orden || 0)).map(c => {
    const conDmx = (c.items || []).some(it => mapa[it.equipo_id]?.rol === 'dmx');
    const suelto = (c.items || []).reduce((s, it) => s + (mapa[it.equipo_id] ? precios.precioUnitario(mapa[it.equipo_id], it.cantidad, conDmx) * it.cantidad : 0), 0);
    return { ...c, precio_suelto: Math.round(suelto) };
  });
  const destacados = lista.filter(c => c.destacado);
  return { lista, destacados, elegidoId: (destacados[1] || destacados[0])?.id || null };
}

// Promociones activas y vigentes (se muestran arriba en la portada).
async function promosVigentes() {
  const hoy = hoyLima();
  return (await db.listar('promociones', { filtro: { activo: true } })).filter(p => !p.vence || p.vence >= hoy).slice(0, 3);
}

// Portada: un RESUMEN. Cada sección lleva a su página completa.
router.get('/', a(async (req, res) => {
  const [equipos, combos, publicaciones, reglas, promos, listaResenas] = await Promise.all([
    catalogo.equipos(),
    catalogo.combos(),
    db.listar('publicaciones', { filtro: { publicado: true }, orden: 'orden' }),
    precios.reglas(),
    promosVigentes(),
    resenas.publicadas()
  ]);
  const mapa = catalogo.mapaPorId(equipos);
  // Destacados del catálogo: los que el admin marcó (por orden), hasta 3; si faltan, se completan.
  const marcados = equipos.filter(e => e.destacado).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const destacados = [...marcados, ...equipos.filter(e => !e.destacado)].slice(0, 3);
  const { destacados: paquetes, lista: todosCombos, elegidoId } = prepararCombos(combos, mapa);
  res.render('publico/index', {
    titulo: null, equipos: destacados, total_equipos: equipos.length, publicaciones, reglas, promos, resenas: listaResenas.slice(0, 6),
    paquetes: (paquetes.length ? paquetes : todosCombos).slice(0, 3), elegidoId, total_combos: combos.length, mapa, hoy: hoyLima(), TIPOS_EVENTO
  });
}));

router.get('/catalogo', a(async (req, res) => {
  const [equipos, reglas] = await Promise.all([catalogo.equipos(), precios.reglas()]);
  const ordenados = [...equipos].sort((a, b) => (b.destacado - a.destacado) || (a.orden || 0) - (b.orden || 0));
  res.render('publico/catalogo', { titulo: 'Catálogo de equipos', equipos: ordenados, reglas, hoy: hoyLima() });
}));

router.get('/combos', a(async (req, res) => {
  const [equipos, combos, reglas] = await Promise.all([catalogo.equipos({ soloPublicados: false }), catalogo.combos(), precios.reglas()]);
  const mapa = catalogo.mapaPorId(equipos);
  const { lista, elegidoId } = prepararCombos(combos, mapa);
  res.render('publico/combos', { titulo: 'Combos y paquetes', combos: lista, elegidoId, mapa, reglas });
}));

router.get('/eventos', a(async (req, res) => {
  const [publicaciones, listaResenas] = await Promise.all([db.listar('publicaciones', { filtro: { publicado: true }, orden: 'orden' }), resenas.publicadas()]);
  res.render('publico/eventos', { titulo: 'Eventos realizados', publicaciones, resenas: listaResenas, TIPOS_PUB });
}));

router.get('/asistente', a(async (req, res) => {
  res.render('publico/asistente', { titulo: 'Arma tu evento', hoy: hoyLima() });
}));

router.get('/mi-evento', a(async (req, res) => {
  res.render('publico/mi-evento', { titulo: 'Mi evento', hoy: hoyLima() });
}));

router.get('/reservas/:codigo', requiereCliente, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r || (r.usuario_id !== req.usuario.id && !['admin', 'publicador'].includes(req.usuario.rol))) return next();
  // Si estaba pendiente y venció, catalogo.disponibilidad la marca como expirada.
  if (r.estado === 'pendiente_pago') await catalogo.disponibilidad(r.fecha_evento);
  const [actual, listaPagos] = await Promise.all([
    db.obtener('reservas', r.id),
    db.listar('pagos', { filtro: { reserva_id: r.id }, orden: 'creado_en' })
  ]);
  res.render('publico/reserva', {
    titulo: `Reserva ${r.codigo}`,
    r: actual,
    pagos: listaPagos,
    mpActivo: pagos.mercadoPagoActivo(),
    simulado: pagos.simuladoActivo(),
    hoy: hoyLima()
  });
}));

router.post('/reservas/:codigo/reunion', requiereCliente, a(async (req, res, next) => {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r || r.usuario_id !== req.usuario.id) return next();
  if (r.reunion?.agendada_por === 'admin') {
    req.flash('aviso', 'AeeS ya agendó tu reunión. Si necesitas cambiarla, escríbenos por WhatsApp.');
    return res.redirect(`/reservas/${r.codigo}`);
  }
  const { fecha, hora, modalidad } = req.body;
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && /^\d{2}:\d{2}$/.test(hora) && ['videollamada', 'presencial', 'llamada'].includes(modalidad);
  if (!valida || fecha < hoyLima() || fecha > r.fecha_evento) {
    req.flash('error', 'Elige una fecha entre hoy y el día del evento, una hora y la modalidad.');
  } else {
    await db.actualizar('reservas', r.id, { reunion: { fecha, hora, modalidad, solicitada_en: new Date().toISOString() } });
    req.flash('exito', 'Horario propuesto. Te confirmamos la reunión o llamada por WhatsApp.');
  }
  res.redirect(`/reservas/${r.codigo}`);
}));

module.exports = router;
