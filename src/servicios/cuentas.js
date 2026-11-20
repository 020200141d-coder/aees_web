// ============================================================================
//  src/servicios/cuentas.js — cuentas de los clientes (registro = ingreso)
//
//  Registrarse e ingresar es el MISMO paso:
//   1. Correo + celular: si el correo es nuevo se crea la cuenta (pide el
//      nombre); si existe, el celular debe coincidir. Cuentas antiguas de
//      celular + PIN piden el PIN una sola vez para unirles el correo.
//   2. Google: se valida el "ID token" con Google y que sea para NUESTRO
//      GOOGLE_CLIENT_ID; si falta el celular se pide después (completar).
//
//  Reglas (todas lanzan ErrorNegocio con el mensaje para el cliente):
//   • el correo del personal no entra por aquí (solo por /admin)       → 403
//   • el celular no coincide con el del correo                        → 409
//   • el celular ya pertenece a otro correo                           → 409
//   • reseña solo de un evento propio y completado, una por reserva   → 403 / 409
// ============================================================================

const db = require('../db');
const precios = require('./precios');
const puntos = require('./puntos');
const resenas = require('./resenas');
const { verificarClave } = require('../lib/seguridad');
const { ErrorNegocio } = require('../lib/errores');
const { TIPOS_EVENTO } = require('../lib/util');
const { errorIngreso, ocultarCorreo } = require('../validadores/cuenta');
const { celularValido } = require('../validadores/clientes');

// ── Correo + celular ───────────────────────────────────────────────────────
async function ingresar({ email, celular, nombre, pin }) {
  const formato = errorIngreso({ email, celular });
  if (formato) throw new ErrorNegocio(formato, 400);

  let u = await db.buscarUno('usuarios', { email });
  if (u) {
    if (u.rol !== 'cliente') throw new ErrorNegocio('Ese correo es del personal: ingresa por el panel.', 403);
    if (u.celular && u.celular !== celular) throw new ErrorNegocio('El celular no coincide con el de ese correo. Si cambiaste de número, escríbenos por WhatsApp.', 409);
    if (!u.celular) u = await db.actualizar('usuarios', u.id, { celular });
    return u;
  }
  const porCelular = await db.buscarUno('usuarios', { celular });
  if (porCelular?.email) throw new ErrorNegocio(`Ese celular ya está registrado con otro correo (${ocultarCorreo(porCelular.email)}).`, 409);
  if (porCelular) {
    // Cuenta antigua de celular + PIN: se pide el PIN una sola vez para unirle este correo.
    if (!pin) throw new ErrorNegocio('Tu celular ya tiene una cuenta con PIN. Escríbelo esta única vez para unirle tu correo.', 401, { extra: { pedirPin: true } });
    if (!verificarClave(pin, porCelular.clave_hash)) throw new ErrorNegocio('El PIN no coincide con ese celular.', 401, { extra: { pedirPin: true } });
    return db.actualizar('usuarios', porCelular.id, { email });
  }
  if (nombre.length < 2) throw new ErrorNegocio('Es tu primera vez: escribe tu nombre para crear tu cuenta.', 422, { extra: { nuevo: true } });
  return db.insertar('usuarios', { rol: 'cliente', nombre, email, celular });
}

// ── Google ─────────────────────────────────────────────────────────────────
// Pregunta a Google si el token es válido, de NUESTRA app y con correo verificado.
async function verificarTokenGoogle(credencial, idCliente) {
  if (!idCliente || !credencial) throw new ErrorNegocio('El ingreso con Google no está configurado.', 400);
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credencial)}`, { signal: AbortSignal.timeout(8000) });
  const info = await r.json().catch(() => ({}));
  if (!r.ok || info.aud !== idCliente || info.email_verified !== 'true') throw new ErrorNegocio('No pudimos verificar tu cuenta de Google.', 401);
  return info;
}

async function ingresarConGoogle(info) {
  const email = info.email.toLowerCase();
  let u = (await db.buscarUno('usuarios', { google_sub: info.sub })) || (await db.buscarUno('usuarios', { email }));
  // Las cuentas del personal entran solo por /admin con contraseña, nunca con Google.
  if (u && u.rol !== 'cliente') throw new ErrorNegocio('Ese correo es del personal: ingresa por el panel.', 403);
  if (!u) return db.insertar('usuarios', { rol: 'cliente', nombre: info.name || email.split('@')[0], email, google_sub: info.sub });
  if (!u.google_sub) return db.actualizar('usuarios', u.id, { google_sub: info.sub });
  return u;
}

// Después de Google solo falta el celular (WhatsApp) y confirmar el nombre.
async function completarRegistro(usuario, { celular, nombre }) {
  if (!celularValido(celular)) throw new ErrorNegocio('Escribe tu celular de 9 dígitos (empieza en 9).', 422);
  if (nombre.length < 2) throw new ErrorNegocio('Escribe tu nombre.', 422);
  const otro = await db.buscarUno('usuarios', { celular });
  if (otro && otro.id !== usuario.id) throw new ErrorNegocio('Ese celular ya está registrado en otra cuenta. Si es tuyo, escríbenos por WhatsApp y lo unimos.', 409);
  await db.actualizar('usuarios', usuario.id, { celular, nombre });
}

// ── Mi cuenta ──────────────────────────────────────────────────────────────
// "Repetir": arma el carrito de una reserva anterior (combo + adicionales o equipos sueltos).
function carritoParaRepetir(reserva, combos) {
  const combo = reserva.combo_id && combos[reserva.combo_id]?.publicado ? combos[reserva.combo_id] : null;
  const carrito = combo
    ? { combo_id: combo.id, adicionales: (reserva.adicionales || []).map(ad => (combo.adicionales || []).findIndex(c => c.etiqueta === ad.etiqueta)).filter(i => i >= 0), items: [] }
    : { combo_id: null, adicionales: [], items: (reserva.items || []).map(({ equipo_id, cantidad }) => ({ equipo_id, cantidad })) };
  return { ...carrito, horas: reserva.horas, personas: reserva.personas, espacio: reserva.espacio, tipo_evento: reserva.tipo_evento, lugar: reserva.lat ? { texto: reserva.lugar, lat: reserva.lat, lng: reserva.lng } : null, acceso_vehicular: reserva.encuesta?.acceso_vehicular ?? null };
}

// Puntos, si ya es cliente habitual, sus reservas con "Repetir" y qué reseñas dejó.
async function miCuenta(usuario) {
  const [mias, reglas] = await Promise.all([
    db.listar('reservas', { filtro: { usuario_id: usuario.id }, orden: 'creado_en', desc: true }),
    precios.reglas()
  ]);
  const saldo = puntos.calcularSaldo(mias, reglas);
  const frecuente = await precios.esFrecuente(usuario.id, reglas);
  const combos = Object.fromEntries((await db.listar('combos')).map(c => [c.id, c]));
  const repetir = Object.fromEntries(mias.map(x => [x.codigo, carritoParaRepetir(x, combos)]));
  const conResena = new Set((await resenas.todas()).filter(x => x.usuario_id === usuario.id).map(x => x.reserva_codigo));
  return { reservas: mias, saldo, frecuente, reglas, repetir, conResena };
}

// ── Reseña del cliente ─────────────────────────────────────────────────────
// Una por evento COMPLETADO. Llega sin publicar: el admin la revisa.
async function dejarResena(usuario, body, codigo) {
  const reserva = await db.buscarUno('reservas', { codigo });
  if (!reserva || reserva.usuario_id !== usuario.id || reserva.estado !== 'completada') {
    throw new ErrorNegocio('Solo puedes dejar una reseña de tus eventos ya realizados.', 403);
  }
  if ((await resenas.todas()).some(x => x.reserva_codigo === codigo)) {
    throw new ErrorNegocio('Ya dejaste tu reseña de ese evento. ¡Gracias!', 409, { extra: { tipo: 'aviso' } });
  }
  const tipo = TIPOS_EVENTO[reserva.tipo_evento]?.label || 'Evento';
  const { datos, errores } = resenas.validar({ ...body, nombre: usuario.nombre, evento: `${tipo} · ${reserva.fecha_evento.slice(0, 4)}` });
  if (Object.keys(errores).length) throw new ErrorNegocio(Object.values(errores).join(' '), 422);
  // Para la portada basta el nombre y la inicial del apellido.
  const partes = datos.nombre.split(' ');
  datos.nombre = partes.length > 1 ? `${partes[0]} ${partes[1][0]}.` : partes[0];
  await resenas.agregar(datos, { origen: 'cliente', reserva_codigo: codigo, usuario_id: usuario.id });
}

module.exports = { ingresar, verificarTokenGoogle, ingresarConGoogle, completarRegistro, carritoParaRepetir, miCuenta, dejarResena };
