// ============================================================================
//  src/validadores/pagos.js — comprobante de Yape o Plin que envía el cliente
//
//  Llega por fetch en JSON: { metodo: 'yape'|'plin', operacion, foto: 'data:image/...;base64,...' }
// ============================================================================

const TIPOS_COMPROBANTE = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_COMPROBANTE = 3 * 1024 * 1024;

function leerComprobante(b = {}) {
  const foto = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.foto || ''));
  return {
    metodo: b.metodo === 'plin' ? 'plin' : 'yape',
    operacion: String(b.operacion || '').replace(/\D/g, ''),
    foto: foto ? { tipo: foto[1], buffer: Buffer.from(foto[2], 'base64') } : null
  };
}

const nombreApp = metodo => (metodo === 'plin' ? 'Plin' : 'Yape');

module.exports = { leerComprobante, nombreApp, TIPOS_COMPROBANTE, MAX_COMPROBANTE };
