// ============================================================================
//  src/servicios/asistente.js — recomendaciones y cotizaciones del sitio público
//
//  Orquesta los servicios que ya existían (catálogo, recomendador, precios,
//  transporte, rutas, clima e IA) para responder a la API del navegador:
//   • recomendarEvento(): encuesta → 3 opciones + combo + transporte + clima + explicación
//   • cotizacionRapida(): "Desde S/ …" al instante para el cotizador de la portada
//   • equiposConLibres(), interpretar(), rutaDesdeAlmacen(), pronostico(), cotizarCarrito()
//
//  Las APIs externas (IA, mapas, clima) tienen su "plan B" dentro de sus
//  servicios (patrón Strategy): si fallan, este servicio igual responde.
// ============================================================================

const db = require('../db');
const catalogo = require('./catalogo');
const precios = require('./precios');
const transporte = require('./transporte');
const rutas = require('./rutas');
const clima = require('./clima');
const ia = require('./ia');
const reservas = require('./reservas');
const { recomendar } = require('./recomendador');
const { ErrorNegocio } = require('../lib/errores');
const { soles, texto, CATEGORIAS } = require('../lib/util');

const TITULOS = { esencial: 'Esencial', recomendado: 'Recomendada', premium: 'Premium' };

// Sin fecha: lo que hay operativo. Con fecha: lo que queda libre ese día.
const todosLibres = equipos => Object.fromEntries(equipos.map(e => [e.id, e.estado === 'operativo' ? e.cantidad_total : 0]));

async function equiposConLibres(fecha) {
  const [equipos, libres] = await Promise.all([catalogo.equipos(), fecha ? catalogo.disponibilidad(fecha) : null]);
  return equipos.map(e => ({ ...e, libres: libres ? libres[e.id] : (e.estado === 'operativo' ? e.cantidad_total : 0) }));
}

// Texto libre → campos de la encuesta (IA, o palabras clave si no hay IA).
async function interpretar(t) {
  if (t.length < 8) throw new ErrorNegocio('Cuéntanos un poco más de tu evento.', 400);
  return ia.interpretar(t);
}

// ── Recomendación completa del asistente ───────────────────────────────────
async function recomendarEvento({ encuesta, fecha, lugar, lugarTexto }) {
  const [equipos, combos, n] = await Promise.all([catalogo.equipos({ soloPublicados: false }), catalogo.combos(), db.ajuste('negocio')]);
  const mapa = catalogo.mapaPorId(equipos);
  const [libres, pronostico, ruta, alturaM, reglas] = await Promise.all([
    fecha ? catalogo.disponibilidad(fecha) : todosLibres(equipos),
    lugar && fecha ? clima.pronostico({ ...lugar, fecha }) : null,
    lugar && n?.almacen ? rutas.ruta(n.almacen, lugar) : null,
    lugar ? rutas.altura(lugar) : null,
    precios.reglas()
  ]);

  const rec = recomendar(encuesta, { mapa, libres, combos, lluvia: pronostico?.lluvia_probable && encuesta.espacio === 'exterior' });

  // Precio, transporte y lista legible de cada opción.
  const armar = async ({ nivel, items, combo }) => {
    const expandidos = catalogo.expandir({ combo, items });
    const envio = ruta ? await transporte.calcular(expandidos, mapa, ruta.km, { acceso: encuesta.acceso_vehicular ?? undefined, altura: alturaM, reglas }) : null;
    const cot = await precios.cotizar({ combo, items, horas: rec.horas, conTecnico: rec.con_tecnico, transporte: envio }, mapa);
    const equiposLista = (combo ? combo.items : items).map(it => {
      const e = mapa[it.equipo_id];
      return { equipo_id: it.equipo_id, cantidad: it.cantidad, nombre: e?.nombre, categoria: e?.categoria, rol: e?.rol, motivo: it.motivo || '' };
    });
    return {
      nivel,
      titulo: combo ? combo.nombre : TITULOS[nivel],
      combo_id: combo?.id || null,
      adicionales: combo?.adicionales || [],
      items: combo ? [] : items.map(({ equipo_id, cantidad }) => ({ equipo_id, cantidad })),
      equipos: equiposLista,
      faltan: catalogo.faltantes(expandidos, libres, mapa),
      envio,
      cotizacion: cot,
      total_texto: soles(cot.total),
      adelanto_pct: cot.adelanto_pct,
      resumen: equiposLista.slice(0, 5).map(x => `${x.cantidad} ${x.nombre}`).join(', ')
    };
  };

  const opciones = await Promise.all(rec.opciones.map(armar));
  const comboOpcion = rec.combo ? await armar({ nivel: 'combo', items: [], combo: rec.combo }) : null;
  const recomendada = opciones.find(o => o.nivel === 'recomendado');

  const explicacion = await ia.explicar({
    encuesta, recomendacion: rec, opcion: recomendada, clima: pronostico, transporte: recomendada.envio,
    lugar: texto(lugarTexto, 150), nombre: encuesta.nombre
  });

  return {
    encuesta: { ...encuesta, horas: rec.horas, fecha, lugar: lugar ? { ...lugar, texto: texto(lugarTexto, 200) } : null },
    perfil: rec.perfil,
    personas_efectivas: rec.personas_efectivas,
    razones: rec.razones,
    avisos: rec.avisos,
    opciones,
    combo: comboOpcion,
    ruta: ruta ? { km: ruta.km, minutos: ruta.minutos, fuente: ruta.fuente, estimado: Boolean(ruta.estimado), linea: ruta.linea, enlace_conductor: ruta.enlace_conductor } : null,
    clima: pronostico,
    explicacion,
    ia_activa: ia.activa(),
    categorias: CATEGORIAS
  };
}

// ── Cotizador rápido de la portada ─────────────────────────────────────────
// Aplica las MISMAS reglas del asistente (recomendador.js) sin IA ni mapas,
// así responde en milisegundos mientras el cliente mueve los datos.
async function cotizacionRapida({ encuesta, fecha, acceso }) {
  const [equipos, combos, reglas] = await Promise.all([catalogo.equipos({ soloPublicados: false }), catalogo.combos(), precios.reglas()]);
  const mapa = catalogo.mapaPorId(equipos);
  const libres = fecha ? await catalogo.disponibilidad(fecha) : todosLibres(equipos);
  const rec = recomendar(encuesta, { mapa, libres, combos });

  // Paquete sugerido si encaja con las personas; si no, la opción esencial.
  const combo = rec.combo && encuesta.personas <= rec.combo.personas_max * 1.1 ? rec.combo : null;
  const items = combo ? [] : rec.opciones[0].items;
  const cot = await precios.cotizar({ combo, items, horas: rec.horas, conTecnico: false }, mapa);
  const expandidos = catalogo.expandir({ combo, items });
  // ¿Entra en un vehículo con transporte incluido? (falta confirmar distancia y altura con el mapa)
  const auto = (await transporte.vehiculos()).filter(v => (reglas.vehiculos_transporte_gratis || []).includes(v.id));
  const c = transporte.carga(expandidos, mapa);
  const cabe = auto.some(v => c.volumen_l <= v.capacidad_l * 0.85 && c.peso_kg <= v.capacidad_kg && c.largo_cm <= v.largo_max_cm);
  const faltan = fecha ? catalogo.faltantes(expandidos, libres, mapa) : [];

  const params = new URLSearchParams({ tipo: encuesta.tipo_evento, personas: encuesta.personas, espacio: encuesta.espacio, acceso: acceso ? 'si' : 'no', ...(fecha ? { fecha } : {}) });
  return {
    desde: cot.subtotal,
    desde_texto: soles(cot.subtotal),
    horas: rec.horas,
    nombre: combo ? combo.nombre : 'Sonido a tu medida',
    combo_id: combo?.id || null,
    resumen: (combo ? combo.items : items).filter(it => mapa[it.equipo_id]?.categoria === 'audio').slice(0, 4).map(it => `${it.cantidad}× ${mapa[it.equipo_id]?.nombre}`).join(' · '),
    transporte_incluido: cabe && acceso,
    sin_acceso: !acceso,
    fecha,
    disponible: fecha ? faltan.length === 0 : null,
    url_asistente: `/asistente?${params}`
  };
}

// ── Mapa, clima y carrito ──────────────────────────────────────────────────
const geocodificar = q => rutas.geocodificar(q);

async function rutaDesdeAlmacen(destino) {
  const n = await db.ajuste('negocio');
  if (!destino || !n?.almacen) throw new ErrorNegocio('Marca un punto en el mapa.', 400);
  return { origen: n.almacen, ruta: await rutas.ruta(n.almacen, destino) };
}

const pronostico = async (lugar, fecha) => (lugar && fecha ? clima.pronostico({ ...lugar, fecha }) : { disponible: false });

// Precio final de "Mi evento" (carrito), con los descuentos del cliente si ingresó.
async function cotizarCarrito(carrito, { usuarioId, promoCodigo }) {
  const p = await reservas.preparar(carrito, { usuarioId, promoCodigo });
  return {
    carrito: p.carrito,
    cotizacion: p.cotizacion,
    faltan: p.faltan,
    ruta: p.ruta ? { km: p.ruta.km, minutos: p.ruta.minutos, fuente: p.ruta.fuente, estimado: Boolean(p.ruta.estimado) } : null,
    combo: p.combo ? { id: p.combo.id, nombre: p.combo.nombre, adicionales: p.combo.adicionales || [] } : null
  };
}

module.exports = { equiposConLibres, interpretar, recomendarEvento, cotizacionRapida, geocodificar, rutaDesdeAlmacen, pronostico, cotizarCarrito };
