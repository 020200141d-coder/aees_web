// ============================================================================
//  pruebas/servicios/reservas-admin.spec.js — reglas de reservas del panel (Jest)
//
//  Se reemplazan la base (db en memoria) y los servicios vecinos (catálogo y
//  reservas) por dobles de prueba: así se prueba SOLO la regla de este servicio.
// ============================================================================

jest.mock('../../src/db', () => require('../apoyo/db-memoria').crear());
jest.mock('../../src/servicios/reservas', () => ({ recalcular: jest.fn(async () => ({})), registrarPago: jest.fn(async () => ({})), crear: jest.fn() }));
jest.mock('../../src/servicios/catalogo', () => ({
  equipos: jest.fn(async () => [{ id: 'eon615', nombre: 'JBL EON615' }]),
  disponibilidad: jest.fn(async () => ({ eon615: 1 })),
  mapaPorId: lista => Object.fromEntries(lista.map(e => [e.id, e])),
  faltantes: jest.fn((items, libres, mapa) => items.filter(i => (libres[i.equipo_id] || 0) < i.cantidad).map(i => ({ nombre: mapa[i.equipo_id].nombre, libre: libres[i.equipo_id] || 0, pedido: i.cantidad })))
}));

const db = require('../../src/db');
const reservas = require('../../src/servicios/reservas');
const srv = require('../../src/servicios/reservas-admin');

const BASE = { id: 'r1', codigo: 'AEES-TEST1', estado: 'pendiente_pago', fecha_evento: '2099-05-10', horas: 6, total: 400, adelanto: 160, adelanto_pct: 40, pagado: 100, items: [{ equipo_id: 'eon615', cantidad: 2 }], reunion: null, encuesta: {} };
const reserva = extra => ({ ...BASE, ...extra });

beforeEach(() => db.reiniciar({ tablas: { reservas: [reserva()], pagos: [{ id: 'p1', reserva_id: 'r1', estado: 'pendiente' }], usuarios: [{ id: 'c1', rol: 'cliente', nombre: 'Ana' }, { id: 'a1', rol: 'admin', nombre: 'Jefe' }] } }));

describe('confirmar una reserva', () => {
  test('sin reunión agendada por AeeS se rechaza con 409', async () => {
    await expect(srv.cambiarEstado(reserva(), 'confirmada')).rejects.toMatchObject({ status: 409 });
    expect((await db.obtener('reservas', 'r1')).estado).toBe('pendiente_pago');
  });

  test('con la reunión agendada por el admin se confirma y deja de vencer', async () => {
    await srv.cambiarEstado(reserva({ reunion: { agendada_por: 'admin' } }), 'confirmada');
    const r = await db.obtener('reservas', 'r1');
    expect(r.estado).toBe('confirmada');
    expect(r.expira_en).toBeNull();
  });
});

describe('editar el evento', () => {
  test('una reserva completada no se edita (409)', async () => {
    await expect(srv.editarEvento(reserva({ estado: 'completada' }), { ...BASE })).rejects.toMatchObject({ status: 409 });
  });

  test('no se puede mover a una fecha pasada (422)', async () => {
    await expect(srv.editarEvento(reserva(), { ...BASE, fecha_evento: '2000-01-01' })).rejects.toMatchObject({ status: 422 });
  });

  test('si en la nueva fecha no alcanzan los equipos se rechaza (409)…', async () => {
    await expect(srv.editarEvento(reserva(), { ...BASE, fecha_evento: '2099-06-01' })).rejects.toThrow('no alcanzan: JBL EON615 (hay 1 de 2)');
  });

  test('…salvo que el admin lo cubra con un proveedor aliado', async () => {
    await srv.editarEvento(reserva(), { ...BASE, fecha_evento: '2099-06-01' }, { permitirFaltantes: true });
    expect((await db.obtener('reservas', 'r1')).fecha_evento).toBe('2099-06-01');
  });
});

describe('ajustar el precio', () => {
  test('el total no puede quedar por debajo de lo ya pagado (422)', async () => {
    await expect(srv.ajustarPrecio(reserva(), { nuevo: 50, motivo: 'rebaja grande' }, 'jefe@aees.pe')).rejects.toMatchObject({ status: 422 });
  });

  test('exige un motivo de al menos 5 letras', () => {
    expect(srv.errorAjustePrecio(reserva(), { nuevo: 500, motivo: 'x' })).toMatch(/motivo/);
  });

  test('una reserva cancelada ya no cambia de precio', () => {
    expect(srv.errorAjustePrecio(reserva({ estado: 'cancelada' }), { nuevo: 500, motivo: 'motivo válido' })).toMatch(/ya no se puede cambiar/);
  });

  test('un ajuste válido recalcula el adelanto y queda en el historial', async () => {
    await srv.ajustarPrecio(reserva(), { nuevo: 500, motivo: 'se agregó un parlante' }, 'jefe@aees.pe');
    const r = await db.obtener('reservas', 'r1');
    expect(r.total).toBe(500);
    expect(r.adelanto).toBe(200);
    expect(r.encuesta.historial_precios[0]).toMatchObject({ por: 'jefe@aees.pe', de: 400, a: 500, motivo: 'se agregó un parlante' });
    expect(reservas.recalcular).toHaveBeenCalledWith('r1');
  });
});

describe('pagos y reunión', () => {
  test('un pago manual de 0 se rechaza (422) y no se registra', async () => {
    await expect(srv.pagoManual(reserva(), { monto: 0 }, 'jefe@aees.pe')).rejects.toMatchObject({ status: 422 });
    expect(reservas.registrarPago).not.toHaveBeenCalled();
  });

  test('la reunión no puede ser después del día del evento', async () => {
    const reunion = { valida: true, datos: { fecha: '2099-06-01', hora: '10:00', modalidad: 'llamada', nota: '' } };
    await expect(srv.agendarReunion(reserva(), reunion, 'jefe@aees.pe')).rejects.toMatchObject({ status: 422 });
  });

  test('aprobar un pago lo marca y recalcula la reserva', async () => {
    await srv.resolverPago('p1', 'aprobar');
    expect((await db.obtener('pagos', 'p1')).estado).toBe('aprobado');
    expect(reservas.recalcular).toHaveBeenCalledWith('r1');
  });

  test('una acción desconocida sobre un pago devuelve null', async () => {
    expect(await srv.resolverPago('p1', 'borrar')).toBeNull();
  });

  test('solo se crea una reserva para una cuenta de cliente', async () => {
    await expect(srv.crearDesdePanel({ clienteId: 'a1', carrito: {} })).rejects.toThrow('Elige el cliente');
  });
});
