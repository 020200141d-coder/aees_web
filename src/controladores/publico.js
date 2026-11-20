// ============================================================================
//  src/controladores/publico.js — páginas que ve el cliente
//
//  ruta → controlador → servicio (sitio) → db
//  Cada página pide sus datos al servicio y elige la vista EJS.
// ============================================================================

const sitio = require('../servicios/sitio');
const pagos = require('../servicios/pagos');
const { leerReunion } = require('../validadores/reservas');
const { TIPOS_EVENTO, hoyLima } = require('../lib/util');
const { esErrorNegocio } = require('../lib/errores');

// Tipos de foto de la galería (filtros de /eventos).
const TIPOS_PUB = { boda: 'Bodas', fiesta: 'Fiestas', concierto: 'Conciertos', corporativo: 'Corporativo', conferencia: 'Ceremonias', electronica: 'Electrónica' };

async function portada(req, res) {
  res.render('publico/index', { titulo: null, ...(await sitio.portada()), hoy: hoyLima(), TIPOS_EVENTO });
}

async function catalogo(req, res) {
  res.render('publico/catalogo', { titulo: 'Catálogo de equipos', ...(await sitio.catalogoOrdenado()), hoy: hoyLima() });
}

async function combos(req, res) {
  res.render('publico/combos', { titulo: 'Combos y paquetes', ...(await sitio.paginaCombos()) });
}

async function eventos(req, res) {
  res.render('publico/eventos', { titulo: 'Eventos realizados', ...(await sitio.eventos()), TIPOS_PUB });
}

const asistente = (req, res) => res.render('publico/asistente', { titulo: 'Arma tu evento', hoy: hoyLima() });
const miEvento = (req, res) => res.render('publico/mi-evento', { titulo: 'Mi evento', hoy: hoyLima() });

// Estado de la reserva, pago del adelanto, reunión y WhatsApp.
async function reserva(req, res, next) {
  const datos = await sitio.reservaDelCliente(req.params.codigo, req.usuario);
  if (!datos) return next(); // no existe o no es suya → 404
  res.render('publico/reserva', {
    titulo: `Reserva ${datos.reserva.codigo}`, r: datos.reserva, pagos: datos.pagos,
    mpActivo: pagos.mercadoPagoActivo(), simulado: pagos.simuladoActivo(), hoy: hoyLima()
  });
}

// El cliente propone el horario de la reunión de confirmación.
async function reunion(req, res, next) {
  const r = await sitio.reservaPropiaPorCodigo(req.params.codigo, req.usuario);
  if (!r) return next();
  try {
    await sitio.proponerReunion(r, leerReunion(req.body));
    req.flash('exito', 'Horario propuesto. Te confirmamos la reunión o llamada por WhatsApp.');
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    req.flash(err.extra?.tipo || 'error', err.message);
  }
  res.redirect(`/reservas/${r.codigo}`);
}

module.exports = { portada, catalogo, combos, eventos, asistente, miEvento, reserva, reunion };
