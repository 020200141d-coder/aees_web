// ============================================================================
//  main.js — interacciones del sitio público (sin frameworks)
//
//  Reutiliza los módulos del portafolio (header, menú, scroll suave, scroll
//  spy, progreso, reveal, contadores, texto que se escribe, filtros, modal,
//  carrusel, tilt, botones magnéticos, cursor, canvas del hero, parallax y
//  formulario) y suma los del negocio:
//   • initIntro          puerta de entrada con sonido (una vez por sesión)
//   • initAgregar        botón + de cada equipo → "Mi evento"
//   • initCombos         "Reservar este combo"
//   • initDisponibilidad fecha del catálogo → consulta /api/equipos?fecha=
//   • initGaleria        lightbox de los eventos realizados
//   • initSonidoUI       bocina flotante + "tic" al pasar por botones
//
//  Flujo al cargar: DOMContentLoaded → se enganchan los init*(); cuando la
//  intro se cierra (o si no hay intro) se añade body.cargado, que dispara la
//  entrada animada del hero en el CSS.
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

/* ------------------------------------------------------------------ */
/* Intro con sonido (solo portada, una vez por sesión)                */
/* ------------------------------------------------------------------ */
function marcarCargado() {
  if (document.body.classList.contains('cargado')) return;
  document.body.classList.add('cargado');
  initTyped();
}

function initIntro() {
  const intro = $('#intro');
  if (!intro) { marcarCargado(); return; }
  let vista = false;
  try { vista = sessionStorage.getItem('aees_intro') === '1'; } catch (e) { /* sin almacenamiento */ }
  if (vista) { intro.remove(); marcarCargado(); return; }

  document.body.classList.add('sin-scroll');
  const salir = conSonido => {
    try { sessionStorage.setItem('aees_intro', '1'); } catch (e) { /* nada */ }
    if (conSonido) { AeesSonido.activar(); AeesSonido.intro(); }
    intro.classList.add('saliendo');
    document.body.classList.remove('sin-scroll');
    // Esperamos el "golpe" del sonido para que la entrada del hero coincida con el bajo.
    setTimeout(marcarCargado, conSonido ? 1200 : 200);
    setTimeout(() => intro.remove(), 1400);
  };
  $$('[data-intro]', intro).forEach(b => b.addEventListener('click', () => salir(b.dataset.intro === 'sonido')));
  intro.addEventListener('keydown', e => { if (e.key === 'Escape') salir(false); });
  $('[data-intro="sonido"]', intro).focus();
}

/* ------------------------------------------------------------------ */
/* Header: fondo al bajar, se esconde al bajar rápido y vuelve al subir */
/* ------------------------------------------------------------------ */
function initHeader() {
  const header = $('#header');
  const menu = $('#nav-links');
  if (!header) return;
  let ultimoY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    header.classList.toggle('con-fondo', y > 20);
    header.classList.toggle('escondido', y > ultimoY && y > 400 && !menu.classList.contains('abierto'));
    ultimoY = y;
  }, { passive: true });
}

function initMenuMovil() {
  const boton = $('#nav-toggle');
  const menu = $('#nav-links');
  const cerrar = () => { menu?.classList.remove('abierto'); boton?.setAttribute('aria-expanded', 'false'); };
  if (!boton || !menu) return cerrar;
  boton.addEventListener('click', () => boton.setAttribute('aria-expanded', String(menu.classList.toggle('abierto'))));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
  document.addEventListener('click', e => {
    if (menu.classList.contains('abierto') && !menu.contains(e.target) && !boton.contains(e.target)) cerrar();
  });
  return cerrar;
}

/* ------------------------------------------------------------------ */
/* Scroll suave para [data-scroll] + "Cotizar <servicio>" rellena el mensaje */
/* ------------------------------------------------------------------ */
function initScrollSuave(cerrarMenu) {
  document.addEventListener('click', e => {
    const enlace = e.target.closest('a[data-scroll]');
    if (!enlace) return;
    const hash = new URL(enlace.href).hash;
    const destino = hash && document.querySelector(hash);
    if (!destino) return;
    e.preventDefault();
    cerrarMenu();
    destino.scrollIntoView({ behavior: reducirMovimiento ? 'auto' : 'smooth' });
    history.replaceState(null, '', hash);
    if (enlace.dataset.servicio) prellenarMensaje(`Hola AeeS, quiero cotizar ${enlace.dataset.servicio.toLowerCase()} para mi evento. `);
  });
}

function prellenarMensaje(texto) {
  const area = $('#mensaje');
  if (!area) return;
  area.value = texto;
  area.dispatchEvent(new Event('input'));
  setTimeout(() => { area.focus({ preventScroll: true }); area.setSelectionRange(texto.length, texto.length); }, 700);
  toast('success', 'Te dejamos el mensaje empezado ✍️');
}

function initScrollSpy() {
  const enlaces = $$('.nav-links a[data-scroll]');
  if (!enlaces.length) return;
  const observador = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (entrada.isIntersecting) enlaces.forEach(a => a.classList.toggle('activo', a.hash === `#${entrada.target.id}`));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach(s => observador.observe(s));
}

/* Progreso de lectura (barra superior + anillo del botón subir) */
function initProgreso() {
  const barra = $('.progreso-lectura span');
  const botonSubir = $('#volver-arriba');
  let pendiente = false;
  const actualizar = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progreso = max > 0 ? window.scrollY / max : 0;
    barra?.style.setProperty('--progreso', progreso.toFixed(4));
    botonSubir?.style.setProperty('--progreso', progreso.toFixed(4));
    botonSubir?.classList.toggle('visible', window.scrollY > 500);
    pendiente = false;
  };
  window.addEventListener('scroll', () => { if (!pendiente) { pendiente = true; requestAnimationFrame(actualizar); } }, { passive: true });
  actualizar();
  botonSubir?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducirMovimiento ? 'auto' : 'smooth' }));
}

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

/* Indicador deslizante bajo el filtro activo */
function moverIndicador(indicador, activo) {
  if (!indicador || !activo) return;
  indicador.style.setProperty('--x', `${activo.offsetLeft}px`);
  indicador.style.setProperty('--ancho', `${activo.offsetWidth}px`);
}

/* ------------------------------------------------------------------ */
/* Filtros con animación de salida/entrada (catálogo y galería)        */
/* Cada barra [data-filtros="x"] filtra las tarjetas de [data-grid="x"] */
/* ------------------------------------------------------------------ */
const filtroActual = {};
function initFiltros() {
  $$('[data-filtros]').forEach(barra => {
    const nombre = barra.dataset.filtros;
    const botones = $$('.filtro', barra);
    const indicador = $('.filtros-indicador', barra);
    const cards = $$(`[data-grid="${nombre}"] > [data-categoria]`);
    const vacio = $(`[data-vacio="${nombre}"]`);
    filtroActual[nombre] = 'todos';
    let temporizador;

    const aplicar = boton => {
      filtroActual[nombre] = boton.dataset.filtro;
      botones.forEach(b => { b.classList.toggle('activo', b === boton); b.setAttribute('aria-pressed', String(b === boton)); });
      moverIndicador(indicador, boton);
      const coincide = card => filtroActual[nombre] === 'todos' || card.dataset.categoria === filtroActual[nombre];
      cards.forEach(card => { if (!coincide(card)) card.classList.add('saliendo'); });
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        let visibles = 0;
        cards.forEach(card => {
          if (!coincide(card)) { card.hidden = true; return; }
          card.hidden = false;
          card.classList.add('saliendo', 'visible');
          const orden = visibles++;
          setTimeout(() => card.classList.remove('saliendo'), 40 + Math.min(orden, 10) * 60);
        });
        if (vacio) vacio.hidden = visibles > 0;
      }, reducirMovimiento ? 0 : 300);
    };

    botones.forEach(b => b.addEventListener('click', () => aplicar(b)));
    const reposicionar = () => moverIndicador(indicador, $('.filtro.activo', barra));
    reposicionar();
    window.addEventListener('resize', reposicionar);
    document.fonts?.ready.then(reposicionar);
  });
}

/* ------------------------------------------------------------------ */
/* Modal genérico: abrir / cerrar con animación                        */
/* ------------------------------------------------------------------ */
function crearModal(modal, alNavegar) {
  const abrir = () => { modal.showModal(); document.body.classList.add('sin-scroll'); };
  const cerrar = () => {
    if (!modal.open) return;
    modal.classList.add('cerrando');
    setTimeout(() => { modal.classList.remove('cerrando'); modal.close(); document.body.classList.remove('sin-scroll'); }, reducirMovimiento ? 0 : 280);
  };
  $$('[data-cerrar-modal]', modal).forEach(b => b.addEventListener('click', cerrar));
  modal.addEventListener('click', e => { if (e.target === modal) cerrar(); });
  modal.addEventListener('cancel', e => { e.preventDefault(); cerrar(); });
  modal.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') alNavegar?.(1);
    if (e.key === 'ArrowLeft') alNavegar?.(-1);
  });
  return { abrir, cerrar };
}

/* Detalle de equipo con Anterior / Siguiente y "Agregar a mi evento" */
function initModalEquipo() {
  const modal = $('#modal-equipo');
  const datos = JSON.parse($('#datos-equipos')?.textContent || '[]');
  if (!modal || !datos.length) return;
  const cuerpo = $('.modal-cuerpo', modal);
  let indice = 0;
  const visibles = () => datos.filter(e => !filtroActual.equipos || filtroActual.equipos === 'todos' || e.categoria === filtroActual.equipos);

  const pintar = e => {
    // La ilustración o foto se copia de la tarjeta (sin los chips) para no duplicar los SVG.
    const visual = $(`[data-equipo-card="${e.id}"] .equipo-visual`).cloneNode(true);
    $$('.chip', visual).forEach(c => c.remove());
    $('#modal-visual').replaceChildren(...visual.childNodes);
    $('#modal-cat').innerHTML = `<i class="${e.icono}"></i> ${e.categoriaLabel}`;
    const chipEstado = $(`[data-equipo-card="${e.id}"] [data-estado]`);
    $('#modal-estado').className = chipEstado.className.replace('estado', '');
    $('#modal-estado').textContent = chipEstado.textContent;
    $('#modal-titulo').textContent = e.nombre;
    $('#modal-detalle').textContent = e.descripcion;
    const ficha = [
      ['Precio', `${soles(e.precio)} / jornada`],
      e.mayor_desde ? ['Por cantidad', `${soles(e.precio_mayor)} c/u desde ${e.mayor_desde}`] : null,
      e.ajuste_sin_dmx ? ['Sin DMX', `${soles(Number(e.precio) + Number(e.ajuste_sin_dmx))} c/u`] : null,
      ['Marca / modelo', `${e.marca} ${e.modelo}`],
      e.potencia_w ? ['Potencia', `${e.potencia_w} W`] : null,
      e.spl_db ? ['SPL máx.', `${e.spl_db} dB`] : null,
      e.cobertura_personas ? ['Cobertura aprox.', `${e.cobertura_personas} personas c/u`] : null,
      e.dimensiones ? ['Medidas', e.dimensiones] : null,
      e.peso_kg ? ['Peso', `${e.peso_kg} kg`] : null,
      ['En stock', `${e.cantidad_total} unidades`]
    ].filter(Boolean);
    $('#modal-ficha').replaceChildren(...ficha.map(([k, v]) => {
      const d = document.createElement('div');
      d.innerHTML = '<small></small><b></b>';
      d.firstChild.textContent = k; d.lastChild.textContent = v;
      return d;
    }));
    const botonAgregar = $('#modal-agregar');
    botonAgregar.dataset.agregar = e.id;
    botonAgregar.disabled = $(`[data-agregar="${e.id}"]`)?.disabled;
  };

  const navegar = dir => {
    const lista = visibles();
    indice = (indice + dir + lista.length) % lista.length;
    cuerpo.style.setProperty('--dir', `${dir * 40}px`);
    cuerpo.classList.remove('cambiando'); void cuerpo.offsetWidth; cuerpo.classList.add('cambiando');
    pintar(lista[indice]);
  };
  const { abrir } = crearModal(modal, navegar);

  $$('[data-equipo]').forEach(b => b.addEventListener('click', () => {
    const lista = visibles();
    indice = Math.max(0, lista.findIndex(e => e.id === b.dataset.equipo));
    pintar(lista[indice]);
    abrir();
  }));
  $$('[data-modal-nav]', modal).forEach(b => b.addEventListener('click', () => navegar(Number(b.dataset.modalNav))));
}

/* Lightbox de la galería */
function initGaleria() {
  const modal = $('#modal-foto');
  const datos = JSON.parse($('#datos-galeria')?.textContent || '[]');
  if (!modal || !datos.length) return;
  let indice = 0;
  const visibles = () => datos.filter(p => !filtroActual.galeria || filtroActual.galeria === 'todos' || p.tipo === filtroActual.galeria);
  const pintar = p => {
    $('#foto-grande').src = p.imagen;
    $('#foto-grande').alt = p.titulo;
    $('#foto-titulo').textContent = p.titulo;
    $('#foto-texto').textContent = p.texto;
  };
  const navegar = dir => { const l = visibles(); indice = (indice + dir + l.length) % l.length; pintar(l[indice]); };
  const { abrir } = crearModal(modal, navegar);
  $$('[data-foto]').forEach(b => b.addEventListener('click', () => {
    const l = visibles();
    indice = Math.max(0, l.findIndex(p => p.id === b.dataset.foto));
    pintar(l[indice]);
    abrir();
  }));
  $$('[data-foto-nav]', modal).forEach(b => b.addEventListener('click', () => navegar(Number(b.dataset.fotoNav))));
}

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
  gsap.to('.hero-contenido', { yPercent: 22, opacity: 0.15, ease: 'none', scrollTrigger: disparo });
  gsap.to('.hero-foto', { yPercent: 12, ease: 'none', scrollTrigger: { ...disparo } });
}

/* Copiar correo */
function initCopiarEmail() {
  $$('.copiar-email').forEach(btn => btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(btn.dataset.email); toast('success', 'Correo copiado'); }
    catch { window.location.href = `mailto:${btn.dataset.email}`; }
  }));
}

/* ------------------------------------------------------------------ */
/* Agregar equipos y combos a "Mi evento"                              */
/* ------------------------------------------------------------------ */
function initAgregar() {
  const nombres = Object.fromEntries(JSON.parse($('#datos-equipos')?.textContent || '[]').map(e => [e.id, e.nombre]));
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-agregar]');
    if (!b || b.disabled) return;
    e.stopPropagation();
    AeesEvento.agregarEquipo(b.dataset.agregar, 1);
    AeesSonido.confirmar();
    b.classList.add('agregado');
    setTimeout(() => b.classList.remove('agregado'), 900);
    const item = AeesEvento.leer().items.find(x => x.equipo_id === b.dataset.agregar);
    toast('success', `${nombres[b.dataset.agregar] || 'Equipo'} ×${item?.cantidad || 1} en tu evento`);
  });
}

function initCombos() {
  $$('[data-combo]').forEach(b => b.addEventListener('click', async () => {
    const actual = AeesEvento.leer();
    if (actual.combo_id && actual.combo_id !== b.dataset.combo) {
      const r = await alerta({ icon: 'question', title: 'Ya tienes un combo', text: `¿Lo cambiamos por el ${b.dataset.comboNombre}? Los equipos sueltos se mantienen.`, showCancelButton: true, confirmButtonText: 'Sí, cambiar', cancelButtonText: 'No' });
      if (!r.isConfirmed) return;
    }
    AeesEvento.ponerCombo(b.dataset.combo, Number(b.dataset.comboHoras));
    AeesSonido.confirmar();
    window.location.href = '/mi-evento';
  }));
}

/* Fecha del catálogo → disponibilidad real por equipo */
function initDisponibilidad() {
  const input = $('#fecha-catalogo');
  if (!input) return;
  const fechaGuardada = AeesEvento.leer().fecha;
  if (fechaGuardada && fechaGuardada >= input.min) input.value = fechaGuardada;

  const consultar = async () => {
    if (!input.value) return;
    AeesEvento.actualizar({ fecha: input.value });
    const r = await aeesFetch(`/api/equipos?fecha=${input.value}`);
    if (!r.ok) return toast('error', r.error || 'No se pudo consultar la disponibilidad');
    r.equipos.forEach(e => {
      const card = $(`[data-equipo-card="${e.id}"]`);
      if (!card) return;
      const chip = $('[data-estado]', card);
      const libre = e.libres > 0;
      chip.className = `chip estado ${libre ? 'chip-ok' : 'chip-no'}`;
      chip.textContent = libre ? `Libres: ${e.libres}` : 'Ocupado esa fecha';
      $('[data-agregar]', card).disabled = !libre;
    });
    toast('info', 'Disponibilidad actualizada para tu fecha');
  };
  input.addEventListener('change', consultar);
  if (input.value) consultar();
}

/* ------------------------------------------------------------------ */
/* Formulario de contacto → POST /api/contacto (o WhatsApp)            */
/* ------------------------------------------------------------------ */
function initFormulario() {
  const form = $('#form-contacto');
  if (!form) return;
  const boton = $('button[type="submit"]', form);
  const contador = $('#contador');
  let intentado = false;

  const reglas = {
    nombre: v => (v.length >= 2 ? '' : 'Escribe tu nombre.'),
    telefono: v => (v.replace(/\D/g, '').length >= 9 ? '' : 'Déjanos un celular de 9 dígitos.'),
    mensaje: v => (v.length >= 10 ? '' : 'Cuéntanos un poco más (mínimo 10 caracteres).')
  };
  const marcar = (nombre, error) => {
    const campo = form.elements[nombre].closest('.campo');
    campo.classList.toggle('error', Boolean(error));
    $('.campo-error', campo).textContent = error;
    if (error) { campo.classList.remove('sacudir'); void campo.offsetWidth; campo.classList.add('sacudir'); }
  };
  const validar = () => Object.entries(reglas).map(([n, r]) => { const err = r(form.elements[n].value.trim()); marcar(n, err); return !err; }).every(Boolean);

  form.addEventListener('input', e => {
    if (e.target.name === 'mensaje') contador.textContent = e.target.value.length;
    if (intentado && reglas[e.target.name]) {
      const campo = e.target.closest('.campo');
      const err = reglas[e.target.name](e.target.value.trim());
      campo.classList.toggle('error', Boolean(err));
      $('.campo-error', campo).textContent = err;
    }
  });

  const limpiar = () => { form.reset(); contador.textContent = '0'; intentado = false; };

  $('#enviar-wa')?.addEventListener('click', () => {
    intentado = true;
    if (!validar()) return toast('warning', 'Revisa los campos marcados');
    const d = Object.fromEntries(new FormData(form));
    const numero = $('a.wa-flotante').href.match(/wa\.me\/(\d+)/)[1];
    const texto = `Hola AeeS, soy ${d.nombre} (${d.telefono}).${d.fecha_evento ? ` Mi evento es el ${d.fecha_evento}.` : ''}\n\n${d.mensaje}`;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    limpiar();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    intentado = true;
    if (!validar()) return toast('warning', 'Revisa los campos marcados');
    const datos = Object.fromEntries(new FormData(form));
    boton.classList.add('cargando');
    try {
      const r = await aeesFetch('/api/contacto', { method: 'POST', body: datos });
      if (r.ok) {
        limpiar();
        await alerta({ icon: 'success', title: `¡Gracias, ${datos.nombre.split(' ')[0]}!`, text: 'Recibimos tu mensaje. Te respondemos por WhatsApp lo antes posible.', confirmButtonText: 'Genial' });
      } else {
        Object.entries(r.campos || {}).forEach(([n, err]) => form.elements[n] && marcar(n, err));
        alerta({ icon: r.status === 429 ? 'warning' : 'error', title: 'No se pudo enviar', text: r.error });
      }
    } catch {
      const r = await alerta({ icon: 'error', title: 'Sin conexión', text: '¿Prefieres escribirnos por WhatsApp?', showCancelButton: true, confirmButtonText: 'Abrir WhatsApp', cancelButtonText: 'Cerrar' });
      if (r?.isConfirmed) window.open($('a.wa-flotante').href, '_blank', 'noopener');
    } finally {
      boton.classList.remove('cargando');
    }
  });
}

/* Bocina flotante + "tic" al pasar sobre botones cuando el sonido está activo */
function initSonidoUI() {
  const btn = $('#btn-sonido');
  const pintar = () => {
    if (!btn) return;
    btn.classList.toggle('activo', AeesSonido.activo);
    btn.setAttribute('aria-pressed', String(AeesSonido.activo));
    btn.innerHTML = `<i class="fa-solid fa-volume-${AeesSonido.activo ? 'high' : 'xmark'}"></i>`;
  };
  btn?.addEventListener('click', () => {
    if (AeesSonido.activo) AeesSonido.desactivar();
    else { AeesSonido.activar(); AeesSonido.confirmar(); }
    pintar();
  });
  document.addEventListener('sonido-cambiado', pintar);
  pintar();
  if (conMouse) {
    let ultimo = null;
    document.addEventListener('pointerover', e => {
      const el = e.target.closest('.btn, .filtro, .btn-agregar, .opcion');
      if (el && el !== ultimo) AeesSonido.tick();
      ultimo = el;
    });
  }
}

/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  initIntro();
  initHeader();
  const cerrarMenu = initMenuMovil();
  initScrollSuave(cerrarMenu);
  initScrollSpy();
  initProgreso();
  initReveal();
  initContadores();
  initFiltros();
  initModalEquipo();
  initGaleria();
  initCarrusel();
  initTilt();
  initMagneticos();
  initCursor();
  initCanvasHero();
  initParallax();
  initCopiarEmail();
  initAgregar();
  initCombos();
  initDisponibilidad();
  initFormulario();
  initSonidoUI();
});
