// ============================================================================
//  pruebas/servicios/usuarios.spec.js — reglas de las cuentas del personal (Jest)
//
//  Protegen al negocio de quedarse sin dueño: la cuenta principal, la propia
//  cuenta y el último administrador no se pueden borrar ni degradar.
// ============================================================================

jest.mock('../../src/db', () => require('../apoyo/db-memoria').crear());

process.env.ADMIN_EMAIL = 'dueno@aees.pe';
const db = require('../../src/db');
const usuarios = require('../../src/servicios/usuarios');
const { hashClave } = require('../../src/lib/seguridad');
const { leerCuentaNueva, claveDebil } = require('../../src/validadores/usuarios');

const CLAVE = 'ClaveSegura2026';
const dueno = { id: 'u1', rol: 'admin', email: 'dueno@aees.pe', nombre: 'Dueño' };
const admin2 = { id: 'u2', rol: 'admin', email: 'socio@aees.pe', nombre: 'Socio' };
const publi = { id: 'u3', rol: 'publicador', email: 'publi@aees.pe', nombre: 'Publi' };

beforeEach(() => db.reiniciar({ tablas: { usuarios: [{ ...dueno, clave_hash: hashClave(CLAVE) }, admin2, publi, { id: 'c1', rol: 'cliente', email: 'cli@gmail.com', nombre: 'Cliente' }] } }));

describe('eliminar cuentas', () => {
  test('nadie elimina su propia cuenta (409)', async () => {
    await expect(usuarios.eliminar('u2', admin2)).rejects.toMatchObject({ status: 409, message: 'No puedes eliminar tu propia cuenta.' });
  });

  test('la cuenta principal del negocio no se elimina', async () => {
    await expect(usuarios.eliminar('u1', admin2)).rejects.toThrow('La cuenta principal del negocio no se puede eliminar.');
  });

  test('siempre queda al menos un administrador', async () => {
    await db.eliminar('usuarios', 'u1'); // queda un solo admin (u2)
    await expect(usuarios.eliminar('u2', publi)).rejects.toThrow('Debe quedar al menos un administrador.');
  });

  test('un cliente no se trata como cuenta del personal (404)', async () => {
    await expect(usuarios.eliminar('c1', dueno)).rejects.toMatchObject({ status: 404 });
  });

  test('un publicador sí se puede quitar', async () => {
    await usuarios.eliminar('u3', dueno);
    expect(db._tabla('usuarios').map(u => u.id)).not.toContain('u3');
  });
});

describe('cambiar el rol', () => {
  test('la cuenta principal siempre es administradora', async () => {
    const { errores } = await usuarios.actualizar(dueno, { nombre: 'Dueño', rol: 'publicador' }, admin2);
    expect(errores.rol).toMatch(/cuenta principal/);
  });

  test('nadie se quita a sí mismo el rol de admin', async () => {
    const { errores } = await usuarios.actualizar(admin2, { nombre: 'Socio', rol: 'publicador' }, admin2);
    expect(errores.rol).toMatch(/a ti mismo/);
  });

  test('una contraseña nueva débil no se guarda', async () => {
    const { errores } = await usuarios.actualizar(publi, { nombre: 'Publi', rol: 'publicador', claveNueva: 'corta' }, dueno);
    expect(errores.clave_nueva).toBeDefined();
  });
});

describe('crear e ingresar', () => {
  test('el correo de una cuenta es único', async () => {
    const { datos, clave, errores } = leerCuentaNueva({ nombre: 'Otro', email: 'PUBLI@aees.pe', rol: 'publicador', clave: 'OtraClave2026' });
    expect((await usuarios.crear(datos, clave, errores)).errores.email).toBe('Ese correo ya tiene cuenta.');
  });

  test('la contraseña se guarda con hash, nunca en texto plano', async () => {
    const { datos, clave, errores } = leerCuentaNueva({ nombre: 'Nueva', email: 'nueva@aees.pe', clave: 'NuevaClave2026' });
    await usuarios.crear(datos, clave, errores);
    const u = db._tabla('usuarios').find(x => x.email === 'nueva@aees.pe');
    expect(u.clave_hash).toBeDefined();
    expect(JSON.stringify(u)).not.toContain('NuevaClave2026');
  });

  test('autenticar: clave correcta da la cuenta; incorrecta o cliente da null', async () => {
    expect((await usuarios.autenticar('dueno@aees.pe', CLAVE)).id).toBe('u1');
    expect(await usuarios.autenticar('dueno@aees.pe', 'mala')).toBeNull();
    expect(await usuarios.autenticar('cli@gmail.com', CLAVE)).toBeNull();
  });

  test('claveDebil exige 10 caracteres con letras y números', () => {
    expect(claveDebil('abcdefghij')).not.toBeNull();
    expect(claveDebil('abc123')).not.toBeNull();
    expect(claveDebil('abcde12345')).toBeNull();
  });
});
