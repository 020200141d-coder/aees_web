// ============================================================================
//  src/rutas/pagos.js — pagar el adelanto de una reserva
//
//   POST /pagos/:codigo/mercadopago   crea la preferencia y redirige a Mercado Pago
//   GET  /pagos/retorno               Mercado Pago vuelve aquí (se verifica el pago)
//   POST /pagos/mercadopago/webhook   aviso servidor-a-servidor de Mercado Pago
//   POST /pagos/:codigo/yape          el cliente paga con Yape o Plin: sube la foto
//                                     del comprobante + n.º de operación (JSON)
//   POST /pagos/:codigo/simular       solo desarrollo: aprueba el adelanto
// ============================================================================

const express = require('express');
const db = require('../db');
const pagos = require('../servicios/pagos');
const reservas = require('../servicios/reservas');
const crypto = require('node:crypto');
const { requiereCliente } = require('../middleware/auth');
const { limitar } = require('../lib/seguridad');
const { soles } = require('../lib/util');
const negocio = require('../servicios/negocio');

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

// ── Yape o Plin ─────────────────────────────────────────────────────────────
// El cliente escanea el QR, paga y aquí envía (por fetch, en JSON):
//   { metodo: 'yape'|'plin', operacion: '12345678', foto: 'data:image/webp;base64,...' }
// La foto ya llega reducida y en WebP (public/js/reserva.js). Se guarda en un
// lugar PRIVADO (no es una foto pública: tiene nombres y montos). El pago queda
// "pendiente" hasta que el admin compara la foto y el n.º de operación con su
// Yape/Plin y lo aprueba en el panel.
// La respuesta trae el enlace de WhatsApp con el mensaje ya escrito para avisar al negocio.
const limiteComprobante = limitar({ clave: 'comprobante', max: 6, ventanaMin: 30, mensaje: 'Enviaste varios comprobantes seguidos. Escríbenos por WhatsApp.' });
const TIPOS_COMPROBANTE = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

function mensajeWhatsApp(r, { metodo, operacion, monto }) {
  return `Hola AeeS, pagué el adelanto de mi reserva ${r.codigo} (${r.fecha_evento}) por ${soles(monto)} con ${metodo === 'plin' ? 'Plin' : 'Yape'}. N.º de operación: ${operacion}. Ya subí la foto del comprobante en la web.`;
}

router.post('/:codigo/yape', requiereCliente, limiteComprobante, a(async (req, res) => {
  const r = await reservaPropia(req);
  const metodo = req.body?.metodo === 'plin' ? 'plin' : 'yape';
  const operacion = String(req.body?.operacion || '').replace(/\D/g, '');
  const foto = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.foto || ''));
  const error = msg => res.status(400).json({ ok: false, error: msg });

  if (r.estado !== 'pendiente_pago') return error('Esta reserva ya no tiene un adelanto pendiente.');
  if (!/^\d{6,12}$/.test(operacion)) return error(`El número de operación tiene entre 6 y 12 dígitos (lo ves en el detalle del pago en ${metodo === 'plin' ? 'Plin' : 'Yape'}).`);
  if (!foto) return error('Sube la foto o captura del comprobante (JPG, PNG o WebP).');
  const buffer = Buffer.from(foto[2], 'base64');
  if (buffer.length > 3 * 1024 * 1024) return error('La foto pesa más de 3 MB. Toma una captura de pantalla del comprobante.');

  const pagosReserva = await db.listar('pagos', { filtro: { reserva_id: r.id } });
  if (pagosReserva.some(p => p.metodo === 'yape' && p.estado === 'pendiente')) return error('Ya recibimos un comprobante y lo estamos revisando.');
  if (pagosReserva.some(p => p.referencia === operacion && p.metodo === 'yape')) return error('Ese número de operación ya fue enviado.');

  const nombre = `${r.codigo}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${TIPOS_COMPROBANTE[foto[1]]}`;
  await db.guardarPrivado(nombre, buffer, foto[1]);
  const monto = porPagar(r);
  await reservas.registrarPago(r, {
    // En la base el método es 'yape' para los dos (la columna solo acepta mercadopago/yape/simulado);
    // la app que usó el cliente queda en detalle.app.
    metodo: 'yape', monto, referencia: operacion, estado: 'pendiente',
    detalle: { app: metodo, comprobante: nombre, tipo_foto: foto[1], enviado_en: new Date().toISOString() }
  });
  const { negocio: n } = await negocio.obtener();
  res.json({
    ok: true,
    mensaje: 'Recibimos tu comprobante. Lo verificamos y te confirmamos por WhatsApp.',
    whatsapp: `https://wa.me/${n.whatsapp}?text=${encodeURIComponent(mensajeWhatsApp(r, { metodo, operacion, monto }))}`
  });
}));

router.post('/:codigo/simular', requiereCliente, a(async (req, res) => {
  const r = await reservaPropia(req);
  if (!pagos.simuladoActivo()) return res.status(403).render('error', { titulo: 'No disponible', status: 403, mensaje: 'El pago simulado solo existe en desarrollo.' });
  await reservas.registrarPago(r, { metodo: 'simulado', monto: porPagar(r), referencia: `SIM-${Date.now()}`, estado: 'aprobado' });
  req.flash('exito', 'Pago simulado aprobado (modo desarrollo).');
  res.redirect(`/reservas/${r.codigo}`);
}));

module.exports = router;
module.exports.mensajeWhatsApp = mensajeWhatsApp;
