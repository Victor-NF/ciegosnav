import test from 'node:test';
import assert from 'node:assert/strict';
import { distancia, rumbo, difAngulo, suavizar, cardinal, crearRuta, proyectar } from '../src/geo.js';

test('distancia entre dos puntos de Almería es la esperada', () => {
  const d = distancia({ lat: 36.8381, lon: -2.4637 }, { lat: 36.834, lon: -2.4597 });
  assert.ok(d > 570 && d < 590, `distancia ${d}`);
});

test('rumbo hacia el este y hacia el norte', () => {
  assert.ok(Math.abs(rumbo({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 90) < 0.01);
  assert.ok(Math.abs(rumbo({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 0) < 0.01);
});

test('difAngulo respeta el signo y el salto 359 a 0', () => {
  assert.equal(difAngulo(10, 350), 20);
  assert.equal(difAngulo(350, 10), -20);
  assert.equal(difAngulo(90, 90), 0);
  assert.equal(Math.abs(difAngulo(180, 0)), 180);
});

test('suavizar no da saltos al cruzar el norte', () => {
  const r = suavizar(358, 2, 0.5);
  assert.ok(r === 0 || Math.abs(difAngulo(r, 0)) < 0.01, `r=${r}`);
  assert.equal(suavizar(null, 123, 0.3), 123);
});

test('cardinal', () => {
  assert.equal(cardinal(0), 'norte');
  assert.equal(cardinal(92), 'este');
  assert.equal(cardinal(359), 'norte');
  assert.equal(cardinal(225), 'suroeste');
});

test('proyectar mide distancia a la ruta y metros recorridos', () => {
  const ruta = crearRuta([
    [0, 0],
    [0.002, 0],
  ]);
  const r = proyectar(ruta, { lat: 0.0001, lon: 0.001 });
  assert.ok(Math.abs(r.distancia - 11.1) < 0.3, `distancia ${r.distancia}`);
  assert.ok(Math.abs(r.recorrido - 111.2) < 1, `recorrido ${r.recorrido}`);
});
