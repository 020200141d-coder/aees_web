// ============================================================================
//  src/middleware/auth.js — quién es el usuario y qué puede hacer
//
//  La sesión (cookie firmada con SESSION_SECRET) solo guarda el id del
//  usuario. En cada petición lo buscamos en la BD: así, si el admin cambia el
//  rol o elimina a alguien, el cambio aplica de inmediato.
//
//  Roles:
//   • cliente    → ve el catálogo, arma su evento, reserva y paga.
//   • publicador → entra al panel solo para combos y publicaciones (galería).
//   • admin      → todo: equipos, precios, reservas, pagos, ajustes, usuarios.
// ============================================================================

const db = require('../db');
const { hashClave, verificarClave } = require('../lib/seguridad');

// ── Sesión del personal: más corta y más estricta que la del cliente ─────────
// El cliente queda recordado 7 días (cookie con fecha). El personal NO:
//  • su cookie es "de sesión" (sin fecha): el navegador la borra al cerrarse;
//  • si pasa INACTIVIDAD_MIN sin usar el panel, la sesión se cierra sola;
//  • aunque se use sin parar, a las DURACION_MAX_H horas pide ingresar de nuevo.
// Las marcas de tiempo viajan dentro de la cookie firmada con SESSION_SECRET,
// así que nadie puede alargarlas editando la cookie en su navegador.
const ROLES_PERSONAL = ['admin', 'publicador'];
const INACTIVIDAD_MIN = 60;
const DURACION_MAX_H = 12;
const DIAS_CLIENTE = 180;
const esPersonal = u => Boolean(u && ROLES_PERSONAL.includes(u.rol));

function sesionPersonalVencida(req) {
  const ahora = Date.now();
  const s = req.session;
  if (!s.inicio || !s.visto) return true; // sesiones viejas (antes de este cambio): se piden de nuevo
  return ahora - s.visto > INACTIVIDAD_MIN * 60 * 1000 || ahora - s.inicio > DURACION_MAX_H * 3600 * 1000;
}

async function cargarUsuario(req, res, next) {
  res.locals.usuario = null;
  if (req.session?.uid) {
    try {
      const u = await db.obtener('usuarios', req.session.uid);
      if (!u) {
        req.session.uid = null; // el usuario fue eliminado
      } else if (esPersonal(u) && sesionPersonalVencida(req)) {
        // Se cierra la sesión vencida; requiereStaff lo mandará al ingreso con el aviso.
        req.session = { csrf: req.session.csrf, aviso: 'Tu sesión se cerró por seguridad. Ingresa de nuevo.' };
      } else {
        if (!esPersonal(u)) {
          // Cliente habitual: queda recordado 6 meses en su celular o PC (no tiene que volver a ingresar).
          req.sessionOptions.maxAge = DIAS_CLIENTE * 24 * 3600 * 1000;
        } else {
          req.sessionOptions.maxAge = null; // cookie de sesión: se borra al cerrar el navegador
          // Se renueva la marca como mucho una vez por minuto (cada renovación reescribe la cookie).
          if (Date.now() - req.session.visto > 60 * 1000) req.session.visto = Date.now();
        }
        const { clave_hash, ...publico } = u;
        req.usuario = u;
        res.locals.usuario = publico;
      }
    } catch (err) {
      return next(err);
    }
  }
  next();
}

// Se llama al ingresar con correo y contraseña en /admin/ingresar.
function iniciarSesionPersonal(req, usuario) {
  const csrfActual = req.session.csrf;
  req.session = { uid: usuario.id, csrf: csrfActual, inicio: Date.now(), visto: Date.now() };
  req.sessionOptions.maxAge = null;
}

const quiereJSON = req => req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/') || req.get('accept')?.includes('application/json');

function requiereCliente(req, res, next) {
  if (req.usuario) return next();
  if (quiereJSON(req)) return res.status(401).json({ ok: false, error: 'Ingresa con Google o tu celular para continuar.', login: true });
  res.redirect(`/cuenta/ingresar?volver=${encodeURIComponent(req.originalUrl)}`);
}

// requiereStaff('publicador') deja pasar a publicador y admin; requiereStaff() solo a admin.
function requiereStaff(...roles) {
  return (req, res, next) => {
    const rol = req.usuario?.rol;
    if (rol === 'admin' || (rol && roles.includes(rol))) return next();
    if (!req.usuario || rol === 'cliente') {
      if (quiereJSON(req)) return res.status(401).json({ ok: false, error: 'Tu sesión del panel se cerró. Ingresa de nuevo.' });
      return res.redirect(`/admin/ingresar?volver=${encodeURIComponent(req.originalUrl)}`);
    }
    res.status(403).render('admin/sin-permiso', { titulo: 'Sin permiso' });
  };
}

// ── Contraseña otra vez para acciones delicadas ─────────────────────────────
// Eliminar registros, tocar cuentas del personal o descargar/restaurar el
// respaldo exige escribir la contraseña. Si alguien encuentra el panel abierto
// en una PC ajena, puede mirar, pero no borrar ni crear un admin para él.
// Tras confirmar, hay CONFIRMACION_MIN minutos sin volver a pedirla.
const CONFIRMACION_MIN = 10;
const claveVigente = req => Boolean(req.session?.confirmado && Date.now() - req.session.confirmado < CONFIRMACION_MIN * 60 * 1000);

// La contraseña llega en el campo `_clave` (formularios, puesto por admin.js)
// o en el JSON del fetch. Nunca se guarda: solo se compara con el hash.
function requiereClave(req, res, next) {
  if (!esPersonal(req.usuario)) return next(); // requiereStaff se encarga después
  if (claveVigente(req)) return next();
  const clave = req.body?._clave;
  if (typeof clave === 'string' && clave && verificarClave(clave, req.usuario.clave_hash)) {
    req.session.confirmado = Date.now();
    return next();
  }
  const mensaje = clave ? 'Contraseña incorrecta. No se hizo ningún cambio.' : 'Por seguridad, confirma tu contraseña para esta acción.';
  if (quiereJSON(req) || req.is('application/json')) return res.status(401).json({ ok: false, error: mensaje, pedirClave: true });
  req.session.flash = { tipo: 'error', texto: mensaje };
  // Se vuelve a la página del panel desde donde se envió (nunca a otro sitio).
  let volver = '/admin';
  try {
    const u = new URL(req.get('referer'));
    if (u.host === req.get('host') && u.pathname.startsWith('/admin')) volver = u.pathname + u.search;
  } catch { /* sin referer: al inicio del panel */ }
  res.redirect(303, volver);
}

// Al arrancar: si ADMIN_EMAIL y ADMIN_PASS están en el entorno y ese correo no
// existe, se crea la cuenta de administrador. Así no hay claves en el código.
// Esa cuenta es la "principal" (la del dueño): nadie puede borrarla ni bajarle el rol.
const emailPrincipal = () => process.env.ADMIN_EMAIL?.trim().toLowerCase() || '';
// Cuenta de prueba que crea la semilla de desarrollo: no debe quedar en producción.
const CUENTA_DEMO = 'admin@aees.local';

async function asegurarAdminInicial() {
  const email = emailPrincipal();
  const clave = process.env.ADMIN_PASS;
  if (!email || !clave) {
    console.warn('  ⚠ Define ADMIN_EMAIL y ADMIN_PASS en .env para crear la cuenta de administrador.');
    return;
  }
  const existe = await db.buscarUno('usuarios', { email });
  if (!existe) {
    await db.insertar('usuarios', { rol: 'admin', nombre: 'Administrador', email, clave_hash: hashClave(clave) });
    console.log(`  ✓ Cuenta de administrador creada para ${email}`);
  }
  // En producción se borra la cuenta de prueba, siempre que la principal sea otra.
  if (process.env.NODE_ENV === 'production' && email !== CUENTA_DEMO) {
    const demo = await db.buscarUno('usuarios', { email: CUENTA_DEMO });
    if (demo) { await db.eliminar('usuarios', demo.id); console.log(`  ✓ Cuenta de prueba ${CUENTA_DEMO} eliminada`); }
  }
}

module.exports = {
  DIAS_CLIENTE,
  cargarUsuario, requiereCliente, requiereStaff, requiereClave, claveVigente,
  iniciarSesionPersonal, asegurarAdminInicial, emailPrincipal, esPersonal, CONFIRMACION_MIN
};
