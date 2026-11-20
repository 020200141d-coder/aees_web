// ============================================================================
//  sitio/sonido-ui.js — botón de volumen y títulos que suenan
//
//  Usa AeesSonido (public/js/sonido.js) para generar los sonidos.
//  Script clásico (no módulo ES): sus funciones quedan globales para que
//  main.js las arranque y las páginas (portada.js, mi-evento.js…) las usen.
// ============================================================================

/* ------------------------------------------------------------------ */
/* Sonido: botón de volumen del header + títulos que "suenan"          */
/* La primera vez que se activa suena la intro (antes era una pantalla */
/* aparte). Con sonido, cada letra de los títulos toca una nota.       */
/* ------------------------------------------------------------------ */
function initSonidoUI() {
  const btn = $('#btn-sonido');
  const pintar = () => {
    document.body.classList.toggle('sonido-activo', AeesSonido.activo);
    if (!btn) return;
    btn.classList.toggle('activo', AeesSonido.activo);
    btn.setAttribute('aria-pressed', String(AeesSonido.activo));
    btn.setAttribute('aria-label', AeesSonido.activo ? 'Silenciar el sitio' : 'Activar sonido del sitio');
  };
  btn?.addEventListener('click', () => {
    btn.classList.remove('invitar');
    if (AeesSonido.activo) { AeesSonido.desactivar(); toast('info', 'Sonido desactivado'); }
    else {
      AeesSonido.activar();
      AeesSonido.intro();
      $('.hero-logo')?.classList.add('vibrando');
      setTimeout(() => $('.hero-logo')?.classList.remove('vibrando'), 3000);
      toast('success', 'Sonido activado: pasa el mouse por los títulos');
    }
    pintar();
  });
  document.addEventListener('sonido-cambiado', pintar);
  pintar();
  // Invitación discreta (el botón late 3 veces) si la persona nunca eligió.
  let decidio = false;
  try { decidio = localStorage.getItem('aees_sonido') !== null; } catch (e) { /* nada */ }
  if (!decidio) btn?.classList.add('invitar');

  if (conMouse) {
    let ultimo = null;
    document.addEventListener('pointerover', e => {
      const el = e.target.closest('.btn, .filtro, .btn-agregar, .opcion');
      if (el && el !== ultimo) AeesSonido.tick();
      ultimo = el;
    });
  }
}

// Parte el texto de los títulos en <span class="letra"> sin romper su HTML interno
// (por ejemplo el <span class="texto-acento">). Cada letra salta y suena una nota.
function initPalabrasSonoras() {
  if (reducirMovimiento) return;
  const partir = nodo => {
    [...nodo.childNodes].forEach(hijo => {
      if (hijo.nodeType === Node.TEXT_NODE && hijo.textContent.trim()) {
        // Cada palabra va en un span que no se parte: así en el celular una
        // palabra larga baja entera a la siguiente línea (antes se cortaba letra por letra).
        const frag = document.createDocumentFragment();
        hijo.textContent.split(/( +)/).forEach(trozo => {
          if (!trozo) return;
          if (!trozo.trim()) { frag.append(trozo); return; }
          const palabra = document.createElement('span');
          palabra.className = 'palabra';
          [...trozo].forEach(ch => {
            const s = document.createElement('span');
            s.className = 'letra';
            s.textContent = ch;
            palabra.append(s);
          });
          frag.append(palabra);
        });
        hijo.replaceWith(frag);
      } else if (hijo.nodeType === Node.ELEMENT_NODE && !hijo.matches('i, svg, .oculto-accesible')) {
        partir(hijo);
      }
    });
  };
  $$('.seccion-titulo h2, .pagina-titulo h1').forEach(titulo => {
    titulo.setAttribute('aria-label', titulo.textContent.trim());
    partir(titulo);
    $$('.letra', titulo).forEach(l => l.setAttribute('aria-hidden', 'true'));
    $$('.letra', titulo).forEach((letra, i) => letra.addEventListener('pointerenter', () => {
      letra.classList.remove('salta'); void letra.offsetWidth; letra.classList.add('salta');
      AeesSonido.nota(i);
    }));
  });
  // Pasar el mouse por el logo del hero "agita" las ondas.
  const logo = $('.hero-logo');
  logo?.addEventListener('pointerenter', () => { logo.classList.add('vibrando'); AeesSonido.logo(); });
  logo?.addEventListener('pointerleave', () => logo.classList.remove('vibrando'));
}
