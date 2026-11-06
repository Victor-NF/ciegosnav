import test from 'node:test';
import assert from 'node:assert/strict';
import { GuiaRuta, textoManiobra } from '../src/guia.js';

const M = 1 / 111195; // grados por metro

// Ruta: 200 m hacia el este, giro a la derecha (sur), 100 m más.
function rutaPrueba() {
  const coordenadas = [
    [0, 0],
    [200 * M, 0],
    [200 * M, -100 * M],
  ];
  return {
    duration: 240,
    geometry: { coordinates: coordenadas },
    legs: [
      {
        steps: [
          { distance: 200, name: 'Calle A', maneuver: { type: 'depart', modifier: 'right', bearing_after: 90 } },
          { distance: 100, name: 'Calle B', maneuver: { type: 'turn', modifier: 'right' } },
          { distance: 0, name: '', maneuver: { type: 'arrive' } },
        ],
      },
    ],
  };
}

const pos = (x, y = 0, accuracy = 8) => ({ lat: y * M, lon: x * M, accuracy });

test('textos de maniobra en español', () => {
  assert.equal(textoManiobra({ name: 'Calle B', maneuver: { type: 'turn', modifier: 'right' } }), 'gira a la derecha por Calle B');
  assert.equal(textoManiobra({ name: '', maneuver: { type: 'turn', modifier: 'slight left' } }), 'gira ligeramente a la izquierda');
  assert.equal(textoManiobra({ name: '', maneuver: { type: 'arrive' } }), 'llegas a tu destino');
  assert.match(textoManiobra({ name: 'X', maneuver: { type: 'depart', bearing_after: 93 } }), /hacia el este por X/);
  assert.match(textoManiobra({ name: '', maneuver: { type: 'roundabout', exit: 2 } }), /salida 2/);
});

test('mensaje inicial resume la ruta', () => {
  const g = new GuiaRuta(rutaPrueba());
  assert.match(g.mensajeInicial(), /Ruta de 300 metros, unos 4 minutos/);
});

test('avisa del giro a 80, 30 y 10 metros, una sola vez cada uno', () => {
  const g = new GuiaRuta(rutaPrueba());
  const dichos = [];
  for (let x = 0; x <= 198; x += 2) {
    const r = g.actualizar(pos(x), 1000 + x * 100);
    r.mensajes.forEach((m) => dichos.push(m.texto));
  }
  assert.equal(dichos.length, 3, dichos.join(' | '));
  assert.match(dichos[0], /^En 80 metros, gira a la derecha por Calle B/);
  assert.match(dichos[1], /^En 30 metros/);
  assert.match(dichos[2], /^Ahora/);
});

test('si se empieza ya cerca del giro, solo se dice el aviso más cercano', () => {
  const g = new GuiaRuta(rutaPrueba());
  const r = g.actualizar(pos(185), 1000);
  assert.equal(r.mensajes.length, 1);
  assert.match(r.mensajes[0].texto, /^En 20 metros|^Ahora|^En 10 metros/);
});

test('detecta desvío tras varias lecturas y pide recalcular, sin repetir enseguida', () => {
  const g = new GuiaRuta(rutaPrueba());
  let r;
  r = g.actualizar(pos(50, 60), 1000);
  assert.equal(r.recalcular, false);
  g.actualizar(pos(50, 60), 2000);
  r = g.actualizar(pos(50, 60), 3000);
  assert.equal(r.recalcular, true);
  assert.match(r.mensajes[0].texto, /desviado/);
  r = g.actualizar(pos(50, 60), 4000);
  assert.equal(r.recalcular, false);
});

test('una mala precisión no provoca falsos desvíos ni maniobras', () => {
  const g = new GuiaRuta(rutaPrueba());
  const r = g.actualizar(pos(150, 30, 100), 1000);
  assert.equal(r.recalcular, false);
  assert.ok(r.mensajes.every((m) => !/gira/.test(m.texto)));
});

test('avisa de señal poco precisa con un mensaje cada 30 segundos como máximo', () => {
  const g = new GuiaRuta(rutaPrueba());
  const a = g.actualizar(pos(10, 0, 60), 1000);
  assert.equal(a.mensajes.filter((m) => /poco precisa/.test(m.texto)).length, 1);
  const b = g.actualizar(pos(12, 0, 60), 5000);
  assert.equal(b.mensajes.filter((m) => /poco precisa/.test(m.texto)).length, 0);
});

test('anuncia la llegada una sola vez', () => {
  const g = new GuiaRuta(rutaPrueba());
  const a = g.actualizar(pos(200, -96), 1000);
  assert.ok(a.mensajes.some((m) => /Has llegado/.test(m.texto)));
  const b = g.actualizar(pos(200, -98), 2000);
  assert.equal(b.mensajes.length, 0);
});

test('resumen da distancia restante y siguiente maniobra', () => {
  const g = new GuiaRuta(rutaPrueba());
  g.actualizar(pos(100), 1000);
  assert.match(g.resumen(), /Quedan unos 200 metros\. En 100 metros, gira a la derecha/);
});
