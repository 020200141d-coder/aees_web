// ============================================================================
//  sitio/carrusel.js — carrusel de servicios (flechas, puntos, arrastre y autoplay)
//
//  Script clásico (no módulo ES): sus funciones quedan globales para que
//  main.js las arranque y las páginas (portada.js, mi-evento.js…) las usen.
// ============================================================================

/* ------------------------------------------------------------------ */
/* Carrusel de servicios: flechas, puntos, arrastre y autoplay        */
/* ------------------------------------------------------------------ */
function initCarrusel() {
  const carrusel = $('#carrusel');
  if (!carrusel) return;
  const pista = $('.carrusel-pista', carrusel);
  const cards = $$('.servicio-card', pista);
  const puntos = $('#carrusel-puntos');
  let indice = 0, paginas = 1, paso = 0, autoplay;

  const medir = () => {
    const estilos = getComputedStyle(carrusel);
    const porVista = Number(estilos.getPropertyValue('--por-vista')) || 1;
    const gap = parseFloat(estilos.getPropertyValue('--gap')) || 0;
    paso = cards[0].getBoundingClientRect().width + gap;
    paginas = Math.max(1, cards.length - porVista + 1);
    indice = Math.min(indice, paginas - 1);
    puntos.replaceChildren(...Array.from({ length: paginas }, (_, i) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', `Ir a la posición ${i + 1}`);
      b.addEventListener('click', () => { ir(i); reiniciar(); });
      return b;
    }));
    ir(indice, false);
  };
  const ir = (i, animar = true) => {
    indice = (i + paginas) % paginas;
    if (!animar) pista.style.transition = 'none';
    pista.style.transform = `translateX(${-indice * paso}px)`;
    if (!animar) requestAnimationFrame(() => { pista.style.transition = ''; });
    $$('button', puntos).forEach((b, j) => b.setAttribute('aria-selected', String(j === indice)));
  };
  const reiniciar = () => { clearInterval(autoplay); if (!reducirMovimiento) autoplay = setInterval(() => ir(indice + 1), 5000); };
  const pausar = () => clearInterval(autoplay);

  $('[data-carrusel-prev]').addEventListener('click', () => { ir(indice - 1); reiniciar(); });
  $('[data-carrusel-next]').addEventListener('click', () => { ir(indice + 1); reiniciar(); });
  carrusel.addEventListener('mouseenter', pausar);
  carrusel.addEventListener('mouseleave', reiniciar);
  carrusel.addEventListener('focusin', pausar);

  // Arrastrar con el mouse o deslizar con el dedo.
  let inicioX = 0, deltaX = 0, arrastrando = false, huboArrastre = false;
  carrusel.addEventListener('pointerdown', e => { if (e.button !== 0) return; arrastrando = true; huboArrastre = false; inicioX = e.clientX; deltaX = 0; pausar(); });
  window.addEventListener('pointermove', e => {
    if (!arrastrando) return;
    deltaX = e.clientX - inicioX;
    if (Math.abs(deltaX) > 5 && !huboArrastre) { huboArrastre = true; carrusel.classList.add('arrastrando'); }
    if (huboArrastre) pista.style.transform = `translateX(${-indice * paso + deltaX}px)`;
  });
  window.addEventListener('pointerup', () => {
    if (!arrastrando) return;
    arrastrando = false;
    carrusel.classList.remove('arrastrando');
    ir(Math.abs(deltaX) > 60 ? indice + (deltaX < 0 ? 1 : -1) : indice);
    reiniciar();
  });
  carrusel.addEventListener('click', e => { if (huboArrastre) { e.preventDefault(); e.stopPropagation(); } }, true);
  new IntersectionObserver(([en]) => (en.isIntersecting ? reiniciar() : pausar()), { threshold: 0.4 }).observe(carrusel);
  medir();
  let espera;
  window.addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(medir, 150); });
}
