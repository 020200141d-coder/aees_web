// ============================================================================
//  src/validadores/promociones.js — códigos de descuento
// ============================================================================

const { texto, numero } = require('../lib/util');
const { marcado } = require('./formulario');

function leerPromo(b) {
  const d = {
    codigo: texto(b.codigo, 20).toUpperCase(),
    descripcion: texto(b.descripcion, 200),
    porcentaje: numero(b.porcentaje, NaN),
    solo_frecuentes: marcado(b.solo_frecuentes),
    activo: marcado(b.activo),
    vence: /^\d{4}-\d{2}-\d{2}$/.test(b.vence || '') ? b.vence : null
  };
  const e = {};
  if (!/^[A-Z0-9]{3,20}$/.test(d.codigo)) e.codigo = 'De 3 a 20 letras o números, sin espacios.';
  // Tope de 50 %: un código no debe poder regalar el servicio por error.
  if (!(d.porcentaje > 0 && d.porcentaje <= 50)) e.porcentaje = 'Entre 1 y 50 %.';
  return { datos: d, errores: e };
}

module.exports = { leerPromo };
