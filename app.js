// ============================================================================
//  app.js — arma la aplicación Express (sin encenderla)
//
//  Separado de server.js para poder usar la misma app en:
//   • Render / tu PC:  server.js hace app.listen(PORT)
//   • Vercel:          api/index.js exporta la app como función serverless
//
//  Orden de los middlewares (importa):
//   1. Cabeceras de seguridad
//   2. Archivos estáticos (/css, /js, /img) — no necesitan sesión
//   3. Lectura del cuerpo (formularios y JSON)
//   4. Sesión en cookie firmada → CSRF → usuario actual → datos del negocio
//   5. Rutas: públicas, cuenta, API, pagos, admin
//   6. 404 y manejador de errores
// ============================================================================

const path = require('node:path');
const fs = require('node:fs');

// .env se carga antes que todo para que los servicios vean las claves.
const RUTA_ENV = path.join(__dirname, '.env');
if (fs.existsSync(RUTA_ENV)) process.loadEnvFile(RUTA_ENV);

const express = require('express');
const cookieSession = require('cookie-session');
const { csrf } = require('./src/lib/seguridad');
const { cargarUsuario } = require('./src/middleware/auth');
const negocio = require('./src/servicios/negocio');
const util = require('./src/lib/util');

const ES_PROD = process.env.NODE_ENV === 'production';
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
// Render y Vercel están detrás de un proxy: así req.ip y req.protocol son los reales.
app.set('trust proxy', 1);

// ── 1. Seguridad ─────────────────────────────────────────────────────────────
// CSP: lista blanca de orígenes. Solo se permiten los CDN que usamos (fuentes,
// íconos, alertas, GSAP, Leaflet), el login de Google y las teselas del mapa.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://accounts.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://accounts.google.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://accounts.google.com",
    "frame-src https://accounts.google.com",
    "form-action 'self' https://www.mercadopago.com.pe https://sandbox.mercadopago.com.pe"
  ].join('; '));
  next();
});

// Ruta de salud para Render (healthCheckPath): siempre responde 200 para que el
// servidor se publique aunque Supabase falle, e informa si la base contesta.
// Solo muestra el mensaje de error, nunca las claves.
app.get('/salud', async (req, res) => {
  const db = require('./src/db');
  let base = 'ok';
  try { await db.ajuste('negocio'); } catch (err) { base = err.message; }
  res.json({ ok: true, motor: db.motor, base });
});

// ── 2. Estáticos ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), { maxAge: ES_PROD ? '7d' : 0 }));

// ── 3. Cuerpo de la petición ─────────────────────────────────────────────────
// Límite chico para todo, excepto subir fotos y restaurar respaldos (que pesan más).
const RUTAS_PESADAS = ['/admin/fotos', '/admin/respaldo/restaurar'];
const jsonNormal = express.json({ limit: '200kb' });
const jsonGrande = express.json({ limit: '12mb' });
app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use((req, res, next) => (RUTAS_PESADAS.includes(req.path) ? jsonGrande : jsonNormal)(req, res, next));

// ── 4. Sesión, CSRF, usuario y datos comunes ─────────────────────────────────
// cookie-session guarda la sesión cifrada/firmada en la propia cookie: no
// necesita memoria del servidor, así sobrevive a reinicios de Render y
// funciona en Vercel (donde no hay un proceso fijo).
app.use(cookieSession({
  name: 'aees',
  keys: [process.env.SESSION_SECRET || 'solo-para-desarrollo-cambia-SESSION_SECRET'],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax', // lax: permite volver desde Mercado Pago con la sesión iniciada
  secure: ES_PROD
}));
if (ES_PROD && !process.env.SESSION_SECRET) console.error('  ✗ Falta SESSION_SECRET en producción.');

app.use(csrf);
app.use(cargarUsuario);

app.use(async (req, res, next) => {
  try {
    const { negocio: n, portada } = await negocio.obtener();
    Object.assign(res.locals, {
      negocio: n,
      portada,
      util,
      rutaActual: req.path,
      anio: new Date().getFullYear(),
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      // Mensaje de una sola vez (después de guardar, de un error, etc.)
      flash: req.session.flash || null
    });
    req.session.flash = null;
    req.flash = (tipo, texto) => { req.session.flash = { tipo, texto }; };
    next();
  } catch (err) {
    next(err);
  }
});

// ── 5. Rutas ─────────────────────────────────────────────────────────────────
app.use('/', require('./src/rutas/publico'));
app.use('/cuenta', require('./src/rutas/cuenta'));
app.use('/api', require('./src/rutas/api'));
app.use('/pagos', require('./src/rutas/pagos'));
app.use('/admin', require('./src/rutas/admin'));

// ── 6. 404 y errores ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { titulo: 'Página no encontrada' });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  // A los errores "públicos" (validaciones) les mostramos el mensaje; a los internos, uno genérico.
  const mensaje = err.publico || status < 500 ? err.message : 'Algo salió mal en el servidor. Intenta de nuevo en un momento.';
  if (req.originalUrl.startsWith('/api/') || req.get('accept')?.includes('application/json')) {
    return res.status(status).json({ ok: false, error: mensaje, ...(err.faltan ? { faltan: err.faltan } : {}) });
  }
  res.status(status).render('error', { titulo: 'Error', status, mensaje });
});

module.exports = app;
