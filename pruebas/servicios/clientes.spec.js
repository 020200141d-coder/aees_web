// ============================================================================
//  pruebas/servicios/clientes.spec.js — reglas de clientes del panel (Jest)
// ============================================================================

jest.mock('../../src/db', () => require('../apoyo/db-memoria').crear());

const db = require('../../src/db');
const clientes = require('../../src/servicios/clientes');
const { leerCliente } = require('../../src/validadores/clientes');

beforeEach(() => db.reiniciar({
  tablas: {
    usuarios: [{ id: 'c1', rol: 'cliente', nombre: 'Ana Quispe', celular: '987654321', email: 'ana@gmail.com' }, { id: 'c2', rol: 'cliente', nombre: 'Luis Mamani', celular: '912345678' }],
    reservas: [{ id: 'r1', usuario_id: 'c1', estado: 'completada', total: 300, fecha_evento: '2026-10-01' }]
  }
}));

describe('validador de clientes', () => {
  test('deja el celular en 9 dígitos aunque llegue con +51 y espacios', () => {
    expect(leerCliente({ nombre: 'Rosa', celular: '+51 987 111 222' }).celular).toBe('987111222');
  });
});

describe('servicio de clientes', () => {
  test('un celular que ya es de otra persona se rechaza (409)', async () => {
    await expect(clientes.crear(leerCliente({ nombre: 'Rosa', celular: '987654321' }))).rejects.toMatchObject({ status: 409, message: 'Ese celular ya es de Ana Quispe.' });
  });

  test('al editar, el cliente puede conservar su propio celular', async () => {
    await clientes.actualizar('c1', leerCliente({ nombre: 'Ana Q.', celular: '987654321', email: 'ana@gmail.com' }));
    expect((await db.obtener('usuarios', 'c1')).nombre).toBe('Ana Q.');
  });

  test('los errores se juntan en el orden del formulario', async () => {
    await expect(clientes.crear(leerCliente({ nombre: 'A', celular: '123', email: 'malo' }))).rejects.toThrow('Escribe el nombre. Celular de 9 dígitos (empieza en 9). Correo inválido.');
  });

  test('no se elimina un cliente con reservas (409)', async () => {
    await expect(clientes.eliminar({ id: 'c1', nombre: 'Ana Quispe' })).rejects.toMatchObject({ status: 409 });
    expect(db._tabla('usuarios')).toHaveLength(2);
  });

  test('un cliente sin reservas sí se elimina', async () => {
    await clientes.eliminar({ id: 'c2', nombre: 'Luis Mamani' });
    expect(db._tabla('usuarios').map(u => u.id)).toEqual(['c1']);
  });

  test('la tabla suma lo gastado en reservas pagadas', async () => {
    const { clientes: lista, total } = await clientes.tabla();
    expect(total).toBe(2);
    expect(lista.find(c => c.id === 'c1')).toMatchObject({ reservas: 1, pagadas: 1, gastado: 300 });
  });
});
