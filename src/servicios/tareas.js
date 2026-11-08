// ============================================================================
//  src/servicios/tareas.js — mantenimiento diario automático
//
//  Lo dispara GitHub Actions una vez al día (.github/workflows/diaria.yml)
//  llamando a POST /tareas/diaria con la clave TAREAS_TOKEN. Hace tres cosas:
//
//   1. Despierta Supabase: el plan gratis PAUSA un proyecto que pasa 7 días
//      sin consultas. Esta tarea consulta la base todos los días, así nunca
//      llega a pausarse (aunque no entren clientes una semana).
//   2. Respaldo diario: exporta TODAS las tablas a un archivo JSON y lo guarda
//      en el almacenamiento PRIVADO "respaldos" (no en GitHub: el repositorio
//      es público y el respaldo tiene datos de clientes).
//   3. Limpieza: deja solo los últimos DIAS_RESPALDO respaldos.
//
//  El admin los ve, descarga y restaura en Admin → Respaldo.
// ============================================================================

const db = require('../db');
const { hoyLima } = require('../lib/util');

const BUCKET = 'respaldos';
const PREFIJO = 'diarios';
const DIAS_RESPALDO = 30;

async function respaldoDiario() {
  const inicio = Date.now();
  const datos = await db.exportar(); // también "despierta" la base: consulta cada tabla
  const contenido = Buffer.from(JSON.stringify({ version: 1, generado: new Date().toISOString(), automatico: true, ...datos }));
  const nombre = `${PREFIJO}/aees-respaldo-${hoyLima()}.json`;
  await db.guardarPrivado(nombre, contenido, 'application/json', BUCKET);

  // Limpieza: solo los últimos N días.
  const lista = await db.listarPrivados(BUCKET, PREFIJO);
  const sobran = lista.slice(DIAS_RESPALDO);
  for (const f of sobran) await db.eliminarPrivado(f.nombre, BUCKET);

  return {
    archivo: nombre,
    kb: Math.round(contenido.length / 1024),
    filas: Object.fromEntries(Object.entries(datos).map(([t, filas]) => [t, Array.isArray(filas) ? filas.length : 0])),
    guardados: Math.min(lista.length, DIAS_RESPALDO),
    borrados: sobran.length,
    ms: Date.now() - inicio
  };
}

const listar = () => db.listarPrivados(BUCKET, PREFIJO);
const leer = nombre => (nombre.startsWith(`${PREFIJO}/`) ? db.leerPrivado(nombre, BUCKET) : null);

module.exports = { respaldoDiario, listar, leer, DIAS_RESPALDO };
