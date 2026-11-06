// Voz (síntesis del sistema) y pitidos estéreo (Web Audio).

export class Voz {
  constructor() {
    this.velocidad = 1;
    this.voz = null;
    if ('speechSynthesis' in window) {
      speechSynthesis.addEventListener?.('voiceschanged', () => this.#elegirVoz());
      this.#elegirVoz();
    }
  }

  get disponible() {
    return 'speechSynthesis' in window;
  }

  #elegirVoz() {
    const voces = speechSynthesis.getVoices();
    this.voz =
      voces.find((v) => v.lang === 'es-ES') ||
      voces.find((v) => v.lang.toLowerCase().startsWith('es')) ||
      null;
  }

  decir(texto, urgente = false) {
    if (!this.disponible) return;
    if (urgente) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = this.voz?.lang || 'es-ES';
    if (this.voz) u.voice = this.voz;
    u.rate = this.velocidad;
    speechSynthesis.speak(u);
  }

  callar() {
    if (this.disponible) speechSynthesis.cancel();
  }
}

export class Pitidos {
  constructor() {
    this.ctx = null;
    this.temporizador = null;
  }

  async desbloquear() {
    if (!this.ctx) {
      const Contexto = window.AudioContext || window.webkitAudioContext;
      if (!Contexto) return false;
      this.ctx = new Contexto();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return true;
  }

  pitido({ pan = 0, frecuencia = 660, duracion = 0.12, volumen = 0.3 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gan = this.ctx.createGain();
    osc.frequency.value = frecuencia;
    gan.gain.setValueAtTime(0.0001, t);
    gan.gain.exponentialRampToValueAtTime(volumen, t + 0.01);
    gan.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
    osc.connect(gan);
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      gan.connect(p);
      p.connect(this.ctx.destination);
    } else {
      gan.connect(this.ctx.destination);
    }
    osc.start(t);
    osc.stop(t + duracion + 0.02);
  }

  // obtener() devuelve el sonido actual {pan, frecuencia, intervaloMs} o null.
  iniciarBucle(obtener) {
    this.detenerBucle();
    const tic = () => {
      const s = obtener();
      if (s) this.pitido(s);
      this.temporizador = setTimeout(tic, s ? s.intervaloMs : 250);
    };
    tic();
  }

  detenerBucle() {
    clearTimeout(this.temporizador);
    this.temporizador = null;
  }
}
