// ============================================================================
//  asistente.js — encuesta guiada, mapa y propuesta con IA
//
//  Flujo:
//   0. Texto libre → POST /api/interpretar (IA) → rellena la encuesta.
//   1–4. Pasos de la encuesta (tipo, invitados, fecha, extras).
//   5. Mapa Leaflet + OpenStreetMap: buscar (/api/geocodificar) o tocar el
//      mapa → POST /api/ruta dibuja el recorrido desde el almacén.
//   6. POST /api/recomendar → explicación IA + 3 opciones + combo sugerido,
//      con transporte, clima y disponibilidad. "Elegir" guarda la opción en
//      "Mi evento" (evento.js) y lleva a /mi-evento para reservar.
//
//  El progreso se guarda en "Mi evento" (localStorage): si la persona se va
//  y vuelve, encuentra sus respuestas.
// ============================================================================

(function () {
  const form = document.getElementById('form-asistente');
  if (!form) return;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const soles = n => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const { almacen, whatsapp } = JSON.parse($('#datos-asistente').textContent);
  const HORAS_TIPO = { fiesta_electronica: 8, concierto: 6, fiesta: 6, quinceanero: 6, boda: 6, cumpleanos: 4, graduacion: 5, corporativo: 4, conferencia: 4, otro: 4 };

  let paso = 0;
  let lugar = null; // { texto, lat, lng }
  let ultimaPropuesta = null;

  // ── Navegación entre pasos ────────────────────────────────────────────────
  function irA(n) {
    paso = Math.max(0, Math.min(6, n));
    $$('.paso', form).forEach(s => s.classList.toggle('activo', Number(s.dataset.paso) === paso));
    $$('.paso-item').forEach((b, i) => { b.classList.toggle('activo', i === paso); b.classList.toggle('hecho', i < paso); });
    if (paso === 5) setTimeout(iniciarMapa, 50); // Leaflet necesita que el div sea visible para medirse
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    guardarBorrador();
  }
  function validarPaso() {
    if (paso === 1 && !form.tipo_evento.value) { aeesToast('warning', 'Elige el tipo de evento'); return false; }
    return true;
  }
  form.addEventListener('click', e => {
    if (e.target.closest('[data-siguiente]') && validarPaso()) irA(paso + 1);
    if (e.target.closest('[data-anterior]')) irA(paso - 1);
  });
  $$('[data-ir-paso]').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.dataset.irPaso);
    if (n === 6 && !ultimaPropuesta) return aeesToast('info', 'Completa los pasos para ver tu propuesta');
    if (n > 1 && !form.tipo_evento.value) return aeesToast('warning', 'Primero elige el tipo de evento');
    irA(n);
  }));

  // Selección de tipo → avanza solo y propone las horas típicas.
  form.addEventListener('change', e => {
    if (e.target.name === 'tipo_evento') {
      if (!form.horas.value) form.horas.placeholder = `${HORAS_TIPO[e.target.value]} h (típico)`;
      setTimeout(() => irA(2), 250);
    }
    guardarBorrador();
  });
  const rango = $('#personas'), salida = $('#personas-valor');
  rango.addEventListener('input', () => { salida.textContent = rango.value; });

  // ── Leer / escribir la encuesta ───────────────────────────────────────────
  function leerEncuesta() {
    return {
      tipo_evento: form.tipo_evento.value || 'otro',
      nombre: form.nombre.value.trim(),
      personas: Number(rango.value),
      espacio: form.espacio.value,
      hay_electricidad: !form.sin_electricidad.checked,
      fecha: form.fecha.value || null,
      hora_inicio: form.hora_inicio.value || null,
      horas: Number(form.horas.value) || HORAS_TIPO[form.tipo_evento.value] || 4,
      extras: Object.fromEntries(['orquesta', 'banda', 'dj', 'proyeccion', 'luces'].map(k => [k, form[k].checked])),
      lugar
    };
  }

  function rellenar(d) {
    if (d.tipo_evento && form.querySelector(`[name="tipo_evento"][value="${d.tipo_evento}"]`)) form.querySelector(`[name="tipo_evento"][value="${d.tipo_evento}"]`).checked = true;
    if (d.nombre) form.nombre.value = d.nombre;
    if (d.personas) { rango.value = Math.min(800, Math.max(10, d.personas)); salida.textContent = rango.value; }
    if (d.espacio) form.querySelector(`[name="espacio"][value="${d.espacio}"]`).checked = true;
    if (d.hay_electricidad === false) form.sin_electricidad.checked = true;
    if (d.fecha && d.fecha >= form.fecha.min) form.fecha.value = d.fecha;
    if (d.hora_inicio) form.hora_inicio.value = d.hora_inicio;
    if (d.horas) form.horas.value = d.horas;
    if (d.extras) Object.entries(d.extras).forEach(([k, v]) => { if (form[k]) form[k].checked = Boolean(v); });
    if (d.lugar?.lat) lugar = d.lugar;
  }

  function guardarBorrador() {
    const enc = leerEncuesta();
    AeesEvento.actualizar({ encuesta: enc, tipo_evento: enc.tipo_evento, personas: enc.personas, espacio: enc.espacio, fecha: enc.fecha, hora_inicio: enc.hora_inicio, horas: enc.horas, lugar: enc.lugar });
  }

  // Recuperar respuestas anteriores y el ?tipo= de los enlaces de la portada.
  const previo = AeesEvento.leer();
  if (previo.encuesta) rellenar(previo.encuesta);
  const tipoUrl = new URLSearchParams(location.search).get('tipo');
  if (tipoUrl) rellenar({ tipo_evento: tipoUrl });

  // ── Paso 0: texto libre con IA ────────────────────────────────────────────
  $$('[data-ejemplo]').forEach(b => b.addEventListener('click', () => { $('#texto-libre').value = b.dataset.ejemplo; $('#texto-libre').focus(); }));

  $('#btn-interpretar').addEventListener('click', async () => {
    const texto = $('#texto-libre').value.trim();
    if (texto.length < 8) return aeesToast('info', 'Escribe un poco sobre tu evento o responde paso a paso');
    const boton = $('#btn-interpretar');
    boton.classList.add('cargando');
    try {
      const r = await aeesFetch('/api/interpretar', { method: 'POST', body: { texto } });
      if (!r.ok) throw new Error(r.error);
      const d = r.datos;
      rellenar(d);
      // Si mencionó un lugar, lo buscamos para dejar el pin listo.
      if (d.lugar) buscarLugar(d.lugar, true);
      const entendido = [
        d.tipo_evento !== 'otro' && $(`[name="tipo_evento"][value="${d.tipo_evento}"]`)?.parentElement.textContent.trim(),
        d.personas && `${d.personas} personas`,
        d.espacio === 'exterior' ? 'al aire libre' : d.espacio === 'interior' ? 'en local' : null,
        d.lugar, d.fecha, d.horas && `${d.horas} h`,
        ...Object.entries(d.extras || {}).filter(([k, v]) => v && k !== 'luces').map(([k]) => k)
      ].filter(Boolean);
      await aeesAlerta({
        icon: 'success',
        title: 'Esto entendimos',
        html: `<p>${entendido.map(escapar).join(' · ') || 'Algunos datos'}</p><p style="font-size:.85rem;margin-top:.6rem">${d.fuente === 'ia' ? 'Interpretado con IA.' : 'Interpretado por palabras clave.'} Revisa los pasos y completa lo que falte.</p>`,
        confirmButtonText: 'Revisar'
      });
      irA(d.tipo_evento && d.tipo_evento !== 'otro' ? 2 : 1);
    } catch (err) {
      aeesToast('error', err.message || 'No pudimos interpretar el texto');
    } finally {
      boton.classList.remove('cargando');
    }
  });

  // ── Paso 5: mapa con Leaflet + OpenStreetMap ──────────────────────────────
  let mapa, marcador, linea;
  function iniciarMapa() {
    if (mapa || !window.L) { mapa?.invalidateSize(); return; }
    mapa = L.map('mapa', { scrollWheelZoom: false }).setView([-13.42, -72.05], 10); // Cusco – Valle Sagrado
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    const iconoAlmacen = L.divIcon({ className: '', html: '<div style="background:#F5A623;color:#0D1B2A;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;box-shadow:0 4px 14px rgba(0,0,0,.5)"><i class="fa-solid fa-warehouse"></i></div>', iconSize: [32, 32], iconAnchor: [16, 16] });
    L.marker([almacen.lat, almacen.lng], { icon: iconoAlmacen, title: 'Almacén AeeS' }).addTo(mapa).bindTooltip('Almacén AeeS');
    mapa.on('click', e => ponerPin(e.latlng.lat, e.latlng.lng, 'Punto marcado en el mapa'));
    if (lugar) ponerPin(lugar.lat, lugar.lng, lugar.texto);
  }

  async function ponerPin(lat, lng, texto) {
    lugar = { lat, lng, texto };
    guardarBorrador();
    if (!mapa) return;
    const iconoEvento = L.divIcon({ className: '', html: '<div style="background:#E8784A;color:#fff;width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:grid;place-items:center;box-shadow:0 4px 14px rgba(0,0,0,.5)"><i class="fa-solid fa-champagne-glasses" style="transform:rotate(45deg)"></i></div>', iconSize: [36, 36], iconAnchor: [18, 36] });
    if (marcador) marcador.setLatLng([lat, lng]); else marcador = L.marker([lat, lng], { icon: iconoEvento, draggable: true }).addTo(mapa);
    marcador.off('dragend').on('dragend', e => { const p = e.target.getLatLng(); ponerPin(p.lat, p.lng, 'Punto ajustado en el mapa'); });
    const info = $('#info-ruta');
    info.hidden = false;
    info.innerHTML = '<div class="dato"><small>Ruta</small><b><i class="fa-solid fa-circle-notch fa-spin"></i> Calculando…</b></div>';
    const r = await aeesFetch('/api/ruta', { method: 'POST', body: { lat, lng } });
    if (!r.ok) { info.innerHTML = `<div class="dato"><small>Ruta</small><b>${escapar(r.error)}</b></div>`; return; }
    if (linea) linea.remove();
    linea = L.polyline(r.ruta.linea.map(([x, y]) => [y, x]), { color: '#F5A623', weight: 5, opacity: 0.85 }).addTo(mapa);
    mapa.fitBounds(linea.getBounds(), { padding: [40, 40] });
    info.innerHTML = `
      <div class="dato"><small>Lugar</small><b>${escapar(texto).slice(0, 60)}</b></div>
      <div class="dato"><small>Distancia por carretera</small><b>${r.ruta.km} km${r.ruta.estimado ? ' (aprox.)' : ''}</b></div>
      <div class="dato"><small>Tiempo de viaje</small><b>${Math.floor(r.ruta.minutos / 60) ? Math.floor(r.ruta.minutos / 60) + ' h ' : ''}${r.ruta.minutos % 60} min</b></div>
      <div class="dato"><small>Fuente</small><b style="font-size:.85rem">${escapar(r.ruta.fuente)}</b></div>`;
  }

  async function buscarLugar(q, elegirPrimero = false) {
    const caja = $('#sugerencias');
    if (!q || q.length < 3) return;
    caja.innerHTML = '<span class="suave"><i class="fa-solid fa-circle-notch fa-spin"></i> Buscando…</span>';
    const r = await aeesFetch(`/api/geocodificar?q=${encodeURIComponent(q)}`);
    if (!r.ok || !r.lugares.length) { caja.innerHTML = '<span class="suave">No encontramos ese lugar. Prueba con el distrito o toca el mapa.</span>'; return; }
    if (elegirPrimero) {
      caja.innerHTML = '';
      const l = r.lugares[0];
      lugar = { lat: l.lat, lng: l.lng, texto: l.nombre };
      guardarBorrador();
      if (mapa) ponerPin(l.lat, l.lng, l.nombre);
      return;
    }
    caja.replaceChildren(...r.lugares.map(l => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${escapar(l.nombre)}`;
      b.addEventListener('click', () => { caja.innerHTML = ''; ponerPin(l.lat, l.lng, l.nombre); });
      return b;
    }));
  }
  $('#btn-buscar').addEventListener('click', () => buscarLugar($('#buscar-lugar').value.trim()));
  $('#buscar-lugar').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscarLugar(e.target.value.trim()); } });
  $('#btn-mi-ubicacion').addEventListener('click', () => {
    if (!navigator.geolocation) return aeesToast('info', 'Tu navegador no comparte ubicación');
    navigator.geolocation.getCurrentPosition(
      p => ponerPin(p.coords.latitude, p.coords.longitude, 'Mi ubicación actual'),
      () => aeesToast('info', 'No pudimos obtener tu ubicación; búscala o toca el mapa'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  // ── Paso 6: propuesta ─────────────────────────────────────────────────────
  const ICONOS_CAT = { audio: 'fa-volume-high', iluminacion: 'fa-lightbulb', video: 'fa-tv', electrico: 'fa-bolt', estructura: 'fa-cubes' };

  function tarjetaPlan(op, destacado) {
    const c = op.cotizacion;
    const envio = op.envio;
    const lineasEquipos = op.equipos.map(e => `<li><b>${e.cantidad}×</b><span><i class="fa-solid ${ICONOS_CAT[e.categoria] || 'fa-circle'}" style="color:var(--texto-suave);margin-right:.3rem"></i>${escapar(e.nombre)}</span>${e.motivo ? `<small>${escapar(e.motivo)}</small>` : ''}</li>`).join('');
    const faltan = op.faltan.length ? `<div class="aviso" style="margin-bottom:1rem"><i class="fa-solid fa-triangle-exclamation"></i>Ocupado esa fecha: ${op.faltan.map(f => escapar(f.nombre)).join(', ')}. Lo coordinamos con un proveedor aliado.</div>` : '';
    return `
      <article class="plan${destacado ? ' destacado' : ''}">
        <h3>${escapar(op.titulo)}</h3>
        <div class="total">${soles(c.total)}</div>
        <div class="adelanto">Separas con ${soles(c.adelanto)} (${c.adelanto_pct}%) · ${c.jornadas} jornada${c.jornadas > 1 ? 's' : ''}</div>
        ${faltan}
        <ul>${lineasEquipos}</ul>
        ${op.adicionales?.length ? `<div class="combo-adicionales">${op.adicionales.map(a => `<span><b>+ ${soles(a.precio)}</b> ${escapar(a.etiqueta)}</span>`).join('')}</div>` : ''}
        <div class="desglose">
          <div><span>Equipos</span><span>${soles(c.subtotal)}</span></div>
          <div><span>Técnico en el evento</span><span>${soles(c.tecnico)}</span></div>
          <div><span>Transporte ${envio ? `(${escapar(envio.vehiculo.nombre)}${envio.viajes > 1 ? ` ×${envio.viajes}` : ''})` : ''}</span><span>${envio?.costo != null ? soles(envio.costo) : 'Marca el lugar'}</span></div>
          ${envio ? `<div><span>Carga aprox.</span><span>${envio.carga.volumen_l} L · ${envio.carga.peso_kg} kg</span></div>` : ''}
        </div>
        <button type="button" class="btn ${destacado ? 'btn-primario' : 'btn-ghost'} btn-bloque" data-elegir="${escapar(op.nivel)}"><i class="fa-solid fa-calendar-check"></i> Elegir y reservar</button>
      </article>`;
  }

  function pintarResultados(r) {
    const recomendada = r.opciones.find(o => o.nivel === 'recomendado');
    const clima = r.clima;
    const avisos = [
      ...r.avisos.map(a => `<div class="aviso"><i class="fa-solid fa-circle-info"></i>${escapar(a)}</div>`),
      clima?.aviso ? `<div class="aviso ${clima.lluvia_probable ? '' : 'aviso-ok'}"><i class="fa-solid fa-cloud-sun-rain"></i>${escapar(clima.aviso)}${clima.fuente && clima.fuente !== 'temporada' ? ` <small class="suave">(${escapar(clima.fuente)})</small>` : ''}</div>` : '',
      r.ruta ? `<div class="aviso aviso-ok"><i class="fa-solid fa-route"></i>${r.ruta.km} km desde nuestro almacén (${r.ruta.minutos} min). <a href="${r.ruta.enlace_conductor}" target="_blank" rel="noopener" style="color:var(--primario)">Ver ruta en Google Maps</a></div>` : '<div class="aviso"><i class="fa-solid fa-location-dot"></i>Marca el lugar en el mapa para sumar el transporte.</div>'
    ].join('');
    const planes = [r.combo, ...r.opciones].filter(Boolean);
    $('#resultados').innerHTML = `
      <div class="resultado-cabecera">
        <h2>Tu propuesta</h2>
        <div class="explicacion"><p>${escapar(r.explicacion.texto)}</p><small>${r.explicacion.fuente === 'ia' ? 'Redactado con IA a partir de nuestras reglas técnicas y precios reales.' : 'Generado con nuestras reglas técnicas y precios reales.'}</small></div>
        <div class="avisos">${avisos}</div>
      </div>
      <div class="planes">${planes.map(op => tarjetaPlan(op, op === recomendada)).join('')}</div>
      <p class="suave" style="font-size:.82rem;margin-top:1rem">Perfil acústico: <b>${{ spl: 'alta presión sonora', baile: 'música y discursos', voz: 'inteligibilidad de la voz' }[r.perfil]}</b>${r.personas_efectivas !== r.encuesta.personas ? ` · calculado para ${r.personas_efectivas} personas por ser al aire libre` : ''}.</p>`;
    $$('[data-elegir]', $('#resultados')).forEach(b => b.addEventListener('click', () => elegir(b.dataset.elegir)));
    const resumen = `Hola AeeS, armé mi evento en la web: ${r.encuesta.personas} personas, ${r.encuesta.fecha || 'fecha por definir'}${lugar ? `, en ${lugar.texto.split(',')[0]}` : ''}. Me interesa la opción ${recomendada.titulo} (${soles(recomendada.cotizacion.total)}). ¿Podemos conversar?`;
    $('#wa-propuesta').href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(resumen)}`;
  }

  function elegir(nivel) {
    const r = ultimaPropuesta;
    const op = nivel === 'combo' ? r.combo : r.opciones.find(o => o.nivel === nivel);
    const enc = leerEncuesta();
    AeesEvento.aplicarOpcion(op, {
      encuesta: enc, tipo_evento: enc.tipo_evento, personas: enc.personas, espacio: enc.espacio,
      fecha: enc.fecha, hora_inicio: enc.hora_inicio, horas: r.encuesta.horas, lugar,
      con_tecnico: true, explicacion: r.explicacion.texto
    });
    AeesSonido.confirmar();
    window.location.href = '/mi-evento';
  }

  $('#btn-recomendar').addEventListener('click', async () => {
    if (!form.tipo_evento.value) { irA(1); return aeesToast('warning', 'Elige el tipo de evento'); }
    irA(6);
    $('#resultados').innerHTML = `<div class="cargando-ia"><div class="intro-eq">${Array.from({ length: 9 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div><p>Diseñando el sonido de tu evento…<br><small>Revisando disponibilidad, ruta y clima</small></p></div>`;
    const enc = leerEncuesta();
    const r = await aeesFetch('/api/recomendar', { method: 'POST', body: { ...enc, horas: Number(form.horas.value) || null } });
    if (!r.ok) {
      $('#resultados').innerHTML = `<div class="vacio"><i class="fa-solid fa-plug-circle-exclamation"></i><p>${escapar(r.error || 'No pudimos armar la propuesta.')}</p></div>`;
      return;
    }
    ultimaPropuesta = r;
    pintarResultados(r);
  });
})();
