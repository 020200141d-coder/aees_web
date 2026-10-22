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
const { requiereCliente } = require('../middleware/auth');
const { hoyLima } = require('../lib/util');

const router = express.Router();
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Servicios fijos del rubro (se muestran en el carrusel de la portada).
const SERVICIOS = [
  { id: 'sonido', titulo: 'Sonido', icono: 'fa-solid fa-volume-high', descripcion: 'Parlantes JBL, QSC, RCF y Bose, consolas digitales y micrófonos Shure y Sennheiser, dimensionados para tu cantidad de invitados.' },
  { id: 'iluminacion', titulo: 'Iluminación', icono: 'fa-solid fa-lightbulb', descripcion: 'Uplighting cálido para bodas, cabezas móviles, hazer y DMX para fiestas electrónicas y conciertos.' },
  { id: 'video', titulo: 'Video y pantallas LED', icono: 'fa-solid fa-tv', descripcion: 'Proyectores láser, pantallas de 100" y paneles LED P4 para conferencias, lanzamientos y conciertos.' },
  { id: 'energia', titulo: 'Energía eléctrica', icono: 'fa-solid fa-bolt', descripcion: 'Generadores Honda y Kipor, tableros con protección y extensiones para eventos en el campo.' },
  { id: 'estructuras', titulo: 'Estructuras', icono: 'fa-solid fa-cubes', descripcion: 'Torres y secciones de truss, tarimas de escenario y toldos para proteger los equipos.' },
  { id: 'tecnico', titulo: 'Técnico en el evento', icono: 'fa-solid fa-sliders', descripcion: 'Montaje, prueba de sonido y operación durante el evento, con cables ordenados y etiquetados.' }
];

router.get('/', a(async (req, res) => {
  const [equipos, combos, publicaciones, reglas] = await Promise.all([
    catalogo.equipos(),
    catalogo.combos(),
    db.listar('publicaciones', { filtro: { publicado: true }, orden: 'orden' }),
    precios.reglas()
  ]);
  res.render('publico/index', { titulo: null, equipos, combos, publicaciones, reglas, servicios: SERVICIOS, mapa: catalogo.mapaPorId(equipos) });
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
  const { fecha, hora, modalidad } = req.body;
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && /^\d{2}:\d{2}$/.test(hora) && ['videollamada', 'presencial', 'llamada'].includes(modalidad);
  if (!valida || fecha < hoyLima() || fecha > r.fecha_evento) {
    req.flash('error', 'Elige una fecha entre hoy y el día del evento, una hora y la modalidad.');
  } else {
    await db.actualizar('reservas', r.id, { reunion: { fecha, hora, modalidad, solicitada_en: new Date().toISOString() } });
    req.flash('exito', 'Reunión solicitada. Te confirmamos el horario por WhatsApp.');
  }
  res.redirect(`/reservas/${r.codigo}`);
}));

module.exports = router;
