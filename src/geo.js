// Geometría básica sobre coordenadas {lat, lon}. Sin dependencias.
const R = 6371000;
const M_POR_GRADO = (Math.PI / 180) * R;

export const aRad = (d) => (d * Math.PI) / 180;
export const aGrados = (r) => (r * 180) / Math.PI;

export function distancia(a, b) {
  const f1 = aRad(a.lat);
  const f2 = aRad(b.lat);
  const df = f2 - f1;
  const dl = aRad(b.lon - a.lon);
  const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Rumbo inicial de a hacia b, en grados 0-360 (0 = norte, 90 = este).
export function rumbo(a, b) {
  const f1 = aRad(a.lat);
  const f2 = aRad(b.lat);
  const dl = aRad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (aGrados(Math.atan2(y, x)) + 360) % 360;
}

// Diferencia con signo entre dos rumbos, de -180 a 180.
// Positivo: el objetivo queda a la derecha del rumbo actual (hay que girar a la derecha).
export function difAngulo(objetivo, actual) {
  return ((((objetivo - actual) % 360) + 540) % 360) - 180;
}

// Filtro de suavizado para rumbos (respeta el salto 359 -> 0).
export function suavizar(previo, nuevo, k) {
  if (previo === null || previo === undefined) return nuevo;
  return (previo + k * difAngulo(nuevo, previo) + 360) % 360;
}

const PUNTOS_CARDINALES = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
export function cardinal(grados) {
  return PUNTOS_CARDINALES[Math.round((((grados % 360) + 360) % 360) / 45) % 8];
}

// Prepara una ruta (lista de [lon, lat]) con distancias acumuladas.
export function crearRuta(coordenadas) {
  const pts = coordenadas.map(([lon, lat]) => ({ lat, lon }));
  const acum = [0];
  for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + distancia(pts[i - 1], pts[i]));
  return { pts, acum, total: acum[acum.length - 1] };
}

// Proyecta un punto sobre la ruta.
// Devuelve la distancia del punto a la ruta, y cuántos metros de ruta lleva recorridos.
export function proyectar(ruta, p) {
  const kx = Math.cos(aRad(p.lat)) * M_POR_GRADO;
  let mejor = { distancia: Infinity, recorrido: 0, tramo: 0 };
  for (let i = 0; i < ruta.pts.length - 1; i++) {
    const ax = (ruta.pts[i].lon - p.lon) * kx;
    const ay = (ruta.pts[i].lat - p.lat) * M_POR_GRADO;
    const bx = (ruta.pts[i + 1].lon - p.lon) * kx;
    const by = (ruta.pts[i + 1].lat - p.lat) * M_POR_GRADO;
    const dx = bx - ax;
    const dy = by - ay;
    const largo2 = dx * dx + dy * dy;
    const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / largo2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < mejor.distancia) {
      mejor = { distancia: d, recorrido: ruta.acum[i] + t * (ruta.acum[i + 1] - ruta.acum[i]), tramo: i };
    }
  }
  return mejor;
}
