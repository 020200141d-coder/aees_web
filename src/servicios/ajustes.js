// ============================================================================
//  src/servicios/ajustes.js — guardar los ajustes del negocio
//
//  Cada bloque se valida (validadores/ajustes.js) y se guarda en la tabla
//  "ajustes". Si los datos no son válidos se lanza ErrorNegocio 422.
//  Al guardar datos que se ven en la web (negocio, portada) se limpia la
//  caché de servicios/negocio.js para que el cambio aparezca al instante.
// ============================================================================

const db = require('../db');
const precios = require('./precios');
const negocio = require('./negocio');
const { ErrorNegocio } = require('../lib/errores');
const { leerNegocio, leerReglas, leerVehiculos, leerPortada } = require('../validadores/ajustes');

// Lo que muestra la página de Ajustes. Las reglas se leen con sus valores por
// defecto (precios.reglas) para que los campos nuevos no salgan vacíos.
async function paraFormulario() {
  const [n, vehiculos, portada, reglas] = await Promise.all([...['negocio', 'vehiculos', 'portada'].map(k => db.ajuste(k)), precios.reglas()]);
  return { n: n || {}, reglas, vehiculos: vehiculos || [], portada: portada || {} };
}

// Valida con `leer` y guarda en `clave`; si hay error, ErrorNegocio 422.
async function guardar(clave, { datos, error }) {
  if (error) throw new ErrorNegocio(error, 422);
  await db.guardarAjuste(clave, datos);
}

async function guardarNegocio(body) {
  await guardar('negocio', leerNegocio(body, (await db.ajuste('negocio')) || {}));
  negocio.invalidar();
}

// Se parte de lo guardado: así no se pierden reglas que el formulario no muestra.
const guardarReglas = async body => guardar('reglas', leerReglas(body, await precios.reglas()));

const guardarVehiculos = body => guardar('vehiculos', leerVehiculos(body));

async function guardarPortada(body) {
  await guardar('portada', leerPortada(body));
  negocio.invalidar();
}

module.exports = { paraFormulario, guardarNegocio, guardarReglas, guardarVehiculos, guardarPortada };
