// ============================================================================
//  pruebas/servicios/combos.spec.js — validación y reglas de combos (Jest)
// ============================================================================

jest.mock('../../src/db', () => require('../apoyo/db-memoria').crear());

const db = require('../../src/db');
const combos = require('../../src/servicios/combos');
const { leerCombo, slugCombo } = require('../../src/validadores/combos');

const mapa = { eon615: { id: 'eon615', nombre: 'JBL EON615' }, sm58: { id: 'sm58', nombre: 'Shure SM58' } };
const formulario = extra => ({
  nombre: 'Combo cumpleaños', precio: '250', tipos_evento: ['cumpleanos'], personas_min: '20', personas_max: '80', horas_base: '6',
  items: { 0: { equipo_id: 'eon615', cantidad: '2' } }, ...extra
});

beforeEach(() => db.reiniciar({ tablas: { combos: [{ id: 'combo-cumpleanos', nombre: 'Combo cumpleaños', publicado: true }] } }));

describe('leerCombo (validador)', () => {
  test('un formulario correcto no tiene errores', () => {
    expect(leerCombo(formulario(), mapa).errores).toEqual({});
  });

  test('descarta equipos que no existen y exige al menos uno', () => {
    const { datos, errores } = leerCombo(formulario({ items: { 0: { equipo_id: 'fantasma', cantidad: '3' } } }), mapa);
    expect(datos.items).toEqual([]);
    expect(errores.items).toBeDefined();
  });

  test('el máximo de personas no puede ser menor que el mínimo', () => {
    expect(leerCombo(formulario({ personas_min: '100', personas_max: '50' }), mapa).errores.personas_max).toBeDefined();
  });

  test('las horas base van de 1 a 24', () => {
    expect(leerCombo(formulario({ horas_base: '30' }), mapa).errores.horas_base).toBeDefined();
  });

  test('un adicional sin etiqueta se describe solo con cantidad y nombre', () => {
    const { datos } = leerCombo(formulario({ adicionales: { 0: { equipo_id: 'sm58', cantidad: '2', precio: '40' } } }), mapa);
    expect(datos.adicionales[0].etiqueta).toBe('2× Shure SM58');
  });
});

describe('crear combo', () => {
  test('el id sale del nombre sin tildes ni símbolos', () => {
    expect(slugCombo('Combo Grande · DJ')).toBe('combo-grande-dj');
  });

  test('si el id ya existe se agrega un sufijo para no pisar el otro combo', async () => {
    const nuevo = await combos.crear({ nombre: 'Combo cumpleaños' });
    expect(nuevo.id).toMatch(/^combo-cumpleanos-[0-9a-f]{4}$/);
    expect(db._tabla('combos')).toHaveLength(2);
  });

  test('alternarPublicado devuelve null si el combo no existe', async () => {
    expect(await combos.alternarPublicado('no-existe')).toBeNull();
    expect(await combos.alternarPublicado('combo-cumpleanos')).toBe(false);
  });
});
