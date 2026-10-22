// ============================================================================
//  src/servicios/pagos.js — API de pagos para el adelanto de la reserva
//
//  API 3 del proyecto. Dos métodos reales + uno de prueba:
//
//  1. Mercado Pago Checkout Pro (si hay MP_ACCESS_TOKEN)
//     Flujo:  creamos una "preferencia" con el monto del adelanto →
//             redirigimos al cliente a la página segura de Mercado Pago
//             (tarjeta, y los medios que tu cuenta tenga habilitados) →
//             Mercado Pago nos avisa por webhook y además vuelve a /pagos/retorno.
//     En ambos casos NO confiamos en lo que dice la URL: consultamos el pago a
//     la API de Mercado Pago con nuestro token y solo si dice "approved" lo
//     registramos. Con credenciales de PRUEBA todo funciona sin cobrar.
//
//  2. Yape manual (sin comisión): el cliente yapea al número del negocio y
//     escribe el número de operación; el admin lo verifica en su app Yape y
//     lo aprueba desde el panel.
//
//  3. Simulado: solo fuera de producción, para probar el flujo completo sin
//     cuentas. En producción está desactivado siempre.
// ============================================================================

const MP_API = 'https://api.mercadopago.com';

const mercadoPagoActivo = () => Boolean(process.env.MP_ACCESS_TOKEN);
const simuladoActivo = () => process.env.NODE_ENV !== 'production' && process.env.PAGOS_SIMULADOS !== 'false';

async function mp(ruta, opciones = {}) {
  const res = await fetch(`${MP_API}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...opciones.headers },
    signal: AbortSignal.timeout(10000)
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status}: ${datos.message || 'error'}`);
  return datos;
}

// Crea la preferencia de pago y devuelve la URL a la que se redirige al cliente.
async function crearPreferencia(reserva, { baseUrl, monto, email }) {
  const cuerpo = {
    items: [{ id: reserva.codigo, title: `Adelanto reserva ${reserva.codigo} — AeeS Acústico`, quantity: 1, unit_price: monto, currency_id: 'PEN' }],
    external_reference: reserva.codigo,
    back_urls: {
      success: `${baseUrl}/pagos/retorno`,
      failure: `${baseUrl}/pagos/retorno`,
      pending: `${baseUrl}/pagos/retorno`
    },
    statement_descriptor: 'AEES ACUSTICO',
    ...(email ? { payer: { email } } : {})
  };
  // auto_return y webhook solo funcionan con URLs públicas (no localhost).
  if (!/localhost|127\.0\.0\.1/.test(baseUrl)) {
    cuerpo.auto_return = 'approved';
    cuerpo.notification_url = `${baseUrl}/pagos/mercadopago/webhook`;
  }
  const pref = await mp('/checkout/preferences', { method: 'POST', body: JSON.stringify(cuerpo) });
  // Con un token de prueba (TEST-...) se usa el checkout de pruebas.
  const prueba = process.env.MP_ACCESS_TOKEN.startsWith('TEST-');
  return { url: prueba ? pref.sandbox_init_point || pref.init_point : pref.init_point, id: pref.id };
}

// Consulta un pago a Mercado Pago (fuente de verdad).
async function consultarPago(idPago) {
  const p = await mp(`/v1/payments/${encodeURIComponent(idPago)}`);
  return { id: String(p.id), estado: p.status, monto: p.transaction_amount, codigo: p.external_reference, metodo: p.payment_method_id };
}

module.exports = { mercadoPagoActivo, simuladoActivo, crearPreferencia, consultarPago };
