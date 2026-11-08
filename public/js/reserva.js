// ============================================================================
//  reserva.js — pagar el adelanto con Yape o Plin (página /reservas/:codigo)
//
//   1. El cliente toca "subir captura": se muestra la vista previa.
//   2. Al enviar, la foto se REDUCE en el navegador (máx. 1400 px) y se
//      convierte a WebP: una captura de 4 MB queda en ~150 KB, sube rápido
//      con datos móviles y no llena el almacenamiento gratis.
//   3. Se envía { metodo, operacion, foto } a POST /pagos/:codigo/yape.
//   4. Si sale bien, se muestra el botón "Avisar por WhatsApp" con el mensaje
//      ya escrito (código de reserva, monto y n.º de operación). El navegador
//      no deja abrir WhatsApp solo, por eso es un botón que el cliente toca.
//  Además: botones [data-copiar] para copiar el monto o el número de Yape/Plin.
// ============================================================================

(function () {
  const $ = (s, c = document) => c.querySelector(s);

  // ── Copiar monto / número ─────────────────────────────────────────────────
  document.querySelectorAll('[data-copiar]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copiar); aeesToast('success', 'Copiado'); } catch { aeesToast('info', b.dataset.copiar); }
  }));

  const form = $('#form-comprobante');
  if (!form) return;
  const archivo = form.querySelector('input[type="file"]');
  const vista = $('.vista-comprobante', form);
  const error = $('[data-error-comprobante]', form);

  // Vista previa de la captura elegida.
  archivo.addEventListener('change', () => {
    const f = archivo.files[0];
    error.textContent = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { archivo.value = ''; error.textContent = 'Elige una imagen (captura o foto del comprobante).'; return; }
    vista.style.backgroundImage = `url('${URL.createObjectURL(f)}')`;
    vista.classList.add('con-foto');
    vista.querySelector('span').textContent = 'Toca para cambiar la captura';
  });

  // Reduce la imagen y la devuelve como data URL WebP (JPEG si el navegador no tiene WebP).
  async function reducir(f, max = 1400) {
    const img = await createImageBitmap(f).catch(() => null);
    if (!img) throw new Error('No pudimos leer esa imagen. Prueba con una captura de pantalla.');
    const escala = Math.min(1, max / Math.max(img.width, img.height));
    const lienzo = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * escala), height: Math.round(img.height * escala) });
    lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const webp = lienzo.toDataURL('image/webp', 0.82);
    return webp.startsWith('data:image/webp') ? webp : lienzo.toDataURL('image/jpeg', 0.85);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    error.textContent = '';
    const operacion = form.operacion.value.replace(/\D/g, '');
    if (!archivo.files[0]) { error.textContent = 'Sube la captura del comprobante.'; return; }
    if (!/^\d{6,12}$/.test(operacion)) { error.textContent = 'El número de operación tiene entre 6 y 12 dígitos.'; form.operacion.focus(); return; }

    const boton = form.querySelector('button');
    boton.disabled = true;
    boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enviando…';
    try {
      const foto = await reducir(archivo.files[0]);
      const r = await aeesFetch(`/pagos/${form.dataset.codigo}/yape`, { method: 'POST', body: { metodo: form.metodo.value, operacion, foto } });
      if (!r.ok) throw new Error(r.error || 'No se pudo enviar el comprobante.');
      window.AeesSonido?.confirmar?.();
      await aeesAlerta({
        icon: 'success',
        title: 'Comprobante recibido',
        html: `${r.mensaje}<br><br><a class="btn btn-wa btn-bloque" href="${r.whatsapp}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> Avisar por WhatsApp</a>`,
        confirmButtonText: 'Listo'
      });
      location.reload();
    } catch (err) {
      error.textContent = err.message;
      boton.disabled = false;
      boton.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar comprobante';
    }
  });
})();
