// ============================================================================
//  portada.js — lo propio de la portada (diseño "B")
//
//   • Cotizador rápido del hero: en cada cambio (con una pausa de 250 ms para
//     no consultar por cada tecla) pide POST /api/cotizacion-rapida y muestra
//     "Desde S/ …", el paquete sugerido, si va con transporte incluido y, si
//     hay fecha, si está disponible. "Reservar este paquete" lo pone en
//     "Mi evento"; "Ver propuesta completa" abre el asistente con los mismos datos.
//   • Cotizador con IA: los ejemplos rellenan el texto (el formulario envía a /asistente?texto=…).
//   • Promociones: copiar el código.
//   • Presentación de fotos de eventos: cambia sola cada 2 segundos; se pausa
//     al pasar el mouse y si la persona pidió "reducir movimiento".
// ============================================================================

(function () {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  // ── Cotizador rápido ──────────────────────────────────────────────────────
  const form = $('#cotizador-rapido');
  if (form) {
    let ultima = null, pausa;
    const leer = () => ({
      tipo_evento: form.tipo_evento.value,
      personas: Number(form.personas.value),
      espacio: form.espacio.value,
      acceso_vehicular: form.acceso_vehicular.value === 'si',
      fecha: form.fecha.value || null
    });

    async function consultar() {
      const datos = leer();
      $('#rapido-precio').classList.add('cargando');
      const r = await aeesFetch('/api/cotizacion-rapida', { method: 'POST', body: datos });
      $('#rapido-precio').classList.remove('cargando');
      if (!r.ok) { $('#rapido-detalle').textContent = r.error || 'No pudimos calcular. Prueba el asistente.'; return; }
      ultima = { ...r, datos };
      $('#rapido-nombre').textContent = r.nombre;
      $('#rapido-precio').innerHTML = `Desde <b>${r.desde_texto}</b> <small>/ ${r.horas} h</small>`;
      const notas = [
        r.resumen,
        r.transporte_incluido ? '✓ Transporte incluido en Cusco' : r.sin_acceso ? 'Sin acceso vehicular: se suma la carga a mano' : 'Transporte según la distancia',
        r.disponible === true ? '✓ Disponible esa fecha' : r.disponible === false ? 'Esa fecha está ocupada: te ofrecemos un aliado' : ''
      ].filter(Boolean);
      $('#rapido-detalle').innerHTML = notas.map(n => `<span>${n.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>`).join('');
      $('#rapido-asistente').href = r.url_asistente;
      $('#rapido-reservar').hidden = !r.combo_id;
    }

    form.addEventListener('input', e => {
      if (e.target.name === 'personas') form.personas_valor.value = e.target.value;
      clearTimeout(pausa);
      pausa = setTimeout(consultar, 250);
    });
    form.addEventListener('submit', e => e.preventDefault());

    $('#rapido-reservar').addEventListener('click', () => {
      if (!ultima?.combo_id) return;
      const d = ultima.datos;
      AeesEvento.ponerCombo(ultima.combo_id, ultima.horas);
      AeesEvento.actualizar({ tipo_evento: d.tipo_evento, personas: d.personas, espacio: d.espacio, fecha: d.fecha, acceso_vehicular: d.acceso_vehicular });
      window.AeesSonido?.confirmar?.();
      window.location.href = '/mi-evento';
    });
    consultar();
  }

  // ── Cotizador con IA: ejemplos ────────────────────────────────────────────
  $$('[data-ejemplo-ia]').forEach(b => b.addEventListener('click', () => {
    const t = $('#texto-ia');
    t.value = b.dataset.ejemploIa;
    t.focus();
  }));
  $('.cotizador-ia')?.addEventListener('submit', e => {
    if ($('#texto-ia').value.trim().length < 8) { e.preventDefault(); aeesToast('info', 'Cuéntanos un poco de tu evento'); }
  });

  // ── Promociones: copiar código ────────────────────────────────────────────
  $$('[data-copiar-codigo]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copiarCodigo); aeesToast('success', `Código ${b.dataset.copiarCodigo} copiado: pégalo en "Mi evento"`); } catch { aeesToast('info', b.dataset.copiarCodigo); }
  }));

  // ── Presentación de fotos (cada 2 s) ──────────────────────────────────────
  const caja = $('#presentacion');
  const fotos = caja ? $$('.diapositiva', caja) : [];
  if (fotos.length > 1) {
    const puntos = $$('.presentacion-puntos span', caja);
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let i = 0, timer = null;
    const mostrar = n => {
      fotos[i].classList.remove('activa'); fotos[i].setAttribute('aria-hidden', 'true'); puntos[i]?.classList.remove('activo');
      i = (n + fotos.length) % fotos.length;
      fotos[i].classList.add('activa'); fotos[i].setAttribute('aria-hidden', 'false'); puntos[i]?.classList.add('activo');
    };
    const iniciar = () => { if (!quieto && !timer) timer = setInterval(() => mostrar(i + 1), 2000); };
    const parar = () => { clearInterval(timer); timer = null; };
    caja.addEventListener('mouseenter', parar);
    caja.addEventListener('mouseleave', iniciar);
    caja.addEventListener('click', () => mostrar(i + 1));
    document.addEventListener('visibilitychange', () => (document.hidden ? parar() : iniciar()));
    iniciar();
  }
})();
