// ============================================================================
//  admin-reserva.js — formulario "Nueva reserva" del panel
//
//  Arma el mismo "carrito" que usa la web (combo + adicionales + equipos
//  sueltos + fecha, horas, lugar, acceso...) y:
//   • busca el lugar con GET /api/geocodificar (OpenStreetMap) para tener
//     latitud/longitud: con eso el servidor calcula ruta y transporte;
//   • cada cambio pide el precio a POST /admin/reservas/cotizar (con los
//     descuentos y puntos de ESE cliente) y avisa si falta algún equipo;
//   • al guardar envía todo a POST /admin/reservas/nueva y abre la reserva.
// ============================================================================

(function () {
  const form = document.getElementById('form-reserva-admin');
  if (!form) return;
  const $ = (s, c = document) => c.querySelector(s);
  const csrf = $('meta[name="csrf"]')?.content || '';
  const datos = JSON.parse($('#datos-reserva-admin').textContent);
  const soles = n => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let lugar = null; // { texto, lat, lng }

  async function pedir(url, cuerpo) {
    const res = await fetch(url, { method: cuerpo ? 'POST' : 'GET', headers: { Accept: 'application/json', 'x-csrf-token': csrf, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw Object.assign(new Error(json.error || 'No se pudo completar.'), { datos: json });
    return json;
  }

  // ── Equipos sueltos: filas con equipo + cantidad ──────────────────────────
  const opciones = datos.equipos.map(e => `<option value="${e.id}">${escapar(e.nombre)} · ${soles(e.precio)}</option>`).join('');
  function agregarFila() {
    const fila = document.createElement('div');
    fila.className = 'fila-form';
    fila.style.margin = '0';
    fila.innerHTML = `<select data-equipo><option value="">Equipo…</option>${opciones}</select><input type="number" data-cantidad min="1" max="100" value="1" style="width:80px" aria-label="Cantidad"><button type="button" class="btn-icono" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>`;
    fila.querySelector('button').addEventListener('click', () => { fila.remove(); cotizar(); });
    $('#filas-sueltos').append(fila);
  }
  $('#agregar-suelto').addEventListener('click', agregarFila);

  // ── Adicionales del combo elegido ─────────────────────────────────────────
  form.combo_id.addEventListener('change', () => {
    const c = datos.combos[form.combo_id.value];
    $('#adicionales-admin').innerHTML = c?.adicionales.length
      ? '<small class="suave">Adicionales del paquete:</small>' + c.adicionales.map((a, i) => `<label class="casilla"><input type="checkbox" data-adicional="${i}"> ${escapar(a.etiqueta)} <b style="color:var(--primario)">+ ${soles(a.precio)}</b></label>`).join('')
      : '';
    if (c) form.horas.value = c.horas;
  });

  // ── Buscar el lugar ───────────────────────────────────────────────────────
  async function buscarLugar() {
    const q = form.lugar_texto.value.trim();
    if (q.length < 3) return;
    $('#lugar-elegido').textContent = 'Buscando…';
    try {
      const r = await pedir(`/api/geocodificar?q=${encodeURIComponent(q)}`);
      const l = r.lugares?.[0];
      if (!l) { lugar = null; $('#lugar-elegido').textContent = 'No lo encontramos: prueba con el distrito o una referencia conocida.'; return; }
      lugar = { texto: l.nombre, lat: l.lat, lng: l.lng };
      $('#lugar-elegido').innerHTML = `<i class="fa-solid fa-location-dot" style="color:var(--primario)"></i> ${escapar(l.nombre)}`;
      cotizar();
    } catch (err) { $('#lugar-elegido').textContent = err.message; }
  }
  $('#buscar-lugar-admin').addEventListener('click', buscarLugar);
  form.lugar_texto.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscarLugar(); } });

  // ── Carrito con lo que hay en el formulario ───────────────────────────────
  function carrito() {
    return {
      combo_id: form.combo_id.value || null,
      adicionales: [...form.querySelectorAll('[data-adicional]:checked')].map(x => Number(x.dataset.adicional)),
      items: [...form.querySelectorAll('#filas-sueltos .fila-form')].map(f => ({ equipo_id: f.querySelector('[data-equipo]').value, cantidad: Number(f.querySelector('[data-cantidad]').value) || 0 })).filter(x => x.equipo_id && x.cantidad > 0),
      fecha: form.fecha.value || null,
      hora_inicio: form.hora_inicio.value || null,
      horas: Number(form.horas.value) || 6,
      personas: Number(form.personas.value) || 0,
      tipo_evento: form.tipo_evento.value,
      espacio: form.espacio.value,
      acceso_vehicular: form.acceso_vehicular.value === 'si',
      con_tecnico: form.con_tecnico.checked,
      lugar
    };
  }

  // ── Precio en vivo ────────────────────────────────────────────────────────
  let pausa;
  function cotizar() {
    clearTimeout(pausa);
    pausa = setTimeout(async () => {
      const c = carrito();
      if (!c.combo_id && !c.items.length) { $('#resumen-admin').innerHTML = '<p class="suave">Elige un paquete o agrega equipos.</p>'; $('#faltan-admin').innerHTML = ''; return; }
      try {
        const r = await pedir('/admin/reservas/cotizar', { cliente_id: form.cliente_id.value, carrito: c, promo: form.promo.value });
        const k = r.cotizacion, t = k.transporte;
        $('#resumen-admin').innerHTML = `
          ${k.lineas.map(l => `<div><span>${l.tipo === 'adicional' ? '+ ' : l.tipo === 'equipo' ? `${l.cantidad}× ` : ''}${escapar(l.nombre)}</span><span>${soles(l.subtotal)}</span></div>`).join('')}
          ${k.tecnico ? `<div><span>Técnico</span><span>${soles(k.tecnico)}</span></div>` : ''}
          <div><span>Transporte${t ? ` · ${escapar(t.vehiculo.nombre)}` : ''}</span><span>${t?.costo == null ? 'busca el lugar' : t.gratis && !t.recargo_sin_acceso ? 'Incluido' : soles(t.costo)}</span></div>
          ${k.descuento ? `<div style="color:var(--disponible)"><span>Descuento ${k.descuento_pct}%${k.frecuente ? ' (frecuente)' : ''}</span><span>− ${soles(k.descuento)}</span></div>` : ''}
          <div class="total"><span>Total</span><b>${soles(k.total)}</b></div>
          <div class="adelanto"><span>Adelanto ${k.adelanto_pct}%</span><span>${soles(k.adelanto)}</span></div>`;
        $('#faltan-admin').innerHTML = r.faltan.length ? `<div class="aviso" style="margin-bottom:.8rem"><i class="fa-solid fa-triangle-exclamation"></i>Ese día no alcanzan: ${r.faltan.map(f => `${escapar(f.nombre)} (hay ${f.libre} de ${f.pedido})`).join(', ')}.</div>` : '';
      } catch (err) { $('#resumen-admin').innerHTML = `<p class="aviso">${escapar(err.message)}</p>`; }
    }, 300);
  }
  form.addEventListener('input', cotizar);
  form.addEventListener('change', cotizar);

  // ── Guardar ───────────────────────────────────────────────────────────────
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const error = $('#error-reserva-admin');
    error.textContent = '';
    const c = carrito();
    if (!form.cliente_id.value) { error.textContent = 'Elige el cliente.'; return; }
    if (!c.fecha) { error.textContent = 'Elige la fecha.'; return; }
    if (!c.lugar) { error.textContent = 'Busca el lugar del evento (botón Buscar).'; return; }
    const boton = form.querySelector('button:not([type])') || form.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      const r = await pedir('/admin/reservas/nueva', {
        cliente_id: form.cliente_id.value, carrito: c, promo: form.promo.value,
        pago_monto: form.pago_monto.value, pago_referencia: form.pago_referencia.value,
        permitir_faltantes: form.permitir_faltantes.checked
      });
      window.location.href = r.url;
    } catch (err) {
      error.textContent = err.message + (err.datos?.faltan ? ` (${err.datos.faltan.map(f => f.nombre).join(', ')})` : '');
      boton.disabled = false;
    }
  });

  agregarFila();
  if (form.combo_id.value) form.combo_id.dispatchEvent(new Event('change'));
})();
