// ============================================================================
//  src/rutas/cuenta.js — registro e ingreso de clientes (/cuenta)
//
//  Solo URL + middleware. La lógica está en controladores/cuenta.js y las
//  reglas en servicios/cuentas.js.
//
//  Registrarse e ingresar es el MISMO paso (correo + celular, o Google).
//  Ojo de seguridad: correo + celular no envía un código de verificación (eso
//  cuesta dinero por SMS/WhatsApp). Para que nadie pruebe combinaciones hay
//  límite de intentos por IP, y el botón de Google sí verifica la identidad.
//  El DNI y demás datos se piden recién al reservar, no al registrarse.
// ============================================================================

const express = require('express');
const { limitar } = require('../lib/seguridad');
const { requiereCliente } = require('../middleware/auth');
const { a } = require('../controladores/comun');
const cuenta = require('../controladores/cuenta');

const router = express.Router();
const limiteLogin = limitar({ clave: 'login', max: 10, ventanaMin: 15, mensaje: 'Demasiados intentos. Espera 15 minutos.' });

router.get('/ingresar', cuenta.formIngreso);
router.post('/ingresar', limiteLogin, a(cuenta.ingresar));
router.post('/google', limiteLogin, a(cuenta.google));
router.get('/completar', requiereCliente, cuenta.formCompletar);
router.post('/completar', requiereCliente, limiteLogin, a(cuenta.completar));
router.post('/celular', cuenta.celularAntiguo);
router.post('/salir', cuenta.salir);
router.get('/', requiereCliente, a(cuenta.panel));
router.post('/resenas', requiereCliente, a(cuenta.resena));

module.exports = router;
