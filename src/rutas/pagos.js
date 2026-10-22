// ============================================================================
//  src/rutas/pagos.js — pagar el adelanto de una reserva
//
//   POST /pagos/:codigo/mercadopago   crea la preferencia y redirige a Mercado Pago
//   GET  /pagos/retorno               Mercado Pago vuelve aquí (se verifica el pago)
//   POST /pagos/mercadopago/webhook   aviso servidor-a-servidor de Mercado Pago
//   POST /pagos/:codigo/yape          el cliente informa su n.º de operación Yape
//   POST /pagos/:codigo/simular       solo desarrollo: aprueba el adelanto
// ============================================================================

const express = require('express');
const db = require('../db');
const pagos = require('../servicios/pagos');
const reservas = require('../servicios/reservas');
const { requiereCliente } = require('../middleware/auth');

const router = express.Router();
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const baseUrl = req => process.env.BASE_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;

// Carga la reserva y verifica que sea del usuario (o que sea personal del negocio).
async function reservaPropia(req) {
  const r = await db.buscarUno('reservas', { codigo: req.params.codigo });
  if (!r) throw Object.assign(new Error('Reserva no encontrada.'), { status: 404 });
  if (r.usuario_id !== req.usuario.id && req.usuario.rol !== 'admin') throw Object.assign(new Error('Esta reserva no es tuya.'), { status: 403 });
  return r;
}

const porPagar = r => Math.max(0, Math.round((r.adelanto - (r.pagado || 0)) * 100) / 100);

router.post('/:codigo/mercadopago', requiereCliente, a(async (req, res) => {
  const r = await reservaPropia(req);
  if (r.estado !== 'pendiente_pago' || !pagos.mercadoPagoActivo()) return res.redirect(`/reservas/${r.codigo}`);
  const { url } = await pagos.crearPreferencia(r, { baseUrl: baseUrl(req), monto: porPagar(r), email: r.datos_cliente?.correo || req.usuario.email });
  res.redirect(303, url);
}));

// Verifica con la API de Mercado Pago y registra si está aprobado.
async function procesarPagoMP(idPago) {
  const p = await pagos.consultarPago(idPago);
  const r = p.codigo && await db.buscarUno('reservas', { codigo: p.codigo });
  if (!r) return null;
  const estado = p.estado === 'approved' ? 'aprobado' : p.estado === 'rejected' ? 'rechazado' : 'pendiente';
  await reservas.registrarPago(r, { metodo: 'mercadopago', monto: p.monto, referencia: p.id, estado, detalle: { metodo: p.metodo, estado_mp: p.estado } });
  return { reserva: r, estado };
}

router.get('/retorno', a(async (req, res) => {
  const idPago = req.query.payment_id || req.query.collection_id;
  const codigo = req.query.external_reference;
  if (idPago && idPago !== 'null' && pagos.mercadoPagoActivo()) {
    const resultado = await procesarPagoMP(idPago);
    if (resultado) {
      req.flash(resultado.estado === 'aprobado' ? 'exito' : 'aviso', resultado.estado === 'aprobado' ? '¡Pago recibido! Tus equipos y tu fecha quedaron separados.' : 'Tu pago aún no se confirma. Si ya pagaste, se actualizará en unos minutos.');
      return res.redirect(`/reservas/${resultado.reserva.codigo}`);
    }
  }
  if (codigo) {
    req.flash('aviso', 'No se completó el pago. Puedes intentarlo de nuevo o pagar con Yape.');
    return res.redirect(`/reservas/${encodeURIComponent(codigo)}`);
  }
  res.redirect('/cuenta');
}));

// Mercado Pago envía { type: 'payment', data: { id } } (o ?topic=payment&id=).
// Respondemos 200 rápido; si algo falla lo registramos y Mercado Pago reintenta.
router.post('/mercadopago/webhook', a(async (req, res) => {
  const tipo = req.body?.type || req.query.type || req.query.topic;
  const id = req.body?.data?.id || req.query['data.id'] || req.query.id;
  if (tipo === 'payment' && id && pagos.mercadoPagoActivo()) {
    try { await procesarPagoMP(id); } catch (err) { console.error('[webhook mp]', err.message); return res.sendStatus(500); }
  }
  res.sendStatus(200);
}));

router.post('/:codigo/yape', requiereCliente, a(async (req, res) => {
  const r = await reservaPropia(req);
  const operacion = String(req.body.operacion || '').replace(/\D/g, '');
  if (!/^\d{6,12}$/.test(operacion)) {
    req.flash('error', 'El número de operación de Yape tiene entre 6 y 12 dígitos (lo ves en el detalle del yapeo).');
    return res.redirect(`/reservas/${r.codigo}`);
  }
  await reservas.registrarPago(r, { metodo: 'yape', monto: porPagar(r), referencia: operacion, estado: 'pendiente', detalle: { celular_yape: String(req.body.celular || '').replace(/\D/g, '') } });
  req.flash('exito', 'Recibimos tu número de operación. Lo verificamos y te confirmamos por WhatsApp (normalmente en menos de 1 hora).');
  res.redirect(`/reservas/${r.codigo}`);
}));

router.post('/:codigo/simular', requiereCliente, a(async (req, res) => {
  const r = await reservaPropia(req);
  if (!pagos.simuladoActivo()) return res.status(403).render('error', { titulo: 'No disponible', status: 403, mensaje: 'El pago simulado solo existe en desarrollo.' });
  await reservas.registrarPago(r, { metodo: 'simulado', monto: porPagar(r), referencia: `SIM-${Date.now()}`, estado: 'aprobado' });
  req.flash('exito', 'Pago simulado aprobado (modo desarrollo).');
  res.redirect(`/reservas/${r.codigo}`);
}));

module.exports = router;
