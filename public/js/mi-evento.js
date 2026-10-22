// ============================================================================
//  mi-evento.js — resumen del evento y reserva
//
//  1. Lee el borrador de "Mi evento" (evento.js).
//  2. Pide el precio REAL a POST /api/cotizar cada vez que algo cambia
//     (cantidades, fecha, horas, lugar, técnico, promo). El servidor responde
//     con las líneas, transporte, descuento, total, adelanto y faltantes.
//  3. Si algún equipo está ocupado esa fecha, ofrece pedir una reunión:
//     AeeS puede completar con un proveedor aliado (POST /api/solicitudes).
//  4. Con sesión iniciada, el formulario crea la reserva (POST /api/reservas)
//     y lleva a /reservas/CODIGO para pagar el adelanto.
// ============================================================================

(function () {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const soles = n => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const config = JSON.parse($('#datos-evento').textContent);
  let ultima = null;
  let promo = '';

  const vacio = () => AeesEvento.total() === 0;

  function mostrar() {
    $('#evento-vacio').hidden = !vacio();
    $('#evento-contenido').hidden = vacio();
  }

  // ── Datos del evento ↔ formulario ─────────────────────────────────────────
  function cargarCampos() {
    const e = AeesEvento.leer();
    $('#ev-fecha').value = e.fecha || '';
    $('#ev-hora').value = e.hora_inicio || '';
    $('#ev-horas').value = e.horas || 4;
    $('#ev-personas').value = e.personas || '';
    $('#ev-tecnico').checked = e.con_tecnico !== false;
    $('#ev-lugar-texto').textContent = e.lugar?.texto || 'sin marcar';
  }
  ['ev-fecha', 'ev-hora', 'ev-horas', 'ev-personas', 'ev-tecnico'].forEach(id => $(`#${id}`).addEventListener('change', () => {
    AeesEvento.actualizar({
      fecha: $('#ev-fecha').value || null,
      hora_inicio: $('#ev-hora').value || null,
      horas: Number($('#ev-horas').value) || 4,
      personas: Number($('#ev-personas').value) || null,
      con_tecnico: $('#ev-tecnico').checked
    });
    cotizar();
  }));

  // ── Cotización con el servidor ────────────────────────────────────────────
  let pendiente;
  function cotizar() {
    clearTimeout(pendiente);
    pendiente = setTimeout(async () => {
      mostrar();
      if (vacio()) return;
      const r = await aeesFetch('/api/cotizar', { method: 'POST', body: { carrito: AeesEvento.leer(), promo } });
      if (!r.ok) { $('#resumen').innerHTML = `<p class="aviso">${escapar(r.error)}</p>`; return; }
      ultima = r;
      pintar(r);
    }, 250);
  }

  function pintar(r) {
    const c = r.cotizacion;
    const evento = AeesEvento.leer();

    // Líneas: combo (con su detalle) + adicionales + equipos sueltos con +/-
    $('#lineas').innerHTML = c.lineas.map(l => {
      if (l.tipo === 'combo') {
        return `<div class="linea"><div><b><i class="fa-solid fa-box-open" style="color:var(--primario)"></i> ${escapar(l.nombre)}</b><small>${escapar(l.detalle.join(' · '))}</small></div>
          <button type="button" class="btn-icono" data-quitar-combo aria-label="Quitar combo"><i class="fa-solid fa-xmark"></i></button>
          <span class="precio">${soles(l.subtotal)}</span></div>`;
      }
      if (l.tipo === 'adicional') return `<div class="linea"><div><b>+ ${escapar(l.nombre)}</b><small>Adicional del combo</small></div><span></span><span class="precio">${soles(l.subtotal)}</span></div>`;
      return `<div class="linea"><div><b>${escapar(l.nombre)}</b><small>${soles(l.precio_unit)} c/u × ${l.jornadas} jornada${l.jornadas > 1 ? 's' : ''}</small></div>
        <div class="cantidad"><button type="button" data-menos="${l.id}" aria-label="Quitar uno">−</button><span>${l.cantidad}</span><button type="button" data-mas="${l.id}" aria-label="Agregar uno">+</button></div>
        <span class="precio">${soles(l.subtotal)}</span></div>`;
    }).join('');

    // Adicionales del combo como casillas
    const ads = r.combo?.adicionales || [];
    $('#adicionales').innerHTML = ads.length ? `<p class="suave" style="font-size:.88rem;margin-bottom:.5rem">Súmale al combo:</p>` + ads.map((a, i) => `
      <label class="casilla" style="margin-bottom:.4rem"><input type="checkbox" data-adicional="${i}" ${evento.adicionales?.includes(i) ? 'checked' : ''}> ${escapar(a.etiqueta)} <b style="color:var(--secundario)">+ ${soles(a.precio)}</b></label>`).join('') : '';

    // Faltantes en la fecha
    $('#faltan').innerHTML = r.faltan.length ? `
      <div class="aviso" style="margin-bottom:1rem"><i class="fa-solid fa-triangle-exclamation"></i>
        Para el ${escapar(evento.fecha)} no alcanzan: ${r.faltan.map(f => `${escapar(f.nombre)} (pides ${f.pedido}, quedan ${f.libre})`).join(', ')}.
        <br>Podemos completarlo con un proveedor aliado. <button type="button" class="btn btn-coral btn-sm" style="margin-top:.6rem" id="pedir-reunion"><i class="fa-solid fa-handshake"></i> Pedir reunión para buscar solución</button>
      </div>` : '';
    $('#pedir-reunion')?.addEventListener('click', pedirReunion);

    const t = c.transporte;
    $('#resumen').innerHTML = `
      <div><span>Equipos (${c.jornadas} jornada${c.jornadas > 1 ? 's' : ''})</span><span>${soles(c.subtotal)}</span></div>
      <div><span>Técnico en el evento</span><span>${soles(c.tecnico)}</span></div>
      <div><span>Transporte${t ? ` · ${escapar(t.vehiculo.nombre)}${t.viajes > 1 ? ` ×${t.viajes}` : ''}${r.ruta ? ` · ${r.ruta.km} km` : ''}` : ''}</span><span>${t?.costo != null ? soles(t.costo) : '<small class="suave">marca el lugar</small>'}</span></div>
      ${c.descuento ? `<div style="color:var(--disponible)"><span>Descuento ${c.descuento_pct}%${c.promo ? ` (${escapar(c.promo.codigo)})` : c.frecuente ? ' (cliente frecuente)' : ''}</span><span>− ${soles(c.descuento)}</span></div>` : ''}
      ${c.error_promo ? `<div style="color:var(--no-disponible);font-size:.85rem">${escapar(c.error_promo)}</div>` : ''}
      <div class="total"><span>Total</span><b>${soles(c.total)}</b></div>
      <div class="adelanto"><span>Adelanto para separar (${c.adelanto_pct}%)</span><span>${soles(c.adelanto)}</span></div>
      <small class="suave">La fecha y los equipos quedan bloqueados ${c.horas_bloqueo} h mientras pagas el adelanto.</small>`;

    const resumenWa = `Hola AeeS, armé mi evento en la web para el ${evento.fecha || '(fecha por definir)'}${evento.lugar ? ` en ${evento.lugar.texto.split(',')[0]}` : ''}: ${c.lineas.map(l => `${l.cantidad}× ${l.nombre}`).join(', ')}. Total estimado ${soles(c.total)}.`;
    $('#wa-evento').href = `https://wa.me/${config.whatsapp}?text=${encodeURIComponent(resumenWa)}`;
  }

  // Delegación de eventos para los botones que se redibujan.
  document.addEventListener('click', e => {
    const mas = e.target.closest('[data-mas]'), menos = e.target.closest('[data-menos]');
    if (mas || menos) {
      const id = (mas || menos).dataset.mas || (mas || menos).dataset.menos;
      const it = AeesEvento.leer().items.find(x => x.equipo_id === id);
      AeesEvento.cambiarCantidad(id, (it?.cantidad || 0) + (mas ? 1 : -1));
      cotizar();
    }
    if (e.target.closest('[data-quitar-combo]')) { AeesEvento.quitarCombo(); cotizar(); }
  });
  document.addEventListener('change', e => {
    if (!e.target.matches('[data-adicional]')) return;
    const marcados = $$('[data-adicional]:checked').map(x => Number(x.dataset.adicional));
    AeesEvento.actualizar({ adicionales: marcados });
    cotizar();
  });
  $('#vaciar').addEventListener('click', async () => {
    const r = await aeesAlerta({ icon: 'warning', title: '¿Vaciar tu evento?', showCancelButton: true, confirmButtonText: 'Sí, vaciar', cancelButtonText: 'No' });
    if (r.isConfirmed) { AeesEvento.vaciar(); mostrar(); }
  });
  $('#aplicar-promo').addEventListener('click', () => { promo = $('#promo').value.trim().toUpperCase(); cotizar(); });

  // ── Fecha ocupada → reunión con proveedor aliado ──────────────────────────
  async function pedirReunion() {
    let nombre = config.usuario?.nombre || '', telefono = config.usuario?.celular || '';
    if (!nombre || !telefono) {
      const r = await Swal.fire({
        title: 'Coordinemos una solución',
        html: '<input id="sol-nombre" class="swal2-input" placeholder="Tu nombre"><input id="sol-tel" class="swal2-input" placeholder="Celular (9 dígitos)" inputmode="tel">',
        confirmButtonText: 'Pedir reunión', showCancelButton: true, cancelButtonText: 'Cancelar',
        preConfirm: () => ({ nombre: document.getElementById('sol-nombre').value, telefono: document.getElementById('sol-tel').value })
      });
      if (!r.isConfirmed) return;
      ({ nombre, telefono } = r.value);
    }
    const r = await aeesFetch('/api/solicitudes', { method: 'POST', body: { carrito: AeesEvento.leer(), nombre, telefono } });
    if (r.ok) aeesAlerta({ icon: 'success', title: 'Solicitud enviada', text: 'Te escribimos por WhatsApp para proponerte una solución (otro equipo equivalente o un proveedor aliado) y agendar la reunión.' });
    else aeesAlerta({ icon: 'error', title: 'No se pudo enviar', text: r.error });
  }

  // ── Mapa del lugar ────────────────────────────────────────────────────────
  let mapa, marcador;
  function iniciarMapa() {
    if (!window.L || mapa) return;
    const e = AeesEvento.leer();
    mapa = L.map('mapa', { scrollWheelZoom: false }).setView(e.lugar ? [e.lugar.lat, e.lugar.lng] : [-13.42, -72.05], e.lugar ? 13 : 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    if (e.lugar) marcador = L.marker([e.lugar.lat, e.lugar.lng]).addTo(mapa);
    mapa.on('click', ev => ponerLugar(ev.latlng.lat, ev.latlng.lng, 'Punto marcado en el mapa'));
  }
  function ponerLugar(lat, lng, texto) {
    AeesEvento.actualizar({ lugar: { lat, lng, texto } });
    $('#ev-lugar-texto').textContent = texto;
    if (marcador) marcador.setLatLng([lat, lng]); else marcador = L.marker([lat, lng]).addTo(mapa);
    mapa.setView([lat, lng], 13);
    cotizar();
  }
  async function buscar() {
    const q = $('#buscar-lugar').value.trim();
    if (q.length < 3) return;
    const r = await aeesFetch(`/api/geocodificar?q=${encodeURIComponent(q)}`);
    const caja = $('#sugerencias');
    if (!r.ok || !r.lugares.length) { caja.innerHTML = '<span class="suave">No encontramos ese lugar; toca el mapa.</span>'; return; }
    caja.replaceChildren(...r.lugares.map(l => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = l.nombre;
      b.addEventListener('click', () => { caja.innerHTML = ''; ponerLugar(l.lat, l.lng, l.nombre); });
      return b;
    }));
  }
  $('#btn-buscar').addEventListener('click', buscar);
  $('#buscar-lugar').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });

  // ── Reservar ──────────────────────────────────────────────────────────────
  const form = $('#form-reserva');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const errores = {};
    if ((d.nombre || '').trim().length < 3) errores.nombre = 'Escribe tu nombre completo.';
    if (!/^\d{8}$/.test(d.dni || '')) errores.dni = 'El DNI tiene 8 dígitos.';
    if (!/^9\d{8}$/.test((d.celular || '').replace(/\D/g, '').replace(/^51/, ''))) errores.celular = 'Celular de 9 dígitos que empiece en 9.';
    if (!d.acepta) errores.acepta = 'Necesitamos tu autorización para gestionar la reserva.';
    const evento = AeesEvento.leer();
    $$('.campo-simple', form).forEach(c => { c.classList.remove('error'); $('.campo-error', c).textContent = ''; });
    $('[data-error="acepta"]').textContent = errores.acepta || '';
    Object.entries(errores).forEach(([k, v]) => { const c = form.elements[k]?.closest('.campo-simple'); if (c) { c.classList.add('error'); $('.campo-error', c).textContent = v; } });
    if (Object.keys(errores).length) return aeesToast('warning', 'Revisa tus datos');
    if (!evento.fecha) return aeesAlerta({ icon: 'info', title: 'Falta la fecha', text: 'Elige la fecha del evento en "Datos del evento".' });
    if (!evento.lugar) return aeesAlerta({ icon: 'info', title: 'Falta el lugar', text: 'Marca el lugar en el mapa para calcular el transporte.' });

    const boton = $('button[type="submit"]', form);
    boton.classList.add('cargando');
    const r = await aeesFetch('/api/reservas', { method: 'POST', body: { carrito: evento, promo, cliente: { ...d, acepta: Boolean(d.acepta) } } });
    boton.classList.remove('cargando');
    if (r.ok) {
      AeesEvento.vaciar();
      window.location.href = r.url;
      return;
    }
    if (r.campos) Object.entries(r.campos).forEach(([k, v]) => { const c = form.elements[k]?.closest('.campo-simple'); if (c) { c.classList.add('error'); $('.campo-error', c).textContent = v; } });
    if (r.status === 409) { cotizar(); }
    aeesAlerta({ icon: 'error', title: 'No se pudo reservar', text: r.error });
  });

  mostrar();
  cargarCampos();
  cotizar();
  iniciarMapa();
})();
