// ============================================================================
//  src/servicios/adelantos.js — pagar el adelanto de una reserva
//
//  servicios/pagos.js habla con Mercado Pago (API externa). Este servicio
//  aplica las reglas del NEGOCIO sobre el adelanto:
//   • la reserva debe existir y ser del cliente (o el admin)          → 404 / 403
//   • solo se paga mientras está "pendiente de pago"                  → 409
//   • n.º de operación de 6 a 12 dígitos y foto válida de hasta 3 MB  → 400
//   • un solo comprobante en revisión y nunca la misma operación dos veces → 409
//  El comprobante se guarda en un lugar PRIVADO (tiene nombres y montos) y el
//  pago queda "pendiente" hasta que el admin lo compara con su Yape/Plin.
// ============================================================================

const crypto = require('node:crypto');
const db = require('../db');
const pagos = require('./pagos');
const reservas = require('./reservas');
const negocio = require('./negocio');
const { ErrorNegocio } = require('../lib/errores');
const { soles } = require('../lib/util');
const { TIPOS_COMPROBANTE, MAX_COMPROBANTE, nombreApp } = require('../validadores/pagos');

// Carga la reserva y verifica que sea del usuario (o que sea el admin).
async function reservaPropia(codigo, usuario) {
  const r = await db.buscarUno('reservas', { codigo });
  if (!r) throw new ErrorNegocio('Reserva no encontrada.', 404);
  if (r.usuario_id !== usuario.id && usuario.rol !== 'admin') throw new ErrorNegocio('Esta reserva no es tuya.', 403);
  return r;
}

// Lo que falta pagar del adelanto (nunca negativo, en céntimos exactos).
const porPagar = r => Math.max(0, Math.round((r.adelanto - (r.pagado || 0)) * 100) / 100);

// ── Mercado Pago ───────────────────────────────────────────────────────────
// URL de pago, o null si la reserva ya no está pendiente o Mercado Pago no está activo.
async function urlMercadoPago(r, { baseUrl, email }) {
  if (r.estado !== 'pendiente_pago' || !pagos.mercadoPagoActivo()) return null;
  const { url } = await pagos.crearPreferencia(r, { baseUrl, monto: porPagar(r), email: r.datos_cliente?.correo || email });
  return url;
}

// Verifica con la API de Mercado Pago y registra el resultado.
async function procesarPagoMP(idPago) {
  const p = await pagos.consultarPago(idPago);
  const r = p.codigo && await db.buscarUno('reservas', { codigo: p.codigo });
  if (!r) return null;
  const estado = p.estado === 'approved' ? 'aprobado' : p.estado === 'rejected' ? 'rechazado' : 'pendiente';
  await reservas.registrarPago(r, { metodo: 'mercadopago', monto: p.monto, referencia: p.id, estado, detalle: { metodo: p.metodo, estado_mp: p.estado } });
  return { reserva: r, estado };
}

// ── Yape o Plin ────────────────────────────────────────────────────────────
function mensajeWhatsApp(r, { metodo, operacion, monto }) {
  return `Hola AeeS, pagué el adelanto de mi reserva ${r.codigo} (${r.fecha_evento}) por ${soles(monto)} con ${nombreApp(metodo)}. N.º de operación: ${operacion}. Ya subí la foto del comprobante en la web.`;
}

async function enviarComprobante(r, { metodo, operacion, foto }) {
  if (r.estado !== 'pendiente_pago') throw new ErrorNegocio('Esta reserva ya no tiene un adelanto pendiente.', 409);
  if (!/^\d{6,12}$/.test(operacion)) throw new ErrorNegocio(`El número de operación tiene entre 6 y 12 dígitos (lo ves en el detalle del pago en ${nombreApp(metodo)}).`, 400);
  if (!foto) throw new ErrorNegocio('Sube la foto o captura del comprobante (JPG, PNG o WebP).', 400);
  if (foto.buffer.length > MAX_COMPROBANTE) throw new ErrorNegocio('La foto pesa más de 3 MB. Toma una captura de pantalla del comprobante.', 400);

  const pagosReserva = await db.listar('pagos', { filtro: { reserva_id: r.id } });
  if (pagosReserva.some(p => p.metodo === 'yape' && p.estado === 'pendiente')) throw new ErrorNegocio('Ya recibimos un comprobante y lo estamos revisando.', 409);
  if (pagosReserva.some(p => p.referencia === operacion && p.metodo === 'yape')) throw new ErrorNegocio('Ese número de operación ya fue enviado.', 409);

  const nombre = `${r.codigo}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${TIPOS_COMPROBANTE[foto.tipo]}`;
  await db.guardarPrivado(nombre, foto.buffer, foto.tipo);
  const monto = porPagar(r);
  await reservas.registrarPago(r, {
    // En la base el método es 'yape' para los dos (la columna solo acepta mercadopago/yape/simulado);
    // la app que usó el cliente queda en detalle.app.
    metodo: 'yape', monto, referencia: operacion, estado: 'pendiente',
    detalle: { app: metodo, comprobante: nombre, tipo_foto: foto.tipo, enviado_en: new Date().toISOString() }
  });
  const { negocio: n } = await negocio.obtener();
  return {
    mensaje: 'Recibimos tu comprobante. Lo verificamos y te confirmamos por WhatsApp.',
    whatsapp: `https://wa.me/${n.whatsapp}?text=${encodeURIComponent(mensajeWhatsApp(r, { metodo, operacion, monto }))}`
  };
}

// Solo en desarrollo: aprueba el adelanto sin pagar.
const simular = r => reservas.registrarPago(r, { metodo: 'simulado', monto: porPagar(r), referencia: `SIM-${Date.now()}`, estado: 'aprobado' });

module.exports = { reservaPropia, porPagar, urlMercadoPago, procesarPagoMP, mensajeWhatsApp, enviarComprobante, simular };
