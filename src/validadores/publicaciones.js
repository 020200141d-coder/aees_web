// ============================================================================
//  src/validadores/publicaciones.js — formulario de la Galería (eventos realizados)
// ============================================================================

const { texto } = require('../lib/util');
const { marcado, entero, urlImagen } = require('./formulario');

// Tipos de evento que se pueden mostrar en la galería pública.
const TIPOS_PUB = { boda: 'Boda', fiesta: 'Fiesta', concierto: 'Concierto', corporativo: 'Corporativo', conferencia: 'Conferencia / ceremonia', electronica: 'Electrónica' };

function leerPublicacion(b) {
  const d = {
    titulo: texto(b.titulo, 100),
    tipo: TIPOS_PUB[b.tipo] ? b.tipo : 'fiesta',
    texto: String(b.texto || '').trim().slice(0, 600),
    imagen: urlImagen(b.imagen),
    imagen_fuente: texto(b.imagen_fuente, 120),
    publicado: marcado(b.publicado),
    orden: entero(b.orden)
  };
  const e = {};
  if (d.titulo.length < 3) e.titulo = 'El título es obligatorio.';
  // Aquí la foto es obligatoria: una publicación de la galería sin foto no tiene sentido.
  if (!d.imagen) e.imagen = 'Sube una foto o pega una URL https.';
  return { datos: d, errores: e };
}

module.exports = { leerPublicacion, TIPOS_PUB };
