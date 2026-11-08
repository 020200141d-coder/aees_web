// ============================================================================
//  src/servicios/precios.js — cuánto cuesta un evento
//
//  Regla de tiempo (configurable en Admin → Ajustes):
//   • El precio de cada equipo y de cada combo es por EVENTO de hasta
//     `horas_base` horas (por defecto 6: un cumpleaños o una boda normal).
//   • Cada hora de más cobra la parte proporcional del precio por
//     `factor_hora_extra`:  extra = precio × (horas − base) / base × factor.
//     Con factor 0.5 → Combo grande S/ 600 a 8 h (fiesta electrónica):
//       600 × 2/6 × 0.5 = S/ 100 más  →  S/ 700, como lo cobra el negocio.
//   • Un combo puede traer sus propias horas_base.
//
//  IMPORTANTE: el servidor SIEMPRE recalcula el precio desde la base de
//  datos. Nunca se confía en un precio que venga del navegador.
// ============================================================================

const db = require('../db');
const { redondear } = require('../lib/util');

async function reglas() {
  return normalizarReglas({
    ...REGLAS_BASE,
    ...(await db.ajuste('reglas'))
  });
}

// Valores por defecto: lo guardado en Admin → Ajustes los reemplaza.
const REGLAS_BASE = {
  adelanto_pct: 40, horas_bloqueo: 24,
  horas_jornada: 6, factor_hora_extra: 0.5,
  tecnico_por_evento: 150, descuento_frecuente_pct: 10, reservas_para_frecuente: 2,
  // Transporte sin costo: carga que entra en estos vehículos (paquete pequeño o
  // mediano), hasta km_transporte_gratis por carretera, a una altura que no pase
  // de altura_max_gratis_m (sin subir a los cerros) y con acceso vehicular.
  vehiculos_transporte_gratis: ['auto'], km_transporte_gratis: 15, altura_max_gratis_m: 3500,
  // Si el vehículo no llega hasta el lugar, el equipo se carga a mano el último tramo.
  recargo_sin_acceso: 30
};

// Antes las reglas eran por "jornadas" de 4 h. Si en la base quedaron esos
// nombres, se traducen para que nada se rompa.
function normalizarReglas(r) {
  if (r.tecnico_por_evento == null && r.tecnico_por_jornada != null) r.tecnico_por_evento = r.tecnico_por_jornada;
  return r;
}

// Cuánto se multiplica el precio por la duración. Hasta la base: 1×.
// Devuelve también las horas extra para mostrarlas en el detalle.
function factorTiempo(horas, horasBase, factorExtra) {
  const base = Math.max(1, Number(horasBase) || 6);
  const h = Math.max(1, Number(horas) || base);
  const horas_extra = Math.max(0, h - base);
  return { jornadas: 1, horas_base: base, horas_extra, factor: 1 + (horas_extra / base) * (Number(factorExtra) || 0) };
}

// Precio unitario de un equipo suelto según las reglas del negocio:
//  • Precio por cantidad: desde `mayor_desde` unidades se cobra `precio_mayor`
//    (tachos LED: S/ 25 c/u, desde 13 unidades S/ 20).
//  • Sin DMX: si el evento no lleva controlador DMX, se suma `ajuste_sin_dmx`
//    (tachos: −5, porque no hay programación de escenas).
function precioUnitario(e, cantidad, conDmx) {
  const porCantidad = e.mayor_desde && e.precio_mayor != null && cantidad >= e.mayor_desde ? Number(e.precio_mayor) : Number(e.precio);
  const ajuste = conDmx ? 0 : Number(e.ajuste_sin_dmx || 0);
  return Math.max(0, porCantidad + ajuste);
}

// Calcula las líneas y el subtotal de equipos (sin transporte ni descuentos).
//  entrada: { combo, adicionales:[{equipo_id,cantidad,precio,etiqueta}], items:[{equipo_id,cantidad}], horas }
//  `conDmx` se decide mirando TODO el evento (combo + adicionales + sueltos).
function subtotalEquipos({ combo, adicionales = [], items = [], horas }, mapa, r) {
  const lineas = [];
  // Si hay combo, su duración (horas_base) es la jornada de TODO el evento: un combo
  // de 5 h con equipos sueltos y técnico se cobra como 1 jornada en todas las líneas.
  const tiempo = factorTiempo(horas, combo?.horas_base || r.horas_jornada, r.factor_hora_extra);
  const todos = [...(combo?.items || []), ...adicionales, ...items];
  const conDmx = todos.some(it => mapa[it.equipo_id]?.rol === 'dmx');

  if (combo) {
    const t = tiempo;
    lineas.push({
      tipo: 'combo', id: combo.id, nombre: combo.nombre, cantidad: 1,
      precio_unit: combo.precio, jornadas: t.jornadas, horas_extra: t.horas_extra, subtotal: redondear(combo.precio * t.factor),
      detalle: combo.items.map(it => `${it.cantidad}× ${mapa[it.equipo_id]?.nombre || it.equipo_id}`)
    });
    // Adicionales del combo: precio especial fijo definido en el combo (p. ej. +2 EON615 = S/ 100).
    for (const ad of adicionales) {
      lineas.push({
        tipo: 'adicional', id: ad.equipo_id, nombre: ad.etiqueta || `${ad.cantidad}× ${mapa[ad.equipo_id]?.nombre}`, cantidad: 1,
        precio_unit: ad.precio, jornadas: t.jornadas, horas_extra: t.horas_extra, subtotal: redondear(ad.precio * t.factor)
      });
    }
  }
  for (const it of items) {
    const e = mapa[it.equipo_id];
    if (!e || !(it.cantidad > 0)) continue;
    const unit = precioUnitario(e, it.cantidad, conDmx);
    lineas.push({
      tipo: 'equipo', id: e.id, nombre: e.nombre, cantidad: it.cantidad,
      precio_unit: unit, jornadas: tiempo.jornadas, horas_extra: tiempo.horas_extra, subtotal: redondear(unit * it.cantidad * tiempo.factor)
    });
  }
  return { lineas, jornadas: tiempo.jornadas, horas_base: tiempo.horas_base, horas_extra: tiempo.horas_extra, factor_tiempo: tiempo.factor, con_dmx: conDmx, subtotal: redondear(lineas.reduce((s, l) => s + l.subtotal, 0)) };
}

// ¿El cliente ya es "frecuente"? (N reservas pagadas o completadas)
async function esFrecuente(usuarioId, r) {
  if (!usuarioId) return false;
  const suyas = await db.listar('reservas', { filtro: { usuario_id: usuarioId } });
  return suyas.filter(x => ['adelanto_pagado', 'confirmada', 'completada'].includes(x.estado)).length >= r.reservas_para_frecuente;
}

// Busca y valida un código promocional. Devuelve { promo, error }.
async function validarPromo(codigo, { frecuente }) {
  if (!codigo) return {};
  const promo = await db.buscarUno('promociones', { codigo: String(codigo).trim().toUpperCase() });
  if (!promo || !promo.activo) return { error: 'Ese código no existe o ya no está activo.' };
  if (promo.vence && promo.vence < new Date().toISOString().slice(0, 10)) return { error: 'Ese código ya venció.' };
  if (promo.solo_frecuentes && !frecuente) return { error: 'Ese código es solo para clientes frecuentes.' };
  return { promo };
}

// Cotización completa: equipos + técnico + transporte − descuento → total y adelanto.
async function cotizar({ combo, adicionales, items, horas, conTecnico, transporte, promoCodigo, usuarioId }, mapa) {
  const r = await reglas();
  const base = subtotalEquipos({ combo, adicionales, items, horas }, mapa, r);
  // El técnico que opera el evento sigue la misma regla de horas que los equipos.
  const tecnico = conTecnico ? redondear(r.tecnico_por_evento * base.factor_tiempo) : 0;
  const costoTransporte = transporte?.costo || 0;

  const frecuente = await esFrecuente(usuarioId, r);
  const { promo, error: errorPromo } = await validarPromo(promoCodigo, { frecuente });
  // Se aplica el mayor descuento entre la promo y el de cliente frecuente (no se suman).
  const pct = Math.max(promo?.porcentaje || 0, frecuente ? r.descuento_frecuente_pct : 0);
  const descuento = redondear(base.subtotal * pct / 100);

  const total = redondear(base.subtotal + tecnico + costoTransporte - descuento);
  return {
    ...base,
    tecnico,
    transporte: transporte || null,
    descuento,
    descuento_pct: pct,
    frecuente,
    promo: promo ? { codigo: promo.codigo, porcentaje: promo.porcentaje } : null,
    error_promo: errorPromo || null,
    total,
    adelanto_pct: r.adelanto_pct,
    adelanto: redondear(total * r.adelanto_pct / 100),
    horas_bloqueo: r.horas_bloqueo
  };
}

module.exports = { reglas, REGLAS_BASE, factorTiempo, precioUnitario, subtotalEquipos, cotizar, esFrecuente };
