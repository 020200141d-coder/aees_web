// ============================================================================
//  src/controladores/api.js — API JSON que usa el navegador (fetch)
//
//  ruta → controlador → validador (api) → servicio (asistente / contacto) → db
//  Todas las respuestas son { ok: true, ... } o { ok: false, error }.
//  accionJson convierte los ErrorNegocio de los servicios en { ok: false }.
// ============================================================================

const asistente = require('../servicios/asistente');
const contacto = require('../servicios/contacto');
const { leerEncuesta, leerEncuestaRapida, leerDatosCliente, leerContacto, fechaValida, coordenadas, limpiarTelefono } = require('../validadores/api');
const { texto } = require('../lib/util');
const { accionJson } = require('./comun');

async function equipos(req, res) {
  const fecha = fechaValida(req.query.fecha);
  res.json({ ok: true, fecha, equipos: await asistente.equiposConLibres(fecha) });
}

const interpretar = (req, res) => accionJson(res, async () => ({ datos: await asistente.interpretar(texto(req.body?.texto, 1500)) }));

async function recomendar(req, res) {
  res.json({ ok: true, ...(await asistente.recomendarEvento(leerEncuesta(req.body || {}))) });
}

async function cotizacionRapida(req, res) {
  res.json({ ok: true, ...(await asistente.cotizacionRapida(leerEncuestaRapida(req.body || {}))) });
}

async function geocodificar(req, res) {
  res.json({ ok: true, lugares: await asistente.geocodificar(req.query.q) });
}

const ruta = (req, res) => accionJson(res, () => asistente.rutaDesdeAlmacen(coordenadas(req.body)));

async function clima(req, res) {
  res.json({ ok: true, clima: await asistente.pronostico(coordenadas(req.query), fechaValida(req.query.fecha)) });
}

async function cotizar(req, res) {
  res.json({ ok: true, ...(await asistente.cotizarCarrito(req.body?.carrito, { usuarioId: req.usuario?.id, promoCodigo: texto(req.body?.promo, 30) })) });
}

const reservar = (req, res) => accionJson(res, () => contacto.reservar({
  usuario: req.usuario, carrito: req.body?.carrito, cliente: leerDatosCliente(req.body?.cliente || {}), promoCodigo: texto(req.body?.promo, 30)
}));

function contactar(req, res) {
  if (req.body?.web) return res.json({ ok: true }); // honeypot: era un bot
  return accionJson(res, async () => { await contacto.guardarContacto(leerContacto(req.body || {})); });
}

const solicitar = (req, res) => {
  const b = req.body || {};
  return accionJson(res, async () => {
    await contacto.solicitarReunion({
      nombre: texto(b.nombre || req.usuario?.nombre, 80),
      telefono: limpiarTelefono(b.telefono || req.usuario?.celular),
      mensaje: b.mensaje, carrito: b.carrito, usuario: req.usuario
    });
  });
};

module.exports = { equipos, interpretar, recomendar, cotizacionRapida, geocodificar, ruta, clima, cotizar, reservar, contactar, solicitar };
