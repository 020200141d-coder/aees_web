// ============================================================================
//  sitio/contacto.js — copiar correo y formulario de contacto (POST /api/contacto o WhatsApp)
//
//  Script clásico (no módulo ES): sus funciones quedan globales para que
//  main.js las arranque y las páginas (portada.js, mi-evento.js…) las usen.
// ============================================================================

/* Copiar correo */
function initCopiarEmail() {
  $$('.copiar-email').forEach(btn => btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(btn.dataset.email); toast('success', 'Correo copiado'); }
    catch { window.location.href = `mailto:${btn.dataset.email}`; }
  }));
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
