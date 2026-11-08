// ============================================================================
//  src/servicios/puntos.js — puntos por frecuencia del cliente
//
//  Regla del negocio (editable en Admin → Ajustes → Reglas):
//   • 1 punto por cada S/ 100 (puntos_cada_soles) de eventos COMPLETADOS.
//   • Cada 5 puntos (puntos_canje) se canjean por S/ 50 (soles_canje) de
//     descuento en una reserva nueva.
//
//  No hay una tabla de puntos: el saldo se CALCULA a partir de las reservas.
//  Así nunca se desordena y no hace falta cambiar la base de datos:
//   ganados    = piso( suma de totales de reservas completadas / 100 )
//   por ganar  = lo mismo con reservas pagadas o confirmadas (aún no realizadas)
//   canjeados  = puntos usados en reservas que siguen vigentes
//                (si una reserva se cancela o expira, sus puntos vuelven)
//   disponible = ganados − canjeados
// ============================================================================

const db = require('../db');

const VIGENTES = ['pendiente_pago', 'adelanto_pagado', 'confirmada', 'completada'];
const POR_GANAR = ['adelanto_pagado', 'confirmada'];

function reglasPuntos(r) {
  return {
    cada_soles: Math.max(1, Number(r.puntos_cada_soles) || 100),
    canje_puntos: Math.max(1, Number(r.puntos_canje) || 5),
    canje_soles: Math.max(0, Number(r.soles_canje) || 50)
  };
}

// Cuenta los puntos de un cliente a partir de sus reservas.
// `excluirReservaId`: al recotizar una reserva existente, no contar lo que ella misma canjeó.
function calcularSaldo(reservas, r, { excluirReservaId } = {}) {
  const p = reglasPuntos(r);
  const suma = estados => reservas.filter(x => estados.includes(x.estado)).reduce((s, x) => s + Number(x.total || 0), 0);
  const ganados = Math.floor(suma(['completada']) / p.cada_soles);
  const por_ganar = Math.floor(suma(POR_GANAR) / p.cada_soles);
  const canjeados = reservas
    .filter(x => VIGENTES.includes(x.estado) && x.id !== excluirReservaId)
    .reduce((s, x) => s + Number(x.encuesta?.puntos_canjeados || 0), 0);
  const disponible = Math.max(0, ganados - canjeados);
  return {
    ...p,
    ganados, por_ganar, canjeados, disponible,
    canjes_posibles: Math.floor(disponible / p.canje_puntos),
    faltan_para_canje: disponible >= p.canje_puntos ? 0 : p.canje_puntos - (disponible % p.canje_puntos)
  };
}

async function saldo(usuarioId, r, opciones) {
  if (!usuarioId) return null;
  const reservas = await db.listar('reservas', { filtro: { usuario_id: usuarioId } });
  return calcularSaldo(reservas, r, opciones);
}

// Cuántos canjes se aplican: lo pedido, sin pasar del saldo ni dejar el total en negativo.
function aplicarCanje(pedidos, s, maximoSoles) {
  if (!s || !(pedidos > 0) || !s.canje_soles) return { canjes: 0, puntos: 0, descuento: 0 };
  const porMonto = Math.floor(Math.max(0, maximoSoles) / s.canje_soles);
  const canjes = Math.max(0, Math.min(Math.floor(pedidos), s.canjes_posibles, porMonto));
  return { canjes, puntos: canjes * s.canje_puntos, descuento: canjes * s.canje_soles };
}

module.exports = { calcularSaldo, saldo, aplicarCanje, reglasPuntos };
