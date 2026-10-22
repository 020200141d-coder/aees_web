// ============================================================================
//  evento.js — "Mi evento": el carrito compartido por todas las páginas
//
//  Se guarda en localStorage del navegador (no en el servidor) porque es solo
//  un borrador: cualquiera puede armarlo sin registrarse. Al reservar, el
//  servidor RECALCULA todo con los precios reales; el navegador solo manda
//  ids y cantidades.
//
//  Forma del borrador:
//   { combo_id, adicionales:[índices], items:[{equipo_id,cantidad}],
//     fecha, hora_inicio, horas, tipo_evento, personas, espacio,
//     lugar:{texto,lat,lng}, con_tecnico, encuesta, explicacion }
//
//  También define aeesFetch(): fetch con JSON y el token CSRF de la página.
// ============================================================================

(function () {
  const CLAVE = 'aees_evento';
  const vacio = () => ({ combo_id: null, adicionales: [], items: [], horas: 4, con_tecnico: true });

  function leer() {
    try { return { ...vacio(), ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; } catch (e) { return vacio(); }
  }

  function guardar(evento) {
    try { localStorage.setItem(CLAVE, JSON.stringify(evento)); } catch (e) { /* sin almacenamiento: queda en memoria de la página */ }
    actualizarContador(evento, true);
    document.dispatchEvent(new CustomEvent('evento-cambiado', { detail: evento }));
    return evento;
  }

  // Número de "cosas" en el evento: el combo cuenta como 1 + equipos sueltos.
  const total = e => (e.combo_id ? 1 : 0) + e.items.reduce((s, it) => s + it.cantidad, 0);

  function actualizarContador(evento = leer(), latir = false) {
    const el = document.getElementById('contador-evento');
    if (!el) return;
    const n = total(evento);
    el.textContent = n ? String(n) : '';
    el.classList.toggle('visible', n > 0);
    if (latir && n) { el.classList.remove('latido'); void el.offsetWidth; el.classList.add('latido'); }
  }

  const api = {
    leer,
    guardar,
    total: () => total(leer()),
    actualizarContador,
    agregarEquipo(id, cantidad = 1) {
      const e = leer();
      const it = e.items.find(x => x.equipo_id === id);
      if (it) it.cantidad += cantidad; else e.items.push({ equipo_id: id, cantidad });
      return guardar(e);
    },
    cambiarCantidad(id, cantidad) {
      const e = leer();
      e.items = e.items.map(x => (x.equipo_id === id ? { ...x, cantidad } : x)).filter(x => x.cantidad > 0);
      return guardar(e);
    },
    ponerCombo(id, horas) {
      const e = leer();
      e.combo_id = id; e.adicionales = [];
      if (horas && !e.encuesta?.horas) e.horas = horas;
      return guardar(e);
    },
    quitarCombo() {
      const e = leer();
      e.combo_id = null; e.adicionales = [];
      return guardar(e);
    },
    // Lo usa el asistente: reemplaza el contenido por la opción elegida y guarda los datos del evento.
    aplicarOpcion(opcion, datos) {
      return guardar({
        ...leer(),
        ...datos,
        combo_id: opcion.combo_id || null,
        adicionales: [],
        items: opcion.combo_id ? [] : opcion.items.map(({ equipo_id, cantidad }) => ({ equipo_id, cantidad }))
      });
    },
    actualizar(cambios) { return guardar({ ...leer(), ...cambios }); },
    vaciar() { return guardar(vacio()); }
  };

  window.AeesEvento = api;

  // fetch con JSON + token CSRF. Devuelve { ok, status, ...json }.
  window.aeesFetch = async function (url, { method = 'GET', body } = {}) {
    const token = document.querySelector('meta[name="csrf"]')?.content || '';
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), 'x-csrf-token': token },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida del servidor.' }));
    return { status: res.status, ...json, ok: res.ok && json.ok !== false };
  };

  document.addEventListener('DOMContentLoaded', () => actualizarContador());
})();
