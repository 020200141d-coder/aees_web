// ============================================================================
//  google.js — callback del botón "Continuar con Google" (Google Identity Services).
//  Lo usan /cuenta/ingresar y la invitación de la portada (partials/aviso-cuenta.ejs).
//
//  Flujo: Google entrega un "credential" (JWT firmado por Google) → lo enviamos a
//  POST /cuenta/google, que lo verifica con Google y responde a dónde ir:
//  si el cliente es nuevo (sin celular) → /cuenta/completar; si no, a donde iba.
//  A dónde volver se lee de data-volver del div #g_id_onload que puso la vista.
// ============================================================================
async function aeesGoogle(respuesta) {
  const config = document.getElementById('g_id_onload');
  const volver = (config && config.dataset.volver) || '/cuenta';
  const r = await aeesFetch('/cuenta/google', { method: 'POST', body: { credential: respuesta.credential, volver } });
  if (r.ok) window.location.href = r.volver;
  else aeesAlerta({ icon: 'error', title: 'No pudimos ingresar', text: r.error });
}
window.aeesGoogle = aeesGoogle;
