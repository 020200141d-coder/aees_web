// ============================================================================
//  src/db/local.js — base de datos en un archivo JSON (solo para desarrollo)
//
//  Flujo:
//   1. Al primer uso, si no existe data/db.local.json, se crea copiando
//      data/semilla.json (equipos, combos, ajustes de ejemplo).
//   2. Todo se mantiene en memoria (objeto `estado`) para responder rápido.
//   3. Cada escritura guarda el archivo de forma SEGURA: primero escribe un
//      .tmp y luego lo renombra. Renombrar es atómico en el sistema de
//      archivos, así que si el proceso se corta a mitad nunca queda un JSON
//      roto a medias.
//   4. Las escrituras se encolan (cadena de promesas) para que dos peticiones
//      simultáneas no se pisen.
//
//  En Vercel el disco es de solo lectura salvo /tmp: ahí lo movemos, pero
//  se pierde en cada despliegue. Para producción usa Supabase.
// ============================================================================

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const TABLAS = require('./tablas');

const RAIZ = path.join(__dirname, '..', '..');
const RUTA_SEMILLA = path.join(RAIZ, 'data', 'semilla.json');
const RUTA_DB = process.env.VERCEL
  ? path.join(os.tmpdir(), 'aees-db.json')
  : path.join(RAIZ, 'data', 'db.local.json');

let estado = null;
let cola = Promise.resolve();

// Convierte la semilla (ajustes como objeto clave→valor) al formato de tablas.
function desdeSemilla(semilla) {
  const datos = {};
  for (const t of TABLAS) datos[t] = [];
  datos.ajustes = Object.entries(semilla.ajustes || {}).map(([id, valor]) => ({ id, valor }));
  for (const t of TABLAS) {
    if (t !== 'ajustes' && Array.isArray(semilla[t])) {
      datos[t] = semilla[t].map(f => ({ creado_en: new Date().toISOString(), ...f }));
    }
  }
  return datos;
}

function cargar() {
  if (estado) return estado;
  if (fs.existsSync(RUTA_DB)) {
    estado = JSON.parse(fs.readFileSync(RUTA_DB, 'utf8'));
  } else {
    estado = desdeSemilla(JSON.parse(fs.readFileSync(RUTA_SEMILLA, 'utf8')));
    guardarYa();
  }
  for (const t of TABLAS) estado[t] ||= [];
  return estado;
}

function guardarYa() {
  const tmp = `${RUTA_DB}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2));
  fs.renameSync(tmp, RUTA_DB);
}

// Encola la escritura: devuelve una promesa que se resuelve cuando ya está en disco.
function guardar() {
  cola = cola.then(guardarYa, guardarYa);
  return cola;
}

// Copia profunda para que quien reciba una fila no modifique el estado interno por accidente.
const copia = v => (v == null ? v : structuredClone(v));

const coincide = (fila, filtro = {}) => Object.entries(filtro).every(([k, v]) => fila[k] === v);

function ordenar(filas, orden, desc) {
  if (!orden) return filas;
  return filas.sort((a, b) => {
    const x = a[orden], y = b[orden];
    if (x === y) return 0;
    const r = x > y ? 1 : -1;
    return desc ? -r : r;
  });
}

module.exports = {
  async listar(tabla, { filtro, orden, desc } = {}) {
    const filas = cargar()[tabla].filter(f => coincide(f, filtro));
    return copia(ordenar(filas, orden, desc));
  },

  async obtener(tabla, id) {
    return copia(cargar()[tabla].find(f => f.id === id) || null);
  },

  async buscarUno(tabla, filtro) {
    return copia(cargar()[tabla].find(f => coincide(f, filtro)) || null);
  },

  async insertar(tabla, fila) {
    const datos = cargar();
    const nueva = { id: crypto.randomUUID(), creado_en: new Date().toISOString(), ...fila };
    if (datos[tabla].some(f => f.id === nueva.id)) {
      const err = new Error(`Ya existe un registro con id "${nueva.id}".`);
      err.status = 409;
      throw err;
    }
    datos[tabla].push(nueva);
    await guardar();
    return copia(nueva);
  },

  async actualizar(tabla, id, cambios) {
    const fila = cargar()[tabla].find(f => f.id === id);
    if (!fila) return null;
    Object.assign(fila, cambios, { id });
    await guardar();
    return copia(fila);
  },

  async eliminar(tabla, id) {
    const datos = cargar();
    datos[tabla] = datos[tabla].filter(f => f.id !== id);
    await guardar();
  },

  async ajuste(clave) {
    return copia(cargar().ajustes.find(a => a.id === clave)?.valor ?? null);
  },

  async guardarAjuste(clave, valor) {
    const datos = cargar();
    const fila = datos.ajustes.find(a => a.id === clave);
    if (fila) fila.valor = valor;
    else datos.ajustes.push({ id: clave, valor });
    await guardar();
  },

  async exportar() {
    return copia(cargar());
  },

  // Fotos subidas desde el panel: se guardan en public/uploads y se sirven como estáticos.
  async guardarFoto(nombre, buffer) {
    const carpeta = process.env.VERCEL ? path.join(os.tmpdir(), 'uploads') : path.join(RAIZ, 'public', 'uploads');
    fs.mkdirSync(carpeta, { recursive: true });
    fs.writeFileSync(path.join(carpeta, nombre), buffer);
    return `/uploads/${nombre}`;
  },

  // Reemplaza todas las tablas que vengan en el respaldo; las demás quedan igual.
  async importar(respaldo) {
    const datos = cargar();
    for (const t of TABLAS) {
      if (Array.isArray(respaldo[t])) datos[t] = respaldo[t];
    }
    await guardar();
  }
};
