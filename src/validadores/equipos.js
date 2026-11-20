// ============================================================================
//  src/validadores/equipos.js — lee y valida el formulario de un equipo
//
//  Antes vivía dentro de src/rutas/admin.js. Ahora es una función pura:
//  recibe el body del formulario y devuelve { datos, errores } sin tocar la
//  base ni la petición, así se puede probar sola.
//   • datos   → el equipo ya limpio y con los tipos correctos
//   • errores → { campo: mensaje } para mostrar junto a cada input
// ============================================================================

const { CATEGORIAS, texto, numero } = require('../lib/util');
const { marcado, entero, opcional, urlImagen } = require('./formulario');

const ESTADOS_EQUIPO = ['operativo', 'mantenimiento', 'baja'];

function leerEquipo(b) {
  const d = {
    codigo: texto(b.codigo, 30).toUpperCase(),
    nombre: texto(b.nombre, 120),
    marca: texto(b.marca, 60),
    modelo: texto(b.modelo, 60),
    categoria: b.categoria,
    rol: texto(b.rol, 30).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    descripcion: String(b.descripcion || '').trim().slice(0, 1500),
    precio: numero(b.precio, NaN),
    precio_mayor: opcional(b.precio_mayor),
    mayor_desde: opcional(b.mayor_desde),
    ajuste_sin_dmx: numero(b.ajuste_sin_dmx, 0),
    precio_adicional: opcional(b.precio_adicional),
    cantidad_total: entero(b.cantidad_total, NaN),
    potencia_w: entero(b.potencia_w),
    spl_db: opcional(b.spl_db),
    cobertura_personas: opcional(b.cobertura_personas),
    dimensiones: texto(b.dimensiones, 80),
    volumen_l: numero(b.volumen_l, 0),
    peso_kg: numero(b.peso_kg, 0),
    largo_cm: entero(b.largo_cm),
    imagen: urlImagen(b.imagen),
    imagen_fuente: texto(b.imagen_fuente, 160),
    // Enlace a la página de la foto: las licencias Creative Commons piden citar autor y fuente.
    imagen_fuente_url: /^https:\/\/\S+$/.test(String(b.imagen_fuente_url || '').trim()) ? String(b.imagen_fuente_url).trim().slice(0, 400) : '',
    estado: ESTADOS_EQUIPO.includes(b.estado) ? b.estado : 'operativo',
    publicado: marcado(b.publicado),
    destacado: marcado(b.destacado),
    orden: entero(b.orden)
  };
  const e = {};
  if (!/^[A-Z0-9-]{2,30}$/.test(d.codigo)) e.codigo = 'Código de 2 a 30 caracteres: letras, números o guiones.';
  if (d.nombre.length < 2) e.nombre = 'El nombre es obligatorio.';
  if (!CATEGORIAS[d.categoria]) e.categoria = 'Elige una categoría.';
  if (!d.rol) e.rol = 'El rol es obligatorio (lo usa el recomendador).';
  if (!(d.precio >= 0)) e.precio = 'El precio debe ser 0 o mayor.';
  if (d.precio_mayor != null && !(d.precio_mayor >= 0)) e.precio_mayor = 'Debe ser 0 o mayor.';
  if ((d.precio_mayor == null) !== (d.mayor_desde == null)) e.mayor_desde = 'Completa ambos: precio por cantidad y desde cuántas unidades.';
  if (d.mayor_desde != null && !(d.mayor_desde >= 2)) e.mayor_desde = 'Desde 2 unidades o más.';
  if (d.precio_adicional != null && !(d.precio_adicional >= 0)) e.precio_adicional = 'Debe ser 0 o mayor.';
  if (!(d.cantidad_total >= 0)) e.cantidad_total = 'La cantidad debe ser 0 o mayor.';
  if (d.volumen_l < 0 || d.peso_kg < 0 || d.largo_cm < 0) e.volumen_l = 'Medidas en 0 o mayores.';
  if (d.imagen === null) e.imagen = 'Pega una URL https o sube una foto.';
  return { datos: d, errores: e };
}

module.exports = { leerEquipo, ESTADOS_EQUIPO };
