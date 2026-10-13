// Serwer do pracy lokalnej: pliki z public/ i funkcje z api/.
// Bez zależności. Moduły ES nie wczytują się z file://, a /api musi odpowiadać
// tak jak na produkcji, inaczej lokalnie nie da się sprawdzić ani sondy stanu,
// ani ścieżki awaryjnej.
import { createServer } from 'node:http';
import { readFile, readFileSync } from 'node:fs';
import { readFile as czytaj } from 'node:fs/promises';
import { extname, normalize } from 'node:path';

const PUBLIC = new URL('../public/', import.meta.url);

/**
 * Nagłówki z vercel.json, stosowane także lokalnie.
 *
 * Powstało po błędzie, który dało się zobaczyć wyłącznie na produkcji:
 * `permissions-policy: geolocation=()` szło na wszystkie adresy i blokowało
 * pobranie lokalizacji na stronie zgody. Lokalnie nic tego nie wysyłało, więc
 * ścieżka działała i wyglądała na poprawną. Teraz serwer deweloperski wysyła
 * to samo co hosting — reguły dopasowują się po kolei, późniejsza wygrywa.
 */
const REGULY_NAGLOWKOW = (() => {
  try {
    const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    return (cfg.headers || []).map(r => ({ wzor: new RegExp(`^${r.source}$`), naglowki: r.headers }));
  } catch {
    return [];
  }
})();

function naglowkiDla(sciezka) {
  const out = {};
  for (const r of REGULY_NAGLOWKOW) {
    if (!r.wzor.test(sciezka)) continue;
    for (const h of r.naglowki) out[h.key] = h.value;
  }
  return out;
}
const API = new URL('../api/', import.meta.url);
const PORT = Number(process.env.PORT) || 8000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml'
};

/** Dokłada do odpowiedzi Node'a metody, których używają funkcje serwerowe. */
function wzbogac(res) {
  res.status = (k) => { res.statusCode = k; return res; };
  res.json = (d) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(d));
    return res;
  };
  return res;
}

async function obsluzApi(req, res, nazwa) {
  try {
    const mod = await import(new URL(`${nazwa}.js`, API).href);
    await mod.default(req, wzbogac(res));
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ blad: `Nie ma funkcji /api/${nazwa}.`, powod: 'brak_funkcji' }));
      return;
    }
    console.error('[serve] błąd funkcji', nazwa, e);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ blad: 'Funkcja się wywróciła, szczegóły w logach.', powod: 'awaria' }));
  }
}

createServer(async (req, res) => {
  const sciezka = decodeURIComponent(req.url.split('?')[0]);
  for (const [k, v] of Object.entries(naglowkiDla(sciezka))) res.setHeader(k, v);

  const api = sciezka.match(/^\/api\/([a-z0-9-]+)\/?$/i);
  if (api) return obsluzApi(req, res, api[1]);

  // Przepisania ścieżek jak w vercel.json, żeby /z/KOD działało też lokalnie
  const przepisania = [
    [/^\/z\/[A-Z0-9]+\/?$/i, '/z/index.html'],
    [/^\/mapa\/[A-Z0-9]+\/?$/i, '/mapa/podglad.html'],
    [/^\/operator\/[^/]+\/?$/i, '/operator/index.html']
  ];
  let doSerwowania = sciezka;
  for (const [wzor, cel] of przepisania) {
    if (wzor.test(sciezka) && !sciezka.endsWith('.html')) { doSerwowania = cel; break; }
  }

  // normalize + odcięcie wiodących ../ trzyma nas w katalogu public
  const rel = normalize(doSerwowania).replace(/^(\.\.[/\\])+/, '');
  const plik = rel === '/' || rel === '\\' ? 'index.html' : rel.replace(/^[/\\]+/, '');
  // Katalog bez pliku: dołóż index.html, tak jak robi to hosting
  const kandydaci = extname(plik) ? [plik] : [plik, `${plik.replace(/\/$/, '')}/index.html`];

  try {
    let body = null, uzyty = plik;
    for (const k of kandydaci) {
      try { body = await czytaj(new URL(k, PUBLIC)); uzyty = k; break; } catch { /* kolejny kandydat */ }
    }
    if (body === null) throw new Error('brak pliku');
    res.writeHead(200, { 'content-type': TYPES[extname(uzyty)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Nie ma takiego pliku: ' + plik);
  }
}).listen(PORT, () => console.log(`Prototyp działa na http://localhost:${PORT}`));
