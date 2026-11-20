// ============================================================================
//  src/validadores/cuenta.js — formularios de ingreso del cliente
//
//  Solo forma de los datos. Lo que depende de la base (¿el correo ya existe?,
//  ¿el celular es de otra persona?) lo decide servicios/cuentas.js.
// ============================================================================

const { texto } = require('../lib/util');
const { limpiarCelular, celularValido } = require('./clientes');

// Cualquier correo válido (Gmail, Hotmail, Outlook, el de la universidad…).
const esCorreo = e => /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e);

// Para los mensajes: muestra el correo a medias (a•••z@gmail.com).
const ocultarCorreo = e => e.replace(/^(.)(.*)(.)@/, (m, a, b, c) => `${a}${'•'.repeat(Math.min(b.length, 5))}${c}@`);

// Solo rutas internas en "volver" (evita redirigir a sitios ajenos).
const volverCliente = v => (typeof v === 'string' && /^\/(?!\/)/.test(v) ? v : '/cuenta');

// Ingreso con correo + celular (y nombre si es nuevo, PIN si es cuenta antigua).
function leerIngreso(b) {
  return {
    email: texto(b.email, 120).toLowerCase(),
    celular: limpiarCelular(b.celular),
    nombre: texto(b.nombre, 80),
    pin: String(b.pin || '')
  };
}

// Primer error de formato del ingreso (o null).
function errorIngreso({ email, celular }) {
  if (!esCorreo(email)) return 'Escribe un correo válido, por ejemplo tunombre@gmail.com.';
  if (!celularValido(celular)) return 'Escribe tu celular de 9 dígitos (empieza en 9).';
  return null;
}

module.exports = { esCorreo, ocultarCorreo, volverCliente, leerIngreso, errorIngreso };
