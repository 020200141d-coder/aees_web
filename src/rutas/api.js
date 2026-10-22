// ============================================================================
//  src/rutas/api.js — API JSON que usa el navegador (fetch)
//
//   GET  /api/equipos?fecha=        catálogo con unidades libres ese día
//   POST /api/interpretar           texto libre → campos de la encuesta (IA)
//   POST /api/recomendar            encuesta → 3 opciones + combo + transporte + clima + explicación IA
//   GET  /api/geocodificar?q=       buscar un lugar (mapa)
//   POST /api/ruta                  almacén → lugar: km, minutos, línea para el mapa
//   GET  /api/clima                 pronóstico del día del evento
//   POST /api/cotizar               precio final de "Mi evento" (carrito)
//   POST /api/reservas              crear la reserva (requiere sesión)
//   POST /api/contacto              mensaje / cotización rápida
//   POST /api/solicitudes           fecha ocupada → pedir reunión (proveedor aliado)
//
//  Todas las respuestas son { ok: true, ... } o { ok: false, error }.
// ============================================================================

const express = require('express');
const db = require('../db');
const catalogo = require('../servicios/catalogo');
const precios = require('../servicios/precios');
const transporte = require('../servicios/transporte');
const rutas = require('../servicios/rutas');
const clima = require('../servicios/clima');
const ia = require('../servicios/ia');
const reservas = require('../servicios/reservas');
const { recomendar } = require('../servicios/recomendador');
const { requiereCliente } = require('../middleware/auth');
const { limitar } = require('../lib/seguridad');
const { soles, texto, numero, TIPOS_EVENTO, CATEGORIAS } = require('../lib/util');

const router = express.Router();

// Envuelve rutas async para que cualquier error llegue al manejador de errores.
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const fechaValida = f => (/^\d{4}-\d{2}-\d{2}$/.test(f || '') ? f : null);
const coordenadas = o => {
  const lat = numero(o?.lat, NaN), lng = numero(o?.lng, NaN);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};

// La IA y los mapas externos cuestan o tienen cuotas: limitamos por IP.
const limiteIA = limitar({ clave: 'ia', max: 20, ventanaMin: 10, mensaje: 'Hiciste muchas consultas seguidas. Espera unos minutos o escríbenos por WhatsApp.' });
const limiteMapa = limitar({ clave: 'mapa', max: 40, ventanaMin: 5 });

router.get('/equipos', a(async (req, res) => {
  const fecha = fechaValida(req.query.fecha);
  const [equipos, libres] = await Promise.all([catalogo.equipos(), fecha ? catalogo.disponibilidad(fecha) : null]);
  res.json({
    ok: true,
    fecha,
    equipos: equipos.map(e => ({ ...e, libres: libres ? libres[e.id] : (e.estado === 'operativo' ? e.cantidad_total : 0) }))
  });
}));

router.post('/interpretar', limiteIA, a(async (req, res) => {
  const t = texto(req.body?.texto, 1500);
  if (t.length < 8) return res.status(400).json({ ok: false, error: 'Cuéntanos un poco más de tu evento.' });
  res.json({ ok: true, datos: await ia.interpretar(t) });
}));

const TITULOS = { esencial: 'Esencial', recomendado: 'Recomendada', premium: 'Premium' };

router.post('/recomendar', limiteIA, a(async (req, res) => {
  const b = req.body || {};
  const encuesta = {
    tipo_evento: TIPOS_EVENTO[b.tipo_evento] ? b.tipo_evento : 'otro',
    personas: Math.round(numero(b.personas, 50)),
    espacio: b.espacio === 'exterior' ? 'exterior' : 'interior',
    horas: Math.round(numero(b.horas, 0)) || null,
    hay_electricidad: b.hay_electricidad !== false,
    extras: Object.fromEntries(['orquesta', 'banda', 'dj', 'proyeccion', 'luces'].map(k => [k, Boolean(b.extras?.[k])])),
    nombre: texto(b.nombre, 40)
  };
  if (b.extras && b.extras.luces === undefined) encuesta.extras.luces = true;
  const fecha = fechaValida(b.fecha);
  const lugar = coordenadas(b.lugar);

  const [equipos, combos, n] = await Promise.all([catalogo.equipos({ soloPublicados: false }), catalogo.combos(), db.ajuste('negocio')]);
  const mapa = catalogo.mapaPorId(equipos);
  const [libres, pronostico, ruta] = await Promise.all([
    fecha ? catalogo.disponibilidad(fecha) : Object.fromEntries(equipos.map(e => [e.id, e.estado === 'operativo' ? e.cantidad_total : 0])),
    lugar && fecha ? clima.pronostico({ ...lugar, fecha }) : null,
    lugar && n?.almacen ? rutas.ruta(n.almacen, lugar) : null
  ]);

  const rec = recomendar(encuesta, { mapa, libres, combos, lluvia: pronostico?.lluvia_probable && encuesta.espacio === 'exterior' });

  // Precio, transporte y lista legible de cada opción.
  const armar = async ({ nivel, items, combo }) => {
    const expandidos = catalogo.expandir({ combo, items });
    const envio = ruta ? await transporte.calcular(expandidos, mapa, ruta.km) : null;
    const cot = await precios.cotizar({ combo, items, horas: rec.horas, conTecnico: true, transporte: envio }, mapa);
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
    lugar: texto(b.lugar?.texto, 150), nombre: encuesta.nombre
  });

  res.json({
    ok: true,
    encuesta: { ...encuesta, horas: rec.horas, fecha, lugar: lugar ? { ...lugar, texto: texto(b.lugar?.texto, 200) } : null },
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
  });
}));

router.get('/geocodificar', limiteMapa, a(async (req, res) => {
  res.json({ ok: true, lugares: await rutas.geocodificar(req.query.q) });
}));

router.post('/ruta', limiteMapa, a(async (req, res) => {
  const destino = coordenadas(req.body);
  const n = await db.ajuste('negocio');
  if (!destino || !n?.almacen) return res.status(400).json({ ok: false, error: 'Marca un punto en el mapa.' });
  res.json({ ok: true, origen: n.almacen, ruta: await rutas.ruta(n.almacen, destino) });
}));

router.get('/clima', limiteMapa, a(async (req, res) => {
  const lugar = coordenadas(req.query);
  const fecha = fechaValida(req.query.fecha);
  res.json({ ok: true, clima: lugar && fecha ? await clima.pronostico({ ...lugar, fecha }) : { disponible: false } });
}));

router.post('/cotizar', a(async (req, res) => {
  const p = await reservas.preparar(req.body?.carrito, { usuarioId: req.usuario?.id, promoCodigo: texto(req.body?.promo, 30) });
  res.json({
    ok: true,
    carrito: p.carrito,
    cotizacion: p.cotizacion,
    faltan: p.faltan,
    ruta: p.ruta ? { km: p.ruta.km, minutos: p.ruta.minutos, fuente: p.ruta.fuente, estimado: Boolean(p.ruta.estimado) } : null,
    combo: p.combo ? { id: p.combo.id, nombre: p.combo.nombre, adicionales: p.combo.adicionales || [] } : null
  });
}));

router.post('/reservas', requiereCliente, a(async (req, res) => {
  const c = req.body?.cliente || {};
  const datos = {
    nombre: texto(c.nombre, 80),
    dni: String(c.dni || '').replace(/\D/g, ''),
    celular: String(c.celular || '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, ''),
    correo: texto(c.correo, 120)
  };
  const campos = {};
  if (datos.nombre.length < 3) campos.nombre = 'Escribe tu nombre completo.';
  if (!/^\d{8}$/.test(datos.dni)) campos.dni = 'El DNI tiene 8 dígitos.';
  if (!/^9\d{8}$/.test(datos.celular)) campos.celular = 'Celular peruano de 9 dígitos que empiece en 9.';
  if (datos.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(datos.correo)) campos.correo = 'Ese correo no parece válido.';
  if (c.acepta !== true) campos.acepta = 'Debes aceptar el uso de tus datos para gestionar la reserva.';
  if (Object.keys(campos).length) return res.status(400).json({ ok: false, error: 'Revisa los datos marcados.', campos });

  const reserva = await reservas.crear({ usuario: req.usuario, carrito: req.body?.carrito, datosCliente: datos, promoCodigo: texto(req.body?.promo, 30) });
  res.json({ ok: true, codigo: reserva.codigo, url: `/reservas/${reserva.codigo}` });
}));

const limiteContacto = limitar({ clave: 'contacto', max: 5, ventanaMin: 15, mensaje: 'Enviaste varios mensajes seguidos. Escríbenos por WhatsApp.' });

router.post('/contacto', limiteContacto, a(async (req, res) => {
  const b = req.body || {};
  if (b.web) return res.json({ ok: true }); // honeypot: era un bot
  const datos = {
    nombre: texto(b.nombre, 80),
    telefono: String(b.telefono || '').replace(/[^\d+ ]/g, '').slice(0, 20),
    fecha_evento: fechaValida(b.fecha_evento),
    mensaje: String(b.mensaje || '').trim().slice(0, 3000)
  };
  const campos = {};
  if (datos.nombre.length < 2) campos.nombre = 'Escribe tu nombre.';
  if (datos.telefono.replace(/\D/g, '').length < 9) campos.telefono = 'Déjanos un número para responderte.';
  if (datos.mensaje.length < 10) campos.mensaje = 'Cuéntanos un poco más (mínimo 10 caracteres).';
  if (Object.keys(campos).length) return res.status(400).json({ ok: false, error: 'Revisa los campos marcados.', campos });
  await db.insertar('mensajes', { ...datos, tipo: 'contacto', datos: {}, leido: false });
  res.json({ ok: true });
}));

// Fecha ocupada → en vez de perder al cliente, pedimos una reunión: AeeS
// puede completar con un proveedor aliado. Queda en Admin → Mensajes con el
// detalle del evento para responder rápido.
router.post('/solicitudes', limiteContacto, a(async (req, res) => {
  const b = req.body || {};
  const nombre = texto(b.nombre || req.usuario?.nombre, 80);
  const telefono = String(b.telefono || req.usuario?.celular || '').replace(/[^\d+ ]/g, '').slice(0, 20);
  if (nombre.length < 2 || telefono.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ ok: false, error: 'Déjanos tu nombre y un celular para coordinar la reunión.' });
  }
  const p = await reservas.preparar(b.carrito, { usuarioId: req.usuario?.id });
  const resumen = p.expandidos.map(it => `${it.cantidad}× ${p.mapa[it.equipo_id]?.nombre}`).join(', ');
  await db.insertar('mensajes', {
    tipo: 'fecha_ocupada',
    nombre,
    telefono,
    fecha_evento: p.carrito.fecha,
    mensaje: texto(b.mensaje, 1000) || `Quiero reservar para el ${p.carrito.fecha}, pero hay equipos ocupados. Propónganme una solución.`,
    datos: { carrito: p.carrito, faltan: p.faltan, resumen, total_estimado: p.cotizacion.total, usuario_id: req.usuario?.id || null },
    leido: false
  });
  res.json({ ok: true });
}));

module.exports = router;
