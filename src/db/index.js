// ============================================================================
//  src/db/index.js — punto único de acceso a los datos
//
//  ¿Por qué dos "adaptadores"?
//   • En producción usamos Supabase (PostgreSQL gestionado, plan gratis).
//   • En tu PC, mientras no tengas cuenta de Supabase, todo se guarda en
//     data/db.local.json. Así el proyecto corre con solo `npm start`.
//
//  Ambos adaptadores exponen EXACTAMENTE los mismos métodos, así que el
//  resto del código (rutas, servicios) no sabe ni le importa dónde viven
//  los datos. Esto es el patrón "Repository" que también usas en la app
//  Flutter (datasource local / remoto detrás de una misma interfaz).
//
//  Métodos:
//   listar(tabla, { filtro, orden, desc })   → filas
//   obtener(tabla, id)                       → fila | null
//   buscarUno(tabla, filtro)                 → fila | null
//   insertar(tabla, fila)                    → fila (con id y creado_en)
//   actualizar(tabla, id, cambios)           → fila
//   eliminar(tabla, id)
//   ajuste(clave) / guardarAjuste(clave, valor)
//   exportar() / importar(datos)             → respaldo completo
//   guardarFoto(nombre, buffer, tipo)        → URL pública de la foto
// ============================================================================

const usarSupabase = Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_KEY?.trim());

const db = usarSupabase ? require('./supabase') : require('./local');

db.motor = usarSupabase ? 'supabase' : 'local';

module.exports = db;
