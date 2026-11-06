// Guiado paso a paso sobre una ruta peatonal en formato OSRM.
import { cardinal, crearRuta, proyectar } from './geo.js';

const NIVELES = [80, 30, 10]; // metros a los que se avisa de cada maniobra
const MARGEN_FUERA_MIN = 25; // metros
const LECTURAS_FUERA = 3;
const ESPERA_FUERA_MS = 15000;
const ESPERA_SENAL_MS = 30000;
const PRECISION_DEBIL = 40; // metros de error GPS a partir de los que se avisa
const PRECISION_INUTIL = 80; // por encima, no se dan maniobras

const LADOS = {
  left: 'a la izquierda',
  right: 'a la derecha',
  'slight left': 'ligeramente a la izquierda',
  'slight right': 'ligeramente a la derecha',
  'sharp left': 'en ángulo cerrado a la izquierda',
  'sharp right': 'en ángulo cerrado a la derecha',
};

export function textoManiobra(paso) {
  const m = paso.maneuver || {};
  const calle = paso.name ? ` por ${paso.name}` : '';
  const lado = LADOS[m.modifier];
  switch (m.type) {
    case 'depart':
      return `empieza a caminar hacia el ${cardinal(m.bearing_after ?? 0)}${calle}`;
    case 'arrive':
      return 'llegas a tu destino';
    case 'roundabout':
    case 'rotary':
      return m.exit ? `en la rotonda, toma la salida ${m.exit}${calle}` : `entra en la rotonda${calle}`;
    case 'fork':
      return `en la bifurcación, mantente ${lado || 'recto'}${calle}`;
    case 'end of road':
      return `al final de la calle, gira ${lado || 'según la señal'}${calle}`;
    case 'turn':
      if (m.modifier === 'uturn') return 'da la vuelta';
      if (m.modifier === 'straight') return `sigue recto${calle}`;
      return `gira ${lado || ''}${calle}`.replace('  ', ' ');
    default:
      if (m.modifier === 'uturn') return 'da la vuelta';
      return lado ? `continúa ${lado}${calle}` : `sigue recto${calle}`;
  }
}

const redondear = (m) => Math.max(5, Math.round(m / 10) * 10);

export class GuiaRuta {
  constructor(rutaOsrm) {
    const coordenadas = rutaOsrm.geometry.coordinates;
    this.ruta = crearRuta(coordenadas);
    this.pasos = rutaOsrm.legs.flatMap((l) => l.steps);
    const suma = this.pasos.reduce((s, p) => s + p.distance, 0) || 1;
    const escala = this.ruta.total / suma;
    let acumulado = 0;
    this.inicioPaso = this.pasos.map((p) => {
      const inicio = acumulado;
      acumulado += p.distance * escala;
      return inicio;
    });
    this.duracion = rutaOsrm.duration;
    this.anunciados = new Set();
    this.fuera = 0;
    this.ultimoFuera = -Infinity;
    this.ultimaSenal = -Infinity;
    this.llegado = false;
    this.estado = null;
  }

  mensajeInicial() {
    const minutos = Math.max(1, Math.round(this.duracion / 60));
    const primero = this.pasos[0] ? textoManiobra(this.pasos[0]) : 'sigue la ruta';
    return `Ruta de ${Math.round(this.ruta.total)} metros, unos ${minutos} minutos andando. Primero, ${primero}.`;
  }

  // pos: {lat, lon, accuracy}. Devuelve mensajes, estado y si conviene recalcular la ruta.
  actualizar(pos, ahora = Date.now()) {
    const mensajes = [];
    let recalcular = false;
    const precision = pos.accuracy ?? 20;
    const pr = proyectar(this.ruta, pos);
    const restante = Math.max(0, this.ruta.total - pr.recorrido);

    let sig = this.inicioPaso.findIndex((inicio, i) => i >= 1 && inicio - pr.recorrido > -3);
    if (sig === -1) sig = this.pasos.length - 1;
    const distSig = Math.max(0, this.inicioPaso[sig] - pr.recorrido);
    this.estado = { recorrido: pr.recorrido, restante, fuera: pr.distancia, siguiente: sig, distSig, precision };

    if (this.llegado) return { mensajes, estado: this.estado, recalcular };

    if (precision > PRECISION_DEBIL && ahora - this.ultimaSenal > ESPERA_SENAL_MS) {
      this.ultimaSenal = ahora;
      mensajes.push({
        texto: `Posición poco precisa, con unos ${Math.round(precision)} metros de error. Avanza despacio y fíate del bastón.`,
        urgente: false,
      });
    }

    const limiteFuera = Math.max(MARGEN_FUERA_MIN, 1.5 * precision);
    this.fuera = pr.distancia > limiteFuera ? this.fuera + 1 : 0;
    if (this.fuera >= LECTURAS_FUERA && ahora - this.ultimoFuera > ESPERA_FUERA_MS) {
      this.ultimoFuera = ahora;
      recalcular = true;
      mensajes.push({
        texto: `Te has desviado unos ${Math.round(pr.distancia)} metros de la ruta. Recalculando.`,
        urgente: true,
      });
      return { mensajes, estado: this.estado, recalcular };
    }
    if (this.fuera > 0) return { mensajes, estado: this.estado, recalcular };

    if (restante <= Math.max(12, 0.7 * precision)) {
      this.llegado = true;
      mensajes.push({
        texto: `Has llegado a tu destino, con un margen de unos ${Math.round(Math.max(precision, 10))} metros.`,
        urgente: true,
      });
      return { mensajes, estado: this.estado, recalcular };
    }

    if (precision > PRECISION_INUTIL) return { mensajes, estado: this.estado, recalcular };

    const aplicables = NIVELES.filter((n) => distSig <= n);
    if (aplicables.length > 0) {
      const menor = Math.min(...aplicables);
      const clave = `${sig}:${menor}`;
      if (!this.anunciados.has(clave)) {
        aplicables.forEach((n) => this.anunciados.add(`${sig}:${n}`));
        const texto = textoManiobra(this.pasos[sig]);
        const cuando = menor === 10 ? 'Ahora' : `En ${redondear(distSig)} metros`;
        mensajes.push({ texto: `${cuando}, ${texto}.`, urgente: menor === 10 });
      }
    }
    return { mensajes, estado: this.estado, recalcular };
  }

  resumen() {
    if (!this.estado) return 'Aún no tengo tu posición.';
    const { restante, distSig, siguiente } = this.estado;
    const proximo = this.pasos[siguiente] ? textoManiobra(this.pasos[siguiente]) : 'sigue la ruta';
    return `Quedan unos ${Math.round(restante)} metros. En ${redondear(distSig)} metros, ${proximo}.`;
  }
}
