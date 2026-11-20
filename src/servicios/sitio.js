// ============================================================================
//  src/servicios/sitio.js — datos de las páginas públicas
//
//  Arma lo que muestran la portada, el catálogo, los combos y los eventos, y
//  las reglas de la página de una reserva vista por el cliente:
//   • solo el dueño de la reserva (o el personal) puede verla          → null (404)
//   • el cliente propone la reunión entre hoy y el día del evento       → 422
//   • si AeeS ya la agendó, el cliente no la cambia desde la web        → 409
// ============================================================================

const db = require('../db');
const catalogo = require('./catalogo');
const precios = require('./precios');
const resenas = require('./resenas');
const { ErrorNegocio } = require('../lib/errores');
const { hoyLima } = require('../lib/util');

// Combos ordenados (destacados primero) con su "precio suelto": lo que costarían
// los mismos equipos por separado, para mostrar el ahorro con precio tachado.
// El "Más elegido" es el destacado del medio (o el único destacado).
function prepararCombos(combos, mapa) {
  const lista = [...combos].sort((a, b) => (b.destacado - a.destacado) || (a.orden || 0) - (b.orden || 0)).map(c => {
    const conDmx = (c.items || []).some(it => mapa[it.equipo_id]?.rol === 'dmx');
    const suelto = (c.items || []).reduce((s, it) => s + (mapa[it.equipo_id] ? precios.precioUnitario(mapa[it.equipo_id], it.cantidad, conDmx) * it.cantidad : 0), 0);
    return { ...c, precio_suelto: Math.round(suelto) };
  });
  const destacados = lista.filter(c => c.destacado);
  return { lista, destacados, elegidoId: (destacados[1] || destacados[0])?.id || null };
}

// Promociones activas y vigentes (se muestran arriba en la portada).
async function promosVigentes() {
  const hoy = hoyLima();
  return (await db.listar('promociones', { filtro: { activo: true } })).filter(p => !p.vence || p.vence >= hoy).slice(0, 3);
}

const publicacionesVisibles = () => db.listar('publicaciones', { filtro: { publicado: true }, orden: 'orden' });

// Portada: un RESUMEN. Cada sección lleva a su página completa.
async function portada() {
  const [equipos, combos, publicaciones, reglas, promos, listaResenas] = await Promise.all([
    catalogo.equipos(), catalogo.combos(), publicacionesVisibles(), precios.reglas(), promosVigentes(), resenas.publicadas()
  ]);
  const mapa = catalogo.mapaPorId(equipos);
  // Destacados del catálogo: los que el admin marcó (por orden), hasta 3; si faltan, se completan.
  const marcados = equipos.filter(e => e.destacado).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const destacados = [...marcados, ...equipos.filter(e => !e.destacado)].slice(0, 3);
  const { destacados: paquetes, lista: todosCombos, elegidoId } = prepararCombos(combos, mapa);
  return {
    equipos: destacados, total_equipos: equipos.length, publicaciones, reglas, promos, resenas: listaResenas.slice(0, 6),
    paquetes: (paquetes.length ? paquetes : todosCombos).slice(0, 3), elegidoId, total_combos: combos.length, mapa
  };
}

async function catalogoOrdenado() {
  const [equipos, reglas] = await Promise.all([catalogo.equipos(), precios.reglas()]);
  return { equipos: [...equipos].sort((a, b) => (b.destacado - a.destacado) || (a.orden || 0) - (b.orden || 0)), reglas };
}

async function paginaCombos() {
  const [equipos, combos, reglas] = await Promise.all([catalogo.equipos({ soloPublicados: false }), catalogo.combos(), precios.reglas()]);
  const mapa = catalogo.mapaPorId(equipos);
  const { lista, elegidoId } = prepararCombos(combos, mapa);
  return { combos: lista, elegidoId, mapa, reglas };
}

async function eventos() {
  const [publicaciones, listaResenas] = await Promise.all([publicacionesVisibles(), resenas.publicadas()]);
  return { publicaciones, resenas: listaResenas };
}

// ── Reserva vista por el cliente ───────────────────────────────────────────
const puedeVer = (r, usuario) => r.usuario_id === usuario.id || ['admin', 'publicador'].includes(usuario.rol);

// Devuelve la reserva al día (o null si no existe o no es suya).
async function reservaDelCliente(codigo, usuario) {
  const r = await db.buscarUno('reservas', { codigo });
  if (!r || !puedeVer(r, usuario)) return null;
  // Si estaba pendiente y venció, catalogo.disponibilidad la marca como expirada.
  if (r.estado === 'pendiente_pago') await catalogo.disponibilidad(r.fecha_evento);
  const [actual, pagos] = await Promise.all([
    db.obtener('reservas', r.id),
    db.listar('pagos', { filtro: { reserva_id: r.id }, orden: 'creado_en' })
  ]);
  return { reserva: actual, pagos };
}

// Solo el dueño propone el horario; si AeeS ya agendó la reunión, no se cambia aquí.
async function proponerReunion(r, { datos, valida }) {
  if (r.reunion?.agendada_por === 'admin') {
    throw new ErrorNegocio('AeeS ya agendó tu reunión. Si necesitas cambiarla, escríbenos por WhatsApp.', 409, { extra: { tipo: 'aviso' } });
  }
  if (!valida || datos.fecha < hoyLima() || datos.fecha > r.fecha_evento) {
    throw new ErrorNegocio('Elige una fecha entre hoy y el día del evento, una hora y la modalidad.', 422);
  }
  const { fecha, hora, modalidad } = datos;
  await db.actualizar('reservas', r.id, { reunion: { fecha, hora, modalidad, solicitada_en: new Date().toISOString() } });
}

const reservaPropiaPorCodigo = async (codigo, usuario) => {
  const r = await db.buscarUno('reservas', { codigo });
  return r && r.usuario_id === usuario.id ? r : null;
};

module.exports = { prepararCombos, promosVigentes, portada, catalogoOrdenado, paginaCombos, eventos, reservaDelCliente, proponerReunion, reservaPropiaPorCodigo };
