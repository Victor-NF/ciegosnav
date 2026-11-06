// Control de alineación: compara el rumbo actual con el rumbo objetivo
// y decide qué decir y cómo sonar. Pensado para cruzar recto.
import { difAngulo } from './geo.js';

const OK = 5; // grados
const LEVE = 15;
const PERDIDO = 45;
const HISTERESIS = 2;
const REPETIR_MS = 4000;

const FRASES = {
  ok: 'Recto.',
  leveI: 'Un poco a la izquierda.',
  leveD: 'Un poco a la derecha.',
  fuerteI: 'Gira a la izquierda.',
  fuerteD: 'Gira a la derecha.',
  perdido: 'Muy desviado. Detente y reorienta el cuerpo.',
};

export class Alineacion {
  constructor() {
    this.objetivo = null;
    this.banda = 'ok';
    this.lado = 0;
    this.ultimoHabla = -Infinity;
    this.ultimaClave = null;
  }

  iniciar(objetivo) {
    this.objetivo = objetivo;
    this.banda = 'ok';
    this.lado = 0;
    this.ultimoHabla = -Infinity;
    this.ultimaClave = null;
  }

  // Nivel con histéresis: sube al superar el límite más el margen
  // y baja al quedar por debajo del límite menos el margen.
  #nivel(abs) {
    const niveles = ['ok', 'leve', 'fuerte', 'perdido'];
    const limites = [0, OK, LEVE, PERDIDO];
    let n = niveles.indexOf(this.banda);
    while (n < 3 && abs > limites[n + 1] + HISTERESIS) n++;
    while (n > 0 && abs < limites[n] - HISTERESIS) n--;
    return niveles[n];
  }

  // rumbo: grados actuales. Devuelve desviación, texto a decir (o null) y sonido.
  actualizar(rumbo, ahora = Date.now()) {
    const dev = difAngulo(this.objetivo, rumbo); // positivo = hay que girar a la derecha
    const abs = Math.abs(dev);
    const nueva = this.#nivel(abs);
    const lado = dev >= 0 ? 1 : -1;
    const ladoEfectivo = nueva === 'ok' ? 0 : lado;
    const cambio = nueva !== this.banda || (nueva !== 'ok' && ladoEfectivo !== this.lado);
    this.banda = nueva;
    this.lado = ladoEfectivo;

    const clave = nueva === 'ok' ? 'ok' : nueva === 'perdido' ? 'perdido' : `${nueva === 'leve' ? 'leve' : 'fuerte'}${lado > 0 ? 'D' : 'I'}`;
    let texto = null;
    if (cambio || (nueva !== 'ok' && ahora - this.ultimoHabla > REPETIR_MS)) {
      texto = FRASES[clave];
      this.ultimoHabla = ahora;
    }
    this.ultimaClave = clave;

    // Pitido: suena del lado hacia el que hay que girar. En "recto", un tictac grave y central.
    const pan = Math.max(-1, Math.min(1, dev / 30));
    let sonido;
    if (nueva === 'ok') sonido = { pan: 0, frecuencia: 330, intervaloMs: 2000 };
    else if (nueva === 'leve') sonido = { pan, frecuencia: 660, intervaloMs: 700 };
    else sonido = { pan: lado, frecuencia: 880, intervaloMs: 350 };

    return { desviacion: dev, banda: nueva, texto, sonido };
  }
}
