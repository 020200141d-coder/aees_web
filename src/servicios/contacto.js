// ============================================================================
//  src/servicios/contacto.js — mensajes que llegan desde la web
//
//   • guardarContacto(): formulario de contacto de la portada
//   • solicitarReunion(): la fecha está ocupada → en vez de perder al cliente
//     se pide una reunión (AeeS puede completar con un proveedor aliado)
//  Ambos quedan en Admin → Mensajes.
//  También crea la reserva desde "Mi evento" con los datos validados.
// ============================================================================

const db = require('../db');
const reservas = require('./reservas');
const { ErrorNegocio } = require('../lib/errores');
const { texto } = require('../lib/util');

// `campos` con errores → 400 con los mensajes para marcar el formulario.
function exigirCampos(campos, mensaje) {
  if (Object.keys(campos).length) throw new ErrorNegocio(mensaje, 400, { extra: { campos } });
}

async function guardarContacto({ datos, campos }) {
  exigirCampos(campos, 'Revisa los campos marcados.');
  await db.insertar('mensajes', { ...datos, tipo: 'contacto', datos: {}, leido: false });
}

async function solicitarReunion({ nombre, telefono, mensaje, carrito, usuario }) {
  if (nombre.length < 2 || telefono.replace(/\D/g, '').length < 9) {
    throw new ErrorNegocio('Déjanos tu nombre y un celular para coordinar la reunión.', 400);
  }
  const p = await reservas.preparar(carrito, { usuarioId: usuario?.id });
  const resumen = p.expandidos.map(it => `${it.cantidad}× ${p.mapa[it.equipo_id]?.nombre}`).join(', ');
  await db.insertar('mensajes', {
    tipo: 'fecha_ocupada',
    nombre,
    telefono,
    fecha_evento: p.carrito.fecha,
    mensaje: texto(mensaje, 1000) || `Quiero reservar para el ${p.carrito.fecha}, pero hay equipos ocupados. Propónganme una solución.`,
    datos: { carrito: p.carrito, faltan: p.faltan, resumen, total_estimado: p.cotizacion.total, usuario_id: usuario?.id || null },
    leido: false
  });
}

// Reserva desde "Mi evento": primero los datos del cliente, luego el servicio de reservas.
async function reservar({ usuario, carrito, cliente: { datos, campos }, promoCodigo }) {
  exigirCampos(campos, 'Revisa los datos marcados.');
  const reserva = await reservas.crear({ usuario, carrito, datosCliente: datos, promoCodigo });
  return { codigo: reserva.codigo, url: `/reservas/${reserva.codigo}` };
}

module.exports = { guardarContacto, solicitarReunion, reservar };
