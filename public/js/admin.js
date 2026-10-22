// ============================================================================
//  admin.js — interacciones del panel (todo funciona igual sin JS salvo
//  la subida de fotos, la vista previa del combo y restaurar el respaldo)
//
//   • [data-confirmar]  formularios que piden "¿Seguro?" antes de enviarse
//   • [data-alternar]   interruptor publicado sí/no → POST por fetch (sin recargar)
//   • form[data-auto]   el <select> de estado se guarda solo al cambiar
//   • [data-subir-foto] encuadra la foto (Cropper.js), la pasa a WebP y la sube
//   • #form-combo       filas dinámicas de equipos/adicionales + vista previa en vivo
//   • #archivo-respaldo lee el .json y lo envía a /admin/respaldo/restaurar
// ============================================================================

(function () {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const csrf = $('meta[name="csrf"]')?.content || '';
  const soles = n => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hayAlertas = typeof window.Swal !== 'undefined';
  const toast = (icon, title) => (hayAlertas ? Swal.fire({ toast: true, position: 'top-end', timer: 2200, showConfirmButton: false, icon, title }) : console.info(title));

  async function postJSON(url, cuerpo) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(cuerpo || {}) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.error || 'No se pudo completar la acción.');
    return json;
  }

  // ── Confirmación antes de eliminar / rechazar ─────────────────────────────
  $$('form[data-confirmar]').forEach(form => form.addEventListener('submit', async e => {
    if (form.dataset.confirmado) return;
    e.preventDefault();
    const ok = hayAlertas
      ? (await Swal.fire({ icon: 'warning', title: '¿Seguro?', text: form.dataset.confirmar, showCancelButton: true, confirmButtonText: 'Sí, continuar', cancelButtonText: 'Cancelar' })).isConfirmed
      : window.confirm(form.dataset.confirmar);
    if (ok) { form.dataset.confirmado = '1'; form.submit(); }
  }));

  // ── Interruptores publicado sí/no ─────────────────────────────────────────
  $$('[data-alternar]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await postJSON(b.dataset.alternar);
      b.setAttribute('aria-checked', String(r.publicado));
      toast('success', r.publicado ? 'Publicado en el sitio' : 'Oculto del sitio');
    } catch (err) { toast('error', err.message); } finally { b.disabled = false; }
  }));

  $$('form[data-auto] select').forEach(s => s.addEventListener('change', () => s.form.submit()));

  // ── Subir foto: encuadrar, reducir y convertir a WebP en el navegador ────
  // 1. Cropper.js muestra la foto con un marco de la proporción donde se usará
  //    (data-formato), así una foto vertical no deforma una tarjeta horizontal.
  // 2. Se exporta a máx. 1600 px por lado en WebP (~150–300 KB; si el navegador
  //    no sabe hacer WebP, en JPEG).
  // 3. Se envía en base64 a POST /admin/fotos, que la guarda y devuelve la URL.
  const PROPORCION = { '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '16:10': 16 / 10, '4:5': 4 / 5, '1:1': 1 };

  function exportar(canvas) {
    const webp = canvas.toDataURL('image/webp', 0.82);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
  }

  // Sin Cropper (CDN caído): recorte centrado automático con la proporción pedida.
  function recorteCentrado(img, proporcion) {
    let w = img.naturalWidth, h = img.naturalHeight, x = 0, y = 0;
    if (proporcion) {
      if (w / h > proporcion) { const nw = h * proporcion; x = (w - nw) / 2; w = nw; } else { const nh = w / proporcion; y = (h - nh) / 2; h = nh; }
    }
    const escala = Math.min(1, 1600 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * escala);
    c.height = Math.round(h * escala);
    c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
    return exportar(c);
  }

  async function encuadrar(archivo, formato) {
    const url = URL.createObjectURL(archivo);
    try {
      const img = await new Promise((ok, mal) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => mal(new Error('No se pudo leer la imagen.'));
        i.src = url;
      });
      if (!window.Cropper || !hayAlertas) return recorteCentrado(img, PROPORCION[formato]);
      let cropper;
      // En la galería se puede elegir la orientación; en lo demás la proporción es fija.
      const opciones = formato === 'libre'
        ? `<div class="acciones" style="justify-content:center;margin-top:.8rem">${[['4:3', 'Horizontal'], ['3:4', 'Vertical'], ['16:9', 'Panorámica'], ['libre', 'Libre']].map(([f, t]) => `<button type="button" class="btn btn-ghost btn-sm" data-prop="${f}">${t}</button>`).join('')}</div>`
        : '';
      const r = await Swal.fire({
        title: 'Encuadra la foto',
        html: `<div style="max-height:60vh"><img id="img-recorte" src="${url}" alt="" style="max-width:100%;display:block"></div>${opciones}<p style="font-size:.8rem;margin-top:.6rem">Arrastra para mover el marco y usa la rueda para acercar.</p>`,
        width: 760,
        showCancelButton: true,
        confirmButtonText: 'Usar esta foto',
        cancelButtonText: 'Cancelar',
        didOpen: el => {
          cropper = new Cropper(el.querySelector('#img-recorte'), { aspectRatio: PROPORCION[formato] || (formato === 'libre' ? 4 / 3 : NaN), viewMode: 1, autoCropArea: 1, background: false });
          el.querySelectorAll('[data-prop]').forEach(b => b.addEventListener('click', () => cropper.setAspectRatio(PROPORCION[b.dataset.prop] || NaN)));
        },
        preConfirm: () => exportar(cropper.getCroppedCanvas({ maxWidth: 1600, maxHeight: 1600, imageSmoothingQuality: 'high' }))
      });
      cropper?.destroy();
      return r.isConfirmed ? r.value : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  $$('[data-subir-foto]').forEach(caja => {
    const url = $('[data-url-foto]', caja), vista = $('.vista', caja), archivo = $('[data-archivo-foto]', caja);
    const formato = caja.dataset.formato || '4:3';
    // La miniatura usa la misma proporción que tendrá la foto en el sitio.
    if (PROPORCION[formato]) vista.style.aspectRatio = String(PROPORCION[formato]);
    const pintar = v => { vista.style.backgroundImage = v ? `url("${v}")` : ''; vista.classList.toggle('con-foto', Boolean(v)); url.dispatchEvent(new Event('input', { bubbles: true })); };
    url.addEventListener('change', () => pintar(url.value.trim()));
    archivo.addEventListener('change', async () => {
      const f = archivo.files[0];
      archivo.value = '';
      if (!f) return;
      try {
        const datos = await encuadrar(f, formato);
        if (!datos) return;
        vista.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        vista.classList.remove('con-foto');
        const r = await postJSON('/admin/fotos', { datos });
        url.value = r.url;
        pintar(r.url);
        toast('success', `Foto lista (${Math.round(datos.length * 0.75 / 1024)} KB)`);
      } catch (err) {
        toast('error', err.message);
      } finally {
        vista.innerHTML = '<i class="fa-regular fa-image"></i>';
      }
    });
  });

  // ── Armador de combos con vista previa ────────────────────────────────────
  const formCombo = $('#form-combo');
  if (formCombo) {
    const datos = JSON.parse($('#datos-combo').textContent);
    const equipos = Object.fromEntries(datos.equipos.map(e => [e.id, e]));
    const opciones = sel => datos.equipos.map(e => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${escapar(e.nombre)}${e.publicado ? '' : ' (oculto)'} — ${soles(e.precio)}</option>`).join('');
    let contador = 0;

    // Los nombres items[N][campo] los entiende Express (urlencoded extendido) como una lista de objetos.
    function filaItem(it = {}) {
      const i = contador++;
      const div = document.createElement('div');
      div.className = 'fila';
      div.innerHTML = `<select name="items[${i}][equipo_id]" aria-label="Equipo">${opciones(it.equipo_id)}</select>
        <input name="items[${i}][cantidad]" type="number" min="1" value="${it.cantidad || 1}" aria-label="Cantidad">
        <button type="button" class="btn-icono" data-quitar aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>`;
      $('#filas-items').append(div);
    }
    function filaAdicional(it = {}) {
      const i = contador++;
      const div = document.createElement('div');
      div.className = 'fila adicional';
      div.innerHTML = `<select name="adicionales[${i}][equipo_id]" aria-label="Equipo adicional">${opciones(it.equipo_id)}</select>
        <input name="adicionales[${i}][cantidad]" type="number" min="1" value="${it.cantidad || 1}" aria-label="Cantidad">
        <input name="adicionales[${i}][precio]" type="number" min="0" step="1" value="${it.precio ?? ''}" placeholder="S/" aria-label="Precio especial">
        <input name="adicionales[${i}][etiqueta]" value="${escapar(it.etiqueta || '')}" placeholder="Texto (ej. 2 EON615 adicionales)" maxlength="80" aria-label="Texto">
        <button type="button" class="btn-icono" data-quitar aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>`;
      $('#filas-adicionales').append(div);
      // Sugerimos el precio de adicional del equipo (p. ej. EON615 = 50 c/u) si no hay uno.
      const sugerir = () => {
        const e = equipos[$('select', div).value];
        const precio = $('[name$="[precio]"]', div);
        if (!precio.value && e?.precio_adicional != null) precio.value = e.precio_adicional * Number($('[name$="[cantidad]"]', div).value || 1);
      };
      $('select', div).addEventListener('change', sugerir);
      sugerir();
    }

    datos.items.forEach(filaItem);
    datos.adicionales.forEach(filaAdicional);
    if (!datos.items.length) filaItem();

    formCombo.addEventListener('click', e => {
      const agregar = e.target.closest('[data-agregar-fila]');
      if (agregar) { (agregar.dataset.agregarFila === 'items' ? filaItem : filaAdicional)(); previa(); }
      if (e.target.closest('[data-quitar]')) { e.target.closest('.fila').remove(); previa(); }
    });

    function previa() {
      const v = n => formCombo.elements[n]?.value || '';
      $('#previa-nombre').textContent = v('nombre') || 'Nombre del combo';
      $('#previa-descripcion').textContent = v('descripcion') || 'Descripción para el cliente.';
      $('#previa-precio').textContent = soles(v('precio'));
      $('#previa-horas').textContent = `/ ${v('horas_base') || 4} h`;
      $('#previa-personas').textContent = `${v('personas_min') || 0}–${v('personas_max') || 0} personas`;
      const img = $('#previa-img'), urlImg = v('imagen');
      img.hidden = !urlImg;
      if (urlImg) img.src = urlImg;

      const items = $$('#filas-items .fila').map(f => ({ id: $('select', f).value, cantidad: Number($('input', f).value) || 0 }));
      $('#previa-items').innerHTML = items.filter(x => x.cantidad > 0).map(x => `<li>${x.cantidad}× ${escapar(equipos[x.id]?.nombre)}</li>`).join('');
      const ads = $$('#filas-adicionales .fila').map(f => ({ etiqueta: $('[name$="[etiqueta]"]', f).value || `${$('[name$="[cantidad]"]', f).value}× ${equipos[$('select', f).value]?.nombre}`, precio: $('[name$="[precio]"]', f).value }));
      $('#previa-adicionales').innerHTML = ads.map(a => `<span><b>+ ${soles(a.precio)}</b> ${escapar(a.etiqueta)}</span>`).join('');

      // Comparación con el precio de los equipos sueltos: ayuda a decidir el precio del combo.
      const suelto = items.reduce((s, x) => s + (equipos[x.id]?.precio || 0) * x.cantidad, 0);
      const precio = Number(v('precio')) || 0;
      const caja = $('#ahorro');
      if (!suelto) { caja.textContent = ''; return; }
      const dif = suelto - precio;
      caja.classList.toggle('caro', dif < 0);
      caja.innerHTML = dif >= 0
        ? `<i class="fa-solid fa-tag"></i> Por separado costaría <b>${soles(suelto)}</b>: el cliente ahorra <b>${soles(dif)}</b> (${Math.round(dif / suelto * 100)}%).`
        : `<i class="fa-solid fa-triangle-exclamation"></i> El combo cuesta <b>${soles(-dif)}</b> más que los equipos por separado (${soles(suelto)}).`;
    }
    formCombo.addEventListener('input', previa);
    formCombo.addEventListener('change', previa);
    previa();
  }

  // ── Restaurar respaldo ────────────────────────────────────────────────────
  $('#archivo-respaldo')?.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    let datos;
    try { datos = JSON.parse(await f.text()); } catch { return toast('error', 'El archivo no es un JSON válido.'); }
    const ok = !hayAlertas || (await Swal.fire({ icon: 'warning', title: '¿Restaurar este respaldo?', text: `Archivo: ${f.name}. Se cargarán ${datos.equipos?.length ?? 0} equipos y ${datos.reservas?.length ?? 0} reservas.`, showCancelButton: true, confirmButtonText: 'Restaurar', cancelButtonText: 'Cancelar' })).isConfirmed;
    if (!ok) return;
    try {
      const r = await postJSON('/admin/respaldo/restaurar', datos);
      await Swal.fire({ icon: 'success', title: 'Respaldo restaurado', text: `Tablas: ${r.tablas.join(', ')}.` });
      location.reload();
    } catch (err) {
      toast('error', err.message);
    } finally { e.target.value = ''; }
  });
})();
