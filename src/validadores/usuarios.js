// ============================================================================
//  src/validadores/usuarios.js — cuentas del personal (admin y publicador)
// ============================================================================

const { texto } = require('../lib/util');
const { correoValido } = require('./clientes');

const ROLES = { admin: 'Administrador', publicador: 'Publicador' };

// Contraseña del personal: 10+ caracteres con letras y números. Devuelve el
// mensaje de error o null si está bien.
const claveDebil = c => (c.length < 10 || !/[a-zA-Z]/.test(c) || !/\d/.test(c) ? 'Mínimo 10 caracteres, con letras y números.' : null);

// Formulario de cuenta nueva. El correo repetido lo revisa el servicio.
function leerCuentaNueva(b) {
  const datos = { nombre: texto(b.nombre, 80), email: texto(b.email, 120).toLowerCase(), rol: ROLES[b.rol] ? b.rol : 'publicador' };
  const errores = {};
  if (datos.nombre.length < 2) errores.nombre = 'Escribe el nombre.';
  if (!correoValido(datos.email)) errores.email = 'Correo inválido.';
  const clave = String(b.clave || '');
  const debil = claveDebil(clave);
  if (debil) errores.clave = debil;
  return { datos, clave, errores };
}

module.exports = { ROLES, claveDebil, leerCuentaNueva };
