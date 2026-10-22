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
const { hashClave } = require('../lib/seguridad');

async function cargarUsuario(req, res, next) {
  res.locals.usuario = null;
  if (req.session?.uid) {
    try {
      const u = await db.obtener('usuarios', req.session.uid);
      if (u) {
        const { clave_hash, ...publico } = u;
        req.usuario = u;
        res.locals.usuario = publico;
      } else {
        req.session.uid = null; // el usuario fue eliminado
      }
    } catch (err) {
      return next(err);
    }
  }
  next();
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
    if (!req.usuario || rol === 'cliente') return res.redirect(`/admin/ingresar?volver=${encodeURIComponent(req.originalUrl)}`);
    res.status(403).render('admin/sin-permiso', { titulo: 'Sin permiso' });
  };
}

// Al arrancar: si ADMIN_EMAIL y ADMIN_PASS están en el entorno y ese correo no
// existe, se crea la cuenta de administrador. Así no hay claves en el código.
async function asegurarAdminInicial() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
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
}

module.exports = { cargarUsuario, requiereCliente, requiereStaff, asegurarAdminInicial };
