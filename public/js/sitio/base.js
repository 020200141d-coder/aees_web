// ============================================================================
//  sitio/base.js — utilidades comunes del sitio público
//
//  Atajos $ y $$, preferencias del usuario (movimiento reducido, mouse),
//  formato de soles y alertas (SweetAlert2 con plan B si el CDN no carga).
//  Se carga PRIMERO: los demás módulos usan estas funciones.
//  Script clásico (no módulo ES): sus funciones quedan globales para que
//  main.js las arranque y las páginas (portada.js, mi-evento.js…) las usen.
// ============================================================================

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const conMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const soles = n => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ------------------------------------------------------------------ */
/* Alertas: SweetAlert2 con plan B si el CDN no cargó                 */
/* ------------------------------------------------------------------ */
const hayAlertas = typeof window.Swal !== 'undefined';
const Toast = hayAlertas
  ? Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2600, timerProgressBar: true })
  : null;
function toast(icon, title) {
  if (Toast) return Toast.fire({ icon, title });
  console.info(title);
}
function alerta(opciones) {
  if (hayAlertas) return Swal.fire({ confirmButtonText: 'Entendido', ...opciones });
  window.alert(`${opciones.title}\n\n${opciones.text || ''}`);
  return Promise.resolve({ isConfirmed: true });
}
window.aeesToast = toast;
window.aeesAlerta = alerta;
