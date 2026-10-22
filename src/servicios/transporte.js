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

// Devuelve { vehiculo, viajes, costo, carga, distancia_km } o null si no hay distancia.
async function calcular(expandidos, mapa, distanciaKm) {
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
  const costo = Number.isFinite(km) ? redondear((vehiculo.base + vehiculo.por_km * km) * viajes) : null;
  return {
    vehiculo: { id: vehiculo.id, nombre: vehiculo.nombre, descripcion: vehiculo.descripcion },
    viajes,
    carga: c,
    distancia_km: Number.isFinite(km) ? redondear(km) : null,
    costo
  };
}

module.exports = { calcular, carga, vehiculos };
