// ============================================================================
//  cuenta.js — "Mi cuenta" del cliente
//
//  Botón "Repetir": toma el carrito de una reserva anterior (lo arma el
//  servidor en #datos-repetir: combo + adicionales o equipos sueltos, horas,
//  lugar y acceso vehicular), lo guarda en "Mi evento" con AeesEvento y lleva
//  al cliente allí para que solo elija la nueva fecha. La fecha NO se copia:
//  la anterior ya pasó o está tomada.
// ============================================================================

(function () {
  const datos = document.getElementById('datos-repetir');
  if (!datos || typeof AeesEvento === 'undefined') return;
  const carritos = JSON.parse(datos.textContent);

  document.querySelectorAll('[data-repetir]').forEach(boton => boton.addEventListener('click', () => {
    const c = carritos[boton.dataset.repetir];
    if (!c) return;
    AeesEvento.guardar({ ...c, fecha: null, hora_inicio: null, con_tecnico: false, canje_puntos: 0 });
    window.location.href = '/mi-evento';
  }));
})();
