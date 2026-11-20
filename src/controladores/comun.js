// ============================================================================
//  src/controladores/comun.js — piezas que comparten todos los controladores
//
//  Un controlador es el "traductor" entre HTTP y los servicios:
//    1. lee la petición (req.params, req.body, req.query),
//    2. llama al servicio que aplica las reglas,
//    3. responde: render de una vista, redirect con flash o JSON.
//  No contiene reglas de negocio ni consultas a la base.
// ============================================================================

const { esErrorNegocio } = require('../lib/errores');

// Envuelve un controlador async: si falla, el error llega a next() y lo
// atiende el manejador central de app.js (Express 5 ya lo hace con promesas,
// pero así queda explícito y funciona igual en cualquier versión).
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ¿El navegador pidió JSON? (los interruptores del panel usan fetch con Accept: JSON)
const quiereJson = req => Boolean(req.get('accept')?.includes('application/json'));

// Solo se vuelve a rutas del propio panel (evita redirecciones a otros sitios).
const volverSeguro = v => (typeof v === 'string' && /^\/admin(\/|$|\?)/.test(v) ? v : '/admin');

// Express 5 ya no acepta redirect('back'): se vuelve a la página anterior solo si es del panel.
const volverA = (req, porDefecto) => {
  try {
    const u = new URL(req.get('referer'));
    return u.host === req.get('host') ? volverSeguro(u.pathname + u.search) : porDefecto;
  } catch {
    return porDefecto;
  }
};

// Ejecuta una acción del panel y, si un servicio rechaza la operación con un
// ErrorNegocio, lo convierte en mensaje flash + redirect (patrón PRG). Cualquier
// otro error (base caída, bug) sigue su camino al manejador central.
async function accionPanel(req, res, { hacer, exito, volver }) {
  try {
    const resultado = await hacer();
    const mensaje = typeof exito === 'function' ? exito(resultado) : exito;
    if (mensaje) req.flash('exito', mensaje);
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    req.flash('error', err.message);
  }
  res.redirect(typeof volver === 'function' ? volver() : volver);
}

// Igual que accionPanel pero para la API JSON: si el servicio lanza un
// ErrorNegocio, responde { ok: false, error, ...extra } con su status
// (extra = por ejemplo { campos } para marcar los inputs del formulario).
async function accionJson(res, hacer) {
  try {
    res.json({ ok: true, ...(await hacer()) });
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    res.status(err.status).json({ ok: false, error: err.message, ...(err.extra || {}) });
  }
}

module.exports = { a, quiereJson, volverSeguro, volverA, accionPanel, accionJson };
