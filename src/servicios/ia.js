// ============================================================================
//  src/servicios/ia.js — API de inteligencia artificial (Claude, de Anthropic)
//
//  API 2 del proyecto (rol "IA" de los ejemplos del docente). Dos usos:
//
//  1. interpretar(texto): la persona escribe con sus palabras
//       "quiero sonido para la boda de mi hijo, 100 invitados, con orquesta,
//        en Urubamba el 20 de diciembre"
//     y la IA lo convierte en los campos de la encuesta (JSON). Usamos
//     "structured outputs" (output_config.format con un JSON Schema) para que
//     la respuesta SIEMPRE tenga la forma esperada.
//
//  2. explicar(contexto): con la recomendación YA calculada por las reglas,
//     redacta un mensaje cálido y personal. Se le prohíbe inventar equipos o
//     precios: solo puede usar los datos que le pasamos.
//
//  Si no hay ANTHROPIC_API_KEY o la API falla, todo sigue funcionando: hay un
//  intérprete por palabras clave y un texto armado con las razones de las
//  reglas. La IA mejora la experiencia, pero no es un punto único de falla.
// ============================================================================

const Anthropic = require('@anthropic-ai/sdk');

const MODELO = process.env.IA_MODELO || 'claude-opus-5-5';
const activa = () => Boolean(process.env.ANTHROPIC_API_KEY);

let cliente;
const obtenerCliente = () => (cliente ||= new Anthropic());

// Llamada común. `fallbacks: "default"` (beta) hace que, si el modelo rechaza
// la petición por sus filtros de seguridad, la API la reintente sola con otro
// modelo adecuado dentro de la misma llamada.
async function llamar({ system, mensaje, formato, maxTokens = 4000 }) {
  const respuesta = await obtenerCliente().beta.messages.create({
    model: MODELO,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // Tarea simple: esfuerzo bajo = respuesta rápida y barata.
    output_config: formato ? { effort: 'low', format: formato } : { effort: 'low' },
    system,
    messages: [{ role: 'user', content: mensaje }]
  });
  if (respuesta.stop_reason === 'refusal') throw new Error('La IA no pudo responder esta solicitud.');
  return respuesta.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

// ── 1. Interpretar texto libre ──────────────────────────────────────────────

const TIPOS = ['cumpleanos', 'boda', 'quinceanero', 'fiesta', 'fiesta_electronica', 'concierto', 'graduacion', 'corporativo', 'conferencia', 'otro'];

const ESQUEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['tipo_evento', 'personas', 'espacio', 'horas', 'lugar', 'fecha', 'extras', 'equipos_mencionados', 'nivel_tecnico'],
    properties: {
      // Tipos simples (sin null): lo "desconocido" va como 0 o "" y luego se limpia en normalizar().
      tipo_evento: { type: 'string', enum: TIPOS },
      personas: { type: 'integer', description: '0 si no se menciona' },
      espacio: { type: 'string', enum: ['interior', 'exterior', 'desconocido'] },
      horas: { type: 'integer', description: '0 si no se menciona' },
      lugar: { type: 'string', description: 'vacío si no se menciona' },
      fecha: { type: 'string', description: 'YYYY-MM-DD, o vacío si no se menciona' },
      extras: {
        type: 'object', additionalProperties: false,
        required: ['orquesta', 'banda', 'dj', 'proyeccion', 'luces'],
        properties: { orquesta: { type: 'boolean' }, banda: { type: 'boolean' }, dj: { type: 'boolean' }, proyeccion: { type: 'boolean' }, luces: { type: 'boolean' } }
      },
      equipos_mencionados: { type: 'array', items: { type: 'string' } },
      nivel_tecnico: { type: 'string', enum: ['basico', 'experto'] }
    }
  }
};

// Convierte los "vacíos" del esquema (0, "", "desconocido") en null para el resto del código.
function normalizar(d) {
  return {
    ...d,
    personas: d.personas > 0 ? d.personas : null,
    horas: d.horas > 0 ? d.horas : null,
    espacio: d.espacio === 'desconocido' ? null : d.espacio,
    lugar: d.lugar || null,
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) ? d.fecha : null
  };
}

const SISTEMA_INTERPRETAR = `Extraes datos de pedidos de alquiler de sonido, luces y video para eventos en Cusco, Perú.
Devuelve solo los campos del esquema. Si un dato no se menciona usa 0, cadena vacía, "desconocido" o false según el campo.
"matrimonio" es boda; "quince" es quinceañero; "promo" es graduación; "fiesta electrónica", "rave" o "tecno" es fiesta_electronica.
Jardín, campo, chacra, aire libre o playa es exterior; salón, local, auditorio o casa es interior.
nivel_tecnico es "experto" solo si la persona nombra marcas, modelos o especificaciones técnicas (watts, SPL, canales).
Hoy es ${new Date().toISOString().slice(0, 10)}; si dicen una fecha sin año, usa la próxima ocurrencia.`;

// Plan B sin IA: palabras clave y números.
function interpretarReglas(texto) {
  const t = String(texto).toLowerCase();
  const hay = (...p) => p.some(x => t.includes(x));
  let tipo = 'otro';
  if (hay('electr', 'rave', 'tecno', 'techno')) tipo = 'fiesta_electronica';
  else if (hay('boda', 'matrimonio', 'casamiento')) tipo = 'boda';
  else if (hay('quince')) tipo = 'quinceanero';
  else if (hay('cumple')) tipo = 'cumpleanos';
  else if (hay('graduac', 'promo')) tipo = 'graduacion';
  else if (hay('conferencia', 'charla', 'seminario', 'misa', 'congreso')) tipo = 'conferencia';
  else if (hay('corporat', 'empresa', 'lanzamiento', 'convenc')) tipo = 'corporativo';
  else if (hay('concierto', 'show en vivo', 'festival')) tipo = 'concierto';
  else if (hay('fiesta', 'baile', 'pachanga')) tipo = 'fiesta';

  const personas = t.match(/(\d{2,4})\s*(personas|invitados|asistentes|pax|gente)/);
  const horas = t.match(/(\d{1,2})\s*(h\b|horas)/);
  const lugares = ['urubamba', 'calca', 'pisac', 'písac', 'ollantaytambo', 'chinchero', 'yucay', 'huaro', 'oropesa', 'saylla', 'poroy', 'anta', 'lamay', 'maras', 'sicuani', 'quillabamba', 'valle sagrado', 'cusco', 'cuzco'];
  const lugar = lugares.find(l => t.includes(l));
  return {
    tipo_evento: tipo,
    personas: personas ? Number(personas[1]) : null,
    espacio: hay('aire libre', 'jardín', 'jardin', 'campo', 'chacra', 'exterior', 'al aire') ? 'exterior' : hay('salón', 'salon', 'local', 'auditorio', 'casa') ? 'interior' : null,
    horas: horas ? Number(horas[1]) : null,
    lugar: lugar ? lugar.replace(/\b\w/g, c => c.toUpperCase()) : null,
    fecha: null,
    extras: { orquesta: hay('orquesta'), banda: hay('banda', 'grupo en vivo'), dj: hay('dj', 'disc jockey'), proyeccion: hay('proyector', 'pantalla', 'video', 'diapositiva'), luces: !hay('sin luces') },
    equipos_mencionados: [],
    nivel_tecnico: hay('watts', 'spl', 'canales', 'jbl', 'shure', 'qsc', 'line array', 'xlr') ? 'experto' : 'basico',
    fuente: 'reglas'
  };
}

async function interpretar(texto) {
  const limpio = String(texto || '').slice(0, 1500);
  if (!activa()) return interpretarReglas(limpio);
  try {
    const json = await llamar({ system: SISTEMA_INTERPRETAR, mensaje: limpio, formato: ESQUEMA, maxTokens: 2000 });
    return { ...normalizar(JSON.parse(json)), fuente: 'ia' };
  } catch (err) {
    console.warn('[ia] interpretar falló, uso reglas:', err.message);
    return interpretarReglas(limpio);
  }
}

// ── 2. Explicar la recomendación ────────────────────────────────────────────

const SISTEMA_EXPLICAR = `Eres el asesor de AeeS Acústico, empresa de alquiler de sonido, luces y video en Cusco.
Escribe en español del Perú, cálido y claro, para alguien que quizá no sabe nada de sonido.
Reglas estrictas:
- Usa SOLO los equipos, cantidades y precios del JSON. No inventes equipos, marcas, precios ni descuentos.
- Máximo 140 palabras, 2 o 3 párrafos cortos, sin listas ni títulos ni emojis.
- Explica por qué esa opción encaja con su evento (tipo, invitados, lugar, horas) y menciona un detalle de cuidado (cables ordenados, técnico, toldo si llueve).
- Termina invitando a reservar con el adelanto o a escribir por WhatsApp si quiere ajustar algo.`;

function explicarReglas(ctx) {
  const r = ctx.recomendacion;
  const nombre = ctx.nombre ? `${ctx.nombre}, p` : 'P';
  return `${nombre}ara tu evento de ${r.personas} personas te recomendamos la opción «${ctx.opcion.titulo}» por ${ctx.opcion.total_texto}. ${r.razones.join(' ')} ` +
    `Incluye ${ctx.opcion.resumen}. Puedes separar la fecha con el ${ctx.opcion.adelanto_pct}% de adelanto o escribirnos por WhatsApp si quieres ajustar algo.`;
}

async function explicar(ctx) {
  if (!activa()) return { texto: explicarReglas(ctx), fuente: 'reglas' };
  try {
    const datos = {
      evento: ctx.encuesta,
      lugar: ctx.lugar || null,
      clima: ctx.clima?.aviso || null,
      transporte: ctx.transporte ? `${ctx.transporte.vehiculo.nombre}, ${ctx.transporte.distancia_km} km` : null,
      razones_tecnicas: ctx.recomendacion.razones,
      opcion_recomendada: { nombre: ctx.opcion.titulo, total: ctx.opcion.total_texto, adelanto_pct: ctx.opcion.adelanto_pct, equipos: ctx.opcion.equipos }
    };
    const texto = await llamar({ system: SISTEMA_EXPLICAR, mensaje: JSON.stringify(datos), maxTokens: 3000 });
    return { texto: texto || explicarReglas(ctx), fuente: texto ? 'ia' : 'reglas' };
  } catch (err) {
    console.warn('[ia] explicar falló, uso texto de reglas:', err.message);
    return { texto: explicarReglas(ctx), fuente: 'reglas' };
  }
}

module.exports = { interpretar, explicar, activa, interpretarReglas };
