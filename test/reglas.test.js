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
const { carga } = require('../src/servicios/transporte');
const { recomendar } = require('../src/servicios/recomendador');
const ia = require('../src/servicios/ia');
const { interpretarReglas } = ia;

const mapa = Object.fromEntries(semilla.equipos.map(e => [e.id, e]));
const libres = Object.fromEntries(semilla.equipos.map(e => [e.id, e.cantidad_total]));
const reglas = semilla.ajustes.reglas;
const combo = id => semilla.combos.find(c => c.id === id);

test('una fiesta de 8 horas son 2 jornadas y cuesta el doble (factor 1)', () => {
  assert.deepEqual(factorTiempo(8, 4, 1), { jornadas: 2, factor: 2 });
  assert.deepEqual(factorTiempo(4, 4, 1), { jornadas: 1, factor: 1 });
  assert.deepEqual(factorTiempo(9, 4, 0.5), { jornadas: 3, factor: 2 });
});

test('tachos LED: S/ 25 c/u, S/ 20 desde 13 unidades y S/ 5 menos sin DMX', () => {
  const tacho = mapa['tacho-54'];
  assert.equal(precioUnitario(tacho, 8, true), 25);
  assert.equal(precioUnitario(tacho, 13, true), 20);
  assert.equal(precioUnitario(tacho, 8, false), 20);
  assert.equal(precioUnitario(tacho, 16, false), 15);
});

test('el Combo Line Array cuesta S/ 800 y +2 EON615 suman S/ 100', () => {
  const c = combo('combo-line-array');
  const r = subtotalEquipos({ combo: c, adicionales: [c.adicionales[0]], items: [], horas: 4 }, mapa, reglas);
  assert.equal(r.subtotal, 900);
  assert.equal(r.jornadas, 1);
});

test('con combo, la jornada del evento es la del combo (5 h = 1 jornada)', () => {
  const r = subtotalEquipos({ combo: combo('combo-fiesta-150'), items: [{ equipo_id: 'beam290', cantidad: 2 }], horas: 5 }, mapa, reglas);
  assert.equal(r.jornadas, 1);
  assert.equal(r.subtotal, 650 + 160);
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
  assert.equal(r.combo.id, 'combo-line-array');
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
