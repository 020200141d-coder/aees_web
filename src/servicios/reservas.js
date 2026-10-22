// ============================================================================
//  src/servicios/reservas.js — de "carrito" a reserva pagada
//
//  Flujo:
//   1. preparar(carrito): recalcula TODO en el servidor a partir de ids y
//      cantidades: equipos/combo desde la BD, disponibilidad de la fecha,
//      ruta y transporte, técnico, promo y adelanto.
//   2. crear(): si todo está disponible, guarda la reserva "pendiente_pago"
//      con un plazo de bloqueo (por defecto 24 h). Mientras tanto esos
//      equipos no se le ofrecen a otro cliente para esa fecha.
//   3. registrarPago(): cuando un pago se aprueba (Mercado Pago, Yape
//      verificado o simulado) se suma; si cubre el adelanto, la reserva pasa a
//      "adelanto_pagado" y ya no expira.
//   4. Después el cliente agenda la reunión de confirmación y el admin la
//      marca "confirmada" y, tras el evento, "completada".
//
//  Doble reserva: dos clientes podrían pedir el último equipo al mismo
//  tiempo. Tras insertar volvemos a contar; si la fecha quedó sobrevendida,
//  la reserva recién creada se borra y se avisa (control optimista).
// ============================================================================

const db = require('../db');
const catalogo = require('./catalogo');
const precios = require('./precios');
const transporte = require('./transporte');
const rutas = require('./rutas');
const { codigoReserva, redondear, texto, numero, hoyLima } = require('../lib/util');

function errorUsuario(mensaje, status = 400, extra = {}) {
  return Object.assign(new Error(mensaje), { status, publico: true, ...extra });
}

// Limpia lo que llega del navegador: solo ids, cantidades enteras y textos cortos.
function normalizarCarrito(c = {}) {
  const lat = numero(c.lugar?.lat, NaN), lng = numero(c.lugar?.lng, NaN);
  return {
    combo_id: c.combo_id ? texto(c.combo_id, 80) : null,
    // Posiciones de los adicionales del combo que el cliente marcó (0, 1, 2...).
    adicionales: [...new Set((Array.isArray(c.adicionales) ? c.adicionales : []).map(n => Math.floor(numero(n, -1))).filter(n => n >= 0 && n < 20))],
    items: (Array.isArray(c.items) ? c.items : []).slice(0, 60)
      .map(it => ({ equipo_id: texto(it.equipo_id, 40), cantidad: Math.floor(numero(it.cantidad)) }))
      .filter(it => it.equipo_id && it.cantidad > 0 && it.cantidad <= 100),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(c.fecha) ? c.fecha : null,
    hora_inicio: /^\d{2}:\d{2}$/.test(c.hora_inicio) ? c.hora_inicio : null,
    horas: Math.min(24, Math.max(1, Math.round(numero(c.horas, 4)))),
    tipo_evento: texto(c.tipo_evento, 30) || 'otro',
    personas: Math.max(0, Math.round(numero(c.personas))),
    espacio: c.espacio === 'exterior' ? 'exterior' : 'interior',
    lugar: Number.isFinite(lat) && Number.isFinite(lng) ? { texto: texto(c.lugar.texto, 200), lat, lng } : null,
    con_tecnico: c.con_tecnico !== false,
    encuesta: c.encuesta && typeof c.encuesta === 'object' ? JSON.parse(JSON.stringify(c.encuesta).slice(0, 4000)) : {},
    explicacion: texto(c.explicacion, 2000)
  };
}

async function preparar(carritoCrudo, { usuarioId, promoCodigo, excluirReservaId } = {}) {
  const carrito = normalizarCarrito(carritoCrudo);
  const [equipos, almacen] = await Promise.all([
    catalogo.equipos({ soloPublicados: false }),
    db.ajuste('negocio').then(n => n?.almacen)
  ]);
  const mapa = catalogo.mapaPorId(equipos);
  const combo = carrito.combo_id ? await db.obtener('combos', carrito.combo_id) : null;
  if (carrito.combo_id && (!combo || !combo.publicado)) throw errorUsuario('Ese combo ya no está disponible.');
  // Los precios de los adicionales salen del combo guardado, no del navegador.
  const adicionales = combo ? carrito.adicionales.map(i => combo.adicionales?.[i]).filter(Boolean) : [];
  if (!combo) carrito.adicionales = [];

  // Solo equipos publicados y existentes.
  carrito.items = carrito.items.filter(it => mapa[it.equipo_id]?.publicado);
  if (!combo && !carrito.items.length) throw errorUsuario('Tu evento no tiene equipos todavía.');

  const expandidos = catalogo.expandir({ combo, adicionales, items: carrito.items });
  const libres = carrito.fecha ? await catalogo.disponibilidad(carrito.fecha, { excluirReservaId }) : null;
  const faltan = libres ? catalogo.faltantes(expandidos, libres, mapa) : [];

  let ruta = null, envio = null;
  if (carrito.lugar && almacen) {
    ruta = await rutas.ruta(almacen, carrito.lugar);
    envio = await transporte.calcular(expandidos, mapa, ruta.km);
  }

  const cotizacion = await precios.cotizar({
    combo, adicionales, items: carrito.items, horas: carrito.horas, conTecnico: carrito.con_tecnico,
    transporte: envio, promoCodigo, usuarioId
  }, mapa);

  return { carrito, combo, adicionales, mapa, expandidos, faltan, ruta, envio, cotizacion };
}

async function crear({ usuario, carrito: carritoCrudo, datosCliente, promoCodigo }) {
  const p = await preparar(carritoCrudo, { usuarioId: usuario.id, promoCodigo });
  const { carrito, cotizacion } = p;

  if (!carrito.fecha) throw errorUsuario('Elige la fecha del evento.');
  if (carrito.fecha < hoyLima()) throw errorUsuario('La fecha del evento ya pasó.');
  if (!carrito.lugar) throw errorUsuario('Marca en el mapa el lugar del evento para calcular el transporte.');
  if (p.faltan.length) throw errorUsuario('Algunos equipos ya no están disponibles para esa fecha.', 409, { faltan: p.faltan });
  if (cotizacion.error_promo) throw errorUsuario(cotizacion.error_promo);

  const r = await precios.reglas();
  const reserva = await db.insertar('reservas', {
    codigo: codigoReserva(),
    usuario_id: usuario.id,
    estado: 'pendiente_pago',
    fecha_evento: carrito.fecha,
    hora_inicio: carrito.hora_inicio,
    horas: carrito.horas,
    tipo_evento: carrito.tipo_evento,
    personas: carrito.personas,
    espacio: carrito.espacio,
    lugar: carrito.lugar.texto,
    lat: carrito.lugar.lat,
    lng: carrito.lugar.lng,
    distancia_km: p.ruta?.km ?? null,
    vehiculo: p.envio?.vehiculo?.nombre || null,
    combo_id: p.combo?.id || null,
    adicionales: p.adicionales,
    // Guardamos una "foto" de los precios del momento: si mañana cambian, la reserva no cambia.
    items: p.expandidos.map(it => ({ ...it, nombre: p.mapa[it.equipo_id].nombre })),
    subtotal: cotizacion.subtotal,
    transporte: p.envio?.costo || 0,
    tecnico: cotizacion.tecnico,
    descuento: cotizacion.descuento,
    total: cotizacion.total,
    adelanto_pct: cotizacion.adelanto_pct,
    adelanto: cotizacion.adelanto,
    pagado: 0,
    promo_codigo: cotizacion.promo?.codigo || null,
    expira_en: new Date(Date.now() + r.horas_bloqueo * 3600 * 1000).toISOString(),
    datos_cliente: datosCliente,
    encuesta: { ...carrito.encuesta, lineas: cotizacion.lineas, ruta: p.ruta ? { km: p.ruta.km, minutos: p.ruta.minutos, fuente: p.ruta.fuente, enlace_conductor: p.ruta.enlace_conductor } : null, carga: p.envio?.carga || null },
    explicacion: carrito.explicacion || null,
    reunion: null,
    notas_admin: ''
  });

  // Control optimista contra doble reserva.
  const libres = await catalogo.disponibilidad(carrito.fecha, { excluirReservaId: reserva.id });
  const choque = catalogo.faltantes(p.expandidos, libres, p.mapa);
  if (choque.length) {
    await db.eliminar('reservas', reserva.id);
    throw errorUsuario('Otra persona acaba de reservar parte de esos equipos para esa fecha.', 409, { faltan: choque });
  }

  // Guardamos DNI y celular en el perfil para la próxima vez (cliente recurrente).
  const cambios = {};
  if (!usuario.dni && datosCliente.dni) cambios.dni = datosCliente.dni;
  if (!usuario.celular && datosCliente.celular) cambios.celular = datosCliente.celular;
  if (usuario.nombre !== datosCliente.nombre) cambios.nombre = datosCliente.nombre;
  if (Object.keys(cambios).length) {
    try { await db.actualizar('usuarios', usuario.id, cambios); } catch (err) { console.warn('[reservas] no se actualizó el perfil:', err.message); }
  }
  return reserva;
}

// Suma pagos aprobados y actualiza el estado. Idempotente: si el mismo pago
// llega dos veces (webhook + retorno), no se cuenta doble.
async function registrarPago(reserva, { metodo, monto, referencia, estado = 'aprobado', detalle = {} }) {
  if (referencia) {
    const repetido = (await db.listar('pagos', { filtro: { reserva_id: reserva.id } })).find(x => x.referencia === referencia && x.metodo === metodo);
    if (repetido) {
      if (repetido.estado !== estado) await db.actualizar('pagos', repetido.id, { estado });
      return recalcular(reserva.id);
    }
  }
  await db.insertar('pagos', { reserva_id: reserva.id, metodo, monto: redondear(monto), estado, referencia: referencia || null, detalle });
  return recalcular(reserva.id);
}

async function recalcular(reservaId) {
  const reserva = await db.obtener('reservas', reservaId);
  const pagos = await db.listar('pagos', { filtro: { reserva_id: reservaId } });
  const pagado = redondear(pagos.filter(x => x.estado === 'aprobado').reduce((s, x) => s + Number(x.monto), 0));
  const cambios = { pagado };
  // Una reserva ya expirada NO se reactiva sola aunque llegue el pago: sus equipos
  // pudieron ofrecerse a otro cliente. El admin la revisa y la confirma a mano.
  if (reserva.estado === 'pendiente_pago' && pagado >= reserva.adelanto - 0.01) {
    cambios.estado = 'adelanto_pagado';
    cambios.expira_en = null;
  }
  return db.actualizar('reservas', reservaId, cambios);
}

module.exports = { preparar, crear, registrarPago, recalcular, normalizarCarrito, errorUsuario };
