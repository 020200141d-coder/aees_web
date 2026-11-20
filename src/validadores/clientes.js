// ============================================================================
//  src/validadores/clientes.js — datos de un cliente registrado desde el panel
//
//  Formato: nombre, celular peruano de 9 dígitos, correo y DNI opcionales.
//  Lo que depende de la base (¿el celular ya es de otro?) lo revisa el servicio.
// ============================================================================

const { texto } = require('../lib/util');

const celularValido = c => /^9\d{8}$/.test(c);
// Acepta "+51 987 654 321", "987-654-321"… y deja solo los 9 dígitos.
const limpiarCelular = v => String(v || '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');
const correoValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function leerCliente(b) {
  return {
    nombre: texto(b.nombre, 80),
    email: texto(b.email, 120).toLowerCase() || null,
    celular: limpiarCelular(b.celular),
    dni: String(b.dni || '').replace(/\D/g, '').slice(0, 12) || null
  };
}

// Errores de formato (sin consultar la base), en el orden en que se muestran.
function erroresFormato(d) {
  const e = {};
  if (d.nombre.length < 2) e.nombre = 'Escribe el nombre.';
  if (!celularValido(d.celular)) e.celular = 'Celular de 9 dígitos (empieza en 9).';
  if (d.email && !correoValido(d.email)) e.email = 'Correo inválido.';
  if (d.dni && !/^\d{8,12}$/.test(d.dni)) e.dni = 'DNI de 8 dígitos (o CE).';
  return e;
}

module.exports = { leerCliente, erroresFormato, celularValido, limpiarCelular, correoValido };
