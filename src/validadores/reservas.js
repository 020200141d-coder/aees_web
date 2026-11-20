// ============================================================================
//  src/validadores/reservas.js — formularios de una reserva en el panel
//
//  Solo convierte y comprueba el FORMATO de lo que llega del formulario.
//  Las reglas que dependen del estado de la reserva (¿ya pasó la fecha?,
//  ¿alcanzan los equipos?, ¿cuánto pagó el cliente?) están en el servicio.
// ============================================================================

const { TIPOS_EVENTO, texto, numero } = require('../lib/util');
const { entero } = require('./formulario');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const MODALIDADES = ['videollamada', 'presencial', 'llamada'];

// Datos del evento editables. Lo que venga mal se conserva como estaba (r).
function leerEdicion(b, r) {
  return {
    fecha_evento: FECHA.test(b.fecha_evento) ? b.fecha_evento : r.fecha_evento,
    hora_inicio: HORA.test(b.hora_inicio) ? b.hora_inicio : r.hora_inicio,
    horas: Math.min(24, Math.max(1, entero(b.horas, r.horas))),
    personas: Math.max(0, entero(b.personas, r.personas || 0)),
    tipo_evento: TIPOS_EVENTO[b.tipo_evento] ? b.tipo_evento : r.tipo_evento,
    lugar: texto(b.lugar, 200) || r.lugar,
    encuesta: { ...(r.encuesta || {}), acceso_vehicular: b.acceso_vehicular === 'si' ? true : b.acceso_vehicular === 'no' ? false : r.encuesta?.acceso_vehicular ?? null }
  };
}

// Reunión o llamada de confirmación: fecha, hora y modalidad válidas.
function leerReunion(b) {
  const { fecha, hora, modalidad } = b;
  return {
    datos: { fecha, hora, modalidad, nota: texto(b.nota, 200) },
    valida: FECHA.test(fecha) && HORA.test(hora) && MODALIDADES.includes(modalidad)
  };
}

// Ajuste manual del precio: total redondeado a céntimos y motivo.
const leerAjustePrecio = b => ({ nuevo: Math.round(numero(b.total_nuevo, NaN) * 100) / 100, motivo: texto(b.motivo, 300) });

module.exports = { leerEdicion, leerReunion, leerAjustePrecio, FECHA, MODALIDADES };
