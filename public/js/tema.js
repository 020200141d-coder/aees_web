// ============================================================================
//  tema.js — botón modo día / noche del PANEL de administración.
//  (El sitio público tiene el mismo comportamiento en main.js → initTema.)
//
//  Flujo: _inicio.ejs pone html[data-tema] antes de pintar (leyendo
//  localStorage 'aees_tema'), así no hay parpadeo. Al tocar el botón
//  [data-cambiar-tema] se alterna el tema y se guarda la elección; como la
//  clave es la misma que la del sitio, el panel y la web quedan iguales.
// ============================================================================
(function () {
  const raiz = document.documentElement;
  const botones = document.querySelectorAll('[data-cambiar-tema]');
  if (!botones.length) return;

  // Actualiza el texto y la accesibilidad del botón según el tema actual.
  function pintar() {
    const dia = raiz.dataset.tema === 'dia';
    botones.forEach(b => {
      b.setAttribute('aria-pressed', String(dia));
      const texto = b.querySelector('.tema-texto');
      if (texto) texto.textContent = dia ? 'Modo noche' : 'Modo día';
    });
  }

  botones.forEach(b => b.addEventListener('click', () => {
    const tema = raiz.dataset.tema === 'dia' ? 'noche' : 'dia';
    raiz.classList.add('cambiando-tema');            // transición suave solo durante el cambio
    raiz.dataset.tema = tema;
    try { localStorage.setItem('aees_tema', tema); } catch (e) { /* sin almacenamiento */ }
    pintar();
    setTimeout(() => raiz.classList.remove('cambiando-tema'), 450);
  }));
  pintar();
})();
