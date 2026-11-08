// ============================================================================
//  src/servicios/resenas.js — reseñas (comentarios) de clientes reales
//
//  ¿De dónde salen?
//   • El cliente, desde "Mi cuenta", puede dejar UNA reseña por cada evento
//     COMPLETADO. Llega como "pendiente" y el admin la aprueba (o la borra)
//     en Admin → Reseñas antes de que salga en la portada.
//   • El admin también puede escribir una reseña que un cliente le dejó por
//     WhatsApp o en persona (con su permiso).
//  Nunca se inventan reseñas: si no hay ninguna publicada, la portada no
//  muestra la sección de reseñas (solo las fotos de eventos).
//
//  Se guardan en la tabla `ajustes` (clave "resenas", un arreglo JSON): así no
//  hace falta crear otra tabla en Supabase.
//  Forma: { id, nombre, evento, texto, estrellas (1–5), publicado, origen,
//           reserva_codigo, usuario_id, creado_en, orden }
// ============================================================================

const crypto = require('node:crypto');
const db = require('../db');
const { texto } = require('../lib/util');

async function todas() {
  const lista = (await db.ajuste('resenas')) || [];
  return Array.isArray(lista) ? lista : [];
}

async function publicadas() {
  return (await todas()).filter(r => r.publicado).sort((a, b) => (a.orden || 0) - (b.orden || 0) || String(b.creado_en).localeCompare(String(a.creado_en)));
}

// Limpia lo que llega de un formulario. Devuelve { datos, errores }.
function validar(b = {}) {
  const datos = {
    nombre: texto(b.nombre, 60),
    evento: texto(b.evento, 80),
    texto: String(b.texto || '').trim().replace(/\s+/g, ' ').slice(0, 500),
    estrellas: Math.min(5, Math.max(1, Math.round(Number(b.estrellas) || 5)))
  };
  const errores = {};
  if (datos.nombre.length < 2) errores.nombre = 'Escribe el nombre.';
  if (datos.texto.length < 10) errores.texto = 'Escribe al menos una frase (10 letras).';
  return { datos, errores };
}

async function guardarTodas(lista) {
  await db.guardarAjuste('resenas', lista);
}

async function agregar(datos, extra = {}) {
  const lista = await todas();
  const nueva = { id: crypto.randomUUID().slice(0, 12), ...datos, publicado: false, orden: 0, creado_en: new Date().toISOString(), ...extra };
  lista.push(nueva);
  await guardarTodas(lista);
  return nueva;
}

async function actualizar(id, cambios) {
  const lista = await todas();
  const i = lista.findIndex(r => r.id === id);
  if (i < 0) return null;
  lista[i] = { ...lista[i], ...cambios, id };
  await guardarTodas(lista);
  return lista[i];
}

async function eliminar(id) {
  await guardarTodas((await todas()).filter(r => r.id !== id));
}

module.exports = { todas, publicadas, validar, agregar, actualizar, eliminar };
