// ============================================================================
//  sitio/galeria.js — lightbox de los eventos realizados
//
//  Script clásico (no módulo ES): sus funciones quedan globales para que
//  main.js las arranque y las páginas (portada.js, mi-evento.js…) las usen.
// ============================================================================

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
