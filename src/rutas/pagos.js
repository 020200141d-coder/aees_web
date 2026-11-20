// ============================================================================
//  src/rutas/pagos.js — pagar el adelanto de una reserva (solo URL + middleware)
//
//   POST /pagos/:codigo/mercadopago   crea la preferencia y redirige a Mercado Pago
//   GET  /pagos/retorno               Mercado Pago vuelve aquí (se verifica el pago)
//   POST /pagos/mercadopago/webhook   aviso servidor-a-servidor de Mercado Pago
//   POST /pagos/:codigo/yape          el cliente paga con Yape o Plin: sube la foto
//                                     del comprobante + n.º de operación (JSON)
//   POST /pagos/:codigo/simular       solo desarrollo: aprueba el adelanto
//
//  La lógica está en controladores/pagos.js y las reglas en servicios/adelantos.js.
// ============================================================================

const express = require('express');
const { requiereCliente } = require('../middleware/auth');
const { limitar } = require('../lib/seguridad');
const { a } = require('../controladores/comun');
const ctl = require('../controladores/pagos');
const { mensajeWhatsApp } = require('../servicios/adelantos');

const router = express.Router();
const limiteComprobante = limitar({ clave: 'comprobante', max: 6, ventanaMin: 30, mensaje: 'Enviaste varios comprobantes seguidos. Escríbenos por WhatsApp.' });

router.post('/:codigo/mercadopago', requiereCliente, a(ctl.mercadoPago));
router.get('/retorno', a(ctl.retorno));
router.post('/mercadopago/webhook', a(ctl.webhook));
router.post('/:codigo/yape', requiereCliente, limiteComprobante, a(ctl.yape));
router.post('/:codigo/simular', requiereCliente, a(ctl.simular));

module.exports = router;
// Se mantiene por compatibilidad: antes este archivo exportaba la función.
module.exports.mensajeWhatsApp = mensajeWhatsApp;
