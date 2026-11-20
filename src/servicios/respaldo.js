// ============================================================================
//  src/servicios/respaldo.js — copias de seguridad desde el panel
//
//  Descargar todo, restaurar desde un archivo y manejar los respaldos
//  automáticos diarios (que guarda servicios/tareas.js).
//  Regla: solo se restaura un archivo que parezca un respaldo de AeeS
//  (tablas conocidas y equipos con id y nombre)                       → 400
// ============================================================================

const db = require('../db');
const tareas = require('./tareas');
const negocio = require('./negocio');
const TABLAS = require('../db/tablas');
const { ErrorNegocio } = require('../lib/errores');

async function estado() {
  const automaticos = await tareas.listar().catch(() => []);
  return { motor: db.motor, automaticos, dias: tareas.DIAS_RESPALDO, tareaActiva: Boolean(process.env.TAREAS_TOKEN?.trim()) };
}

const leerAutomatico = nombre => tareas.leer(nombre);
const respaldarAhora = () => tareas.respaldoDiario();

async function exportar() {
  return { version: 1, generado: new Date().toISOString(), ...(await db.exportar()) };
}

async function restaurar(b = {}) {
  const tablas = TABLAS.filter(t => Array.isArray(b[t]));
  if (!tablas.length || !Array.isArray(b.equipos) || b.equipos.some(e => !e.id || !e.nombre)) {
    throw new ErrorNegocio('Ese archivo no parece un respaldo de AeeS (faltan tablas o equipos válidos).', 400);
  }
  await db.importar(Object.fromEntries(tablas.map(t => [t, b[t]])));
  negocio.invalidar();
  return { tablas, equipos: b.equipos.length };
}

module.exports = { estado, leerAutomatico, respaldarAhora, exportar, restaurar };
