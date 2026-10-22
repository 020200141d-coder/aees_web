// ============================================================================
//  scripts/cargar-semilla.js — carga data/semilla.json en la base activa
//
//  Uso:  npm run semilla
//   • Con SUPABASE_URL y SUPABASE_SERVICE_KEY en .env → sube a Supabase
//     (upsert: si ya existen, los actualiza; no borra reservas ni usuarios).
//   • Sin Supabase → recrea data/db.local.json desde cero.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');

const RUTA_ENV = path.join(__dirname, '..', '.env');
if (fs.existsSync(RUTA_ENV)) process.loadEnvFile(RUTA_ENV);

const semilla = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'semilla.json'), 'utf8'));

async function main() {
  if (!process.env.SUPABASE_URL) {
    const rutaLocal = path.join(__dirname, '..', 'data', 'db.local.json');
    fs.rmSync(rutaLocal, { force: true });
    // Al requerir el adaptador local sin archivo, se crea desde la semilla.
    await require('../src/db/local').listar('equipos');
    console.log('Base local recreada en data/db.local.json');
    return;
  }

  const db = require('../src/db');
  const respaldo = {
    ajustes: Object.entries(semilla.ajustes).map(([id, valor]) => ({ id, valor })),
    equipos: semilla.equipos,
    combos: semilla.combos,
    promociones: semilla.promociones,
    publicaciones: semilla.publicaciones
  };
  await db.importar(respaldo);
  console.log(`Semilla cargada en Supabase: ${semilla.equipos.length} equipos, ${semilla.combos.length} combos.`);
}

main().catch(err => {
  console.error('No se pudo cargar la semilla:', err.message);
  process.exit(1);
});
