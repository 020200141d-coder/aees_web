// ============================================================================
//  src/servicios/catalogo.js — equipos, combos y disponibilidad por fecha
//
//  ¿Cómo sabemos si un equipo está libre un día?
//    libre = cantidad_total − (unidades ocupadas por reservas de ese día)
//
//  Una reserva "ocupa" equipos si está:
//   • adelanto_pagado o confirmada, o
//   • pendiente_pago y todavía dentro de su plazo de bloqueo (expira_en).
//     Así el cliente tiene unas horas para pagar el adelanto sin que otro le
//     gane la fecha; si no paga, la reserva expira sola y libera los equipos.
//  Un equipo en mantenimiento o de baja cuenta como 0 disponibles.
// ============================================================================

const db = require('../db');

const ESTADOS_QUE_OCUPAN = ['adelanto_pagado', 'confirmada'];

async function equipos({ soloPublicados = true } = {}) {
  const lista = await db.listar('equipos', { orden: 'orden' });
  return soloPublicados ? lista.filter(e => e.publicado && e.estado !== 'baja') : lista;
}

async function combos({ soloPublicados = true } = {}) {
  const lista = await db.listar('combos', { orden: 'orden' });
  return soloPublicados ? lista.filter(c => c.publicado) : lista;
}

const mapaPorId = lista => Object.fromEntries(lista.map(e => [e.id, e]));

// ¿Esta reserva sigue reteniendo equipos? (y si su plazo venció, la marca como expirada)
async function ocupa(reserva) {
  if (ESTADOS_QUE_OCUPAN.includes(reserva.estado)) return true;
  if (reserva.estado !== 'pendiente_pago') return false;
  if (reserva.expira_en && new Date(reserva.expira_en) > new Date()) return true;
  // Expiración "perezosa": no necesitamos un cron, se marca la primera vez que alguien la consulta.
  await db.actualizar('reservas', reserva.id, { estado: 'expirada' });
  return false;
}

// Devuelve { equipo_id: unidades_libres } para la fecha indicada (YYYY-MM-DD).
// excluirReservaId sirve para recalcular una reserva sin contarse a sí misma.
async function disponibilidad(fecha, { excluirReservaId } = {}) {
  const [todos, delDia] = await Promise.all([
    equipos({ soloPublicados: false }),
    fecha ? db.listar('reservas', { filtro: { fecha_evento: fecha } }) : []
  ]);

  const ocupado = {};
  for (const r of delDia) {
    if (r.id === excluirReservaId || !(await ocupa(r))) continue;
    for (const it of r.items || []) ocupado[it.equipo_id] = (ocupado[it.equipo_id] || 0) + it.cantidad;
  }

  const libres = {};
  for (const e of todos) {
    const total = e.estado === 'operativo' ? e.cantidad_total : 0;
    libres[e.id] = Math.max(0, total - (ocupado[e.id] || 0));
  }
  return libres;
}

// Convierte combo + adicionales + equipos sueltos en una lista plana { equipo_id, cantidad }.
// Es lo que se guarda en la reserva y lo que se compara contra la disponibilidad.
function expandir({ combo, adicionales = [], items = [] }) {
  const total = {};
  for (const it of [...(combo?.items || []), ...adicionales, ...items]) {
    if (!it.equipo_id || !(it.cantidad > 0)) continue;
    total[it.equipo_id] = (total[it.equipo_id] || 0) + Math.floor(it.cantidad);
  }
  return Object.entries(total).map(([equipo_id, cantidad]) => ({ equipo_id, cantidad }));
}

// Lista los equipos que no alcanzan para esa fecha: [{ equipo_id, nombre, pedido, libre }]
function faltantes(expandidos, libres, mapa) {
  return expandidos
    .filter(it => (libres[it.equipo_id] ?? 0) < it.cantidad)
    .map(it => ({ equipo_id: it.equipo_id, nombre: mapa[it.equipo_id]?.nombre || it.equipo_id, pedido: it.cantidad, libre: libres[it.equipo_id] ?? 0 }));
}

module.exports = { equipos, combos, mapaPorId, disponibilidad, expandir, faltantes };
