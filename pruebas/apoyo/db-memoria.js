// ============================================================================
//  pruebas/apoyo/db-memoria.js — base de datos falsa, en memoria, para Jest
//
//  Implementa los mismos métodos que src/db (listar, obtener, insertar…).
//  Gracias al patrón Repository, los servicios no notan la diferencia: en las
//  pruebas se reemplaza src/db por esta con jest.mock y así cada prueba parte
//  de datos conocidos, sin internet, sin Supabase y sin tocar archivos.
// ============================================================================

function crear(semilla = {}) {
  let tablas = {};
  let ajustes = {};
  let contador = 0;
  const copia = v => JSON.parse(JSON.stringify(v));
  const cumple = (fila, filtro = {}) => Object.entries(filtro).every(([k, v]) => fila[k] === v);

  const db = {
    motor: 'memoria',
    // Deja la base con estos datos (se llama en beforeEach).
    reiniciar(datos = semilla) {
      tablas = copia(datos.tablas || {});
      ajustes = copia(datos.ajustes || {});
      contador = 0;
    },
    async listar(tabla, { filtro, orden, desc } = {}) {
      let filas = (tablas[tabla] || []).filter(f => cumple(f, filtro));
      if (orden) filas = [...filas].sort((x, y) => (x[orden] > y[orden] ? 1 : x[orden] < y[orden] ? -1 : 0) * (desc ? -1 : 1));
      return copia(filas);
    },
    async obtener(tabla, id) { return copia((tablas[tabla] || []).find(f => f.id === id) || null); },
    async buscarUno(tabla, filtro) { return copia((tablas[tabla] || []).find(f => cumple(f, filtro)) || null); },
    async insertar(tabla, fila) {
      const nueva = { id: fila.id || `id-${++contador}`, creado_en: new Date().toISOString(), ...fila };
      (tablas[tabla] ||= []).push(nueva);
      return copia(nueva);
    },
    async actualizar(tabla, id, cambios) {
      const fila = (tablas[tabla] || []).find(f => f.id === id);
      if (!fila) throw new Error(`no existe ${tabla}/${id}`);
      Object.assign(fila, cambios);
      return copia(fila);
    },
    async eliminar(tabla, id) { tablas[tabla] = (tablas[tabla] || []).filter(f => f.id !== id); },
    async ajuste(clave) { return copia(ajustes[clave] ?? null); },
    async guardarAjuste(clave, valor) { ajustes[clave] = copia(valor); return valor; },
    // Para que las pruebas revisen el estado final.
    _tabla: tabla => copia(tablas[tabla] || [])
  };
  db.reiniciar(semilla);
  return db;
}

module.exports = { crear };
