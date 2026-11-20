// ============================================================================
//  src/validadores/ajustes.js — formularios de Ajustes del negocio
//
//  Cada función recibe el body y lo que ya estaba guardado, y devuelve
//  { datos, error } donde `error` es el texto a mostrar (o null). Los
//  ajustes se editan por bloques y se parte de lo guardado para no perder
//  valores que el formulario no muestra.
// ============================================================================

const crypto = require('node:crypto');
const { texto, numero } = require('../lib/util');
const { entero, urlImagen, filas } = require('./formulario');

// Datos públicos del negocio (WhatsApp, almacén, Yape/Plin, cláusulas…).
function leerNegocio(b, actual = {}) {
  const errores = [];
  const whatsapp = String(b.whatsapp || '').replace(/\D/g, '');
  if (!/^51\d{9}$/.test(whatsapp)) errores.push('WhatsApp: código de país 51 + 9 dígitos (ej. 51987166001).');
  const lat = numero(b.almacen_lat, NaN), lng = numero(b.almacen_lng, NaN);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) errores.push('Ubicación del almacén inválida.');
  if (errores.length) return { datos: null, error: errores.join(' ') };
  return {
    error: null,
    datos: {
      ...actual,
      nombre: texto(b.nombre, 80) || actual.nombre,
      eslogan: texto(b.eslogan, 120),
      descripcion: texto(b.descripcion, 400),
      telefono: String(b.telefono || '').replace(/\D/g, '').slice(0, 12),
      whatsapp,
      correo: texto(b.correo, 120),
      direccion: texto(b.direccion, 160),
      horario: texto(b.horario, 80),
      eventos_realizados: Math.max(0, Math.round(numero(b.eventos_realizados, 0))) || null,
      redes: { instagram: urlImagen(b.instagram) ?? '', facebook: urlImagen(b.facebook) ?? '', tiktok: urlImagen(b.tiktok) ?? '' },
      almacen: { lat, lng, direccion: texto(b.almacen_direccion, 160) },
      yape: { numero: String(b.yape_numero || '').replace(/\D/g, '').slice(0, 9), titular: texto(b.yape_titular, 80), qr_url: urlImagen(b.yape_qr) || '' },
      plin: { numero: String(b.plin_numero || '').replace(/\D/g, '').slice(0, 9), titular: texto(b.plin_titular, 80), qr_url: urlImagen(b.plin_qr) || '' },
      // Una condición por línea. Vacío = se usan las condiciones por defecto (servicios/negocio.js).
      clausulas: String(b.clausulas || '').split(/\r?\n/).map(l => texto(l, 300)).filter(l => l.length > 3).slice(0, 12)
    }
  };
}

// Reglas de precios, transporte y puntos (con sus rangos permitidos).
function leerReglas(b, actuales = {}) {
  const r = {
    ...actuales,
    adelanto_pct: numero(b.adelanto_pct, NaN),
    horas_bloqueo: entero(b.horas_bloqueo, NaN),
    horas_jornada: entero(b.horas_jornada, NaN),
    factor_hora_extra: numero(b.factor_hora_extra, NaN),
    tecnico_por_evento: numero(b.tecnico_por_evento, NaN),
    descuento_frecuente_pct: numero(b.descuento_frecuente_pct, NaN),
    reservas_para_frecuente: entero(b.reservas_para_frecuente, NaN),
    vehiculos_transporte_gratis: [].concat(b.vehiculos_transporte_gratis || []).map(v => texto(v, 20)).filter(Boolean),
    km_transporte_gratis: numero(b.km_transporte_gratis, NaN),
    altura_max_gratis_m: entero(b.altura_max_gratis_m, NaN),
    recargo_sin_acceso: numero(b.recargo_sin_acceso, NaN),
    // Puntos por frecuencia (ver src/servicios/puntos.js)
    puntos_cada_soles: numero(b.puntos_cada_soles, NaN),
    puntos_canje: entero(b.puntos_canje, NaN),
    soles_canje: numero(b.soles_canje, NaN)
  };
  delete r.factor_jornada_extra; delete r.tecnico_por_jornada; // nombres de la versión anterior
  const ok = r.adelanto_pct >= 10 && r.adelanto_pct <= 100 && r.horas_bloqueo >= 1 && r.horas_bloqueo <= 168 && r.horas_jornada >= 1 && r.horas_jornada <= 12 &&
    r.factor_hora_extra >= 0 && r.factor_hora_extra <= 2 && r.tecnico_por_evento >= 0 && r.descuento_frecuente_pct >= 0 && r.descuento_frecuente_pct <= 50 && r.reservas_para_frecuente >= 1 &&
    r.km_transporte_gratis >= 0 && r.km_transporte_gratis <= 200 && r.altura_max_gratis_m >= 0 && r.altura_max_gratis_m <= 6000 && r.recargo_sin_acceso >= 0 &&
    r.puntos_cada_soles >= 1 && r.puntos_canje >= 1 && r.soles_canje >= 0;
  return ok
    ? { datos: r, error: null }
    : { datos: null, error: 'Revisa los valores: adelanto 10–100 %, bloqueo 1–168 h, horas del evento 1–12, factor 0–2, descuento 0–50 %, km 0–200, altura 0–6000 m.' };
}

// Vehículos y tarifas de transporte.
function leerVehiculos(b) {
  const vehiculos = filas(b.vehiculos).map(v => ({
    id: texto(v.id, 20) || crypto.randomUUID().slice(0, 6),
    nombre: texto(v.nombre, 60),
    descripcion: texto(v.descripcion, 200),
    capacidad_l: numero(v.capacidad_l, NaN),
    capacidad_kg: numero(v.capacidad_kg, NaN),
    largo_max_cm: numero(v.largo_max_cm, NaN),
    base: numero(v.base, NaN),
    por_km: numero(v.por_km, NaN)
  })).filter(v => v.nombre);
  const valido = vehiculos.length && vehiculos.every(v => ['capacidad_l', 'capacidad_kg', 'largo_max_cm', 'base', 'por_km'].every(k => v[k] >= 0));
  return valido ? { datos: vehiculos, error: null } : { datos: null, error: 'Cada vehículo necesita nombre y valores numéricos de 0 o más.' };
}

// Fotos de la portada (la de fondo es obligatoria).
function leerPortada(b) {
  const p = {};
  for (const k of ['hero', 'boda', 'electronica', 'corporativo']) p[k] = urlImagen(b[k]) || '';
  if (!p.hero) return { datos: null, error: 'La foto de fondo de la portada necesita una URL válida o una foto subida.' };
  p.fuentes = texto(b.fuentes, 200);
  return { datos: p, error: null };
}

module.exports = { leerNegocio, leerReglas, leerVehiculos, leerPortada };
