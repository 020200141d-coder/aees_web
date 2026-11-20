// ============================================================================
//  src/controladores/admin/reservas.js — Reservas y pagos en el panel (/admin/reservas)
//
//  ruta → controlador → validador (reservas) → servicio (reservas-admin) → db
//  Las reglas (confirmar solo con reunión, no editar reservas cerradas, precio
//  no menor a lo pagado…) están en servicios/reservas-admin.js. Aquí solo se
//  decide la respuesta: página, flash + redirect o JSON para el formulario
//  de "Nueva reserva" que trabaja con fetch.
// ============================================================================

const catalogo = require('../../servicios/catalogo');
const precios = require('../../servicios/precios');
const reservas = require('../../servicios/reservas');
const reservasAdmin = require('../../servicios/reservas-admin');
const usuarios = require('../../servicios/clientes');
const { leerEdicion, leerReunion, leerAjustePrecio, FECHA } = require('../../validadores/reservas');
const { ESTADOS_RESERVA, texto, numero, hoyLima, soles } = require('../../lib/util');
const { esErrorNegocio } = require('../../lib/errores');
const { volverSeguro, accionPanel } = require('../comun');

const fichaDe = r => `/admin/reservas/${r.codigo}`;

// Carga la reserva del :codigo; si no existe, next() → página 404.
async function conReserva(req, next) {
  const r = await reservasAdmin.porCodigo(req.params.codigo);
  if (!r) next();
  return r;
}

async function lista(req, res) {
  const estado = ESTADOS_RESERVA[req.query.estado] ? req.query.estado : '';
  const q = texto(req.query.q, 60).toLowerCase();
  res.render('admin/reservas', { titulo: 'Reservas', reservas: await reservasAdmin.listar({ estado, q }), estado, q });
}

// Formulario de nueva reserva (por ejemplo, tocando un día del calendario).
async function nueva(req, res) {
  const [clientes, equipos, combos, reglas] = await Promise.all([
    usuarios.listarClientes({ orden: 'nombre' }),
    catalogo.equipos({ soloPublicados: true }),
    catalogo.combos(),
    precios.reglas()
  ]);
  const fecha = FECHA.test(req.query.fecha || '') && req.query.fecha >= hoyLima() ? req.query.fecha : '';
  res.render('admin/reserva-nueva', { titulo: 'Nueva reserva', clientes, equipos, combos, reglas, fecha, clienteId: String(req.query.cliente || ''), hoy: hoyLima() });
}

// Vista previa del precio para el formulario (con los descuentos de ESE cliente).
async function cotizar(req, res) {
  const p = await reservas.preparar(req.body?.carrito, { usuarioId: texto(req.body?.cliente_id, 60) || null, promoCodigo: texto(req.body?.promo, 30) });
  res.json({ ok: true, cotizacion: p.cotizacion, faltan: p.faltan, combo: p.combo ? { adicionales: p.combo.adicionales || [] } : null });
}

async function crear(req, res) {
  const b = req.body || {};
  try {
    const reserva = await reservasAdmin.crearDesdePanel({
      clienteId: texto(b.cliente_id, 60), carrito: b.carrito, promo: texto(b.promo, 30),
      permitirFaltantes: b.permitir_faltantes === true, pagoMonto: numero(b.pago_monto, 0),
      pagoReferencia: texto(b.pago_referencia, 40), adminEmail: req.usuario.email
    });
    res.json({ ok: true, codigo: reserva.codigo, url: fichaDe(reserva) });
  } catch (err) {
    // El formulario trabaja con fetch: el error de negocio vuelve como JSON.
    if (!esErrorNegocio(err)) throw err;
    res.status(err.status).json({ ok: false, error: err.message });
  }
}

async function ficha(req, res, next) {
  const r = await conReserva(req, next);
  if (!r) return;
  const { pagos, cliente, combo } = await reservasAdmin.detalle(r);
  res.render('admin/reserva', { titulo: `Reserva ${r.codigo}`, r, pagos, cliente, combo });
}

// Cambiar estado (también lo usan los botones rápidos de la agenda).
async function cambiarEstado(req, res, next) {
  const r = await reservasAdmin.porCodigo(req.params.codigo);
  if (!r || !ESTADOS_RESERVA[req.body.estado]) return next();
  try {
    await reservasAdmin.cambiarEstado(r, req.body.estado);
  } catch (err) {
    if (!esErrorNegocio(err)) throw err;
    req.flash('error', err.message);
    return res.redirect(fichaDe(r));
  }
  req.flash('exito', `Reserva ${r.codigo}: ${ESTADOS_RESERVA[req.body.estado]}.`);
  res.redirect(req.body.volver ? volverSeguro(req.body.volver) : fichaDe(r));
}

async function editar(req, res, next) {
  const r = await conReserva(req, next);
  if (!r) return;
  await accionPanel(req, res, {
    hacer: () => reservasAdmin.editarEvento(r, leerEdicion(req.body, r), { permitirFaltantes: req.body.permitir_faltantes === 'on' }),
    exito: ({ cambiaronHoras }) => `Reserva ${r.codigo} actualizada.${cambiaronHoras ? ' Si cambian las horas, revisa el precio.' : ''}`,
    volver: fichaDe(r)
  });
}

// Eliminar una reserva con sus pagos (ruta delicada: pide contraseña).
async function eliminar(req, res, next) {
  const r = await conReserva(req, next);
  if (!r) return;
  await reservasAdmin.eliminar(r);
  req.flash('exito', `Reserva ${r.codigo} eliminada.`);
  res.redirect('/admin/reservas');
}

async function reunion(req, res, next) {
  const r = await conReserva(req, next);
  if (!r) return;
  await accionPanel(req, res, {
    hacer: () => reservasAdmin.agendarReunion(r, leerReunion(req.body), req.usuario.email),
    exito: 'Reunión agendada. Avísale al cliente por WhatsApp.',
    volver: fichaDe(r)
  });
}

async function notas(req, res, next) {
  const r = await conReserva(req, next);
  if (!r) return;
  await reservasAdmin.guardarNotas(r, req.body.notas_admin);
  req.flash('exito', 'Notas guardadas.');
  res.redirect(fichaDe(r));
}

// Ajuste manual del precio (pide contraseña y motivo; queda en el historial).
async function precio(req, res, next) {
  const r = await conReserva(req, next);
  if (!r) return;
  const ajuste = leerAjustePrecio(req.body);
  await accionPanel(req, res, {
    hacer: () => reservasAdmin.ajustarPrecio(r, ajuste, req.usuario.email),
    exito: `Total de ${r.codigo}: ${soles(r.total)} → ${soles(ajuste.nuevo)}.`,
    volver: fichaDe(r)
  });
}

// Pago en efectivo / transferencia que el admin registra a mano.
async function pagoManual(req, res, next) {
  const r = await conReserva(req, next);
  if (!r) return;
  await accionPanel(req, res, {
    hacer: () => reservasAdmin.pagoManual(r, { monto: numero(req.body.monto, NaN), referencia: req.body.referencia }, req.usuario.email),
    exito: 'Pago registrado.',
    volver: fichaDe(r)
  });
}

// Foto del comprobante Yape/Plin (privada, no se guarda en caché).
async function comprobante(req, res, next) {
  const c = await reservasAdmin.comprobante(req.params.id);
  if (!c) return next();
  res.setHeader('Content-Type', c.tipo);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(c.archivo);
}

// Aprobar o rechazar un Yape informado por el cliente.
async function resolverPago(req, res, next) {
  const r = await reservasAdmin.resolverPago(req.params.id, req.params.accion);
  if (!r) return next();
  req.flash('exito', req.params.accion === 'aprobar' ? `Pago aprobado. Reserva ${r.codigo}: ${ESTADOS_RESERVA[r.estado]}.` : 'Pago rechazado.');
  res.redirect(req.body.volver ? volverSeguro(req.body.volver) : fichaDe(r));
}

module.exports = { lista, nueva, cotizar, crear, ficha, cambiarEstado, editar, eliminar, reunion, notas, precio, pagoManual, comprobante, resolverPago };
