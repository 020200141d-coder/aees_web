// util.js — pequeñas funciones compartidas por servicios, rutas y vistas.

const crypto = require('node:crypto');

// 1234.5 → "S/ 1,234.50"
const soles = n => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const redondear = n => Math.round(Number(n || 0) * 100) / 100;

// Código corto y legible para que el cliente lo dicte por WhatsApp (sin 0/O ni 1/I).
function codigoReserva() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(5);
  return 'AEES-' + Array.from(bytes, b => letras[b % letras.length]).join('');
}

// "2026-11-15" → "domingo 15 de noviembre de 2026" (zona horaria de Lima)
function fechaLarga(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00-05:00`);
  return d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Lima' });
}

// Fecha de hoy en Lima como "YYYY-MM-DD" (los servidores de Render están en UTC).
const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

const texto = (v, max = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const numero = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const CATEGORIAS = {
  audio: { label: 'Audio', icono: 'fa-solid fa-volume-high' },
  iluminacion: { label: 'Iluminación', icono: 'fa-solid fa-lightbulb' },
  video: { label: 'Video', icono: 'fa-solid fa-tv' },
  electrico: { label: 'Eléctrico', icono: 'fa-solid fa-bolt' },
  estructura: { label: 'Estructura', icono: 'fa-solid fa-cubes' }
};

const TIPOS_EVENTO = {
  cumpleanos: { label: 'Cumpleaños', icono: 'fa-solid fa-cake-candles' },
  boda: { label: 'Boda', icono: 'fa-solid fa-ring' },
  quinceanero: { label: 'Quinceañero', icono: 'fa-solid fa-crown' },
  fiesta: { label: 'Fiesta / baile', icono: 'fa-solid fa-champagne-glasses' },
  fiesta_electronica: { label: 'Fiesta electrónica', icono: 'fa-solid fa-headphones' },
  concierto: { label: 'Concierto', icono: 'fa-solid fa-guitar' },
  graduacion: { label: 'Graduación / promoción', icono: 'fa-solid fa-graduation-cap' },
  corporativo: { label: 'Evento corporativo', icono: 'fa-solid fa-briefcase' },
  conferencia: { label: 'Conferencia / misa / charla', icono: 'fa-solid fa-microphone-lines' },
  otro: { label: 'Otro', icono: 'fa-solid fa-star' }
};

const ESTADOS_RESERVA = {
  pendiente_pago: 'Pendiente de adelanto',
  adelanto_pagado: 'Adelanto pagado',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada: 'Cancelada',
  expirada: 'Expirada'
};

module.exports = { soles, redondear, codigoReserva, fechaLarga, hoyLima, texto, numero, CATEGORIAS, TIPOS_EVENTO, ESTADOS_RESERVA };
