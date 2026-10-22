// ============================================================================
//  src/lib/seguridad.js — contraseñas, CSRF y límite de peticiones
//
//  • hashClave / verificarClave: usamos scrypt (incluido en Node, sin
//    dependencias). Nunca guardamos la clave ni el PIN en texto: solo
//    "sal:hash". Para comparar usamos timingSafeEqual, que tarda lo mismo
//    acierte o no, y así no se puede adivinar la clave midiendo tiempos.
//  • csrf: cada sesión recibe un token aleatorio. Los formularios lo envían
//    en el campo oculto _csrf y los fetch en la cabecera x-csrf-token. Un
//    sitio ajeno no conoce el token, así que no puede hacer POST en nombre
//    del usuario aunque el navegador mande su cookie.
//  • limitar: ventana deslizante en memoria (ip + clave → tiempos). Frena
//    fuerza bruta en el login y abuso de la IA, que cuesta dinero por uso.
// ============================================================================

const crypto = require('node:crypto');

function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(clave), sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

function verificarClave(clave, guardado) {
  if (!guardado || !guardado.includes(':')) return false;
  const [sal, hash] = guardado.split(':');
  const calculado = crypto.scryptSync(String(clave), sal, 64);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
}

// Rutas que reciben POST de servicios externos (no llevan nuestro token).
const SIN_CSRF = ['/pagos/mercadopago/webhook'];

function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || SIN_CSRF.includes(req.path)) return next();

  const enviado = req.get('x-csrf-token') || req.body?._csrf;
  if (enviado && enviado === req.session.csrf) return next();

  const err = new Error('La sesión expiró o el formulario es inválido. Recarga la página e inténtalo de nuevo.');
  err.status = 403;
  next(err);
}

const registros = new Map();

// Devuelve un middleware que deja pasar `max` peticiones por IP cada `ventanaMin` minutos.
function limitar({ clave, max, ventanaMin, mensaje }) {
  const ventana = ventanaMin * 60 * 1000;
  return (req, res, next) => {
    const id = `${clave}:${req.ip}`;
    const ahora = Date.now();
    const recientes = (registros.get(id) || []).filter(t => ahora - t < ventana);
    if (recientes.length >= max) {
      return res.status(429).json({ ok: false, error: mensaje || 'Demasiadas solicitudes seguidas. Intenta en unos minutos.' });
    }
    recientes.push(ahora);
    registros.set(id, recientes);
    next();
  };
}

module.exports = { hashClave, verificarClave, csrf, limitar };
