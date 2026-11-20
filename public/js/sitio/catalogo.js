// ============================================================================
//  sitio/catalogo.js — catálogo, combos y "Mi evento"
//
//  Filtros animados, modal de detalle de equipo, agregar equipos y combos
//  al evento y disponibilidad por fecha (/api/equipos?fecha=).
//  Script clásico (no módulo ES): sus funciones quedan globales para que
//  main.js las arranque y las páginas (portada.js, mi-evento.js…) las usen.
// ============================================================================

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
      ['Precio', `${soles(e.precio)} por evento`],
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
    // Crédito de la foto (las licencias CC piden autor, licencia y enlace).
    const credito = $('#modal-credito');
    credito.hidden = !e.imagen_fuente;
    credito.replaceChildren();
    if (e.imagen_fuente) {
      const enlace = document.createElement(e.imagen_fuente_url ? 'a' : 'span');
      enlace.textContent = e.imagen_fuente;
      if (e.imagen_fuente_url) Object.assign(enlace, { href: e.imagen_fuente_url, target: '_blank', rel: 'noopener' });
      credito.append(enlace);
    }
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
