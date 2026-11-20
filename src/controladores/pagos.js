// ============================================================================
//  src/controladores/pagos.js — pagar el adelanto (/pagos)
//
//  ruta → controlador → validador (pagos) → servicio (adelantos) → db / Mercado Pago
//  Los errores de reservaPropia (404 / 403) siguen al manejador central de
//  app.js, que responde JSON o la página de error según quién llamó.
// ============================================================================

const adelantos = require('../servicios/adelantos');
const pagos = require('../servicios/pagos');
const { leerComprobante } = require('../validadores/pagos');
const { esErrorNegocio } = require('../lib/errores');

const baseUrl = req => process.env.BASE_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;

async function mercadoPago(req, res) {
  const r = await adelantos.reservaPropia(req.params.codigo, req.usuario);
  const url = await adelantos.urlMercadoPago(r, { baseUrl: baseUrl(req), email: req.usuario.email });
  if (!url) return res.redirect(`/reservas/${r.codigo}`);
  res.redirect(303, url);
}

// Mercado Pago vuelve aquí después de pagar (se verifica el pago con su API).
async function retorno(req, res) {
  const idPago = req.query.payment_id || req.query.collection_id;
  const codigo = req.query.external_reference;
  if (idPago && idPago !== 'null' && pagos.mercadoPagoActivo()) {
    const resultado = await adelantos.procesarPagoMP(idPago);
    if (resultado) {
      const aprobado = resultado.estado === 'aprobado';
      req.flash(aprobado ? 'exito' : 'aviso', aprobado ? '¡Pago recibido! Tus equipos y tu fecha quedaron separados.' : 'Tu pago aún no se confirma. Si ya pagaste, se actualizará en unos minutos.');
      return res.redirect(`/reservas/${resultado.reserva.codigo}`);
    }
  }
  if (codigo) {
    req.flash('aviso', 'No se completó el pago. Puedes intentarlo de nuevo o pagar con Yape.');
    return res.redirect(`/reservas/${encodeURIComponent(codigo)}`);
  }
  res.redirect('/cuenta');
}

// Aviso servidor-a-servidor: { type: 'payment', data: { id } } (o ?topic=payment&id=).
// Se responde 200 rápido; si algo falla se registra y Mercado Pago reintenta.
async function webhook(req, res) {
  const tipo = req.body?.type || req.query.type || req.query.topic;
  const id = req.body?.data?.id || req.query['data.id'] || req.query.id;
  if (tipo === 'payment' && id && pagos.mercadoPagoActivo()) {
    try { await adelantos.procesarPagoMP(id); } catch (err) { console.error('[webhook mp]', err.message); return res.sendStatus(500); }
  }
  res.sendStatus(200);
}

// Yape o Plin: foto del comprobante + n.º de operación (JSON).
async function yape(req, res) {
  const r = await adelantos.reservaPropia(req.params.codigo, req.usuario);
  try {
    res.json({ ok: true, ...(await adelantos.enviarComprobante(r, leerComprobante(req.body))) });
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    res.status(400).json({ ok: false, error: err.message });
  }
}

async function simular(req, res) {
  const r = await adelantos.reservaPropia(req.params.codigo, req.usuario);
  if (!pagos.simuladoActivo()) return res.status(403).render('error', { titulo: 'No disponible', status: 403, mensaje: 'El pago simulado solo existe en desarrollo.' });
  await adelantos.simular(r);
  req.flash('exito', 'Pago simulado aprobado (modo desarrollo).');
  res.redirect(`/reservas/${r.codigo}`);
}

module.exports = { mercadoPago, retorno, webhook, yape, simular };
