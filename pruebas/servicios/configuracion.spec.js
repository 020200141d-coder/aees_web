// ============================================================================
//  pruebas/servicios/configuracion.spec.js — ajustes, promociones, fotos y respaldo (Jest)
// ============================================================================

jest.mock('../../src/db', () => require('../apoyo/db-memoria').crear());
jest.mock('../../src/servicios/negocio', () => ({ invalidar: jest.fn() }));

const db = require('../../src/db');
const negocio = require('../../src/servicios/negocio');
const ajustes = require('../../src/servicios/ajustes');
const promociones = require('../../src/servicios/promociones');
const panel = require('../../src/servicios/panel');
const respaldo = require('../../src/servicios/respaldo');
const { leerPromo } = require('../../src/validadores/promociones');
const { leerReglas } = require('../../src/validadores/ajustes');

beforeEach(() => db.reiniciar({ tablas: { promociones: [{ id: 'p1', codigo: 'BIENVENIDA5', porcentaje: 5 }] }, ajustes: { negocio: { nombre: 'AeeS Acústico', whatsapp: '51900000000' } } }));

describe('ajustes del negocio', () => {
  test('un WhatsApp sin el 51 se rechaza (422) y no se guarda', async () => {
    await expect(ajustes.guardarNegocio({ whatsapp: '987166001', almacen_lat: '-13.5', almacen_lng: '-71.9' })).rejects.toMatchObject({ status: 422 });
    expect((await db.ajuste('negocio')).whatsapp).toBe('51900000000');
  });

  test('al guardar se conserva lo que el formulario no envía y se limpia la caché', async () => {
    await ajustes.guardarNegocio({ whatsapp: '51987166001', almacen_lat: '-13.53', almacen_lng: '-71.89' });
    expect(await db.ajuste('negocio')).toMatchObject({ nombre: 'AeeS Acústico', whatsapp: '51987166001', almacen: { lat: -13.53, lng: -71.89 } });
    expect(negocio.invalidar).toHaveBeenCalled();
  });

  test('las reglas fuera de rango no pasan (adelanto menor a 10 %)', () => {
    expect(leerReglas({ adelanto_pct: '5' }).error).toMatch(/adelanto 10–100 %/);
  });
});

describe('promociones', () => {
  test('el descuento va de 1 a 50 %', () => {
    expect(leerPromo({ codigo: 'REGALO', porcentaje: '80' }).errores.porcentaje).toBeDefined();
  });

  test('no puede haber dos promociones con el mismo código', async () => {
    const { datos, errores } = leerPromo({ codigo: 'bienvenida5', porcentaje: '10' });
    expect((await promociones.guardar(datos, null, errores)).codigo).toBe('Ya existe ese código.');
  });

  test('al editar, la promoción conserva su propio código', async () => {
    const { datos, errores } = leerPromo({ codigo: 'BIENVENIDA5', porcentaje: '8', activo: 'on' });
    expect(await promociones.guardar(datos, 'p1', errores)).toEqual({});
    expect((await db.obtener('promociones', 'p1')).porcentaje).toBe(8);
  });
});

describe('fotos y respaldo', () => {
  test('solo se aceptan fotos JPG, PNG o WEBP (400)', async () => {
    await expect(panel.guardarFoto('data:text/plain;base64,AAAA')).rejects.toMatchObject({ status: 400 });
  });

  test('un archivo que no es respaldo de AeeS no se restaura (400)', async () => {
    await expect(respaldo.restaurar({ equipos: [{ nombre: 'sin id' }] })).rejects.toMatchObject({ status: 400 });
  });
});
