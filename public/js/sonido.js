// ============================================================================
//  sonido.js — sonidos del sitio generados con la Web Audio API
//
//  ¿Por qué sintetizarlos y no usar un .mp3?
//   • Cero archivos que descargar y cero problemas de derechos de autor.
//   • Se puede explicar cómo se construye un sonido: osciladores (ondas),
//     filtros y envolventes de volumen (gain), igual que en una consola.
//
//  Intro "punch" electro deep (un golpe de bombo con clic,
//  rumble, stab con eco), letras = pluck urbano al ritmo con kicks y 808, botones = hi-hat.
//
//  Los navegadores NO dejan reproducir audio sin una acción del usuario, por
//  eso todo empieza con el clic en el botón de volumen del header (la primera
//  vez suena la intro). La preferencia se recuerda en localStorage.
//
//  API global: AeesSonido.activo, activar(), desactivar(), intro(), tick(), confirmar(), nota(i), logo()
// ============================================================================

(function () {
  let ctx = null;
  let maestro = null;
  let activo = false;
  try { activo = localStorage.getItem('aees_sonido') === '1'; } catch (e) { /* modo privado */ }

  // El AudioContext se crea recién en el primer clic (requisito del navegador).
  function contexto() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      maestro = ctx.createGain();
      maestro.gain.value = 0.7;
      // Compresor final: evita picos que saturen los parlantes de la laptop.
      const comp = ctx.createDynamicsCompressor();
      maestro.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Envolvente simple: sube rápido y cae en `dur` segundos.
  function envolvente(g, t, pico, dur, ataque = 0.01) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pico, t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function ruido(c, dur) {
    const buffer = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const datos = buffer.getChannelData(0);
    for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1;
    const fuente = c.createBufferSource();
    fuente.buffer = buffer;
    return fuente;
  }

  // ── Intro: "punch" de electro deep / tech house (~1,8 s) ──────────────────
  // Antes era una intro de cine de ~3 s; el negocio pidió algo corto y con golpe,
  // como la entrada de un set de DJ. Se arma con 4 piezas, todas sintetizadas:
  //   1. Bombo con "clic": seno que cae de 180 a 42 Hz + un chasquido de ruido agudo.
  //      Suenan 3 bombos a 126 BPM (el tempo típico del tech house).
  //   2. Rumble: diente de sierra grave (Mi, 41 Hz) por un pasa-bajos → el "temblor" del sub.
  //   3. Stab: acorde menor profundo (La m7 abierto) con filtro que se cierra y eco
  //      (delay a 3/8 de tiempo con realimentación) → el "brillo" que queda flotando.
  //   4. Hi-hat abierto a contratiempo entre bombo y bombo.
  const BPM_INTRO = 126;
  const NEGRA = 60 / BPM_INTRO;

  // Eco del stab: se crea una sola vez y queda conectado al maestro.
  let eco = null;
  function busEco(c) {
    if (eco) return eco;
    eco = c.createDelay(1);
    eco.delayTime.value = NEGRA * 0.75;
    const realim = c.createGain(), oscuro = c.createBiquadFilter();
    realim.gain.value = 0.38;                       // cada repetición suena al 38 %
    oscuro.type = 'lowpass'; oscuro.frequency.value = 1800;  // repeticiones más opacas
    eco.connect(oscuro).connect(realim).connect(eco);
    oscuro.connect(maestro);
    return eco;
  }

  function bomboPunch(c, t, vol = 1, conSub = true) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    envolvente(g, t, vol, 0.42, 0.002);
    o.connect(g).connect(maestro);
    o.start(t); o.stop(t + 0.45);
    // Sub: un seno grave (50 → 41 Hz) que queda sonando bajo el golpe: más "frecuencias bajas".
    if (conSub) {
      const sub = c.createOscillator(), gs = c.createGain();
      sub.frequency.setValueAtTime(50, t);
      sub.frequency.exponentialRampToValueAtTime(41, t + 0.5);
      envolvente(gs, t + 0.01, 0.45 * vol, 0.7, 0.02);
      sub.connect(gs).connect(maestro);
      sub.start(t); sub.stop(t + 0.75);
    }
    const clic = ruido(c, 0.02), f = c.createBiquadFilter(), gc = c.createGain();
    f.type = 'highpass'; f.frequency.value = 3000;
    envolvente(gc, t, 0.25 * vol, 0.015, 0.001);
    clic.connect(f).connect(gc).connect(maestro);
    clic.start(t); clic.stop(t + 0.02);
  }

  function rumble(c, t, dur, vol = 0.35) {
    const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 41.2;
    f.type = 'lowpass'; f.frequency.value = 120;
    envolvente(g, t + 0.03, vol, dur, 0.05);
    o.connect(f).connect(g).connect(maestro);
    o.start(t); o.stop(t + dur + 0.1);
  }

  function hatAbierto(c, t, vol = 0.09) {
    const n = ruido(c, 0.25), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 8000;
    envolvente(g, t, vol, 0.2, 0.002);
    n.connect(f).connect(g).connect(maestro);
    n.start(t); n.stop(t + 0.25);
  }

  function stab(c, t, dur = 0.4, vol = 0.07) {
    const f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(350, t + dur);
    envolvente(g, t, 1, dur + 0.05, 0.004);
    f.connect(g);
    g.connect(maestro);
    g.connect(busEco(c));
    // La, Mi, Sol, Do, Mi: La menor 7 abierto (suena "deep", ni alegre ni triste).
    [110, 164.81, 196, 261.63, 329.63].forEach((hz, i) => {
      const o = c.createOscillator(), og = c.createGain();
      o.type = i % 2 ? 'square' : 'sawtooth';
      o.frequency.value = hz; o.detune.value = (i - 2) * 7;   // leve desafinado = más ancho
      og.gain.value = vol;
      o.connect(og).connect(f);
      o.start(t); o.stop(t + dur + 0.1);
    });
  }

  function intro() {
    const c = contexto();
    if (!c) return;
    // Opción A "Punch" (~1,2 s), la que eligió el negocio: UN golpe seco con clic,
    // rumble grave debajo, stab de acorde menor con eco que se apaga y un hi-hat
    // abierto a contratiempo. Volumen moderado (antes se oía muy fuerte).
    const t = c.currentTime + 0.05;
    bomboPunch(c, t, 0.75, false);
    rumble(c, t, 0.9, 0.25);
    stab(c, t, 0.4, 0.05);
    hatAbierto(c, t + NEGRA / 2, 0.07);
  }

  // ── El resto del sitio con el mismo kit deep ──────────────────────────────
  // Cuantizar: el logo y "agregar" esperan la próxima semicorchea (1/16) del pulso
  // de 126 BPM, así sus golpes caen siempre a tiempo.
  const SEMI = NEGRA / 4;
  const alPulso = c => Math.max(Math.ceil(c.currentTime / SEMI) * SEMI, c.currentTime + 0.005);

  // Hi-hat cerrado: ruido muy agudo y cortísimo.
  function hatCerrado(c, t, vol = 0.06) {
    const n = ruido(c, 0.05), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 9000;
    envolvente(g, t, vol, 0.035, 0.001);
    n.connect(f).connect(g).connect(maestro);
    n.start(t); n.stop(t + 0.05);
  }

  // Hi-hat cerrado al pasar el mouse por un botón.
  function tick() {
    if (!activo) return;
    const c = contexto();
    if (!c) return;
    hatCerrado(c, c.currentTime, 0.05);
  }

  // Agregar a "Mi evento": bombo suave + acorde deep con eco.
  function confirmar() {
    if (!activo) return;
    const c = contexto();
    if (!c) return;
    const t = alPulso(c);
    bomboPunch(c, t, 0.5);
    stab(c, t, 0.3, 0.06);
  }

  // ── Letras de los títulos: pluck urbano al ritmo, con kicks y bajo 808 ─────
  // Cada letra espera la próxima semicorchea del MISMO pulso de la intro (126 BPM, tempo
  // de techno / tech house), así todo el sitio va en un solo groove electrónico y al
  // pasar el mouse rápido por un título suena a ritmo y no a notas sueltas.
  //   • cada letra: nota "pluck" (sierra + cuadrada desafinada por un filtro que se cierra)
  //   • cada 4 letras: hi-hat + un kick suave
  //   • cada 8 letras: una nota de bajo 808 (seno grave saturado) para combinar con los kicks
  const SEMI_LETRAS = SEMI;   // 1/16 a 126 BPM, igual que la intro
  const alPulsoLetras = c => Math.max(Math.ceil(c.currentTime / SEMI_LETRAS) * SEMI_LETRAS, c.currentTime + 0.005);

  function pluck(c, t, hz, vol = 0.12) {
    const f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.Q.value = 7;
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(260, t + 0.2);
    envolvente(g, t, vol, 0.24, 0.003);
    f.connect(g).connect(maestro);
    [['sawtooth', 0], ['square', 8]].forEach(([tipo, desafinar]) => {
      const o = c.createOscillator();
      o.type = tipo; o.frequency.value = hz; o.detune.value = desafinar;
      o.connect(f);
      o.start(t); o.stop(t + 0.3);
    });
  }

  // Saturación suave (curva tanh) para que el 808 "gruña" y se oiga en parlantes chicos.
  let saturador = null;
  function saturar(c) {
    if (saturador) return saturador;
    saturador = c.createWaveShaper();
    const curva = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curva[i] = Math.tanh(2.5 * (i / 512 - 1));
    saturador.curve = curva;
    saturador.connect(maestro);
    return saturador;
  }

  // Bajo 808: seno que arranca una octava arriba y cae a su nota (el "bwoom").
  function bajo808(c, t, hz = 55, dur = 0.7, vol = 0.45) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(hz * 2, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.06);
    envolvente(g, t, vol, dur, 0.004);
    o.connect(g).connect(saturar(c));
    o.start(t); o.stop(t + dur + 0.05);
  }

  // La menor pentatónica (La, Do, Re, Mi, Sol): suena bien en cualquier orden.
  const ESCALA = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];
  const BAJOS = [55, 65.41, 49];   // La1, Do2, Sol1: el 808 va cambiando de nota
  function nota(i = 0, vol = 0.12) {
    if (!activo) return;
    const c = contexto();
    if (!c) return;
    const t = alPulsoLetras(c);
    pluck(c, t, ESCALA[i % ESCALA.length], vol);
    if (i % 4 === 0) { hatCerrado(c, t, 0.08); bomboPunch(c, t, 0.4, false); }
    if (i % 8 === 0) bajo808(c, t, BAJOS[(i / 8) % BAJOS.length]);
  }

  // Logo del hero: bombo + rumble corto (el "temblor" del sub).
  function logo() {
    if (!activo) return;
    const c = contexto();
    if (!c) return;
    const t = alPulso(c);
    bomboPunch(c, t, 0.8);
    rumble(c, t, 0.5);
  }

  function guardar() {
    try { localStorage.setItem('aees_sonido', activo ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    document.dispatchEvent(new CustomEvent('sonido-cambiado', { detail: activo }));
  }

  window.AeesSonido = {
    get activo() { return activo; },
    activar() { activo = true; contexto(); guardar(); },
    desactivar() { activo = false; guardar(); },
    intro, tick, confirmar, nota, logo
  };
})();
