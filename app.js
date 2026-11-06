import { Voz, Pitidos } from './src/audio.js';
import { GuiaRuta } from './src/guia.js';
import { Alineacion } from './src/alinear.js';
import { difAngulo, distancia, suavizar } from './src/geo.js';

const $ = (id) => document.getElementById(id);
const voz = new Voz();
const pitidos = new Pitidos();
const alineacion = new Alineacion();

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const RUTAS_A_PIE = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const VIEWBOX = '-3.2,37.5,-1.6,36.6'; // provincia de Almería, solo para priorizar resultados
const LIMITE_REGISTRO = 3000;

const estado = {
  activo: false,
  pos: null,
  rumbo: null,
  rumboEs: null,
  guia: null,
  destino: null,
  ultimoAviso: '',
  alineando: false,
  alinearSonido: null,
  referenciaGiro: null,
  ultimoRecalculo: 0,
  watchId: null,
  bloqueo: null,
  temporizadorAlinear: null,
  ultimoRegistroAlinear: 0,
};

// ---------- utilidades ----------
function guardar(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}
function leer(clave) {
  try { return localStorage.getItem(clave); } catch { return null; }
}

let registro = [];
try { registro = JSON.parse(leer('registro') || '[]'); } catch { registro = []; }
let guardadoPendiente = null;
function anotar(tipo, datos = {}) {
  registro.push({ t: new Date().toISOString(), tipo, ...datos });
  if (registro.length > LIMITE_REGISTRO) registro = registro.slice(-LIMITE_REGISTRO);
  clearTimeout(guardadoPendiente);
  guardadoPendiente = setTimeout(() => guardar('registro', JSON.stringify(registro)), 2000);
}

function ponerEstado(texto) {
  $('estado').textContent = texto;
}

function decir(texto, { urgente = false, registrar = true } = {}) {
  estado.ultimoAviso = texto;
  const li = document.createElement('li');
  li.textContent = texto;
  const lista = $('registro');
  lista.prepend(li);
  while (lista.children.length > 15) lista.lastChild.remove();
  if (registrar) anotar('aviso', { texto });
  if ($('usar-voiceover').checked) {
    const r = $('avisos');
    r.textContent = '';
    setTimeout(() => { r.textContent = texto; }, 50);
  } else {
    voz.decir(texto, urgente);
  }
}

async function pedirJson(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`Error ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------- activación ----------
async function activar() {
  voz.decir('Voz activada.');
  await pitidos.desbloquear().catch(() => {});
  let aviso = '';

  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') aviso += ' Sin permiso de movimiento: la brújula no funcionará.';
    } catch {
      aviso += ' No se pudo pedir el permiso de movimiento.';
    }
  }
  window.addEventListener('deviceorientation', alMoverse);

  if (!('geolocation' in navigator)) {
    decir('Este navegador no ofrece ubicación.', { urgente: true });
    return;
  }
  if (estado.watchId !== null) navigator.geolocation.clearWatch(estado.watchId);
  estado.watchId = navigator.geolocation.watchPosition(alPosicion, alErrorPosicion, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 20000,
  });
  await pedirPantalla();
  estado.activo = true;
  ponerEstado('Activo. Esperando la primera posición.');
  decir(`Sensores activados.${aviso} Esperando tu posición.`);
}

async function pedirPantalla() {
  try {
    if ('wakeLock' in navigator && !estado.bloqueo) {
      estado.bloqueo = await navigator.wakeLock.request('screen');
      estado.bloqueo.addEventListener('release', () => { estado.bloqueo = null; });
    }
  } catch { /* no disponible */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && estado.activo) pedirPantalla();
});

function alErrorPosicion(e) {
  const texto = {
    1: 'Permiso de ubicación denegado. Actívalo en Ajustes, Safari, Ubicación.',
    2: 'No consigo tu posición ahora mismo.',
    3: 'La ubicación tarda demasiado en responder.',
  }[e.code] || 'Error de ubicación.';
  ponerEstado(texto);
  decir(texto, { urgente: true });
}

function alPosicion(p) {
  estado.pos = {
    lat: p.coords.latitude,
    lon: p.coords.longitude,
    accuracy: p.coords.accuracy,
    rumbo: p.coords.heading,
    velocidad: p.coords.speed,
    t: p.timestamp,
  };
  ponerEstado(`Posición con unos ${Math.round(p.coords.accuracy)} metros de error.`);
  if (estado.guia) {
    const r = estado.guia.actualizar(estado.pos);
    anotar('posicion', {
      lat: estado.pos.lat, lon: estado.pos.lon, precision: estado.pos.accuracy,
      restante: Math.round(r.estado.restante), fuera: Math.round(r.estado.fuera),
    });
    r.mensajes.forEach((m) => decir(m.texto, { urgente: m.urgente }));
    if (r.recalcular) recalcular();
  }
}

// ---------- brújula ----------
function alMoverse(e) {
  let r = null;
  if (typeof e.webkitCompassHeading === 'number' && !(e.webkitCompassAccuracy < 0)) r = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') r = (360 - e.alpha) % 360;
  if (r === null) return;
  estado.rumboEs = e.webkitCompassAccuracy ?? null;
  estado.rumbo = suavizar(estado.rumbo, r, 0.25);
}

// ---------- dónde estoy ----------
async function dondeEstoy() {
  if (!estado.pos) { decir('Aún no tengo tu posición. Activa los sensores y espera unos segundos.'); return; }
  const { lat, lon, accuracy } = estado.pos;
  try {
    const d = await pedirJson(`${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=18&accept-language=es`);
    const a = d.address || {};
    const via = a.road || a.pedestrian || a.footway || d.name || 'una vía sin nombre';
    const numero = a.house_number ? ` número ${a.house_number}` : '';
    const zona = a.suburb || a.neighbourhood || a.city_district || a.town || a.city || '';
    decir(`Estás en ${via}${numero}${zona ? `, ${zona}` : ''}. Precisión de unos ${Math.round(accuracy)} metros.`);
  } catch {
    decir(`No he podido obtener el nombre de la calle. Tu precisión es de unos ${Math.round(accuracy)} metros.`);
  }
}

// ---------- búsqueda y rutas ----------
async function buscar(ev) {
  ev.preventDefault();
  const q = $('destino').value.trim();
  if (!q) { decir('Escribe un destino primero.', { urgente: true }); return; }
  ponerEstado('Buscando…');
  try {
    const url = `${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&countrycodes=es&accept-language=es&viewbox=${VIEWBOX}&addressdetails=0`;
    const datos = await pedirJson(url);
    mostrarResultados(datos);
  } catch {
    decir('No he podido buscar. Comprueba la conexión e inténtalo de nuevo.', { urgente: true });
  }
}

function mostrarResultados(datos) {
  const lista = $('lista-resultados');
  lista.replaceChildren();
  if (datos.length === 0) {
    $('resultados').hidden = true;
    decir('No he encontrado ese destino. Prueba con otra forma de escribirlo.', { urgente: true });
    return;
  }
  datos.forEach((d, i) => {
    const dest = { nombre: d.display_name.split(',').slice(0, 3).join(','), lat: +d.lat, lon: +d.lon };
    const aDist = estado.pos ? ` a ${Math.round(distancia(estado.pos, dest))} metros en línea recta` : '';
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${i + 1}. ${dest.nombre}${aDist}`;
    b.addEventListener('click', () => empezarRuta(dest));
    li.append(b);
    lista.append(li);
  });
  $('resultados').hidden = false;
  $('h-resultados').focus();
  ponerEstado(`${datos.length} resultados.`);
  decir(`${datos.length} resultados. Recórrelos y pulsa el que quieras.`, { registrar: false });
}

async function pedirRuta(destino) {
  const { lat, lon } = estado.pos;
  const url = `${RUTAS_A_PIE}/${lon},${lat};${destino.lon},${destino.lat}?overview=full&geometries=geojson&steps=true`;
  const d = await pedirJson(url);
  if (d.code !== 'Ok' || !d.routes?.length) throw new Error('Sin ruta');
  return d.routes[0];
}

async function empezarRuta(destino) {
  if (!estado.pos) { decir('Aún no tengo tu posición. Activa los sensores y espera.', { urgente: true }); return; }
  if (estado.pos.accuracy > 50) decir(`Atención: tu posición tiene unos ${Math.round(estado.pos.accuracy)} metros de error. Espera unos segundos para mejorarla.`);
  decir('Calculando la ruta a pie.', { urgente: true });
  try {
    const ruta = await pedirRuta(destino);
    estado.guia = new GuiaRuta(ruta);
    estado.destino = destino;
    $('destino-actual').textContent = `Destino: ${destino.nombre}`;
    $('guiado').hidden = false;
    $('resultados').hidden = true;
    $('h-guiado').focus();
    anotar('ruta', { destino: destino.nombre, metros: Math.round(estado.guia.ruta.total) });
    decir(estado.guia.mensajeInicial(), { urgente: true });
    await pedirPantalla();
  } catch {
    decir('No he podido calcular la ruta. Comprueba la conexión o prueba otro destino.', { urgente: true });
  }
}

async function recalcular() {
  const ahora = Date.now();
  if (!estado.destino || ahora - estado.ultimoRecalculo < 10000) return;
  estado.ultimoRecalculo = ahora;
  try {
    const ruta = await pedirRuta(estado.destino);
    estado.guia = new GuiaRuta(ruta);
    anotar('recalculo', { metros: Math.round(estado.guia.ruta.total) });
    decir(estado.guia.mensajeInicial(), { urgente: true });
  } catch {
    decir('No he podido recalcular la ruta. Sigue con precaución y usa el bastón.', { urgente: true });
  }
}

function pararGuiado() {
  estado.guia = null;
  estado.destino = null;
  $('guiado').hidden = true;
  voz.callar();
  decir('Guiado detenido.', { urgente: true });
  $('destino').focus();
}

// ---------- alineación ----------
function iniciarAlineacion() {
  if (estado.rumbo === null) {
    decir('No tengo brújula. Pulsa «Activar sensores y voz» y concede el permiso de movimiento.', { urgente: true });
    return;
  }
  pitidos.desbloquear();
  alineacion.iniciar(estado.rumbo);
  estado.alineando = true;
  estado.alinearSonido = { pan: 0, frecuencia: 330, intervaloMs: 2000 };
  $('btn-alinear').hidden = true;
  $('btn-parar-alinear').hidden = false;
  $('btn-parar-alinear').focus();
  anotar('alinear-inicio', { objetivo: Math.round(estado.rumbo) });
  decir('Dirección fijada. Camina hacia delante. El sonido indica hacia dónde girar.', { urgente: true });
  pitidos.iniciarBucle(() => estado.alinearSonido);
  clearInterval(estado.temporizadorAlinear);
  estado.temporizadorAlinear = setInterval(() => {
    if (estado.rumbo === null) return;
    const r = alineacion.actualizar(estado.rumbo);
    estado.alinearSonido = r.sonido;
    if (r.texto) decir(r.texto, { urgente: true, registrar: false });
    const ahora = Date.now();
    if (ahora - estado.ultimoRegistroAlinear > 1000) {
      estado.ultimoRegistroAlinear = ahora;
      anotar('alinear', { rumbo: Math.round(estado.rumbo), desv: Math.round(r.desviacion), banda: r.banda });
    }
  }, 150);
}

function pararAlineacion() {
  clearInterval(estado.temporizadorAlinear);
  pitidos.detenerBucle();
  estado.alineando = false;
  $('btn-alinear').hidden = false;
  $('btn-parar-alinear').hidden = true;
  voz.callar();
  decir('Alineación terminada.', { urgente: true });
  $('btn-alinear').focus();
}

// ---------- pruebas ----------
function medirGiro() {
  if (estado.rumbo === null) { decir('No tengo brújula todavía.', { urgente: true }); return; }
  if (estado.referenciaGiro === null) {
    estado.referenciaGiro = estado.rumbo;
    decir('Referencia fijada. Gira y pulsa de nuevo este botón.');
    $('btn-medir').textContent = 'Medir giro (decir cuánto he girado)';
    return;
  }
  const d = difAngulo(estado.rumbo, estado.referenciaGiro);
  const lado = d >= 0 ? 'a la derecha' : 'a la izquierda';
  anotar('giro', { grados: Math.round(d) });
  decir(`Has girado unos ${Math.round(Math.abs(d))} grados ${lado}.`);
  estado.referenciaGiro = null;
  $('btn-medir').textContent = 'Medir giro (fijar referencia)';
}

function decirRumbo() {
  if (estado.rumbo === null) { decir('No tengo brújula todavía.'); return; }
  const fiab = estado.rumboEs !== null && estado.rumboEs >= 0 ? ` Error estimado de la brújula: ${Math.round(estado.rumboEs)} grados.` : '';
  decir(`Rumbo ${Math.round(estado.rumbo)} grados.${fiab}`);
}

function descargarRegistro() {
  const blob = new Blob([JSON.stringify(registro, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ciegosnav-registro-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  decir(`Registro preparado con ${registro.length} eventos.`);
}

function borrarRegistro() {
  registro = [];
  guardar('registro', '[]');
  decir('Registro borrado.');
}

// ---------- ajustes y eventos ----------
function aplicarVelocidad() {
  voz.velocidad = parseFloat($('velocidad').value);
  $('velocidad-valor').textContent = `Velocidad: ${voz.velocidad.toFixed(1)}`;
  guardar('velocidad', String(voz.velocidad));
}

$('velocidad').value = leer('velocidad') || '1';
$('usar-voiceover').checked = leer('usarVoiceOver') === '1';
aplicarVelocidad();

$('velocidad').addEventListener('input', aplicarVelocidad);
$('velocidad').addEventListener('change', () => decir('Así suena la voz con esta velocidad.', { registrar: false }));
$('usar-voiceover').addEventListener('change', () => guardar('usarVoiceOver', $('usar-voiceover').checked ? '1' : '0'));
$('btn-activar').addEventListener('click', activar);
$('btn-donde').addEventListener('click', dondeEstoy);
$('form-destino').addEventListener('submit', buscar);
$('btn-repetir').addEventListener('click', () => decir(estado.ultimoAviso || 'No hay avisos todavía.', { urgente: true, registrar: false }));
$('btn-restante').addEventListener('click', () => decir(estado.guia ? estado.guia.resumen() : 'No hay guiado en curso.', { urgente: true }));
$('btn-parar-guiado').addEventListener('click', pararGuiado);
$('btn-alinear').addEventListener('click', iniciarAlineacion);
$('btn-parar-alinear').addEventListener('click', pararAlineacion);
$('btn-medir').addEventListener('click', medirGiro);
$('btn-rumbo').addEventListener('click', decirRumbo);
$('btn-descargar').addEventListener('click', descargarRegistro);
$('btn-borrar').addEventListener('click', borrarRegistro);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
