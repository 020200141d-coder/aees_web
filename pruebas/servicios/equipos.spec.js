// ============================================================================
//  pruebas/servicios/equipos.spec.js — reglas del servicio de equipos (Jest)
//
//  Estas reglas antes vivían dentro de la ruta y solo se podían probar
//  levantando el servidor. Al pasar a servicios/equipos.js se prueban solas,
//  con una base en memoria (pruebas/apoyo/db-memoria.js).
// ============================================================================

jest.mock('../../src/db', () => require('../apoyo/db-memoria').crear());

const db = require('../../src/db');
const equipos = require('../../src/servicios/equipos');
const { ErrorNegocio } = require('../../src/lib/errores');

const SEMILLA = {
  tablas: {
    equipos: [
      { id: 'eon615', codigo: 'EON615', nombre: 'JBL EON615', marca: 'JBL', modelo: 'EON615', categoria: 'audio', rol: 'parlante', publicado: true, estado: 'operativo', orden: 2 },
      { id: 'sm58', codigo: 'SM58', nombre: 'Shure SM58', marca: 'Shure', modelo: 'SM58', categoria: 'audio', rol: 'microfono', publicado: true, estado: 'operativo', orden: 1 },
      { id: 'tacho-54', codigo: 'TACHO-54', nombre: 'Tacho LED', marca: '', modelo: '', categoria: 'luces', rol: 'tacho', publicado: true, estado: 'operativo', orden: 3 }
    ],
    combos: [
      { id: 'combo-a', nombre: 'Combo A', items: [{ equipo_id: 'eon615', cantidad: 2 }], adicionales: [] },
      { id: 'combo-b', nombre: 'Combo B', items: [{ equipo_id: 'sm58', cantidad: 1 }], adicionales: [{ equipo_id: 'tacho-54', cantidad: 4 }] }
    ]
  }
};

beforeEach(() => db.reiniciar(SEMILLA));

describe('eliminar un equipo', () => {
  test('si está en un combo se rechaza con ErrorNegocio 409 y no se borra', async () => {
    await expect(equipos.eliminar('eon615')).rejects.toMatchObject({ name: 'ErrorNegocio', status: 409 });
    expect(db._tabla('equipos').map(e => e.id)).toContain('eon615');
  });

  test('el mensaje nombra los combos que lo usan', async () => {
    await expect(equipos.eliminar('eon615')).rejects.toThrow('«Combo A»');
  });

  test('también cuenta si está solo como adicional de un combo', async () => {
    await expect(equipos.eliminar('tacho-54')).rejects.toBeInstanceOf(ErrorNegocio);
  });

  test('si ningún combo lo usa, se elimina', async () => {
    await db.actualizar('combos', 'combo-b', { items: [], adicionales: [] });
    await equipos.eliminar('sm58');
    expect(db._tabla('equipos').map(e => e.id)).not.toContain('sm58');
  });
});

describe('crear un equipo', () => {
  test('el id es el código en minúsculas', async () => {
    const e = await equipos.crear({ codigo: 'XLR-10', nombre: 'Cable XLR' });
    expect(e.id).toBe('xlr-10');
  });

  test('un código repetido da 409 y marca el campo "codigo"', async () => {
    await expect(equipos.crear({ codigo: 'EON615', nombre: 'Otro' })).rejects.toMatchObject({ status: 409, campo: 'codigo' });
  });
});

describe('cambios rápidos', () => {
  test('alternarPublicado invierte el valor y lo devuelve', async () => {
    expect(await equipos.alternarPublicado('sm58')).toBe(false);
    expect(await equipos.alternarPublicado('sm58')).toBe(true);
  });

  test('alternarPublicado de un equipo que no existe devuelve null', async () => {
    expect(await equipos.alternarPublicado('no-existe')).toBeNull();
  });

  test('cambiarEstado solo acepta operativo, mantenimiento o baja', async () => {
    expect(await equipos.cambiarEstado('sm58', 'roto')).toBe(false);
    expect(await equipos.cambiarEstado('sm58', 'mantenimiento')).toBe(true);
    expect((await db.obtener('equipos', 'sm58')).estado).toBe('mantenimiento');
  });
});

describe('listar', () => {
  test('filtra por categoría y busca por texto, ordenado por "orden"', async () => {
    expect((await equipos.listar({ categoria: 'audio' })).map(e => e.id)).toEqual(['sm58', 'eon615']);
    expect((await equipos.listar({ q: 'shure' })).map(e => e.id)).toEqual(['sm58']);
  });

  test('una categoría desconocida no filtra', async () => {
    expect(await equipos.listar({ categoria: 'inventada' })).toHaveLength(3);
  });
});
