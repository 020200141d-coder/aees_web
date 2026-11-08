// ============================================================================
//  scripts/precios-2026-11.js — nuevos precios y paquetes (noviembre 2026)
//
//  Aplica a la base de datos ACTIVA (Supabase si .env tiene sus claves, si no
//  data/db.local.json) los precios que definió el negocio:
//   • parlantes de 15" ~S/ 100 c/u y S/ 180 el par; line array S/ 180 c/u;
//   • Paquete pequeño S/ 200 (2 EON615 + mezcladora + 2 micros, 6 h),
//     Paquete mediano S/ 380, Combo grande (DJ) S/ 600;
//   • precio por evento de 6 h; la fiesta electrónica (8 h) suma S/ 100;
//   • almacén en Urb. Larapa Grande A4-9, San Jerónimo (origen de las rutas);
//   • transporte incluido para paquetes pequeños/medianos en Cusco.
//
//  Uso:   npm run precios            → actualiza la base activa
//         npm run precios -- --semilla → además reescribe data/semilla.json
//  Se puede correr varias veces: solo actualiza (no duplica ni borra nada).
//  Los combos anteriores que se reemplazan quedan "no publicados", no se borran.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const RUTA_ENV = path.join(__dirname, '..', '.env');
if (fs.existsSync(RUTA_ENV)) process.loadEnvFile(RUTA_ENV);
const db = require('../src/db');

// Precios por evento (hasta 6 h). precio_mayor = precio c/u desde `mayor_desde` unidades.
const EQUIPOS = {
  eon615: { precio: 100, precio_mayor: 90, mayor_desde: 2 },
  zlx15p: { precio: 100, precio_mayor: 90, mayor_desde: 2 },
  la151: { precio: 100, precio_mayor: 90, mayor_desde: 2 },
  xrs212: { precio: 180 },
  srx818sp: { precio: 100 },
  srx828sp: { precio: 180 },
  ui24r: { precio: 150 },
  ui16: { precio: 100 }
};

const COMBOS = [
  {
    id: 'combo-pequeno', nombre: 'Paquete pequeño', nivel: 'esencial', orden: 1, destacado: true, publicado: true,
    descripcion: '2 JBL EON615 con mezcladora y 2 micrófonos para 50 a 80 personas en lugar cerrado. 6 horas. Transporte incluido en Cusco con acceso vehicular.',
    tipos_evento: ['cumpleanos', 'fiesta', 'graduacion', 'quinceanero', 'otro'], personas_min: 20, personas_max: 80, horas_base: 6, precio: 200,
    items: [{ equipo_id: 'eon615', cantidad: 2 }, { equipo_id: 'soundcraft-8', cantidad: 1 }, { equipo_id: 'sm58', cantidad: 2 }, { equipo_id: 'tripode', cantidad: 1 }, { equipo_id: 'kit-cables', cantidad: 1 }],
    adicionales: [
      { equipo_id: 'la151', cantidad: 2, precio: 80, etiqueta: 'Lugar abierto: 2 EAW LA151 (los EON quedan de monitor)' },
      { equipo_id: 'srx818sp', cantidad: 1, precio: 100, etiqueta: 'Sub JBL SRX818SP (un bajo)' },
      { equipo_id: 'srx828sp', cantidad: 1, precio: 180, etiqueta: 'Sub JBL SRX828SP (bajo doble)' }
    ],
    desde: 'combo-social-100'
  },
  {
    id: 'combo-mediano', nombre: 'Paquete mediano', nivel: 'recomendado', orden: 2, destacado: true, publicado: true,
    descripcion: '2 EAW LA151 con sub JBL SRX818SP, consola digital y micrófonos para 80 a 150 personas. 6 horas. Transporte incluido en Cusco con acceso vehicular.',
    tipos_evento: ['boda', 'quinceanero', 'fiesta', 'graduacion', 'cumpleanos', 'otro'], personas_min: 80, personas_max: 150, horas_base: 6, precio: 380,
    items: [{ equipo_id: 'la151', cantidad: 2 }, { equipo_id: 'srx818sp', cantidad: 1 }, { equipo_id: 'ui16', cantidad: 1 }, { equipo_id: 'shure-inal', cantidad: 1 }, { equipo_id: 'sm58', cantidad: 1 }, { equipo_id: 'kit-cables', cantidad: 1 }],
    adicionales: [
      { equipo_id: 'eon615', cantidad: 2, precio: 100, etiqueta: '2 JBL EON615 adicionales' },
      { equipo_id: 'srx828sp', cantidad: 1, precio: 180, etiqueta: 'Sub JBL SRX828SP (bajo doble)' },
      { equipo_id: 'tacho-54', cantidad: 8, precio: 150, etiqueta: '8 tachos LED' }
    ],
    desde: 'combo-fiesta-150'
  },
  {
    id: 'combo-grande', nombre: 'Combo grande · DJ', nivel: 'premium', orden: 3, destacado: true, publicado: true,
    descripcion: 'Line array EAW XRS212 con sub doble JBL SRX828SP y 2 EON615 de monitor. 6 horas; fiesta electrónica de 8 horas: S/ 100 más.',
    tipos_evento: ['fiesta_electronica', 'concierto', 'fiesta', 'boda', 'quinceanero', 'graduacion'], personas_min: 150, personas_max: 350, horas_base: 6, precio: 600,
    items: [{ equipo_id: 'xrs212', cantidad: 2 }, { equipo_id: 'srx828sp', cantidad: 1 }, { equipo_id: 'eon615', cantidad: 2 }, { equipo_id: 'ui24r', cantidad: 1 }, { equipo_id: 'kit-cables', cantidad: 2 }],
    adicionales: [
      { equipo_id: 'srx828sp', cantidad: 1, precio: 180, etiqueta: 'Segundo sub doble SRX828SP' },
      { equipo_id: 'eon615', cantidad: 2, precio: 100, etiqueta: '2 JBL EON615 adicionales (4 monitores para grupo)' },
      { equipo_id: 'beam290', cantidad: 4, precio: 320, etiqueta: '4 cabezas Beam 290' }
    ],
    desde: 'combo-line-array'
  }
];
// Combos que los paquetes nuevos reemplazan: se ocultan (no se borran).
const OCULTAR = ['combo-social-100', 'combo-fiesta-150'];
// El line array completo sigue, ahora por evento de 6 h.
const HORAS_6 = ['combo-line-array'];

const REGLAS = {
  horas_jornada: 6, factor_hora_extra: 0.5, tecnico_por_evento: 150,
  descuento_frecuente_pct: 10,
  vehiculos_transporte_gratis: ['auto'], km_transporte_gratis: 15, altura_max_gratis_m: 3500, recargo_sin_acceso: 30
};
const ALMACEN = { lat: -13.5345, lng: -71.897, direccion: 'Urb. Larapa Grande A4-9, San Jerónimo, Cusco' };

// Aplica los cambios sobre un objeto con la forma de semilla.json (o de la base).
function aplicar({ equipos, combos, reglas, negocio }) {
  for (const e of equipos) if (EQUIPOS[e.id]) Object.assign(e, EQUIPOS[e.id]);
  const nuevos = COMBOS.map(({ desde, ...c }) => ({ imagen: combos.find(x => x.id === desde)?.imagen || '', imagen_fuente: combos.find(x => x.id === desde)?.imagen_fuente || '', ...combos.find(x => x.id === c.id), ...c }));
  const resto = combos.filter(c => !COMBOS.some(n => n.id === c.id)).map(c => ({
    ...c,
    publicado: OCULTAR.includes(c.id) ? false : c.publicado,
    destacado: OCULTAR.includes(c.id) ? false : c.destacado,
    horas_base: HORAS_6.includes(c.id) ? 6 : c.horas_base
  }));
  const r = { ...reglas, ...REGLAS };
  delete r.factor_jornada_extra; delete r.tecnico_por_jornada;
  return { equipos, combos: [...nuevos, ...resto], reglas: r, negocio: { ...negocio, direccion: ALMACEN.direccion, almacen: ALMACEN } };
}

async function main() {
  const [equipos, combos, reglas, negocio] = await Promise.all([db.listar('equipos'), db.listar('combos'), db.ajuste('reglas'), db.ajuste('negocio')]);
  const nuevo = aplicar({ equipos, combos, reglas: reglas || {}, negocio: negocio || {} });
  for (const e of nuevo.equipos.filter(x => EQUIPOS[x.id])) await db.actualizar('equipos', e.id, EQUIPOS[e.id]);
  for (const c of nuevo.combos) {
    const existe = combos.some(x => x.id === c.id);
    const { creado_en, ...datos } = c;
    if (existe) await db.actualizar('combos', c.id, datos); else await db.insertar('combos', datos);
  }
  await db.guardarAjuste('reglas', nuevo.reglas);
  await db.guardarAjuste('negocio', nuevo.negocio);
  console.log(`✓ Base ${db.motor}: ${Object.keys(EQUIPOS).length} equipos, ${COMBOS.length} paquetes, reglas y almacén actualizados.`);

  if (process.argv.includes('--semilla')) {
    const ruta = path.join(__dirname, '..', 'data', 'semilla.json');
    const s = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    const n = aplicar({ equipos: s.equipos, combos: s.combos, reglas: s.ajustes.reglas, negocio: s.ajustes.negocio });
    Object.assign(s, { equipos: n.equipos, combos: n.combos });
    s.ajustes.reglas = n.reglas;
    s.ajustes.negocio = n.negocio;
    fs.writeFileSync(ruta, JSON.stringify(s, null, 2) + '\n');
    console.log('✓ data/semilla.json actualizado.');
  }
}

if (require.main === module) main().catch(err => { console.error('✗', err.message); process.exit(1); });
module.exports = { aplicar, EQUIPOS, COMBOS, REGLAS, ALMACEN };
