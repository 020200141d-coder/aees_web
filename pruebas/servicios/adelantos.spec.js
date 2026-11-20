// ============================================================================
//  pruebas/servicios/adelantos.spec.js — pago del adelanto y reunión del cliente (Jest)
// ============================================================================

jest.mock('../../src/db', () => {
  const db = require('../apoyo/db-memoria').crear();
  db.guardarPrivado = jest.fn(async () => {}); // el comprobante "se guarda" sin tocar disco
  return db;
});
jest.mock('../../src/servicios/reservas', () => ({ registrarPago: jest.fn(async () => ({})) }));
jest.mock('../../src/servicios/negocio', () => ({ obtener: async () => ({ negocio: { whatsapp: '51987166001' } }) }));
jest.mock('../../src/servicios/catalogo', () => ({ disponibilidad: jest.fn(async () => ({})) }));

const db = require('../../src/db');
const reservas = require('../../src/servicios/reservas');
const adelantos = require('../../src/servicios/adelantos');
const sitio = require('../../src/servicios/sitio');
const { leerComprobante } = require('../../src/validadores/pagos');
const { leerReunion } = require('../../src/validadores/reservas');

const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const R = { id: 'r1', codigo: 'AEES-PAGO1', usuario_id: 'c1', estado: 'pendiente_pago', fecha_evento: '2099-03-01', adelanto: 160, pagado: 40 };

beforeEach(() => db.reiniciar({ tablas: { reservas: [R], pagos: [] } }));

describe('quién puede pagar', () => {
  test('una reserva que no existe → 404', async () => {
    await expect(adelantos.reservaPropia('AEES-NADA', { id: 'c1' })).rejects.toMatchObject({ status: 404 });
  });

  test('una reserva ajena → 403 (salvo el admin)', async () => {
    await expect(adelantos.reservaPropia('AEES-PAGO1', { id: 'c9', rol: 'cliente' })).rejects.toMatchObject({ status: 403 });
    expect((await adelantos.reservaPropia('AEES-PAGO1', { id: 'a1', rol: 'admin' })).id).toBe('r1');
  });
});

describe('comprobante de Yape / Plin', () => {
  test('lo que falta pagar es el adelanto menos lo ya pagado', () => {
    expect(adelantos.porPagar(R)).toBe(120);
    expect(adelantos.porPagar({ adelanto: 100, pagado: 150 })).toBe(0);
  });

  test('el n.º de operación debe tener de 6 a 12 dígitos', async () => {
    await expect(adelantos.enviarComprobante(R, leerComprobante({ operacion: '12', foto: FOTO }))).rejects.toThrow('entre 6 y 12 dígitos');
  });

  test('sin foto válida se rechaza', async () => {
    await expect(adelantos.enviarComprobante(R, leerComprobante({ operacion: '1234567', foto: 'texto' }))).rejects.toThrow('Sube la foto');
  });

  test('uno válido queda pendiente por el monto que falta y arma el WhatsApp', async () => {
    const r = await adelantos.enviarComprobante(R, leerComprobante({ metodo: 'plin', operacion: '1234567', foto: FOTO }));
    expect(reservas.registrarPago).toHaveBeenCalledWith(R, expect.objectContaining({ metodo: 'yape', monto: 120, estado: 'pendiente', referencia: '1234567' }));
    expect(decodeURIComponent(r.whatsapp)).toContain('con Plin');
  });

  test('no se acepta un segundo comprobante mientras el primero está en revisión', async () => {
    await db.insertar('pagos', { reserva_id: 'r1', metodo: 'yape', estado: 'pendiente', referencia: '1111111' });
    await expect(adelantos.enviarComprobante(R, leerComprobante({ operacion: '2222222', foto: FOTO }))).rejects.toMatchObject({ status: 409 });
  });

  test('una reserva ya pagada no recibe más comprobantes', async () => {
    await expect(adelantos.enviarComprobante({ ...R, estado: 'adelanto_pagado' }, leerComprobante({ operacion: '1234567', foto: FOTO }))).rejects.toMatchObject({ status: 409 });
  });
});

describe('reunión propuesta por el cliente', () => {
  test('debe ser entre hoy y el día del evento', async () => {
    await expect(sitio.proponerReunion(R, leerReunion({ fecha: '2000-01-01', hora: '10:00', modalidad: 'llamada' }))).rejects.toMatchObject({ status: 422 });
  });

  test('si AeeS ya la agendó, el cliente no la cambia (aviso)', async () => {
    await expect(sitio.proponerReunion({ ...R, reunion: { agendada_por: 'admin' } }, leerReunion({}))).rejects.toMatchObject({ status: 409, extra: { tipo: 'aviso' } });
  });

  test('una propuesta válida se guarda', async () => {
    await sitio.proponerReunion(R, leerReunion({ fecha: '2099-02-01', hora: '10:00', modalidad: 'videollamada' }));
    expect((await db.obtener('reservas', 'r1')).reunion).toMatchObject({ fecha: '2099-02-01', modalidad: 'videollamada' });
  });
});
