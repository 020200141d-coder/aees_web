// ============================================================================
//  pruebas/servicios/cuentas.spec.js — registro e ingreso de clientes (Jest)
// ============================================================================

jest.mock('../../src/db', () => require('../apoyo/db-memoria').crear());
jest.mock('../../src/servicios/resenas', () => {
  let lista = [];
  return {
    _reiniciar: l => { lista = l; },
    todas: jest.fn(async () => lista),
    validar: b => ({ datos: { nombre: b.nombre, texto: b.texto, evento: b.evento }, errores: String(b.texto || '').length < 10 ? { texto: 'Escribe al menos una frase (10 letras).' } : {} }),
    agregar: jest.fn(async (datos, extra) => { lista.push({ ...datos, ...extra }); })
  };
});

const db = require('../../src/db');
const resenas = require('../../src/servicios/resenas');
const cuentas = require('../../src/servicios/cuentas');
const { hashClave } = require('../../src/lib/seguridad');
const { leerIngreso, ocultarCorreo, volverCliente } = require('../../src/validadores/cuenta');

beforeEach(() => {
  resenas._reiniciar([]);
  db.reiniciar({
    tablas: {
      usuarios: [
        { id: 'c1', rol: 'cliente', nombre: 'Ana Quispe', email: 'ana@gmail.com', celular: '987654321' },
        { id: 'c2', rol: 'cliente', nombre: 'Luis Antiguo', celular: '912345678', clave_hash: hashClave('123456') },
        { id: 'a1', rol: 'admin', nombre: 'Jefe', email: 'jefe@aees.pe' }
      ],
      reservas: [
        { id: 'r1', codigo: 'AEES-AAAA1', usuario_id: 'c1', estado: 'completada', tipo_evento: 'cumpleanos', fecha_evento: '2026-10-01' },
        { id: 'r2', codigo: 'AEES-BBBB2', usuario_id: 'c1', estado: 'confirmada', tipo_evento: 'boda', fecha_evento: '2026-12-01' }
      ]
    }
  });
});

const ingreso = b => cuentas.ingresar(leerIngreso(b));

describe('ingresar con correo y celular', () => {
  test('un cliente existente entra si el celular coincide', async () => {
    expect((await ingreso({ email: 'ANA@gmail.com', celular: '+51 987 654 321' })).id).toBe('c1');
  });

  test('si el celular no coincide se rechaza (409)', async () => {
    await expect(ingreso({ email: 'ana@gmail.com', celular: '911111111' })).rejects.toMatchObject({ status: 409 });
  });

  test('el correo del personal no entra por aquí (403)', async () => {
    await expect(ingreso({ email: 'jefe@aees.pe', celular: '987654321' })).rejects.toMatchObject({ status: 403 });
  });

  test('un celular de otro correo se rechaza mostrando el correo a medias', async () => {
    await expect(ingreso({ email: 'nueva@gmail.com', celular: '987654321' })).rejects.toThrow('(a•a@gmail.com)');
  });

  test('una cuenta nueva sin nombre pide el nombre', async () => {
    await expect(ingreso({ email: 'nueva@gmail.com', celular: '955555555' })).rejects.toMatchObject({ extra: { nuevo: true } });
  });

  test('una cuenta nueva con nombre se crea como cliente', async () => {
    const u = await ingreso({ email: 'nueva@gmail.com', celular: '955555555', nombre: 'Rosa' });
    expect(u).toMatchObject({ rol: 'cliente', email: 'nueva@gmail.com', celular: '955555555' });
  });

  test('cuenta antigua con PIN: lo pide, rechaza uno malo y une el correo con el bueno', async () => {
    await expect(ingreso({ email: 'luis@gmail.com', celular: '912345678' })).rejects.toMatchObject({ extra: { pedirPin: true } });
    await expect(ingreso({ email: 'luis@gmail.com', celular: '912345678', pin: '000000' })).rejects.toThrow('El PIN no coincide');
    const u = await ingreso({ email: 'luis@gmail.com', celular: '912345678', pin: '123456' });
    expect(u).toMatchObject({ id: 'c2', email: 'luis@gmail.com' });
  });
});

describe('completar el registro después de Google', () => {
  test('el celular no puede ser de otra cuenta (409)', async () => {
    await expect(cuentas.completarRegistro({ id: 'c3' }, { celular: '987654321', nombre: 'Pepe' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('reseña del cliente', () => {
  const usuario = { id: 'c1', nombre: 'Ana Quispe' };

  test('solo de un evento propio y completado', async () => {
    await expect(cuentas.dejarResena(usuario, { texto: 'Todo salió excelente' }, 'AEES-BBBB2')).rejects.toMatchObject({ status: 403 });
  });

  test('se guarda con nombre e inicial del apellido, y no se repite', async () => {
    await cuentas.dejarResena(usuario, { texto: 'Todo salió excelente' }, 'AEES-AAAA1');
    expect(resenas.agregar).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Ana Q.' }), expect.objectContaining({ origen: 'cliente', reserva_codigo: 'AEES-AAAA1' }));
    await expect(cuentas.dejarResena(usuario, { texto: 'Otra vez excelente' }, 'AEES-AAAA1')).rejects.toMatchObject({ status: 409, extra: { tipo: 'aviso' } });
  });
});

describe('validador de cuenta', () => {
  test('ocultarCorreo deja ver solo la primera y la última letra', () => {
    expect(ocultarCorreo('rosario@gmail.com')).toBe('r•••••o@gmail.com');
  });

  test('volverCliente solo acepta rutas internas', () => {
    expect(volverCliente('/mi-evento')).toBe('/mi-evento');
    expect(volverCliente('//evil.com')).toBe('/cuenta');
    expect(volverCliente('https://evil.com')).toBe('/cuenta');
  });

  test('carritoParaRepetir arma los equipos sueltos de una reserva', () => {
    const c = cuentas.carritoParaRepetir({ items: [{ equipo_id: 'eon615', cantidad: 2, precio: 100 }], horas: 6 }, {});
    expect(c).toMatchObject({ combo_id: null, items: [{ equipo_id: 'eon615', cantidad: 2 }], horas: 6 });
  });
});
