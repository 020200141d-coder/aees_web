// ============================================================================
//  src/validadores/formulario.js — conversores comunes de campos de formulario
//
//  Los formularios HTML mandan todo como texto ("on", "12", ""). Estas
//  funciones lo pasan al tipo correcto con un valor por defecto seguro.
//  Las usan todos los validadores (equipos, combos, galería, ajustes…), por
//  eso viven aquí y no repetidas en cada archivo.
// ============================================================================

const { texto, numero } = require('../lib/util');

// Casilla marcada: el navegador manda "on"; el JSON del panel manda true.
const marcado = v => v === 'on' || v === 'true' || v === true;

// Número entero (redondeado) con valor por defecto si viene vacío o inválido.
const entero = (v, def = 0) => Math.round(numero(v, def));

// Número opcional: vacío → null (por ejemplo "precio por cantidad" sin llenar).
const opcional = v => (v === '' || v == null ? null : numero(v, null));

// URL de imagen permitida: https externa o una ruta propia (/img o /uploads).
// Devuelve '' si viene vacía y null si es inválida (así el validador avisa).
const urlImagen = v => {
  const s = texto(v, 600);
  return !s || /^https:\/\/\S+$/.test(s) || /^\/(img|uploads)\/\S+$/.test(s) ? s : null;
};

// Filas que llegan como items[0][campo] → { 0: {...}, 1: {...} } o como arreglo.
const filas = v => (Array.isArray(v) ? v : Object.values(v || {}));

// ¿El validador encontró algún error?
const hayErrores = errores => Object.keys(errores).length > 0;

module.exports = { marcado, entero, opcional, urlImagen, filas, hayErrores };
