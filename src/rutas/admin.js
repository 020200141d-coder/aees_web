// ============================================================================
//  src/rutas/admin.js — panel de administración (/admin)
//
//  Este archivo SOLO declara las URL del panel y qué middleware las protege.
//  Cada URL llama a un controlador (src/controladores/admin/*), que lee la
//  petición, llama al servicio con las reglas (src/servicios/*) y responde.
//
//    petición → ruta (URL + permiso) → controlador → validador → servicio → db
//
//  Páginas EJS clásicas: el formulario hace POST, se valida, se guarda y se
//  redirige (patrón PRG: Post → Redirect → Get, así recargar no reenvía).
//
//  Quién ve qué:
//   publicador → Inicio, Combos, Galería, Reseñas y subir fotos.
//   admin      → todo lo anterior + Equipos, Reservas, Clientes, Mensajes,
//                Promociones, Ajustes, Usuarios y Respaldo.
// ============================================================================

const express = require('express');
const { requiereStaff, requiereClave } = require('../middleware/auth');
const { limitar } = require('../lib/seguridad');
const { a } = require('../controladores/comun');
const panel = require('../controladores/admin/panel');
const equipos = require('../controladores/admin/equipos');
const combos = require('../controladores/admin/combos');
const galeria = require('../controladores/admin/galeria');
const reservas = require('../controladores/admin/reservas');
const clientes = require('../controladores/admin/clientes');
const config = require('../controladores/admin/configuracion');

const router = express.Router();
const soloAdmin = requiereStaff();
const staff = requiereStaff('publicador');

// Variables comunes de todas las vistas del panel (sección, catálogos, contadores).
router.use(panel.variablesComunes);

// ── Ingreso del personal ────────────────────────────────────────────────────
const limiteLogin = limitar({ clave: 'admin-login', max: 8, ventanaMin: 15, mensaje: 'Demasiados intentos. Espera 15 minutos.' });
router.get('/ingresar', panel.formIngreso);
router.post('/ingresar', limiteLogin, a(panel.ingresar));
router.post('/salir', panel.salir);

// Acciones delicadas: piden la contraseña (ver requiereClave en middleware/auth.js).
// Se decide por la ruta para que ninguna nueva ruta de eliminar quede sin protección.
const esDelicada = req => req.method === 'POST' && (req.path.endsWith('/eliminar') || req.path.endsWith('/precio') || req.path.startsWith('/usuarios') || req.path.startsWith('/respaldo'));
router.use((req, res, next) => (esDelicada(req) ? requiereClave(req, res, next) : next()));

// ── Inicio, mensajes y fotos ────────────────────────────────────────────────
router.get('/', staff, a(panel.inicio));
router.post('/fotos', staff, a(panel.subirFoto));
router.get('/mensajes', soloAdmin, a(panel.mensajes));
router.post('/mensajes/:id/leido', soloAdmin, a(panel.alternarLeido));
router.post('/mensajes/:id/eliminar', soloAdmin, a(panel.eliminarMensaje));

// ── Equipos (admin) ─────────────────────────────────────────────────────────
router.get('/equipos', soloAdmin, a(equipos.lista));
router.get('/equipos/nuevo', soloAdmin, a(equipos.nuevo));
router.post('/equipos', soloAdmin, a(equipos.crear));
router.get('/equipos/:id/editar', soloAdmin, a(equipos.editar));
router.post('/equipos/:id', soloAdmin, a(equipos.guardar));
router.post('/equipos/:id/publicado', soloAdmin, a(equipos.alternarPublicado));
router.post('/equipos/:id/estado', soloAdmin, a(equipos.cambiarEstado));
router.post('/equipos/:id/eliminar', soloAdmin, a(equipos.eliminar));

// ── Combos (publicador y admin) ─────────────────────────────────────────────
router.get('/combos', staff, a(combos.lista));
router.get('/combos/nuevo', staff, a(combos.nuevo));
router.post('/combos', staff, a(combos.crear));
router.get('/combos/:id/editar', staff, a(combos.editar));
router.post('/combos/:id', staff, a(combos.guardar));
router.post('/combos/:id/publicado', staff, a(combos.alternarPublicado));
router.post('/combos/:id/eliminar', staff, a(combos.eliminar));

// ── Galería y reseñas (publicador y admin) ──────────────────────────────────
router.get('/galeria', staff, a(galeria.lista));
router.get('/galeria/nueva', staff, galeria.nueva);
router.post('/galeria', staff, a(galeria.crear));
router.get('/galeria/:id/editar', staff, a(galeria.editar));
router.post('/galeria/:id', staff, a(galeria.guardar));
router.post('/galeria/:id/publicado', staff, a(galeria.alternarPublicado));
router.post('/galeria/:id/eliminar', staff, a(galeria.eliminar));
router.get('/resenas', staff, a(galeria.resenasLista));
router.post('/resenas', staff, a(galeria.resenaCrear));
router.post('/resenas/:id', staff, a(galeria.resenaGuardar));
router.post('/resenas/:id/publicado', staff, a(galeria.resenaAlternarPublicado));
router.post('/resenas/:id/eliminar', staff, a(galeria.resenaEliminar));

// ── Reservas y pagos (admin) ────────────────────────────────────────────────
router.get('/reservas', soloAdmin, a(reservas.lista));
router.get('/reservas/nueva', soloAdmin, a(reservas.nueva));
router.post('/reservas/cotizar', soloAdmin, a(reservas.cotizar));
router.post('/reservas/nueva', soloAdmin, a(reservas.crear));
router.get('/reservas/:codigo', soloAdmin, a(reservas.ficha));
router.post('/reservas/:codigo/estado', soloAdmin, a(reservas.cambiarEstado));
router.post('/reservas/:codigo/editar', soloAdmin, a(reservas.editar));
router.post('/reservas/:codigo/eliminar', soloAdmin, a(reservas.eliminar));
router.post('/reservas/:codigo/reunion', soloAdmin, a(reservas.reunion));
router.post('/reservas/:codigo/notas', soloAdmin, a(reservas.notas));
router.post('/reservas/:codigo/precio', soloAdmin, a(reservas.precio));
router.post('/reservas/:codigo/pago-manual', soloAdmin, a(reservas.pagoManual));
router.get('/pagos/:id/comprobante', soloAdmin, a(reservas.comprobante));
router.post('/pagos/:id/:accion', soloAdmin, a(reservas.resolverPago));

// ── Clientes (admin) ────────────────────────────────────────────────────────
router.get('/clientes', soloAdmin, a(clientes.lista));
router.post('/clientes', soloAdmin, a(clientes.crear));
router.get('/clientes/:id', soloAdmin, a(clientes.ficha));
router.post('/clientes/:id', soloAdmin, a(clientes.guardar));
router.post('/clientes/:id/eliminar', soloAdmin, a(clientes.eliminar));

// ── Promociones, ajustes, usuarios y respaldo (admin) ───────────────────────
router.get('/promociones', soloAdmin, a(config.promosLista));
router.get('/promociones/:id/editar', soloAdmin, a(config.promoEditar));
router.post('/promociones', soloAdmin, a(config.promoGuardar));
router.post('/promociones/:id/eliminar', soloAdmin, a(config.promoEliminar));

router.get('/ajustes', soloAdmin, a(config.ajustesForm));
router.post('/ajustes/negocio', soloAdmin, a(config.ajustesNegocio));
router.post('/ajustes/reglas', soloAdmin, a(config.ajustesReglas));
router.post('/ajustes/vehiculos', soloAdmin, a(config.ajustesVehiculos));
router.post('/ajustes/portada', soloAdmin, a(config.ajustesPortada));

router.get('/usuarios', soloAdmin, a(config.usuariosLista));
router.post('/usuarios', soloAdmin, a(config.usuarioCrear));
router.post('/usuarios/:id', soloAdmin, a(config.usuarioGuardar));
router.post('/usuarios/:id/eliminar', soloAdmin, a(config.usuarioEliminar));

router.get('/respaldo', soloAdmin, a(config.respaldoPagina));
router.post('/respaldo/automatico', soloAdmin, a(config.respaldoAutomatico));
router.post('/respaldo/ahora', soloAdmin, a(config.respaldoAhora));
router.post('/respaldo/descargar', soloAdmin, a(config.respaldoDescargar));
router.post('/respaldo/restaurar', soloAdmin, a(config.respaldoRestaurar));

module.exports = router;
