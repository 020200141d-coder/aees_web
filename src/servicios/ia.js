// ============================================================================
//  src/servicios/ia.js — API de inteligencia artificial (Gemini o Claude)
//
//  API 2 del proyecto (rol "IA" de los ejemplos del docente). Dos usos:
//
//  1. interpretar(texto): la persona escribe con sus palabras
//       "quiero sonido para la boda de mi hijo, 100 invitados, con orquesta,
//        en Urubamba el 20 de diciembre"
//     y la IA lo convierte en los campos de la encuesta (JSON).
//
//  2. explicar(contexto): con la recomendación YA calculada por las reglas,
//     redacta un mensaje cálido y personal. Se le prohíbe inventar equipos o
//     precios: solo puede usar los datos que le pasamos.
//
//  Proveedores (se elige solo según la clave que exista en .env):
//   • Google Gemini (GEMINI_API_KEY) → GRATIS con el nivel gratuito de
//     Google AI Studio. Se llama por su API REST con fetch: se envía JSON y se
//     recibe JSON, sin librerías extra.
//   • Claude de Anthropic (ANTHROPIC_API_KEY) → de pago; usa su SDK oficial.
//   Si están las dos, manda IA_PROVEEDOR (gemini | claude); si no, Gemini.
//
//  Sin ninguna clave, o si la API falla, todo sigue funcionando: hay un
//  intérprete por palabras clave y un texto armado con las razones de las
//  reglas. La IA mejora la experiencia, pero no es un punto único de falla.
// ============================================================================

const Anthropic = require('@anthropic-ai/sdk');

const MODELO_CLAUDE = process.env.IA_MODELO || 'claude-opus-5-5';
const MODELO_GEMINI = process.env.GEMINI_MODELO || 'gemini-2.5-flash';

function proveedor() {
  const hayGemini = Boolean(process.env.GEMINI_API_KEY), hayClaude = Boolean(process.env.ANTHROPIC_API_KEY);
  if (hayGemini && hayClaude) return process.env.IA_PROVEEDOR === 'claude' ? 'claude' : 'gemini';
  return hayGemini ? 'gemini' : hayClaude ? 'claude' : null;
}
const activa = () => proveedor() !== null;

// ── Gemini: POST .../models/MODELO:generateContent con un JSON ──────────────
//  Envío:   { systemInstruction, contents:[{role:'user', parts:[{text}]}], generationConfig }
//  Recibo:  { candidates:[{ content:{ parts:[{ text }] } }] }
//  Con responseMimeType 'application/json' Gemini responde solo JSON válido.
async function llamarGemini({ system, mensaje, json, maxTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODELO_GEMINI)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: mensaje }] }],
      generationConfig: { temperature: json ? 0.1 : 0.7, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) }
    }),
    signal: AbortSignal.timeout(25000)
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini respondió ${res.status}: ${datos.error?.message || 'error'}`);
  const texto = (datos.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!texto) throw new Error(`Gemini no devolvió texto (${datos.candidates?.[0]?.finishReason || datos.promptFeedback?.blockReason || 'sin motivo'}).`);
  return texto;
}

// ── Claude: SDK oficial de Anthropic ────────────────────────────────────────
let cliente;
const obtenerCliente = () => (cliente ||= new Anthropic());

// `fallbacks: "default"` (beta) hace que, si el modelo rechaza la petición por
// sus filtros de seguridad, la API la reintente sola con otro modelo adecuado.
async function llamarClaude({ system, mensaje, formato, maxTokens }) {
  const respuesta = await obtenerCliente().beta.messages.create({
    model: MODELO_CLAUDE,
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

// Punto único: el resto del archivo no sabe qué proveedor responde.
// `formato` (JSON Schema) solo lo usa Claude; Gemini recibe el esquema
// descrito en el prompt y su salida se valida igual con limpiar().
function llamar({ system, mensaje, formato, maxTokens = 4000 }) {
  return proveedor() === 'gemini'
    ? llamarGemini({ system, mensaje, json: Boolean(formato), maxTokens })
    : llamarClaude({ system, mensaje, formato, maxTokens });
}

// Algunos modelos envuelven el JSON en ```json ... ```: lo quitamos antes de parsear.
const parsearJSON = texto => JSON.parse(String(texto).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));

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

// Valida y limpia lo que devolvió la IA (nunca confiamos en su formato a ciegas):
// tipos correctos, valores permitidos y los "vacíos" (0, "", "desconocido") → null.
function normalizar(d = {}) {
  const ent = v => (Number.isInteger(Number(v)) && Number(v) > 0 ? Math.min(Number(v), 5000) : null);
  const ex = d.extras || {};
  return {
    tipo_evento: TIPOS.includes(d.tipo_evento) ? d.tipo_evento : 'otro',
    personas: ent(d.personas),
    horas: ent(d.horas) && Math.min(ent(d.horas), 24),
    espacio: ['interior', 'exterior'].includes(d.espacio) ? d.espacio : null,
    lugar: typeof d.lugar === 'string' && d.lugar.trim() ? d.lugar.trim().slice(0, 120) : null,
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : null,
    extras: Object.fromEntries(['orquesta', 'banda', 'dj', 'proyeccion', 'luces'].map(k => [k, k === 'luces' ? ex[k] !== false : ex[k] === true])),
    equipos_mencionados: Array.isArray(d.equipos_mencionados) ? d.equipos_mencionados.filter(x => typeof x === 'string').slice(0, 20) : [],
    nivel_tecnico: d.nivel_tecnico === 'experto' ? 'experto' : 'basico'
  };
}

const SISTEMA_INTERPRETAR = `Extraes datos de pedidos de alquiler de sonido, luces y video para eventos en Cusco, Perú.
Responde SOLO un objeto JSON con exactamente estas claves:
{"tipo_evento": uno de ${JSON.stringify(TIPOS)}, "personas": entero, "espacio": "interior" | "exterior" | "desconocido",
 "horas": entero, "lugar": texto, "fecha": "YYYY-MM-DD" o "", "extras": {"orquesta": bool, "banda": bool, "dj": bool, "proyeccion": bool, "luces": bool},
 "equipos_mencionados": [textos], "nivel_tecnico": "basico" | "experto"}
Si un dato no se menciona usa 0, cadena vacía, "desconocido" o false según el campo.
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
    return { ...normalizar(parsearJSON(json)), fuente: 'ia', proveedor: proveedor() };
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
    return { texto: texto || explicarReglas(ctx), fuente: texto ? 'ia' : 'reglas', proveedor: texto ? proveedor() : null };
  } catch (err) {
    console.warn('[ia] explicar falló, uso texto de reglas:', err.message);
    return { texto: explicarReglas(ctx), fuente: 'reglas' };
  }
}

module.exports = { interpretar, explicar, activa, proveedor, interpretarReglas, normalizar };
