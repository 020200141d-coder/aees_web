// ============================================================================
//  src/servicios/reservas-admin.js — reglas de las reservas que gestiona el panel
//
//  servicios/reservas.js crea reservas y calcula pagos (lo comparten la web y
//  el panel). Este archivo reúne lo que SOLO hace el administrador y que antes
//  vivía dentro de src/rutas/admin.js:
//
//   • confirmar exige la reunión o llamada agendada por AeeS          → 409
//   • una reserva completada / cancelada / expirada no se edita       → 409
//   • una nueva fecha no puede estar en el pasado                     → 422
//   • al cambiar de fecha deben alcanzar los equipos (o usar aliado)  → 409
//   • el precio ajustado no baja de lo ya pagado y exige un motivo    → 422
//     y cada ajuste queda en el historial (quién, cuándo, de/a cuánto)
//   • un pago manual debe ser mayor que 0                             → 422
//
//  Cada regla rota lanza ErrorNegocio; el controlador decide cómo mostrarla.
// ============================================================================

const db = require('../db');
const catalogo = require('./catalogo');
const reservas = require('./reservas');
const { ErrorNegocio } = require('../lib/errores');
const { ESTADOS_RESERVA, texto, hoyLima, soles } = require('../lib/util');

const ESTADOS_CERRADOS = ['completada', 'cancelada', 'expirada'];

// ── Consultas ──────────────────────────────────────────────────────────────
async function listar({ estado = '', q = '' } = {}) {
  let lista = await db.listar('reservas', { orden: 'fecha_evento', desc: true });
  if (estado) lista = lista.filter(r => r.estado === estado);
  if (q) lista = lista.filter(r => `${r.codigo} ${r.datos_cliente?.nombre} ${r.datos_cliente?.celular} ${r.lugar}`.toLowerCase().includes(q));
  return lista;
}

const porCodigo = codigo => db.buscarUno('reservas', { codigo });

// Todo lo que muestra la ficha de una reserva.
async function detalle(r) {
  const [pagos, cliente, combo] = await Promise.all([
    db.listar('pagos', { filtro: { reserva_id: r.id }, orden: 'creado_en' }),
    r.usuario_id ? db.obtener('usuarios', r.usuario_id) : null,
    r.combo_id ? db.obtener('combos', r.combo_id) : null
  ]);
  return { pagos, cliente, combo };
}

// ── Crear desde el panel ───────────────────────────────────────────────────
// Usa el MISMO servicio que la web (reservas.crear): mismos precios, stock,
// transporte y descuentos. Diferencias: el admin elige al cliente, puede
// registrar un adelanto ya pagado y reservar aunque falte un equipo.
async function crearDesdePanel({ clienteId, carrito, promo, permitirFaltantes, pagoMonto, pagoReferencia, adminEmail }) {
  const cliente = await db.obtener('usuarios', clienteId);
  if (!cliente || cliente.rol !== 'cliente') throw new ErrorNegocio('Elige el cliente (o regístralo primero).', 400);
  const datosCliente = { nombre: cliente.nombre, dni: cliente.dni || '', celular: cliente.celular || '', correo: cliente.email || '' };
  const reserva = await reservas.crear({
    usuario: cliente, carrito, datosCliente, promoCodigo: promo,
    opciones: { permitirFaltantes, creadoPor: adminEmail }
  });
  if (pagoMonto > 0) {
    await reservas.registrarPago(reserva, { metodo: 'yape', monto: pagoMonto, referencia: pagoReferencia || `PANEL-${Date.now()}`, estado: 'aprobado', detalle: { registrado_por: adminEmail, nota: 'registrado al crear la reserva en el panel' } });
  }
  return reserva;
}

// ── Estado ─────────────────────────────────────────────────────────────────
async function cambiarEstado(r, estado) {
  if (!ESTADOS_RESERVA[estado]) throw new ErrorNegocio('Estado desconocido.', 404);
  // Regla del negocio: el evento se confirma en la reunión o llamada que agenda AeeS.
  if (estado === 'confirmada' && r.reunion?.agendada_por !== 'admin') {
    throw new ErrorNegocio('Primero agenda la reunión o llamada de confirmación con el cliente (sección "Reunión o llamada").', 409);
  }
  const cambios = { estado };
  if (estado !== 'pendiente_pago') cambios.expira_en = null; // ya no vence
  await db.actualizar('reservas', r.id, cambios);
}

// ── Editar datos del evento ────────────────────────────────────────────────
// Si cambia la fecha se revisa que los mismos equipos estén libres ese día
// (sin contar esta reserva). El precio NO cambia solo: quedó congelado.
async function editarEvento(r, cambios, { permitirFaltantes = false } = {}) {
  if (ESTADOS_CERRADOS.includes(r.estado)) throw new ErrorNegocio('Esta reserva ya no se puede editar.', 409);
  if (cambios.fecha_evento !== r.fecha_evento) {
    if (cambios.fecha_evento < hoyLima()) throw new ErrorNegocio('La nueva fecha ya pasó.', 422);
    const equipos = await catalogo.equipos({ soloPublicados: false });
    const libres = await catalogo.disponibilidad(cambios.fecha_evento, { excluirReservaId: r.id });
    const faltan = catalogo.faltantes((r.items || []).map(({ equipo_id, cantidad }) => ({ equipo_id, cantidad })), libres, catalogo.mapaPorId(equipos));
    if (faltan.length && !permitirFaltantes) {
      throw new ErrorNegocio(`El ${cambios.fecha_evento} no alcanzan: ${faltan.map(f => `${f.nombre} (hay ${f.libre} de ${f.pedido})`).join(', ')}. Marca "reservar igual con proveedor aliado" si lo vas a cubrir.`, 409);
    }
  }
  await db.actualizar('reservas', r.id, cambios);
  return { cambiaronHoras: cambios.horas !== r.horas };
}

// Elimina la reserva y sus pagos (para errores o pruebas; lo normal es cancelarla).
async function eliminar(r) {
  for (const p of await db.listar('pagos', { filtro: { reserva_id: r.id } })) await db.eliminar('pagos', p.id);
  await db.eliminar('reservas', r.id);
}

// ── Reunión y notas ────────────────────────────────────────────────────────
async function agendarReunion(r, { datos, valida }, adminEmail) {
  if (!valida || datos.fecha > r.fecha_evento) throw new ErrorNegocio('Elige una fecha (hasta el día del evento), la hora y la modalidad.', 422);
  await db.actualizar('reservas', r.id, { reunion: { ...(r.reunion || {}), ...datos, agendada_por: 'admin', agendada_por_email: adminEmail, agendada_en: new Date().toISOString() } });
}

const guardarNotas = (r, notas) => db.actualizar('reservas', r.id, { notas_admin: String(notas || '').slice(0, 3000) });

// ── Ajuste manual del precio ───────────────────────────────────────────────
// El precio queda congelado al crear la reserva: cambiar tarifas en Ajustes no
// lo modifica. Solo este ajuste puede cambiarlo, con protecciones y historial.
function errorAjustePrecio(r, { nuevo, motivo }) {
  const pagado = Number(r.pagado || 0);
  if (ESTADOS_CERRADOS.includes(r.estado)) return `La reserva está "${ESTADOS_RESERVA[r.estado]}": su precio ya no se puede cambiar.`;
  if (!(nuevo >= 0)) return 'Escribe el nuevo total.';
  if (nuevo < pagado) return `El total no puede ser menor a lo que el cliente ya pagó (${soles(pagado)}).`;
  if (motivo.length < 5) return 'Escribe el motivo del cambio (queda en el historial).';
  if (nuevo === Number(r.total)) return 'El total es el mismo.';
  return null;
}

async function ajustarPrecio(r, { nuevo, motivo }, adminEmail) {
  const error = errorAjustePrecio(r, { nuevo, motivo });
  if (error) throw new ErrorNegocio(error, 422);
  const pagado = Number(r.pagado || 0);
  const adelanto = Math.round(nuevo * Number(r.adelanto_pct) / 100 * 100) / 100;
  const historial = [...(r.encuesta?.historial_precios || []), {
    fecha: new Date().toISOString(), por: adminEmail, de: Number(r.total), a: nuevo,
    adelanto_de: Number(r.adelanto), adelanto_a: adelanto, motivo, estado: r.estado, pagado
  }];
  await db.actualizar('reservas', r.id, { total: nuevo, adelanto, encuesta: { ...(r.encuesta || {}), historial_precios: historial } });
  // Si con el nuevo adelanto lo pagado ya alcanza, la reserva pasa sola a "adelanto pagado".
  await reservas.recalcular(r.id);
}

// ── Pagos ──────────────────────────────────────────────────────────────────
async function pagoManual(r, { monto, referencia }, adminEmail) {
  if (!(monto > 0)) throw new ErrorNegocio('El monto debe ser mayor que 0.', 422);
  await reservas.registrarPago(r, { metodo: 'yape', monto, referencia: texto(referencia, 40) || `MANUAL-${Date.now()}`, estado: 'aprobado', detalle: { registrado_por: adminEmail, nota: 'registro manual' } });
}

// Foto del comprobante Yape/Plin (archivo privado). null si no hay.
async function comprobante(pagoId) {
  const p = await db.obtener('pagos', pagoId);
  const archivo = p?.detalle?.comprobante && await db.leerPrivado(p.detalle.comprobante);
  return archivo ? { archivo, tipo: p.detalle.tipo_foto || 'image/webp' } : null;
}

// Aprobar o rechazar un Yape informado por el cliente. Devuelve la reserva recalculada.
async function resolverPago(pagoId, accion) {
  const p = await db.obtener('pagos', pagoId);
  if (!p || !['aprobar', 'rechazar'].includes(accion)) return null;
  await db.actualizar('pagos', p.id, { estado: accion === 'aprobar' ? 'aprobado' : 'rechazado' });
  return reservas.recalcular(p.reserva_id);
}

module.exports = {
  ESTADOS_CERRADOS, listar, porCodigo, detalle, crearDesdePanel, cambiarEstado, editarEvento, eliminar,
  agendarReunion, guardarNotas, errorAjustePrecio, ajustarPrecio, pagoManual, comprobante, resolverPago
};
