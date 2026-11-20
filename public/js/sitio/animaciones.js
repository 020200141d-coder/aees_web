// ============================================================================
//  sitio/animaciones.js — efectos visuales
//
//  Aparición al hacer scroll, contadores, texto que se escribe, tilt 3D,
//  botones magnéticos, cursor propio, canvas del hero y parallax.
//  Script clásico (no módulo ES): sus funciones quedan globales para que
//  main.js las arranque y las páginas (portada.js, mi-evento.js…) las usen.
// ============================================================================

/* Aparición al hacer scroll (con retraso escalonado en [data-stagger]) */
function initReveal() {
  $$('[data-stagger]').forEach(grupo => {
    $$(':scope > [data-reveal]', grupo).forEach((el, i) => el.style.setProperty('--delay', `${Math.min(i, 8) * 0.08}s`));
  });
  const observador = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (!entrada.isIntersecting) return;
      const el = entrada.target;
      el.classList.add('visible');
      observador.unobserve(el);
      // Quitamos el retraso después de aparecer: si no, el filtrado y el hover heredarían ese delay.
      setTimeout(() => el.style.setProperty('--delay', '0s'), 1200);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  $$('[data-reveal]').forEach(el => observador.observe(el));
}

/* Contadores animados */
function animarNumero(el, hasta, { desde = 0, duracion = 1800, prefijo = '', sufijo = '' } = {}) {
  if (reducirMovimiento) { el.textContent = `${prefijo}${hasta}${sufijo}`; return; }
  const inicio = performance.now();
  const paso = ahora => {
    const t = Math.min((ahora - inicio) / duracion, 1);
    const suavizado = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // easeOutExpo
    el.textContent = `${prefijo}${Math.round(desde + (hasta - desde) * suavizado)}${sufijo}`;
    if (t < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}
function initContadores() {
  const observador = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (!entrada.isIntersecting) return;
      const el = entrada.target;
      animarNumero(el, Number(el.dataset.contador), { desde: Number(el.dataset.desde || 0), prefijo: el.dataset.prefijo || '' });
      observador.unobserve(el);
    });
  }, { threshold: 0.6 });
  $$('[data-contador]').forEach(el => observador.observe(el));
}

/* Texto que se escribe y borra solo */
function initTyped() {
  const el = $('#typed');
  if (!el || el.dataset.iniciado) return;
  el.dataset.iniciado = '1';
  const roles = JSON.parse(el.dataset.roles || '[]');
  if (reducirMovimiento || !roles.length) { el.textContent = roles[0] || ''; return; }
  let rol = 0, letra = 0, borrando = false;
  const tick = () => {
    const texto = roles[rol];
    letra += borrando ? -1 : 1;
    el.textContent = texto.slice(0, letra);
    let espera = borrando ? 35 : 70;
    if (!borrando && letra === texto.length) { borrando = true; espera = 1800; }
    else if (borrando && letra === 0) { borrando = false; rol = (rol + 1) % roles.length; espera = 350; }
    setTimeout(tick, espera);
  };
  tick();
}


/* Tilt 3D + brillo que sigue al mouse */
function initTilt() {
  if (!conMouse || reducirMovimiento) return;
  const MAX = 6;
  $$('.tilt').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.classList.add('inclinando');
      el.style.setProperty('--ry', `${(px - 0.5) * MAX * 2}deg`);
      el.style.setProperty('--rx', `${(0.5 - py) * MAX * 2}deg`);
      el.style.setProperty('--mx', `${px * 100}%`);
      el.style.setProperty('--my', `${py * 100}%`);
    });
    el.addEventListener('pointerleave', () => { el.classList.remove('inclinando'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  });
}

/* Botones magnéticos */
function initMagneticos() {
  if (!conMouse || reducirMovimiento) return;
  $$('.magnetico').forEach(btn => {
    btn.addEventListener('pointermove', e => {
      const r = btn.getBoundingClientRect();
      btn.style.translate = `${(e.clientX - r.left - r.width / 2) * 0.25}px ${(e.clientY - r.top - r.height / 2) * 0.35}px`;
    });
    btn.addEventListener('pointerleave', () => { btn.style.translate = ''; });
  });
}

/* Cursor personalizado (punto + anillo con inercia) */
function initCursor() {
  if (!conMouse || reducirMovimiento) return;
  const punto = $('.cursor-punto'), anillo = $('.cursor-anillo');
  if (!punto) return;
  let mx = -100, my = -100, ax = -100, ay = -100;
  window.addEventListener('pointermove', e => {
    mx = e.clientX; my = e.clientY;
    punto.style.transform = `translate(${mx}px, ${my}px)`;
    document.body.classList.add('cursor-activo');
  });
  document.addEventListener('pointerleave', () => document.body.classList.remove('cursor-activo'));
  const seguir = () => {
    ax += (mx - ax) * 0.18; ay += (my - ay) * 0.18;
    anillo.style.transform = `translate(${ax}px, ${ay}px)`;
    requestAnimationFrame(seguir);
  };
  seguir();
  document.addEventListener('pointerover', e => {
    document.body.classList.toggle('cursor-hover', Boolean(e.target.closest('a, button, .tilt, input, textarea, select, label')));
  });
}

/* ------------------------------------------------------------------ */
/* Canvas del hero: ecualizador que reacciona al mouse + polvo de escenario */
/* ------------------------------------------------------------------ */
function initCanvasHero() {
  const canvas = $('#hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const hero = canvas.parentElement;
  const oro = getComputedStyle(document.documentElement).getPropertyValue('--primario-rgb').trim() || '245,166,35';
  const coral = getComputedStyle(document.documentElement).getPropertyValue('--secundario-rgb').trim() || '232,120,74';
  let ancho, alto, particulas = [], visible = true, corriendo = false;
  let mouseX = -1, energia = 0;

  const redimensionar = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ancho = hero.clientWidth; alto = hero.clientHeight;
    canvas.width = ancho * dpr; canvas.height = alto * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cantidad = Math.round(Math.min(60, (ancho * alto) / 26000));
    particulas = Array.from({ length: cantidad }, () => ({ x: Math.random() * ancho, y: Math.random() * alto, v: Math.random() * 0.4 + 0.1, r: Math.random() * 1.6 + 0.4 }));
  };

  hero.addEventListener('pointermove', e => { mouseX = e.clientX - hero.getBoundingClientRect().left; energia = 1; });
  hero.addEventListener('pointerleave', () => { mouseX = -1; });

  const dibujar = t => {
    ctx.clearRect(0, 0, ancho, alto);
    energia *= 0.97;
    // Ecualizador: barras de onda; cerca del mouse suben más (como si "tocaras" la música).
    const ancho_barra = 12, barras = Math.floor(ancho / ancho_barra);
    for (let i = 0; i < barras; i++) {
      const x = i * ancho_barra;
      const onda = Math.sin(i * 0.32 + t * 0.0024) * 0.5 + Math.sin(i * 0.11 - t * 0.0014) * 0.5;
      const cerca = mouseX >= 0 ? Math.max(0, 1 - Math.abs(x - mouseX) / 220) * energia : 0;
      const h = ((onda * 0.5 + 0.5) * 0.14 + cerca * 0.3) * alto + 6;
      const color = i % 7 === 0 ? coral : oro;
      ctx.fillStyle = `rgba(${color}, ${0.06 + (onda * 0.5 + 0.5) * 0.08 + cerca * 0.35})`;
      ctx.fillRect(x, alto - h, 7, h);
    }
    // Partículas que suben despacio, como polvo iluminado por los reflectores.
    for (const p of particulas) {
      p.y -= p.v;
      if (p.y < -5) { p.y = alto + 5; p.x = Math.random() * ancho; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${oro}, 0.45)`;
      ctx.fill();
    }
  };
  const bucle = t => { if (!visible || document.hidden) { corriendo = false; return; } dibujar(t); requestAnimationFrame(bucle); };
  const arrancar = () => { if (corriendo || reducirMovimiento) return; corriendo = true; requestAnimationFrame(bucle); };

  redimensionar();
  if (reducirMovimiento) dibujar(0); else arrancar();
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) arrancar(); }).observe(hero);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) arrancar(); });
  window.addEventListener('resize', () => { redimensionar(); if (reducirMovimiento) dibujar(0); });
}

/* Parallax del hero con GSAP (opcional) */
function initParallax() {
  if (reducirMovimiento || !window.gsap || !window.ScrollTrigger || !$('.hero')) return;
  gsap.registerPlugin(ScrollTrigger);
  const disparo = { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.6 };
  // El texto del hero solo sube un poco al bajar (antes BAJABA y se encimaba en las
  // promociones). Ya no se atenúa: en modo día quedaba lavado y no se leía bien.
  gsap.to('.hero-contenido', { yPercent: -6, ease: 'none', scrollTrigger: disparo });
  gsap.to('.hero-foto', { yPercent: 12, ease: 'none', scrollTrigger: { ...disparo } });
}
