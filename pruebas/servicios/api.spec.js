// ============================================================================
//  pruebas/servicios/api.spec.js — validadores de la API y servicio de contacto (Jest)
// ============================================================================

jest.mock('../../src/db', () => require('../apoyo/db-memoria').crear());
jest.mock('../../src/servicios/reservas', () => ({ crear: jest.fn(async () => ({ codigo: 'AEES-NUEVA' })), preparar: jest.fn() }));

const db = require('../../src/db');
const reservas = require('../../src/servicios/reservas');
const contacto = require('../../src/servicios/contacto');
const asistente = require('../../src/servicios/asistente');
const { leerDatosCliente, leerContacto, leerEncuesta, leerEncuestaRapida, coordenadas, fechaValida } = require('../../src/validadores/api');

beforeEach(() => db.reiniciar({ tablas: { mensajes: [] } }));

describe('validadores de la API', () => {
  test('coordenadas fuera del planeta se descartan', () => {
    expect(coordenadas({ lat: -13.5, lng: -71.9 })).toEqual({ lat: -13.5, lng: -71.9 });
    expect(coordenadas({ lat: 999, lng: 0 })).toBeNull();
  });

  test('fechaValida solo acepta AAAA-MM-DD', () => {
    expect(fechaValida('2030-03-01')).toBe('2030-03-01');
    expect(fechaValida('01/03/2030')).toBeNull();
  });

  test('la encuesta sin tipo conocido queda como "otro" y con 50 personas', () => {
    expect(leerEncuesta({ tipo_evento: 'inventado' }).encuesta).toMatchObject({ tipo_evento: 'otro', personas: 50, espacio: 'interior' });
  });

  test('el cotizador rápido limita las personas entre 5 y 3000', () => {
    expect(leerEncuestaRapida({ personas: 1 }).encuesta.personas).toBe(5);
    expect(leerEncuestaRapida({ personas: 99999 }).encuesta.personas).toBe(3000);
  });

  test('datos del cliente: DNI de 8, celular peruano y aceptar el uso de datos', () => {
    const { campos } = leerDatosCliente({ nombre: 'Ana Quispe', dni: '123', celular: '12345', acepta: false });
    expect(Object.keys(campos).sort()).toEqual(['acepta', 'celular', 'dni']);
    expect(leerDatosCliente({ nombre: 'Ana Quispe', dni: '12345678', celular: '+51 987 654 321', acepta: true }).campos).toEqual({});
  });
});

describe('servicio de contacto', () => {
  test('un contacto incompleto se rechaza con los campos a marcar', async () => {
    await expect(contacto.guardarContacto(leerContacto({ nombre: 'A' }))).rejects.toMatchObject({ status: 400, extra: { campos: expect.objectContaining({ nombre: 'Escribe tu nombre.' }) } });
    expect(db._tabla('mensajes')).toHaveLength(0);
  });

  test('un contacto válido queda en Mensajes sin leer', async () => {
    await contacto.guardarContacto(leerContacto({ nombre: 'Rosa', telefono: '987 111 222', mensaje: 'Quiero cotizar una boda en Urubamba.' }));
    expect(db._tabla('mensajes')[0]).toMatchObject({ tipo: 'contacto', leido: false, nombre: 'Rosa' });
  });

  test('pedir reunión exige nombre y celular', async () => {
    await expect(contacto.solicitarReunion({ nombre: 'Rosa', telefono: '12' })).rejects.toMatchObject({ status: 400 });
  });

  test('no se crea la reserva si los datos del cliente están mal', async () => {
    await expect(contacto.reservar({ cliente: leerDatosCliente({}) })).rejects.toMatchObject({ status: 400 });
    expect(reservas.crear).not.toHaveBeenCalled();
  });

  test('con datos correctos devuelve el código y el enlace de la reserva', async () => {
    const r = await contacto.reservar({ usuario: { id: 'c1' }, carrito: {}, cliente: leerDatosCliente({ nombre: 'Ana Quispe', dni: '12345678', celular: '987654321', acepta: true }) });
    expect(r).toEqual({ codigo: 'AEES-NUEVA', url: '/reservas/AEES-NUEVA' });
  });
});

describe('asistente', () => {
  test('un texto muy corto no se interpreta (400)', async () => {
    await expect(asistente.interpretar('hola')).rejects.toMatchObject({ status: 400 });
  });

  test('sin punto en el mapa no hay ruta (400)', async () => {
    await expect(asistente.rutaDesdeAlmacen(null)).rejects.toThrow('Marca un punto en el mapa.');
  });
});
