// ============================================================================
//  src/db/supabase.js — misma interfaz que local.js, pero contra PostgreSQL
//
//  Usamos la "service key" de Supabase SOLO en el servidor (nunca llega al
//  navegador): con ella Express puede leer y escribir todas las tablas. La
//  seguridad la pone nuestro propio middleware (requiereStaff, requiereCliente)
//  y además las tablas tienen RLS activado sin políticas públicas, así que
//  nadie puede tocarlas con la clave pública (anon) desde fuera.
//
//  Las tablas y columnas están definidas en supabase/esquema.sql.
// ============================================================================

const { createClient } = require('@supabase/supabase-js');
const TABLAS = require('./tablas');

// trim(): al pegar las claves en el panel de Render (casillas de varias líneas)
// es fácil que se cuele un espacio o salto de línea, y la clave dejaría de valer.
const cliente = createClient(process.env.SUPABASE_URL.trim().replace(//+$/, ''), process.env.SUPABASE_SERVICE_KEY.trim(), {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Supabase devuelve { data, error }: convertimos el error en excepción para
// que las rutas lo manejen igual que cualquier otro fallo.
function revisar({ data, error }) {
  if (error) {
    const err = new Error(error.message);
    err.status = error.code === '23505' ? 409 : 500; // 23505 = clave duplicada
    throw err;
  }
  return data;
}

module.exports = {
  async listar(tabla, { filtro, orden, desc } = {}) {
    let q = cliente.from(tabla).select('*');
    if (filtro) q = q.match(filtro);
    if (orden) q = q.order(orden, { ascending: !desc });
    return revisar(await q);
  },

  async obtener(tabla, id) {
    return revisar(await cliente.from(tabla).select('*').eq('id', id).maybeSingle());
  },

  async buscarUno(tabla, filtro) {
    return revisar(await cliente.from(tabla).select('*').match(filtro).limit(1).maybeSingle());
  },

  async insertar(tabla, fila) {
    return revisar(await cliente.from(tabla).insert(fila).select().single());
  },

  async actualizar(tabla, id, cambios) {
    const { id: _ignorado, ...resto } = cambios;
    return revisar(await cliente.from(tabla).update(resto).eq('id', id).select().maybeSingle());
  },

  async eliminar(tabla, id) {
    revisar(await cliente.from(tabla).delete().eq('id', id));
  },

  async ajuste(clave) {
    const fila = revisar(await cliente.from('ajustes').select('valor').eq('id', clave).maybeSingle());
    return fila ? fila.valor : null;
  },

  async guardarAjuste(clave, valor) {
    revisar(await cliente.from('ajustes').upsert({ id: clave, valor }));
  },

  async exportar() {
    const datos = {};
    for (const t of TABLAS) datos[t] = revisar(await cliente.from(t).select('*'));
    return datos;
  },

  // Fotos: Supabase Storage, bucket público "fotos" (se crea solo la primera vez).
  // Las fotos NO van en la base de datos: ahí solo guardamos su URL pública.
  async guardarFoto(nombre, buffer, tipo) {
    const subir = () => cliente.storage.from('fotos').upload(nombre, buffer, { contentType: tipo, upsert: false });
    let r = await subir();
    if (r.error && /bucket not found/i.test(r.error.message)) {
      revisar(await cliente.storage.createBucket('fotos', { public: true }));
      r = await subir();
    }
    revisar(r);
    return cliente.storage.from('fotos').getPublicUrl(nombre).data.publicUrl;
  },

  // upsert = inserta lo nuevo y actualiza lo que ya existe (por id).
  // No borra filas que no estén en el respaldo: restaurar nunca destruye datos.
  async importar(respaldo) {
    for (const t of TABLAS) {
      if (Array.isArray(respaldo[t]) && respaldo[t].length) {
        revisar(await cliente.from(t).upsert(respaldo[t]));
      }
    }
  }
};
