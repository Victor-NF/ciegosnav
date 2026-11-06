import test from 'node:test';
import assert from 'node:assert/strict';
import { Alineacion } from '../src/alinear.js';

function crear(objetivo = 90) {
  const a = new Alineacion();
  a.iniciar(objetivo);
  return a;
}

test('dentro de 5 grados se considera recto', () => {
  const a = crear();
  const r = a.actualizar(93, 0);
  assert.equal(r.banda, 'ok');
  assert.equal(r.texto, null);
});

test('desviación leve hacia un lado: indica girar al lado contrario', () => {
  const a = crear(90);
  // rumbo 80: el objetivo (90) queda a la derecha, hay que ir un poco a la derecha
  const r = a.actualizar(80, 0);
  assert.equal(r.banda, 'leve');
  assert.equal(r.texto, 'Un poco a la derecha.');
  assert.ok(r.sonido.pan > 0);
  const b = crear(90).actualizar(100, 0);
  assert.equal(b.texto, 'Un poco a la izquierda.');
  assert.ok(b.sonido.pan < 0);
});

test('desviación fuerte y pérdida de orientación', () => {
  assert.equal(crear(90).actualizar(60, 0).texto, 'Gira a la derecha.');
  const p = crear(90).actualizar(0, 0);
  assert.equal(p.banda, 'perdido');
  assert.match(p.texto, /Detente/);
});

test('la histéresis evita oscilaciones cerca del límite de 5 grados', () => {
  const a = crear(90);
  a.actualizar(80, 0); // leve
  assert.equal(a.actualizar(84, 100).banda, 'leve'); // 6 grados: sigue leve
  assert.equal(a.actualizar(86.5, 200).banda, 'leve'); // 3,5: aún no baja (límite 3)
  assert.equal(a.actualizar(88, 300).banda, 'ok'); // 2: ya está recto
  assert.equal(a.actualizar(84, 400).banda, 'ok'); // 6 grados: tarda en subir (límite 7)
  assert.equal(a.actualizar(82, 500).banda, 'leve'); // 8 grados
});

test('repite el aviso cada pocos segundos mientras esté desviado, y no antes', () => {
  const a = crear(90);
  assert.ok(a.actualizar(80, 0).texto);
  assert.equal(a.actualizar(80, 1000).texto, null);
  assert.ok(a.actualizar(80, 4500).texto);
});

test('cruza el norte sin errores', () => {
  const a = crear(5);
  const r = a.actualizar(355, 0); // objetivo 10 grados a la derecha
  assert.equal(r.texto, 'Un poco a la derecha.');
});

test('al volver al centro anuncia recto una vez', () => {
  const a = crear(90);
  a.actualizar(80, 0);
  const r = a.actualizar(90, 100);
  assert.equal(r.texto, 'Recto.');
  assert.equal(a.actualizar(90, 200).texto, null);
});
