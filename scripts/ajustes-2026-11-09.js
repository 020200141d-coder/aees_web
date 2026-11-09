// ============================================================================
//  scripts/ajustes-2026-11-09.js — cambios puntuales pedidos por el negocio:
//   1. Imágenes para los equipos que no tenían (micros, tacho, matrix, minibrut,
//      trípode): las ilustraciones de scripts/ilustraciones-equipos.js.
//      Solo se asignan si el equipo NO tiene foto (no pisa fotos subidas en el panel).
//   2. Combo grande · DJ: el extra "2 JBL EON615 adicionales" pasa de S/ 100 a S/ 150.
//
//  Aplica a la base ACTIVA (Supabase si .env tiene sus claves) y a data/semilla.json.
//  Se puede correr varias veces: deja el mismo resultado.
//  Uso:  node scripts/ajustes-2026-11-09.js
// ============================================================================
const fs = require('node:fs');
const path = require('node:path');
const RUTA_ENV = path.join(__dirname, '..', '.env');
if (fs.existsSync(RUTA_ENV)) process.loadEnvFile(RUTA_ENV);
const db = require('../src/db');

const FUENTE = 'Ilustración referencial de AeeS Acústico';
const ILUSTRACIONES = ['sv100', 'e832', 'e935', 'e945', 'tacho-54', 'matrix', 'minibrut', 'tripode'];
const PRECIO_EON_DJ = 150;

// El extra de 2 EON en el combo DJ, con su nuevo precio (los demás extras no cambian).
const conNuevoPrecio = (adicionales = []) => adicionales.map(a =>
  a.equipo_id === 'eon615' && a.cantidad === 2 ? { ...a, precio: PRECIO_EON_DJ } : a);

async function main() {
  for (const id of ILUSTRACIONES) {
    const e = await db.buscarUno('equipos', { id });
    if (!e) { console.log(`· ${id}: no existe, se omite`); continue; }
    if (e.imagen) { console.log(`· ${id}: ya tiene foto, no se toca`); continue; }
    await db.actualizar('equipos', id, { imagen: `/img/equipos/${id}.svg`, imagen_fuente: FUENTE, imagen_fuente_url: null });
    console.log(`✓ ${id}: imagen asignada`);
  }

  const combo = await db.buscarUno('combos', { id: 'combo-grande' });
  if (combo) {
    await db.actualizar('combos', combo.id, { adicionales: conNuevoPrecio(combo.adicionales) });
    console.log(`✓ Combo grande · DJ: 2 EON adicionales = S/ ${PRECIO_EON_DJ}`);
  }

  // Semilla (lo que se carga en una base nueva): mismos cambios.
  const rutaSemilla = path.join(__dirname, '..', 'data', 'semilla.json');
  const semilla = JSON.parse(fs.readFileSync(rutaSemilla, 'utf8'));
  for (const e of semilla.equipos) {
    if (ILUSTRACIONES.includes(e.id) && !e.imagen) Object.assign(e, { imagen: `/img/equipos/${e.id}.svg`, imagen_fuente: FUENTE });
  }
  const c = semilla.combos.find(x => x.id === 'combo-grande');
  if (c) c.adicionales = conNuevoPrecio(c.adicionales);
  fs.writeFileSync(rutaSemilla, JSON.stringify(semilla, null, 2) + '\n');
  console.log('✓ data/semilla.json actualizado');
}

main().then(() => process.exit(0)).catch(err => { console.error('✗', err.message); process.exit(1); });
