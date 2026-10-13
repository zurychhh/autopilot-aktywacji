// Wspólna obsługa żądania dla funkcji serwerowych: metoda, limit, błędy.
// Front traktuje każdą odpowiedź inną niż 200 tak samo — wraca do treści
// przygotowanych wcześniej — ale komunikat ma być czytelny w narzędziach
// deweloperskich i w logach, a nie "500".

import { sprawdzLimit } from './limit.js';
import { sprawdzZrodlo } from './origin.js';
import { BladModelu } from './claude.js';

const MAKS = Number(process.env.LIMIT_ZAPYTAN) || 20;
const OKNO_MS = (Number(process.env.LIMIT_OKNO_MINUT) || 60) * 60 * 1000;

function adresIp(req) {
  const naglowek = req.headers['x-forwarded-for'];
  if (typeof naglowek === 'string' && naglowek) return naglowek.split(',')[0].trim();
  return req.socket?.remoteAddress || 'nieznany';
}

async function czytajCialo(req) {
  if (req.body && typeof req.body === 'object') return req.body; // platforma już sparsowała
  const kawalki = [];
  for await (const k of req) kawalki.push(k);
  const surowe = Buffer.concat(kawalki).toString('utf8');
  if (!surowe) return {};
  try {
    return JSON.parse(surowe);
  } catch {
    throw new BladModelu('Ciało żądania nie jest poprawnym JSON-em.', { powod: 'zle_zadanie' });
  }
}

const KODY = { zle_zadanie: 400, obce_zrodlo: 403, limit: 429, brak_klucza: 503, odmowa: 502, zly_schemat: 502 };

export async function obsluz(req, res, fn) {
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ blad: 'Ta funkcja przyjmuje tylko POST.', powod: 'zla_metoda' });
    return;
  }

  // Przed limitem, bo cudza strona nie ma zajmować nam miejsca w limicie
  const zrodlo = sprawdzZrodlo(req.headers.origin);
  if (!zrodlo.ok) {
    res.status(403).json({ blad: 'Ta funkcja obsługuje tylko własną stronę.', powod: 'obce_zrodlo' });
    return;
  }

  const limit = sprawdzLimit(adresIp(req), { maks: MAKS, oknoMs: OKNO_MS });
  res.setHeader('x-limit-zostalo', String(limit.zostalo));
  if (!limit.ok) {
    res.status(429).json({
      blad: `Limit ${MAKS} zapytań zużyty. Spróbuj za ${limit.ponowZa} s.`,
      powod: 'limit'
    });
    return;
  }

  try {
    res.status(200).json(await fn(await czytajCialo(req)));
  } catch (e) {
    if (e instanceof BladModelu) {
      res.status(KODY[e.powod] || 502).json({ blad: e.message, powod: e.powod, szczegoly: e.bledy });
      return;
    }
    // Nieoczekiwany błąd: w logach pełna treść, w odpowiedzi tylko tyle, ile trzeba
    console.error('[api] nieoczekiwany błąd:', e);
    res.status(502).json({ blad: 'Nie udało się teraz wywołać modelu.', powod: 'awaria' });
  }
}
