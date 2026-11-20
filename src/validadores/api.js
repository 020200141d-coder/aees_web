// ============================================================================
//  src/validadores/api.js — datos que llegan a la API JSON (/api)
//
//  Convierte lo que manda el navegador (fetch) en datos limpios y, donde
//  corresponde, devuelve `campos` = { input: mensaje } para marcar el formulario.
// ============================================================================

const { texto, numero, TIPOS_EVENTO } = require('../lib/util');
const { limpiarCelular } = require('./clientes');

const fechaValida = f => (/^\d{4}-\d{2}-\d{2}$/.test(f || '') ? f : null);

const coordenadas = o => {
  const lat = numero(o?.lat, NaN), lng = numero(o?.lng, NaN);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};

// Encuesta del asistente "Arma tu evento".
function leerEncuesta(b = {}) {
  const encuesta = {
    tipo_evento: TIPOS_EVENTO[b.tipo_evento] ? b.tipo_evento : 'otro',
    personas: Math.round(numero(b.personas, 50)),
    espacio: b.espacio === 'exterior' ? 'exterior' : 'interior',
    horas: Math.round(numero(b.horas, 0)) || null,
    hay_electricidad: b.hay_electricidad !== false,
    extras: Object.fromEntries(['orquesta', 'banda', 'dj', 'proyeccion', 'luces'].map(k => [k, Boolean(b.extras?.[k])])),
    nombre: texto(b.nombre, 40),
    // Músicos en vivo: datos para ajustar al rider técnico del grupo.
    integrantes: Math.min(20, Math.max(0, Math.round(numero(b.integrantes, 0)))) || null,
    horas_grupo: Math.min(24, Math.max(0, Math.round(numero(b.horas_grupo, 0)))) || null,
    trae_monitoreo: b.trae_monitoreo === true,
    // ¿El vehículo llega hasta el lugar? (para el transporte incluido)
    acceso_vehicular: b.acceso_vehicular === false ? false : b.acceso_vehicular === true ? true : null
  };
  // Si el navegador mandó extras sin decir nada de luces, se asume que sí las quiere.
  if (b.extras && b.extras.luces === undefined) encuesta.extras.luces = true;
  return { encuesta, fecha: fechaValida(b.fecha), lugar: coordenadas(b.lugar), lugarTexto: b.lugar?.texto };
}

// Cotizador rápido de la portada: 4 datos + fecha opcional.
function leerEncuestaRapida(b = {}) {
  return {
    encuesta: {
      tipo_evento: TIPOS_EVENTO[b.tipo_evento] ? b.tipo_evento : 'otro',
      personas: Math.min(3000, Math.max(5, Math.round(numero(b.personas, 60)))),
      espacio: b.espacio === 'exterior' ? 'exterior' : 'interior',
      extras: { luces: false, dj: b.tipo_evento === 'fiesta_electronica' }
    },
    fecha: fechaValida(b.fecha),
    acceso: b.acceso_vehicular !== false
  };
}

// Datos del cliente al reservar desde "Mi evento".
function leerDatosCliente(c = {}) {
  const datos = {
    nombre: texto(c.nombre, 80),
    dni: String(c.dni || '').replace(/\D/g, ''),
    celular: limpiarCelular(c.celular),
    correo: texto(c.correo, 120)
  };
  const campos = {};
  if (datos.nombre.length < 3) campos.nombre = 'Escribe tu nombre completo.';
  if (!/^\d{8}$/.test(datos.dni)) campos.dni = 'El DNI tiene 8 dígitos.';
  if (!/^9\d{8}$/.test(datos.celular)) campos.celular = 'Celular peruano de 9 dígitos que empiece en 9.';
  if (datos.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(datos.correo)) campos.correo = 'Ese correo no parece válido.';
  if (c.acepta !== true) campos.acepta = 'Debes aceptar el uso de tus datos para gestionar la reserva.';
  return { datos, campos };
}

const limpiarTelefono = v => String(v || '').replace(/[^\d+ ]/g, '').slice(0, 20);

// Formulario de contacto de la portada.
function leerContacto(b = {}) {
  const datos = {
    nombre: texto(b.nombre, 80),
    telefono: limpiarTelefono(b.telefono),
    fecha_evento: fechaValida(b.fecha_evento),
    mensaje: String(b.mensaje || '').trim().slice(0, 3000)
  };
  const campos = {};
  if (datos.nombre.length < 2) campos.nombre = 'Escribe tu nombre.';
  if (datos.telefono.replace(/\D/g, '').length < 9) campos.telefono = 'Déjanos un número para responderte.';
  if (datos.mensaje.length < 10) campos.mensaje = 'Cuéntanos un poco más (mínimo 10 caracteres).';
  return { datos, campos };
}

module.exports = { fechaValida, coordenadas, leerEncuesta, leerEncuestaRapida, leerDatosCliente, leerContacto, limpiarTelefono };
