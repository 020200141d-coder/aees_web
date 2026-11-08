// ============================================================================
//  src/servicios/recomendador.js — reglas de un técnico de sonido, en código
//
//  Idea clave del proyecto: la IA NO decide qué equipos ni cuánto cuestan.
//  Eso lo deciden estas reglas, que son predecibles, auditables y usan el
//  stock real de AeeS. La IA (ia.js) solo explica el resultado con palabras
//  simples.
//
//  Entrada (encuesta): tipo_evento, personas, espacio (interior/exterior),
//  horas, hay_electricidad, extras { orquesta, banda, dj, proyeccion, luces },
//  y para músicos en vivo: integrantes, horas_grupo, trae_monitoreo.
//
//  Reglas del negocio (precios de referencia en Admin → Equipos/Combos):
//   • Evento pequeño (hasta 80 personas, lugar cerrado): 2 JBL EON615 con
//     mezcladora pequeña y 2 micros. Lugar abierto: EAW LA151. Más graves:
//     sub SRX818SP (un bajo) o SRX828SP (bajo doble).
//   • DJ: line array EAW XRS212 con 1 o 2 subs dobles y 2 EON615 de monitor.
//   • Fiesta electrónica: como mínimo el sistema del DJ (Combo grande), 8 h.
//   • Grupo u orquesta: se ajusta al rider técnico según los integrantes;
//     4 monitores EON615 de retorno, salvo que el grupo traiga su monitoreo.
//
//  1. Perfil acústico según el tipo de evento:
//      • spl   → fiesta electrónica / concierto: mucha presión sonora y graves.
//      • baile → bodas, cumpleaños, quinceañeros: música para bailar + discursos.
//      • voz   → corporativo / conferencia: lo importante es que se ENTIENDA
//                cada palabra (inteligibilidad) a volumen moderado.
//  2. Personas "efectivas": al aire libre no hay paredes que reflejen el
//     sonido, así que se necesita ~40% más sistema para la misma gente.
//  3. Escalera de sistemas por perfil (con los equipos reales: EON615,
//     EAW LA151, line array EAW XRS212, subs JBL SRX818SP / SRX828SP...).
//     "Recomendado" es el peldaño que corresponde; "esencial" baja uno y
//     "premium" sube uno.
//  4. Se agregan consola, micrófonos, monitores, luces, pantalla LED y cables
//     según los extras. Lo que AeeS no tiene (tarima, generador, toldo) se
//     indica como "lo coordinamos con un proveedor aliado".
//  5. Se ajusta al stock libre de la fecha: si falta un equipo se busca otro
//     del mismo rol; si no hay, se avisa para coordinar con un aliado.
// ============================================================================

const PERFILES = {
  fiesta_electronica: { perfil: 'spl', horas: 8 },
  concierto: { perfil: 'spl', horas: 6 },
  fiesta: { perfil: 'baile', horas: 6 },
  quinceanero: { perfil: 'baile', horas: 6 },
  boda: { perfil: 'baile', horas: 6, ceremonia: true },
  cumpleanos: { perfil: 'baile', horas: 6 },
  graduacion: { perfil: 'baile', horas: 6 },
  corporativo: { perfil: 'voz', horas: 4 },
  conferencia: { perfil: 'voz', horas: 4 },
  otro: { perfil: 'baile', horas: 6 }
};

// Escaleras: [hasta N personas efectivas, [[equipo, cantidad], ...]]
const ESCALERAS = {
  voz: [
    [120, [['zlx15p', 2]]],
    [250, [['la151', 2]]],
    [Infinity, [['xrs212', 2], ['la151', 2]]]
  ],
  // Paquete pequeño (≤ 80) → mediano (LA151 + un bajo) → bajo doble → line array.
  baile: [
    [80, [['eon615', 2]]],
    [150, [['la151', 2], ['srx818sp', 1]]],
    [250, [['la151', 2], ['srx828sp', 1]]],
    [450, [['xrs212', 2], ['srx828sp', 1]]],
    [Infinity, [['xrs212', 2], ['la151', 2], ['srx828sp', 2]]]
  ],
  // Fiesta electrónica / concierto: el mínimo es el sistema del DJ (Combo grande).
  spl: [
    [250, [['xrs212', 2], ['srx828sp', 1]]],
    [450, [['xrs212', 2], ['srx828sp', 2]]],
    [Infinity, [['xrs212', 2], ['la151', 2], ['srx828sp', 2], ['srx818sp', 2]]]
  ],
  // DJ en un evento social: pequeño con un bajo; desde 80 personas, line array.
  dj: [
    [80, [['eon615', 2], ['srx818sp', 1]]],
    [250, [['xrs212', 2], ['srx828sp', 1]]],
    [Infinity, [['xrs212', 2], ['srx828sp', 2]]]
  ]
};

// Micrófonos vocales del inventario, del mejor al más simple (para el rider).
const MICS_VOCALES = ['e935', 'beta58', 'e945', 'sm58', 'e832', 'sv100'];

const MOTIVOS_PERFIL = {
  spl: 'Es un evento de alta energía: priorizamos presión sonora (SPL) y graves con subwoofers JBL para que la pista se sienta.',
  baile: 'Combina música para bailar con brindis y discursos: buscamos sonido parejo en todo el lugar sin aturdir a las mesas.',
  voz: 'Lo importante es que se entienda cada palabra: usamos parlantes con voz muy clara a volumen moderado y micrófonos de calidad, no potencia bruta.'
};

const PARLANTES = ['xrs212', 'la151', 'eon615', 'zlx15p', 'rcf-pasivo', 'srx818sp', 'srx828sp'];

const limitar = (n, min, max) => Math.max(min, Math.min(max, n));

// Acumula equipos en un objeto { id: { cantidad, motivo } } sumando si se repite.
function crearLista() {
  const items = {};
  return {
    items,
    poner(id, cantidad, motivo) {
      if (!(cantidad > 0)) return;
      items[id] = items[id] ? { cantidad: items[id].cantidad + cantidad, motivo: items[id].motivo } : { cantidad, motivo };
    }
  };
}

function armarNivel(nivel, e, ctx) {
  const { perfil, pEff, extras, tipo } = ctx;
  const lista = crearLista();
  const enVivo = extras.orquesta || extras.banda;
  // Con DJ (y sin músicos) en un evento social se usa la escalera del DJ.
  const esc = ESCALERAS[extras.dj && !enVivo && perfil === 'baile' ? 'dj' : perfil];
  let paso = esc.findIndex(([max]) => pEff <= max);
  if (nivel === 'esencial') paso = Math.max(0, paso - 1);
  if (nivel === 'premium') paso = Math.min(esc.length - 1, paso + 1);
  let principal = esc[paso][1];
  // Lugar abierto y evento pequeño: el EAW LA151 llega más lejos que el EON615.
  if (ctx.exterior && principal.some(([id]) => id === 'eon615')) principal = principal.map(([id, n]) => [id === 'eon615' ? 'la151' : id, n]);
  const MOTIVO = {
    xrs212: 'Line array: proyecta el sonido lejos y parejo',
    srx818sp: 'Subwoofer de un bajo para los graves',
    srx828sp: 'Subwoofer de bajo doble: graves que se sienten en la pista',
    la151: ctx.exterior ? 'EAW LA151: al aire libre llega más lejos que un parlante de 15"' : 'Sonido principal para tus invitados'
  };
  for (const [id, n] of principal) lista.poner(id, n, MOTIVO[id] || 'Sonido principal dimensionado para tus invitados');
  const conLineArray = principal.some(([id]) => id === 'xrs212');

  // Consola: Ui24R con músicos en vivo (muchos canales) o line array;
  // Ui16 para lo intermedio; la mezcladora pequeña para el paquete pequeño.
  const integrantes = enVivo ? limitar(Math.round(Number(ctx.integrantes) || 5), 1, 20) : 0;
  if (enVivo || conLineArray || nivel === 'premium') lista.poner('ui24r', 1, enVivo ? `Consola digital de 24 canales: alcanza para los ${integrantes} integrantes y las voces` : 'Consola digital de 24 canales para el sistema grande');
  else if (pEff <= 80 && perfil !== 'voz') lista.poner('soundcraft-8', 1, 'Mezcladora pequeña con efectos para música y micrófonos');
  else lista.poner('ui16', 1, 'Consola digital controlada por tablet');

  // Micrófonos
  if (perfil === 'voz') {
    lista.poner('shure-inal', nivel === 'esencial' ? 1 : 2, 'Inalámbricos para expositores y preguntas del público');
    lista.poner('beta58', 1, 'Micrófono de podio con poco acople');
  } else if (pEff <= 80 && !conLineArray) {
    lista.poner('sm58', 2, 'Dos micrófonos para saludos, brindis y animación');
  } else {
    lista.poner('shure-inal', e.ceremonia ? 2 : 1, e.ceremonia ? 'Inalámbricos para ceremonia, padrinos y brindis' : 'Inalámbrico para saludos y brindis');
  }

  // Músicos en vivo: se arma según el rider técnico del grupo.
  //  • un micrófono por integrante, del mejor modelo al más simple, según el stock,
  //  • 4 monitores EON615 de retorno, salvo que el grupo traiga su monitoreo.
  if (enVivo) {
    let faltan = integrantes;
    for (const id of MICS_VOCALES) {
      if (faltan <= 0) break;
      const n = Math.min(faltan, ctx.stock?.[id] ?? faltan);
      lista.poner(id, n, 'Micrófono para el rider del grupo (voces e instrumentos)');
      faltan -= n;
    }
    if (!ctx.trae_monitoreo) lista.poner('eon615', 4, '4 EON615 de retorno: el grupo se escucha en el escenario');
  }
  // DJ o electrónica con line array: 2 EON615 de monitor en la cabina.
  if ((extras.dj || perfil === 'spl') && !enVivo && conLineArray) lista.poner('eon615', 2, 'Dos EON615 de monitor para la cabina del DJ');

  // Luces según el perfil
  const quiereLuces = extras.luces !== false;
  if (perfil === 'spl') {
    lista.poner('beam290', nivel === 'esencial' ? 2 : 4, 'Cabezas móviles Beam 290 para el show de luces');
    lista.poner('tacho-54', nivel === 'esencial' ? 6 : 12, 'Tachos LED para bañar de color el escenario');
    lista.poner('humo', 1, 'Humo para que se vean los haces de luz');
    if (nivel !== 'esencial') lista.poner('dmx', 1, 'Controlador DMX para sincronizar todas las luces');
    if (nivel === 'premium') { lista.poner('matrix', 1, 'Matrix LED detrás del DJ'); lista.poner('minibrut', 2, 'Blinders para los golpes de luz al público'); }
  } else if (perfil === 'baile' && quiereLuces) {
    const tachos = limitar(Math.round(ctx.personas / 25), 4, 12);
    lista.poner('tacho-54', nivel === 'esencial' ? 4 : tachos, e.ceremonia ? 'Tachos LED en tono cálido para iluminar el salón (uplighting)' : 'Tachos LED de colores para la pista');
    if (nivel !== 'esencial' && ctx.personas > 100) { lista.poner('beam290', 2, 'Cabezas móviles para el momento del baile'); lista.poner('humo', 1, 'Humo para el vals o la hora loca'); }
    if (nivel !== 'esencial') lista.poner('dmx', 1, 'DMX: escenas de luz programadas para cada momento');
    if (nivel === 'premium') lista.poner('minibrut', 2, 'Blinders para la entrada de los novios');
  } else if (perfil === 'voz' && nivel === 'premium') {
    lista.poner('tacho-54', 4, 'Luz frontal suave para el escenario y las fotos');
  }

  // Pantalla LED (AeeS trabaja con LED P3.9 por metro cuadrado)
  if (extras.proyeccion || (tipo === 'corporativo' && nivel !== 'esencial')) {
    const m2 = nivel === 'premium' ? 8 : nivel === 'esencial' ? 4 : 6;
    lista.poner('led-p39', m2, `Pantalla LED de ${m2} m²: se ve bien incluso con luz`);
  }

  // Trípodes para los parlantes de 15" del sistema principal (no para los monitores).
  const enTripode = principal.filter(([id]) => ['eon615', 'zlx15p'].includes(id)).reduce((s, [, n]) => s + n, 0);
  if (enTripode) lista.poner('tripode', Math.ceil(enTripode / 2), 'Trípodes para elevar los parlantes sobre la gente');

  // Cables: siempre ordenados y etiquetados (un kit por cada 4 parlantes aprox.).
  const parlantes = Object.entries(lista.items).filter(([id]) => PARLANTES.includes(id)).reduce((s, [, v]) => s + v.cantidad, 0);
  lista.poner('kit-cables', Math.max(1, Math.ceil(parlantes / 4)), 'Cables etiquetados y canaletas: nada suelto en el piso');

  return lista.items;
}

// Ajusta cantidades al stock libre del día; busca reemplazo del mismo rol si falta.
function ajustarAStock(items, mapa, libres, avisos) {
  const usados = {};
  const salida = [];
  const libreDe = id => (libres[id] ?? mapa[id]?.cantidad_total ?? 0) - (usados[id] || 0);
  for (const [id, { cantidad, motivo }] of Object.entries(items)) {
    const e = mapa[id];
    if (!e) continue;
    if (libreDe(id) >= cantidad) {
      salida.push({ equipo_id: id, cantidad, motivo });
      usados[id] = (usados[id] || 0) + cantidad;
      continue;
    }
    const alterno = Object.values(mapa).find(x => x.rol === e.rol && x.id !== id && x.publicado && libreDe(x.id) >= cantidad);
    const libre = libreDe(id);
    if (alterno) {
      salida.push({ equipo_id: alterno.id, cantidad, motivo: `${motivo} (en lugar de ${e.nombre})` });
      usados[alterno.id] = (usados[alterno.id] || 0) + cantidad;
      avisos.push(`${e.nombre} no alcanza esa fecha; lo cambiamos por ${alterno.nombre}.`);
    } else if (libre > 0) {
      salida.push({ equipo_id: id, cantidad: libre, motivo });
      usados[id] = (usados[id] || 0) + libre;
      avisos.push(`Tenemos ${libre} de ${e.nombre} para esa fecha (lo ideal son ${cantidad}); el resto lo coordinamos con un proveedor aliado.`);
    } else {
      avisos.push(`${e.nombre} está ocupado esa fecha: lo coordinamos con un proveedor aliado en la reunión.`);
    }
  }
  return salida;
}

// Combo publicado que mejor encaja con el tipo de evento y la cantidad de personas.
// Solo combos con sonido principal: un combo de solo luces es un complemento, no una solución.
function comboSugerido(combos, tipo, personas, mapa) {
  const conSonido = c => (c.items || []).some(it => ['top', 'line_array'].includes(mapa[it.equipo_id]?.rol));
  const candidatos = combos.filter(c => c.publicado !== false && (c.tipos_evento || []).includes(tipo) && conSonido(c));
  if (!candidatos.length) return null;
  const dentro = candidatos.filter(c => personas >= c.personas_min && personas <= c.personas_max);
  const lista = dentro.length ? dentro : candidatos;
  return lista.sort((a, b) => Math.abs((a.personas_max + a.personas_min) / 2 - personas) - Math.abs((b.personas_max + b.personas_min) / 2 - personas))[0];
}

function recomendar(encuesta, { mapa, libres, combos, lluvia }) {
  const tipo = PERFILES[encuesta.tipo_evento] ? encuesta.tipo_evento : 'otro';
  const e = PERFILES[tipo];
  const personas = limitar(Math.round(Number(encuesta.personas) || 50), 5, 3000);
  const exterior = encuesta.espacio === 'exterior';
  // Al aire libre se dimensiona ~40% más; en un evento pequeño (≤ 80) basta con
  // cambiar a EAW LA151, que llega más lejos (regla del negocio).
  const pEff = Math.round(personas * (exterior && personas > 80 ? 1.4 : 1));
  const extras = encuesta.extras || {};
  const enVivo = extras.orquesta || extras.banda;
  const horasGrupo = enVivo ? limitar(Math.round(Number(encuesta.horas_grupo) || 0), 0, 24) : 0;
  // El equipo se queda al menos lo que toca el grupo.
  const horas = limitar(Math.max(Math.round(Number(encuesta.horas) || e.horas), horasGrupo), 1, 24);
  const stock = Object.fromEntries(Object.values(mapa).map(x => [x.id, libres[x.id] ?? x.cantidad_total ?? 0]));

  const ctx = {
    perfil: e.perfil, personas, pEff, exterior, extras, tipo, stock,
    integrantes: encuesta.integrantes, trae_monitoreo: Boolean(encuesta.trae_monitoreo)
  };

  const razones = [MOTIVOS_PERFIL[e.perfil]];
  if (exterior) razones.push('Al aire libre el sonido no rebota en paredes: dimensionamos como si hubiera un 40% más de invitados.');
  if (exterior) razones.push(lluvia ? 'El pronóstico indica lluvia: coordinamos toldo para proteger la consola y los equipos.' : 'Para eventos al aire libre llevamos protección para la consola y, si hace falta, toldo.');
  if (tipo === 'fiesta_electronica') razones.push('Una fiesta electrónica dura unas 8 horas: partimos del sistema del DJ (line array con bajo doble) y se suman las 2 horas extra.');
  if (enVivo) {
    const n = limitar(Math.round(Number(encuesta.integrantes) || 5), 1, 20);
    razones.push(`Ajustamos el sonido al rider técnico del grupo: ${n} integrantes${horasGrupo ? `, ${horasGrupo} h de show` : ''}, consola digital Ui24R${encuesta.trae_monitoreo ? ' (el grupo trae su monitoreo)' : ' y 4 monitores de retorno'}. Envíanos su rider para afinar los detalles.`);
  }
  if (extras.dj && !enVivo) razones.push('Para el DJ dejamos la entrada lista en la consola y monitores en la cabina; el DJ trae su controlador.');
  if (encuesta.hay_electricidad === false) razones.push('El lugar no tiene electricidad confiable: coordinamos un generador con un proveedor aliado.');
  if (personas > 600) razones.push('Para más de 600 personas conviene una visita técnica: te contactaremos para ajustar el diseño.');

  const avisos = [];
  const opciones = ['esencial', 'recomendado', 'premium'].map(nivel => ({
    nivel,
    items: ajustarAStock(armarNivel(nivel, e, ctx), mapa, libres, nivel === 'recomendado' ? avisos : [])
  }));

  return {
    tipo_evento: tipo,
    perfil: e.perfil,
    // Técnico operando todo el evento: con músicos, line array o mucha gente.
    con_tecnico: Boolean(enVivo || e.perfil === 'spl' || personas > 150),
    personas,
    personas_efectivas: pEff,
    horas,
    razones,
    avisos,
    opciones,
    combo: comboSugerido(combos, tipo, personas, mapa)
  };
}

module.exports = { recomendar, PERFILES };
