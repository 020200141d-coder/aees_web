// ============================================================================
//  pruebas/validadores/publicaciones.spec.js — formulario de la Galería (Jest)
// ============================================================================

const { leerPublicacion } = require('../../src/validadores/publicaciones');
const { urlImagen } = require('../../src/validadores/formulario');

describe('leerPublicacion', () => {
  test('exige título de 3 letras y una foto', () => {
    const { errores } = leerPublicacion({ titulo: 'x' });
    expect(Object.keys(errores).sort()).toEqual(['imagen', 'titulo']);
  });

  test('un tipo desconocido pasa a "fiesta"', () => {
    expect(leerPublicacion({ titulo: 'Boda', tipo: 'inventado', imagen: '/img/a.webp' }).datos.tipo).toBe('fiesta');
  });

  test('una publicación correcta no tiene errores', () => {
    expect(leerPublicacion({ titulo: 'Boda en Urubamba', tipo: 'boda', imagen: 'https://ejemplo.com/a.jpg' }).errores).toEqual({});
  });
});

describe('urlImagen (regla compartida por todos los formularios)', () => {
  test('acepta https y rutas propias; rechaza http y otros esquemas', () => {
    expect(urlImagen('https://x.com/a.jpg')).toBe('https://x.com/a.jpg');
    expect(urlImagen('/uploads/a.webp')).toBe('/uploads/a.webp');
    expect(urlImagen('http://x.com/a.jpg')).toBeNull();
    expect(urlImagen('javascript:alert(1)')).toBeNull();
    expect(urlImagen('')).toBe('');
  });
});
