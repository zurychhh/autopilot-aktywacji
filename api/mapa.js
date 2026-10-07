// /api/mapa — jedna funkcja, kilka działań. Osobne funkcje na każde działanie
// zjadłyby limit planu darmowego, a różnią się tylko jedną linijką.
//
//   POST ?akcja=utworz       { imie, odKogo }            → { kod, wygasa }
//   GET  ?akcja=prosba&kod=  →                           → { imie, odKogo, stan }
//   POST ?akcja=zgoda        { kod, lat, lon }           → { ok }
//   POST ?akcja=odmowa       { kod }                     → { ok }
//   GET  ?akcja=lokalizacja&kod=                         → { stan, lokalizacja }
//   GET  ?akcja=liczniki                                 → mikrokonwersje
//
// Sprawdzanie źródła obowiązuje jak wszędzie; limitu zapytań tu nie ma,
// bo nic nie kosztuje pieniędzy, a bliska osoba może odświeżyć stronę.

import { magazyn } from '../lib/magazyn.js';
import { uslugaMapy } from '../lib/mapa.js';
import { uslugaZaproszen } from '../lib/zaproszenia.js';
import { sprawdzZrodlo } from './_lib/origin.js';

async function czytajCialo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const kawalki = [];
  for await (const k of req) kawalki.push(k);
  const surowe = Buffer.concat(kawalki).toString('utf8');
  if (!surowe) return {};
  try { return JSON.parse(surowe); } catch { throw new Error('Ciało żądania nie jest poprawnym JSON-em.'); }
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const zrodlo = sprawdzZrodlo(req.headers.origin);
  if (!zrodlo.ok) {
    res.status(403).json({ blad: 'Ta funkcja obsługuje tylko własną stronę.', powod: 'obce_zrodlo' });
    return;
  }

  const url = req.url || '';
  // Myślnik też jest częścią nazwy działania — bez niego „wyzeruj-liczniki”
  // dopasowywało się do „wyzeruj” i wpadało w gałąź nieznanego działania.
  const akcja = (url.match(/[?&]akcja=([a-z-]+)/) || [])[1];
  const kodZUrl = (url.match(/[?&]kod=([A-Z0-9]+)/) || [])[1];

  try {
    const u = uslugaMapy(magazyn());

    if (akcja === 'utworz' && req.method === 'POST') {
      const { imie, odKogo } = await czytajCialo(req);
      const p = await u.utworzProsbe({ imie, odKogo });
      res.status(200).json({ ...p, tryb: u.tryb, trwaly: u.trwaly });
      return;
    }

    if (akcja === 'prosba' && req.method === 'GET') {
      const p = await u.pokazProsbe(kodZUrl);
      if (!p) { res.status(404).json({ blad: 'Prośba nie istnieje albo wygasła.', powod: 'brak_lub_wygasla' }); return; }
      res.status(200).json({ ...p, trwaly: u.trwaly });
      return;
    }

    if (akcja === 'zgoda' && req.method === 'POST') {
      const { kod, lat, lon, dokladnosc } = await czytajCialo(req);
      const w = await u.zapiszZgode(kod, { lat, lon, dokladnosc });
      res.status(w.ok ? 200 : 400).json(w);
      return;
    }

    if (akcja === 'odmowa' && req.method === 'POST') {
      const { kod } = await czytajCialo(req);
      res.status(200).json(await u.zapiszOdmowe(kod));
      return;
    }

    if (akcja === 'lokalizacja' && req.method === 'GET') {
      res.status(200).json({ ...(await u.pobierzLokalizacje(kodZUrl)), trwaly: u.trwaly });
      return;
    }

    if (akcja === 'zapros' && req.method === 'POST') {
      const { imie, kanal } = await czytajCialo(req);
      const z = uslugaZaproszen(magazyn());
      res.status(200).json(await z.zapros({ imie, kanal }));
      return;
    }

    if (akcja === 'zaproszenia' && req.method === 'GET') {
      const z = uslugaZaproszen(magazyn());
      res.status(200).json({ podsumowanie: await z.podsumowanie(), log: await z.log() });
      return;
    }

    if (akcja === 'wyzeruj-liczniki' && req.method === 'POST') {
      // Domyślnie WYŁĄCZONE. Działa tylko wtedy, gdy ktoś świadomie ustawił
      // MAINTENANCE_TOKEN — bez niego nie da się tego wywołać z zewnątrz,
      // nawet znając ścieżkę.
      const token = process.env.MAINTENANCE_TOKEN;
      if (!token) {
        res.status(503).json({ blad: 'Działanie serwisowe jest wyłączone.', powod: 'brak_tokenu_serwisowego' });
        return;
      }
      const { token: podany } = await czytajCialo(req);
      if (podany !== token) {
        res.status(403).json({ blad: 'Zły token serwisowy.', powod: 'zly_token' });
        return;
      }
      const u = uslugaMapy(magazyn());
      res.status(200).json({ ...(await u.wyzerujLiczniki()), liczniki: await u.liczniki() });
      return;
    }

    if (akcja === 'liczniki' && req.method === 'GET') {
      res.status(200).json({ liczniki: await u.liczniki(), tryb: u.tryb, trwaly: u.trwaly });
      return;
    }

    res.status(400).json({ blad: 'Nieznane działanie albo zła metoda.', powod: 'zle_zadanie' });
  } catch (e) {
    console.error('[mapa]', e);
    res.status(500).json({ blad: e.message || 'Nie udało się wykonać działania.', powod: 'awaria' });
  }
}
