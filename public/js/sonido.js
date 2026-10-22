// ============================================================================
//  sonido.js — sonidos del sitio generados con la Web Audio API
//
//  ¿Por qué sintetizarlos y no usar un .mp3?
//   • Cero archivos que descargar y cero problemas de derechos de autor.
//   • Se puede explicar cómo se construye un sonido: osciladores (ondas),
//     filtros y envolventes de volumen (gain), igual que en una consola.
//
//  Los navegadores NO dejan reproducir audio sin una acción del usuario, por
//  eso todo empieza con el clic en "Entrar con sonido" o en el botón de la
//  bocina. La preferencia se recuerda en localStorage.
//
//  API global: AeesSonido.activo, activar(), desactivar(), intro(), tick(), confirmar()
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

  // Bombo: una onda senoidal que baja de 150 Hz a 40 Hz muy rápido.
  function bombo(c, t, vol = 0.9) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
    envolvente(g, t, vol, 0.5, 0.003);
    o.connect(g).connect(maestro);
    o.start(t); o.stop(t + 0.55);
  }

  // Intro de ~3 s: "subida" de ruido filtrado → golpe de bombo + acorde → brillo.
  function intro() {
    const c = contexto();
    if (!c) return;
    const t = c.currentTime + 0.05;

    // 1. Riser: ruido blanco con un filtro pasa-banda que sube de 300 Hz a 6 kHz.
    const r = ruido(c, 1.4), f = c.createBiquadFilter(), gr = c.createGain();
    f.type = 'bandpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + 1.3);
    gr.gain.setValueAtTime(0.0001, t);
    gr.gain.exponentialRampToValueAtTime(0.35, t + 1.25);
    gr.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    r.connect(f).connect(gr).connect(maestro);
    r.start(t); r.stop(t + 1.4);

    // 2. Golpe: bombo + sub de 55 Hz (La grave).
    const golpe = t + 1.35;
    bombo(c, golpe, 1);
    const sub = c.createOscillator(), gs = c.createGain();
    sub.frequency.value = 55;
    envolvente(gs, golpe, 0.5, 1.8, 0.02);
    sub.connect(gs).connect(maestro);
    sub.start(golpe); sub.stop(golpe + 1.9);

    // 3. Acorde de La menor con ondas diente de sierra suavizadas por un pasa-bajos.
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, golpe);
    lp.frequency.exponentialRampToValueAtTime(2600, golpe + 0.6);
    lp.connect(maestro);
    [220, 261.63, 329.63, 440].forEach((hz, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = (i - 1.5) * 6;
      envolvente(g, golpe, 0.08, 1.9, 0.04);
      o.connect(g).connect(lp);
      o.start(golpe); o.stop(golpe + 2);
    });

    // 4. Brillo final: arpegio corto de notas agudas.
    [880, 1046.5, 1318.5, 1760].forEach((hz, i) => {
      const o = c.createOscillator(), g = c.createGain(), tt = golpe + 0.25 + i * 0.09;
      o.type = 'triangle'; o.frequency.value = hz;
      envolvente(g, tt, 0.06, 0.45);
      o.connect(g).connect(maestro);
      o.start(tt); o.stop(tt + 0.5);
    });
  }

  // "Tic" muy suave al pasar el mouse por un botón.
  function tick() {
    if (!activo) return;
    const c = contexto();
    if (!c) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(1200, t + 0.04);
    envolvente(g, t, 0.025, 0.06, 0.002);
    o.connect(g).connect(maestro);
    o.start(t); o.stop(t + 0.07);
  }

  // Dos notas ascendentes al agregar algo a "Mi evento".
  function confirmar() {
    if (!activo) return;
    const c = contexto();
    if (!c) return;
    [659.25, 987.77].forEach((hz, i) => {
      const t = c.currentTime + i * 0.09, o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = hz;
      envolvente(g, t, 0.08, 0.3);
      o.connect(g).connect(maestro);
      o.start(t); o.stop(t + 0.32);
    });
    bombo(c, c.currentTime, 0.25);
  }

  function guardar() {
    try { localStorage.setItem('aees_sonido', activo ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    document.dispatchEvent(new CustomEvent('sonido-cambiado', { detail: activo }));
  }

  window.AeesSonido = {
    get activo() { return activo; },
    activar() { activo = true; contexto(); guardar(); },
    desactivar() { activo = false; guardar(); },
    intro, tick, confirmar
  };
})();
