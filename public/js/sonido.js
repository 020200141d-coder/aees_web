// ============================================================================
//  sonido.js — sonidos del sitio generados con la Web Audio API
//
//  ¿Por qué sintetizarlos y no usar un .mp3?
//   • Cero archivos que descargar y cero problemas de derechos de autor.
//   • Se puede explicar cómo se construye un sonido: osciladores (ondas),
//     filtros y envolventes de volumen (gain), igual que en una consola.
//
//  Todo usa el mismo kit de electro deep: intro "punch" (3 bombos a 126 BPM,
//  rumble, stab con eco), letras = stabs al ritmo, botones = hi-hat cerrado.
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

  function bomboPunch(c, t, vol = 1) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    envolvente(g, t, vol, 0.42, 0.002);
    o.connect(g).connect(maestro);
    o.start(t); o.stop(t + 0.45);
    // Sub: un seno grave (50 → 41 Hz) que queda sonando bajo el golpe: más "frecuencias bajas".
    const sub = c.createOscillator(), gs = c.createGain();
    sub.frequency.setValueAtTime(50, t);
    sub.frequency.exponentialRampToValueAtTime(41, t + 0.5);
    envolvente(gs, t + 0.01, 0.45 * vol, 0.7, 0.02);
    sub.connect(gs).connect(maestro);
    sub.start(t); sub.stop(t + 0.75);
    const clic = ruido(c, 0.02), f = c.createBiquadFilter(), gc = c.createGain();
    f.type = 'highpass'; f.frequency.value = 3000;
    envolvente(gc, t, 0.25 * vol, 0.015, 0.001);
    clic.connect(f).connect(gc).connect(maestro);
    clic.start(t); clic.stop(t + 0.02);
  }

  function rumble(c, t, dur) {
    const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 41.2;
    f.type = 'lowpass'; f.frequency.value = 120;
    envolvente(g, t + 0.03, 0.35, dur, 0.05);
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
    const t = c.currentTime + 0.05;
    [0, 1, 2].forEach(i => bomboPunch(c, t + i * NEGRA, i === 0 ? 1.1 : 0.9));
    rumble(c, t, NEGRA * 3);
    stab(c, t, 0.4);
    [0, 1, 2].forEach(i => hatAbierto(c, t + i * NEGRA + NEGRA / 2));
  }

  // ── El resto del sitio con el mismo kit deep ──────────────────────────────
  // Cuantizar: en vez de sonar en el instante exacto, cada letra espera la próxima
  // semicorchea (1/16) del pulso de 126 BPM. Por eso al pasar el mouse rápido por un
  // título suena "a ritmo" y no como notas sueltas.
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

  // Stab de UNA nota (para las letras): diente de sierra + cuadrada una octava abajo,
  // por un filtro que se cierra rápido; un poco de eco para que quede flotando.
  function stabNota(c, t, hz, vol = 0.09) {
    const f = c.createBiquadFilter(), g = c.createGain(), envio = c.createGain();
    f.type = 'lowpass'; f.Q.value = 5;
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.18);
    envolvente(g, t, vol, 0.22, 0.003);
    envio.gain.value = 0.35;
    f.connect(g); g.connect(maestro); g.connect(envio).connect(busEco(c));
    [[hz, 'sawtooth'], [hz / 2, 'square']].forEach(([z, tipo]) => {
      const o = c.createOscillator();
      o.type = tipo; o.frequency.value = z;
      o.connect(f);
      o.start(t); o.stop(t + 0.26);
    });
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

  // Letras de los títulos: La menor natural (La, Do, Re, Mi, Sol...). Cada 4 letras
  // un hi-hat, y la primera letra lleva un bombo suave: así un título "toca un compás".
  const ESCALA = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];
  function nota(i = 0, vol = 0.09) {
    if (!activo) return;
    const c = contexto();
    if (!c) return;
    const t = alPulso(c);
    stabNota(c, t, ESCALA[i % ESCALA.length], vol);
    if (i % 4 === 0) hatCerrado(c, t);
    if (i === 0) bomboPunch(c, t, 0.45);
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
