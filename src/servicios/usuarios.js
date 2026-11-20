// ============================================================================
//  src/servicios/usuarios.js — cuentas del personal y su ingreso al panel
//
//  Reglas que protegen al negocio de quedarse sin dueño:
//   • la cuenta principal (ADMIN_EMAIL, la del dueño) no se borra ni baja de rol
//   • nadie se borra ni se quita el rol de admin a sí mismo
//   • siempre queda al menos un administrador
//  Más: el correo de una cuenta es único y la contraseña se guarda con hash.
// ============================================================================

const crypto = require('node:crypto');
const db = require('../db');
const { hashClave, verificarClave } = require('../lib/seguridad');
const { emailPrincipal } = require('../middleware/auth');
const { ErrorNegocio } = require('../lib/errores');
const { ROLES, claveDebil } = require('../validadores/usuarios');

const ROLES_PERSONAL = ['admin', 'publicador'];
const esPrincipal = u => Boolean(u?.email && u.email === emailPrincipal());

// Hash de una clave al azar: si el correo no existe igual se compara contra
// él, así la respuesta tarda lo mismo y no se puede averiguar qué correos
// tienen cuenta midiendo el tiempo.
const HASH_FALSO = hashClave(crypto.randomBytes(12).toString('hex'));

// Devuelve la cuenta del personal si correo y clave son correctos; si no, null.
async function autenticar(email, clave) {
  const u = email && await db.buscarUno('usuarios', { email });
  const claveOk = verificarClave(clave || '', u?.clave_hash || HASH_FALSO);
  return u && ROLES_PERSONAL.includes(u.rol) && claveOk ? u : null;
}

const personal = async () => (await db.listar('usuarios', { orden: 'creado_en' })).filter(u => u.rol !== 'cliente');

async function cuentaDelPersonal(id) {
  const u = await db.obtener('usuarios', String(id));
  return u && u.rol !== 'cliente' ? u : null;
}

const cuantosAdmins = async () => (await db.listar('usuarios', { filtro: { rol: 'admin' } })).length;

// Crea la cuenta; `errores` trae los de formato del validador.
async function crear(datos, clave, errores = {}) {
  if (!errores.email && await db.buscarUno('usuarios', { email: datos.email })) errores.email = 'Ese correo ya tiene cuenta.';
  if (Object.keys(errores).length) return { errores };
  await db.insertar('usuarios', { ...datos, clave_hash: hashClave(clave) });
  return { errores: null };
}

// Editar nombre, rol y (opcional) contraseña. Devuelve { errores, cambios }.
async function actualizar(u, { nombre, rol, claveNueva }, quienEdita) {
  const cambios = { nombre, rol: ROLES[rol] ? rol : u.rol };
  const errores = {};
  if (cambios.nombre.length < 2) errores.nombre = 'Escribe el nombre.';
  if (cambios.rol !== 'admin' && u.rol === 'admin') {
    if (esPrincipal(u)) errores.rol = 'La cuenta principal del negocio siempre es administradora.';
    else if (u.id === quienEdita.id) errores.rol = 'No puedes quitarte el rol de administrador a ti mismo.';
    else if ((await cuantosAdmins()) <= 1) errores.rol = 'Debe quedar al menos un administrador.';
  }
  if (claveNueva) {
    const debil = claveDebil(claveNueva);
    if (debil) errores.clave_nueva = debil; else cambios.clave_hash = hashClave(claveNueva);
  }
  if (Object.keys(errores).length) return { errores, cambios };
  await db.actualizar('usuarios', u.id, cambios);
  return { errores: null, cambios };
}

async function eliminar(id, quienElimina) {
  const u = await db.obtener('usuarios', id);
  if (!u || u.rol === 'cliente') throw new ErrorNegocio('Esa cuenta no existe.', 404);
  if (u.id === quienElimina.id) throw new ErrorNegocio('No puedes eliminar tu propia cuenta.', 409);
  if (esPrincipal(u)) throw new ErrorNegocio('La cuenta principal del negocio no se puede eliminar.', 409);
  if (u.rol === 'admin' && (await cuantosAdmins()) <= 1) throw new ErrorNegocio('Debe quedar al menos un administrador.', 409);
  await db.eliminar('usuarios', u.id);
  return u;
}

module.exports = { ROLES_PERSONAL, esPrincipal, autenticar, personal, cuentaDelPersonal, crear, actualizar, eliminar };
