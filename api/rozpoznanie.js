// /api/rozpoznanie — makieta CAMARA Number Verification.
//
//   POST ?akcja=token    { numerWTelefonie }              → token jednorazowy
//   POST ?akcja=verify   { token, phoneNumber|hashed... } → { devicePhoneNumberVerified }
//   POST ?akcja=numer    { token, zgoda }                 → { devicePhoneNumber }
//
// To MAKIETA. W produkcji token wydaje operator po rozpoznaniu SIM-a, a do tego
// potrzebna jest umowa. Endpoint mówi to w każdej odpowiedzi polem `makieta`.

import { makietaOperatora, BladCamara, SPEC } from '../lib/camara.js';
import { sprawdzZrodlo } from './_lib/origin.js';

const operator = makietaOperatora();

async function czytajCialo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const kawalki = [];
  for await (const k of req) kawalki.push(k);
  const surowe = Buffer.concat(kawalki).toString('utf8');
  if (!surowe) return {};
  try { return JSON.parse(surowe); } catch { throw new BladCamara(400, 'INVALID_ARGUMENT', 'Ciało żądania nie jest poprawnym JSON-em.'); }
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const zrodlo = sprawdzZrodlo(req.headers.origin);
  if (!zrodlo.ok) {
    res.status(403).json({ blad: 'Ta funkcja obsługuje tylko własną stronę.', powod: 'obce_zrodlo' });
    return;
  }

  const akcja = ((req.url || '').match(/[?&]akcja=([a-z-]+)/) || [])[1];

  if (req.method === 'GET') {
    res.status(200).json({
      makieta: true, spec: SPEC,
      uwaga: 'Makieta. W produkcji wymaga umowy z operatorem — token wydaje jego sieć po rozpoznaniu SIM-a.'
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ blad: 'Ta funkcja przyjmuje tylko POST.', powod: 'zla_metoda' });
    return;
  }

  try {
    const cialo = await czytajCialo(req);
    const dopisek = { makieta: true, spec: SPEC };

    if (akcja === 'token') {
      res.status(200).json({ ...operator.wydajToken({ numerWTelefonie: cialo.numerWTelefonie }), ...dopisek });
      return;
    }
    if (akcja === 'verify') {
      res.status(200).json({ ...operator.verify(cialo.token, cialo), ...dopisek });
      return;
    }
    if (akcja === 'numer') {
      res.status(200).json({ ...operator.devicePhoneNumber(cialo.token, { zgodaNaUdostepnienie: !!cialo.zgoda }), ...dopisek });
      return;
    }
    res.status(400).json({ status: 400, code: 'INVALID_ARGUMENT', message: 'Nieznane działanie. Dozwolone: token, verify, numer.', makieta: true });
  } catch (e) {
    if (e instanceof BladCamara) {
      res.status(e.status).json({ ...e.doOdpowiedzi(), makieta: true });
      return;
    }
    console.error('[rozpoznanie]', e);
    res.status(500).json({ status: 500, code: 'INTERNAL', message: 'Makieta się wywróciła.', makieta: true });
  }
}
