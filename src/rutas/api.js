// ============================================================================
//  src/rutas/api.js — API JSON que usa el navegador (solo URL + middleware)
//
//   GET  /api/equipos?fecha=        catálogo con unidades libres ese día
//   POST /api/interpretar           texto libre → campos de la encuesta (IA)
//   POST /api/recomendar            encuesta → 3 opciones + combo + transporte + clima + explicación IA
//   POST /api/cotizacion-rapida     cotizador de la portada: "Desde S/ …" al instante (sin IA ni mapa)
//   GET  /api/geocodificar?q=       buscar un lugar (mapa)
//   POST /api/ruta                  almacén → lugar: km, minutos, línea para el mapa
//   GET  /api/clima                 pronóstico del día del evento
//   POST /api/cotizar               precio final de "Mi evento" (carrito)
//   POST /api/reservas              crear la reserva (requiere sesión)
//   POST /api/contacto              mensaje / cotización rápida
//   POST /api/solicitudes           fecha ocupada → pedir reunión (proveedor aliado)
//
//  La lógica está en controladores/api.js; las reglas en servicios/asistente.js
//  y servicios/contacto.js. Todas las respuestas son { ok: true, ... } o { ok: false, error }.
// ============================================================================

const express = require('express');
const { requiereCliente } = require('../middleware/auth');
const { limitar } = require('../lib/seguridad');
const { a } = require('../controladores/comun');
const api = require('../controladores/api');

const router = express.Router();

// La IA y los mapas externos cuestan o tienen cuotas: limitamos por IP.
const limiteIA = limitar({ clave: 'ia', max: 20, ventanaMin: 10, mensaje: 'Hiciste muchas consultas seguidas. Espera unos minutos o escríbenos por WhatsApp.' });
const limiteMapa = limitar({ clave: 'mapa', max: 40, ventanaMin: 5 });
const limiteRapido = limitar({ clave: 'rapido', max: 60, ventanaMin: 5 });
const limiteContacto = limitar({ clave: 'contacto', max: 5, ventanaMin: 15, mensaje: 'Enviaste varios mensajes seguidos. Escríbenos por WhatsApp.' });

router.get('/equipos', a(api.equipos));
router.post('/interpretar', limiteIA, a(api.interpretar));
router.post('/recomendar', limiteIA, a(api.recomendar));
router.post('/cotizacion-rapida', limiteRapido, a(api.cotizacionRapida));
router.get('/geocodificar', limiteMapa, a(api.geocodificar));
router.post('/ruta', limiteMapa, a(api.ruta));
router.get('/clima', limiteMapa, a(api.clima));
router.post('/cotizar', a(api.cotizar));
router.post('/reservas', requiereCliente, a(api.reservar));
router.post('/contacto', limiteContacto, a(api.contactar));
router.post('/solicitudes', limiteContacto, a(api.solicitar));

module.exports = router;
