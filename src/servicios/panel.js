// ============================================================================
//  src/servicios/panel.js — datos generales del panel de administración
//
//  • pendientes(): contadores del menú lateral (mensajes sin leer, Yape por
//    revisar, reseñas de clientes por publicar)
//  • agenda(): lo que muestra la página de Inicio (calendario del mes,
//    próximos eventos, solicitudes y cifras)
//  • mensajes: lista, marcar leído y eliminar
//  • guardarFoto(): valida una foto en base64 y la guarda (disco o Supabase Storage)
// ============================================================================

const crypto = require('node:crypto');
const db = require('../db');
const resenas = require('./resenas');
const { ErrorNegocio } = require('../lib/errores');

const ESTADOS_INACTIVOS = ['cancelada', 'expirada'];

async function pendientes() {
  const [msjs, pagos] = await Promise.all([db.listar('mensajes', { filtro: { leido: false } }), db.listar('pagos', { filtro: { estado: 'pendiente' } })]);
  return {
    mensajes: msjs.length,
    yape: pagos.filter(p => p.metodo === 'yape').length,
    resenas: (await resenas.todas()).filter(x => !x.publicado && x.origen === 'cliente').length
  };
}

// `mes` = 'AAAA-MM' que se ve en el calendario; `hoy` = fecha de Lima.
async function agenda(mes, hoy) {
  const [reservas, mensajes, pagos, equipos, combos] = await Promise.all([
    db.listar('reservas', { orden: 'fecha_evento' }),
    db.listar('mensajes', { orden: 'creado_en', desc: true }),
    db.listar('pagos', { orden: 'creado_en', desc: true }),
    db.listar('equipos'),
    db.listar('combos')
  ]);
  const activas = reservas.filter(r => !ESTADOS_INACTIVOS.includes(r.estado));
  return {
    delMes: activas.filter(r => r.fecha_evento.startsWith(mes)),
    proximas: activas.filter(r => r.fecha_evento >= hoy && r.estado !== 'completada').slice(0, 12),
    solicitudes: mensajes.filter(m => m.tipo === 'fecha_ocupada' && !m.leido),
    yapePendientes: pagos.filter(p => p.metodo === 'yape' && p.estado === 'pendiente').map(p => ({ ...p, reserva: reservas.find(r => r.id === p.reserva_id) })),
    stats: {
      porPagar: activas.filter(r => r.estado === 'pendiente_pago').length,
      confirmadas: activas.filter(r => ['adelanto_pagado', 'confirmada'].includes(r.estado) && r.fecha_evento >= hoy).length,
      adelantosMes: pagos.filter(p => p.estado === 'aprobado' && (p.creado_en || '').startsWith(hoy.slice(0, 7))).reduce((s, p) => s + Number(p.monto), 0),
      equipos: equipos.length,
      combos: combos.filter(c => c.publicado).length
    }
  };
}

// ── Mensajes ───────────────────────────────────────────────────────────────
const mensajes = () => db.listar('mensajes', { orden: 'creado_en', desc: true });

async function alternarLeido(id) {
  const m = await db.obtener('mensajes', id);
  if (m) await db.actualizar('mensajes', m.id, { leido: !m.leido });
}

const eliminarMensaje = id => db.eliminar('mensajes', id);

// ── Fotos ──────────────────────────────────────────────────────────────────
// El navegador ya reduce la foto a máx. 1600 px y la manda en base64.
const TIPOS_FOTO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_FOTO = 4 * 1024 * 1024;

async function guardarFoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw new ErrorNegocio('Solo se aceptan fotos JPG, PNG o WEBP.', 400);
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_FOTO) throw new ErrorNegocio('La foto pesa más de 4 MB incluso reducida.', 400);
  const nombre = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${TIPOS_FOTO[m[1]]}`;
  return db.guardarFoto(nombre, buffer, m[1]);
}

module.exports = { pendientes, agenda, mensajes, alternarLeido, eliminarMensaje, guardarFoto };
