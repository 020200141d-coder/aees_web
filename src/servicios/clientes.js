// ============================================================================
//  src/servicios/clientes.js — clientes que registra el administrador
//
//  El admin registra clientes que llegan por WhatsApp o en persona. Con su
//  correo y celular, el cliente después puede entrar solo a la web.
//
//  Reglas:
//   • celular y correo no pueden pertenecer a otra persona            → 409
//   • solo se elimina un cliente SIN reservas (son el historial)      → 409
// ============================================================================

const db = require('../db');
const precios = require('./precios');
const puntos = require('./puntos');
const { ErrorNegocio } = require('../lib/errores');
const { erroresFormato, celularValido } = require('../validadores/clientes');

const ESTADOS_PAGADOS = ['adelanto_pagado', 'confirmada', 'completada'];

const listarClientes = ({ orden = 'creado_en', desc = false } = {}) => db.listar('usuarios', { filtro: { rol: 'cliente' }, orden, desc });

// Cliente por id (null si no existe o si es una cuenta del personal).
async function obtener(id) {
  const u = await db.obtener('usuarios', id);
  return u && u.rol === 'cliente' ? u : null;
}

// Errores de formato + duplicados en la base. `idActual` = el propio cliente al editar.
async function errores(d, idActual) {
  const e = erroresFormato(d);
  if (celularValido(d.celular)) {
    const otro = await db.buscarUno('usuarios', { celular: d.celular });
    if (otro && otro.id !== idActual) e.celular = `Ese celular ya es de ${otro.nombre}.`;
  }
  if (d.email && !e.email) {
    const otro = await db.buscarUno('usuarios', { email: d.email });
    if (otro && otro.id !== idActual) e.email = `Ese correo ya es de ${otro.nombre}.`;
  }
  // El mensaje del panel junta los errores en el orden del formulario.
  return Object.fromEntries(['nombre', 'celular', 'email', 'dni'].filter(k => e[k]).map(k => [k, e[k]]));
}

async function validarOFallar(d, idActual) {
  const e = await errores(d, idActual);
  if (Object.keys(e).length) throw new ErrorNegocio(Object.values(e).join(' '), 409);
}

async function crear(d) {
  await validarOFallar(d, null);
  return db.insertar('usuarios', { rol: 'cliente', ...d });
}

async function actualizar(id, d) {
  await validarOFallar(d, id);
  return db.actualizar('usuarios', id, d);
}

async function eliminar(u) {
  const suyas = await db.listar('reservas', { filtro: { usuario_id: u.id } });
  if (suyas.length) throw new ErrorNegocio(`${u.nombre} tiene ${suyas.length} reserva(s): no se puede eliminar. Puedes editar sus datos.`, 409);
  await db.eliminar('usuarios', u.id);
}

// Ficha: reservas del cliente, saldo de puntos y si ya es "frecuente".
async function ficha(u) {
  const [suyas, reglas] = await Promise.all([db.listar('reservas', { filtro: { usuario_id: u.id }, orden: 'fecha_evento', desc: true }), precios.reglas()]);
  return { reservas: suyas, saldo: puntos.calcularSaldo(suyas, reglas), frecuente: await precios.esFrecuente(u.id, reglas) };
}

// Tabla de clientes con sus totales y búsqueda por nombre, correo, celular o DNI.
async function tabla(q = '') {
  const [clientes, reservas] = await Promise.all([listarClientes({ orden: 'creado_en', desc: true }), db.listar('reservas')]);
  const pagada = r => ESTADOS_PAGADOS.includes(r.estado);
  const lista = clientes.map(u => {
    const suyas = reservas.filter(r => r.usuario_id === u.id);
    return { ...u, reservas: suyas.length, pagadas: suyas.filter(pagada).length, gastado: suyas.filter(pagada).reduce((s, r) => s + Number(r.total), 0), ultima: suyas.map(r => r.fecha_evento).sort().pop() };
  });
  const reglas = (await db.ajuste('reglas')) || {};
  const filtrados = q ? lista.filter(c => `${c.nombre} ${c.email || ''} ${c.celular || ''} ${c.dni || ''}`.toLowerCase().includes(q)) : lista;
  return { clientes: filtrados, total: lista.length, minimo: reglas.reservas_para_frecuente || 2 };
}

module.exports = { listarClientes, obtener, errores, crear, actualizar, eliminar, ficha, tabla };
