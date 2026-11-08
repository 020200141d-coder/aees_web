// ============================================================================
//  src/servicios/transporte.js — ¿en qué vehículo entra todo y cuánto cuesta?
//
//  Cada equipo tiene volumen (litros), peso (kg) y largo (cm) aproximados.
//  Sumamos la carga y elegimos el vehículo MÁS BARATO que cumpla las tres
//  condiciones:  volumen ≤ capacidad_l,  peso ≤ capacidad_kg  y  la pieza más
//  larga ≤ largo_max_cm (una sección de truss de 3 m no entra en un taxi).
//
//  Costo ida y vuelta = base + por_km × km_de_ida
//   Calibrado con los precios del negocio para Cusco → Urubamba (66 km
//   por carretera según OSRM):
//     auto:    60 + 3.60 × 66 ≈ S/ 298
//     station: 80 + 4.85 × 66 ≈ S/ 400
//  Las tarifas se editan en Admin → Ajustes → Vehículos.
//
//  Transporte SIN costo (regla del negocio, editable en Ajustes → Reglas):
//   el almacén está en Larapa Grande (San Jerónimo). Un paquete pequeño o
//   mediano (carga que entra en un auto) va gratis al centro de Cusco y sus
//   alrededores, si:  • la ruta no pasa de km_transporte_gratis,
//                     • el lugar no está en un cerro (altura ≤ altura_max_gratis_m),
//                     • el vehículo llega hasta el mismo lugar del evento.
//   Si el vehículo NO llega, se suma recargo_sin_acceso (cargar a mano).
// ============================================================================

const db = require('../db');
const { redondear } = require('../lib/util');

// Se deja un 15% libre para acomodar, amarrar y no llevar todo apretado.
const MARGEN = 0.85;

function carga(expandidos, mapa) {
  let volumen = 0, peso = 0, largo = 0;
  for (const it of expandidos) {
    const e = mapa[it.equipo_id];
    if (!e) continue;
    volumen += (e.volumen_l || 0) * it.cantidad;
    peso += (e.peso_kg || 0) * it.cantidad;
    largo = Math.max(largo, e.largo_cm || 0);
  }
  return { volumen_l: Math.round(volumen), peso_kg: Math.round(peso), largo_cm: largo };
}

async function vehiculos() {
  return (await db.ajuste('vehiculos')) || [];
}

// Decide si el transporte va incluido. `altura` puede ser null (no se pudo
// consultar): en ese caso no se descarta, se confirma en la reunión.
function evaluarGratis({ vehiculoId, viajes, km, altura, acceso }, r) {
  const motivos = [];
  if (!(r.vehiculos_transporte_gratis || []).includes(vehiculoId) || viajes > 1) motivos.push('la carga necesita un vehículo más grande');
  if (!(km <= r.km_transporte_gratis)) motivos.push(`el lugar está a más de ${r.km_transporte_gratis} km del almacén`);
  if (altura != null && altura > r.altura_max_gratis_m) motivos.push(`el lugar está en zona alta (${Math.round(altura)} m)`);
  if (acceso === false) motivos.push('el vehículo no llega hasta el lugar');
  return { gratis: motivos.length === 0, motivos };
}

// Devuelve { vehiculo, viajes, costo, carga, distancia_km, gratis, ... } .
// opciones: { acceso (true/false/undefined), altura (m o null), reglas }
async function calcular(expandidos, mapa, distanciaKm, { acceso, altura = null, reglas = null } = {}) {
  const lista = (await vehiculos()).slice().sort((a, b) => a.base - b.base);
  const c = carga(expandidos, mapa);
  if (!lista.length) return null;

  const cabe = v => c.volumen_l <= v.capacidad_l * MARGEN && c.peso_kg <= v.capacidad_kg && c.largo_cm <= v.largo_max_cm;
  let vehiculo = lista.find(cabe);
  let viajes = 1;
  // Si ni el más grande alcanza, calculamos cuántos viajes del más grande hacen falta.
  if (!vehiculo) {
    vehiculo = lista[lista.length - 1];
    viajes = Math.max(
      Math.ceil(c.volumen_l / (vehiculo.capacidad_l * MARGEN)),
      Math.ceil(c.peso_kg / vehiculo.capacidad_kg)
    );
  }

  const km = Number(distanciaKm);
  const tarifa = Number.isFinite(km) ? redondear((vehiculo.base + vehiculo.por_km * km) * viajes) : null;
  const r = reglas || {};
  const evalua = Number.isFinite(km) && reglas ? evaluarGratis({ vehiculoId: vehiculo.id, viajes, km, altura, acceso }, r) : { gratis: false, motivos: [] };
  const recargo = acceso === false ? Number(r.recargo_sin_acceso || 0) : 0;
  const costo = tarifa == null ? null : redondear((evalua.gratis ? 0 : tarifa) + recargo);
  return {
    tarifa, // lo que costaría sin la regla de transporte incluido
    gratis: evalua.gratis,
    motivos_cobro: evalua.motivos,
    recargo_sin_acceso: recargo,
    acceso_vehicular: acceso === undefined ? null : acceso,
    altura_m: altura == null ? null : Math.round(altura),
    vehiculo: { id: vehiculo.id, nombre: vehiculo.nombre, descripcion: vehiculo.descripcion },
    viajes,
    carga: c,
    distancia_km: Number.isFinite(km) ? redondear(km) : null,
    costo
  };
}

module.exports = { calcular, carga, vehiculos, evaluarGratis };
