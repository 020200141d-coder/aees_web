// ============================================================================
//  test/reglas.test.js — pruebas de las reglas del negocio (sin servidor)
//
//  Ejecutar:  npm test
//  Usa el corredor de pruebas que trae Node (node:test), sin instalar nada.
//  Se prueban las funciones "puras": no tocan la base de datos ni internet,
//  así que siempre dan el mismo resultado.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const semilla = require('../data/semilla.json');
const { factorTiempo, precioUnitario, subtotalEquipos } = require('../src/servicios/precios');
const { carga, evaluarGratis } = require('../src/servicios/transporte');
const { recomendar } = require('../src/servicios/recomendador');
const ia = require('../src/servicios/ia');
const { interpretarReglas } = ia;

const mapa = Object.fromEntries(semilla.equipos.map(e => [e.id, e]));
const libres = Object.fromEntries(semilla.equipos.map(e => [e.id, e.cantidad_total]));
const reglas = semilla.ajustes.reglas;
const combo = id => semilla.combos.find(c => c.id === id);

test('precio por evento de 6 h; cada hora extra cobra la parte proporcional × 0.5', () => {
  assert.equal(factorTiempo(6, 6, 0.5).factor, 1);
  assert.equal(factorTiempo(4, 6, 0.5).factor, 1); // menos horas no baja el precio
  assert.equal(factorTiempo(8, 6, 0.5).horas_extra, 2);
  assert.ok(Math.abs(factorTiempo(8, 6, 0.5).factor - 7 / 6) < 1e-9);
});

test('tachos LED: S/ 25 c/u, S/ 20 desde 13 unidades y S/ 5 menos sin DMX', () => {
  const tacho = mapa['tacho-54'];
  assert.equal(precioUnitario(tacho, 8, true), 25);
  assert.equal(precioUnitario(tacho, 13, true), 20);
  assert.equal(precioUnitario(tacho, 8, false), 20);
  assert.equal(precioUnitario(tacho, 16, false), 15);
});

test('Paquete pequeño: S/ 200 por 6 h; lugar abierto (LA151) +80; sub +100; sub doble +180', () => {
  const c = combo('combo-pequeno');
  assert.equal(subtotalEquipos({ combo: c, items: [], horas: 6 }, mapa, reglas).subtotal, 200);
  const [abierto, sub, doble] = c.adicionales;
  assert.equal(subtotalEquipos({ combo: c, adicionales: [abierto], items: [], horas: 6 }, mapa, reglas).subtotal, 280);
  assert.equal(subtotalEquipos({ combo: c, adicionales: [sub], items: [], horas: 6 }, mapa, reglas).subtotal, 300);
  assert.equal(subtotalEquipos({ combo: c, adicionales: [doble], items: [], horas: 6 }, mapa, reglas).subtotal, 380);
});

test('Combo grande S/ 600; la fiesta electrónica de 8 h cuesta S/ 100 más', () => {
  const c = combo('combo-grande');
  assert.equal(subtotalEquipos({ combo: c, items: [], horas: 6 }, mapa, reglas).subtotal, 600);
  assert.equal(subtotalEquipos({ combo: c, items: [], horas: 8 }, mapa, reglas).subtotal, 700);
});

test('parlante de 15" S/ 100 suelto y S/ 180 el par; line array S/ 180 c/u', () => {
  assert.equal(precioUnitario(mapa.eon615, 1, true), 100);
  assert.equal(precioUnitario(mapa.eon615, 2, true) * 2, 180);
  assert.equal(precioUnitario(mapa.zlx15p, 2, true) * 2, 180);
  assert.equal(precioUnitario(mapa.xrs212, 1, true), 180);
});

test('transporte incluido: paquete en auto, ≤ 15 km, sin cerro y con acceso vehicular', () => {
  assert.equal(evaluarGratis({ vehiculoId: 'auto', viajes: 1, km: 12, altura: 3400, acceso: true }, reglas).gratis, true);
  assert.equal(evaluarGratis({ vehiculoId: 'auto', viajes: 1, km: 12, altura: 3650, acceso: true }, reglas).gratis, false); // cerro
  assert.equal(evaluarGratis({ vehiculoId: 'auto', viajes: 1, km: 40, altura: 3000, acceso: true }, reglas).gratis, false); // lejos
  assert.equal(evaluarGratis({ vehiculoId: 'auto', viajes: 1, km: 5, altura: 3400, acceso: false }, reglas).gratis, false); // sin acceso
  assert.equal(evaluarGratis({ vehiculoId: 'station', viajes: 1, km: 5, altura: 3400, acceso: true }, reglas).gratis, false); // combo grande
});

test('los paquetes pequeño y mediano entran en un auto; el combo grande no', () => {
  const auto = semilla.ajustes.vehiculos.find(v => v.id === 'auto');
  const entra = id => { const c = carga(combo(id).items, mapa); return c.volumen_l <= auto.capacidad_l * 0.85 && c.peso_kg <= auto.capacidad_kg; };
  assert.ok(entra('combo-pequeno'));
  assert.ok(entra('combo-mediano'));
  assert.ok(!entra('combo-grande'));
});

test('el ejemplo del negocio entra en un auto: bajo + 3 EON + consola + 6 tachos + cables', () => {
  const c = carga([
    { equipo_id: 'srx818sp', cantidad: 1 }, { equipo_id: 'eon615', cantidad: 3 },
    { equipo_id: 'soundcraft-8', cantidad: 1 }, { equipo_id: 'tacho-54', cantidad: 6 }, { equipo_id: 'kit-cables', cantidad: 1 }
  ], mapa);
  const auto = semilla.ajustes.vehiculos.find(v => v.id === 'auto');
  assert.ok(c.volumen_l <= auto.capacidad_l * 0.85, `volumen ${c.volumen_l} L no entra`);
  assert.ok(c.peso_kg <= auto.capacidad_kg);
});

test('tarifa Cusco → Urubamba (66 km): auto ≈ S/ 300 y station wagon ≈ S/ 400', () => {
  const [auto, station] = semilla.ajustes.vehiculos;
  assert.ok(Math.abs(auto.base + auto.por_km * 66 - 300) < 5);
  assert.ok(Math.abs(station.base + station.por_km * 66 - 400) < 5);
});

test('conferencia prioriza voz: sin subwoofers y con micrófonos inalámbricos', () => {
  const r = recomendar({ tipo_evento: 'conferencia', personas: 100 }, { mapa, libres, combos: semilla.combos });
  const ids = r.opciones[1].items.map(i => i.equipo_id);
  assert.equal(r.perfil, 'voz');
  assert.ok(!ids.some(id => id.startsWith('srx')));
  assert.ok(ids.includes('shure-inal'));
});

test('fiesta electrónica de 300: perfil SPL, 8 horas, line array y cabezas móviles', () => {
  const r = recomendar({ tipo_evento: 'fiesta_electronica', personas: 300 }, { mapa, libres, combos: semilla.combos });
  const ids = r.opciones[1].items.map(i => i.equipo_id);
  assert.equal(r.perfil, 'spl');
  assert.equal(r.horas, 8);
  assert.ok(ids.includes('xrs212') && ids.includes('beam290'));
  assert.equal(r.combo.id, 'combo-grande');
});

test('fiesta electrónica pequeña: el mínimo es el sistema del DJ (line array + bajo doble + 2 monitores)', () => {
  const r = recomendar({ tipo_evento: 'fiesta_electronica', personas: 60 }, { mapa, libres, combos: semilla.combos });
  const esencial = Object.fromEntries(r.opciones[0].items.map(i => [i.equipo_id, i.cantidad]));
  assert.equal(esencial.xrs212, 2);
  assert.equal(esencial.srx828sp, 1);
  assert.equal(esencial.eon615, 2);
});

test('cumpleaños de 70 en lugar cerrado: 2 EON615, mezcladora pequeña y 2 micros', () => {
  const r = recomendar({ tipo_evento: 'cumpleanos', personas: 70 }, { mapa, libres, combos: semilla.combos });
  const it = Object.fromEntries(r.opciones[1].items.map(i => [i.equipo_id, i.cantidad]));
  assert.equal(it.eon615, 2);
  assert.equal(it['soundcraft-8'], 1);
  assert.equal(it.sm58, 2);
  assert.equal(r.combo.id, 'combo-pequeno');
});

test('cumpleaños de 70 al aire libre: cambia a EAW LA151', () => {
  const r = recomendar({ tipo_evento: 'cumpleanos', personas: 70, espacio: 'exterior' }, { mapa, libres, combos: semilla.combos });
  const ids = r.opciones[1].items.map(i => i.equipo_id);
  assert.ok(ids.includes('la151') && !ids.includes('eon615'));
});

test('DJ en una fiesta de 150: XRS212 con sub doble y 2 EON615 de monitor', () => {
  const r = recomendar({ tipo_evento: 'fiesta', personas: 150, extras: { dj: true } }, { mapa, libres, combos: semilla.combos });
  const it = Object.fromEntries(r.opciones[1].items.map(i => [i.equipo_id, i.cantidad]));
  assert.equal(it.xrs212, 2);
  assert.equal(it.srx828sp, 1);
  assert.equal(it.eon615, 2);
});

test('orquesta de 8 integrantes: 8 micros, 4 monitores y Ui24R; 5 h de show alargan el evento', () => {
  const r = recomendar({ tipo_evento: 'boda', personas: 120, horas: 4, integrantes: 8, horas_grupo: 7, extras: { orquesta: true } }, { mapa, libres, combos: semilla.combos });
  const items = r.opciones[1].items;
  const mics = items.filter(i => mapa[i.equipo_id].rol === 'mic_vocal').reduce((s, i) => s + i.cantidad, 0);
  const it = Object.fromEntries(items.map(i => [i.equipo_id, i.cantidad]));
  assert.equal(mics, 8);
  assert.equal(it.eon615, 4);
  assert.equal(it.ui24r, 1);
  assert.equal(r.horas, 7);
  assert.equal(r.con_tecnico, true);
});

test('si el grupo trae su monitoreo, no se cotizan los 4 monitores', () => {
  const r = recomendar({ tipo_evento: 'boda', personas: 120, integrantes: 5, trae_monitoreo: true, extras: { banda: true } }, { mapa, libres, combos: semilla.combos });
  assert.ok(!r.opciones[1].items.some(i => i.equipo_id === 'eon615'));
});

test('cumpleaños de 100 personas sugiere un combo con sonido (no uno de solo luces)', () => {
  const r = recomendar({ tipo_evento: 'cumpleanos', personas: 100 }, { mapa, libres, combos: semilla.combos });
  assert.ok(r.combo.items.some(it => ['top', 'line_array'].includes(mapa[it.equipo_id].rol)));
});

test('si un equipo está ocupado, el recomendador lo cambia por otro del mismo rol', () => {
  const sinEon = { ...libres, eon615: 0 };
  const r = recomendar({ tipo_evento: 'cumpleanos', personas: 80 }, { mapa, libres: sinEon, combos: semilla.combos });
  const ids = r.opciones[1].items.map(i => i.equipo_id);
  assert.ok(!ids.includes('eon615'));
  assert.ok(r.avisos.length > 0);
});

test('sin IA, el intérprete por palabras clave entiende el pedido de la mamá', () => {
  const d = interpretarReglas('Quiero el sonido para el matrimonio de mi hijo, 100 invitados con orquesta y DJ en Urubamba, en un jardín');
  assert.equal(d.tipo_evento, 'boda');
  assert.equal(d.personas, 100);
  assert.equal(d.espacio, 'exterior');
  assert.equal(d.lugar, 'Urubamba');
  assert.ok(d.extras.orquesta && d.extras.dj);
});

test('con GEMINI_API_KEY, interpretar usa la API de Gemini y valida su JSON', async () => {
  // Simulamos la respuesta HTTP de Gemini (no se gasta la clave ni hace falta internet).
  const fetchReal = global.fetch;
  let pedido;
  global.fetch = async (url, opciones) => {
    pedido = { url, cuerpo: JSON.parse(opciones.body), clave: opciones.headers['x-goog-api-key'] };
    const texto = '```json\n{"tipo_evento":"boda","personas":120,"espacio":"exterior","horas":0,"lugar":"Urubamba","fecha":"","extras":{"orquesta":true,"banda":false,"dj":true,"proyeccion":false,"luces":true},"equipos_mencionados":[],"nivel_tecnico":"basico","extra_inventado":"x"}\n```';
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }) };
  };
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  try {
    const d = await ia.interpretar('boda de 120 invitados con orquesta y dj en un jardín de Urubamba');
    assert.equal(ia.proveedor(), 'gemini');
    assert.match(pedido.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
    assert.equal(pedido.clave, 'clave-de-prueba');
    assert.equal(pedido.cuerpo.generationConfig.responseMimeType, 'application/json');
    assert.equal(d.fuente, 'ia');
    assert.equal(d.tipo_evento, 'boda');
    assert.equal(d.personas, 120);
    assert.equal(d.horas, null);
    assert.equal(d.extra_inventado, undefined);
  } finally {
    global.fetch = fetchReal;
    delete process.env.GEMINI_API_KEY;
  }
});

test('si Gemini falla, se usa el intérprete por palabras clave', async () => {
  const fetchReal = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'cuota agotada' } }) });
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  const avisoReal = console.warn;
  console.warn = () => {};
  try {
    const d = await ia.interpretar('cumpleaños de 80 personas');
    assert.equal(d.fuente, 'reglas');
    assert.equal(d.tipo_evento, 'cumpleanos');
  } finally {
    global.fetch = fetchReal;
    console.warn = avisoReal;
    delete process.env.GEMINI_API_KEY;
  }
});
