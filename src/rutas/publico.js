// ============================================================================
//  src/rutas/publico.js — páginas que ve el cliente (solo URL + middleware)
//
//   GET  /                         portada: hero, servicios, combos, catálogo, experiencias, contacto
//   GET  /catalogo · /combos · /eventos
//   GET  /asistente                encuesta guiada + mapa + recomendación con IA
//   GET  /mi-evento                resumen del evento armado y formulario de reserva
//   GET  /reservas/:codigo         estado, pago del adelanto, reunión y WhatsApp
//   POST /reservas/:codigo/reunion proponer la reunión de confirmación
//
//  La lógica está en controladores/publico.js y los datos en servicios/sitio.js.
// ============================================================================

const express = require('express');
const { requiereCliente } = require('../middleware/auth');
const { a } = require('../controladores/comun');
const publico = require('../controladores/publico');

const router = express.Router();

router.get('/', a(publico.portada));
router.get('/catalogo', a(publico.catalogo));
router.get('/combos', a(publico.combos));
router.get('/eventos', a(publico.eventos));
router.get('/asistente', publico.asistente);
router.get('/mi-evento', publico.miEvento);
router.get('/reservas/:codigo', requiereCliente, a(publico.reserva));
router.post('/reservas/:codigo/reunion', requiereCliente, a(publico.reunion));

module.exports = router;
