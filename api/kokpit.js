// /api/kokpit
//   GET  → raport wyliczony przez kod: zmiany, wyjaśnienia, siła dowodu
//   POST → trzyzdaniowe podsumowanie od AI, wyłącznie z przekazanych faktów
//
// Rozdział jest celowy: GET nie kosztuje nic i działa zawsze, POST kosztuje
// tokeny i jest dodatkiem. Strona pokazuje pełny raport nawet wtedy, gdy AI
// nie odpowie.

import { zrodloDanych } from '../lib/datasource.js';
import { kokpit } from '../lib/kokpit.js';
import { sprawdzZrodlo } from './_lib/origin.js';
import { obsluz } from './_lib/http.js';
import { tekstOdModelu, wczytajPrompt } from './_lib/claude.js';

async function raport(metryka) {
  const z = zrodloDanych();
  const [lejek, akcje, kalendarz, testy] = await Promise.all([
    z.getFunnelDaily(), z.getActionsLog(), z.getCalendar(), z.getTests()
  ]);
  return { zrodlo: z.zrodlo, ...kokpit({ lejek, akcje, kalendarz, testy, metryka }) };
}

/** Fakty dla modelu: same wyliczone liczby i nazwy, bez miejsca na interpretację. */
function fakty(r) {
  return r.znaleziska.slice(0, 5).map(z => {
    const e = z.epizod;
    const zewn = z.wyjasnienieZewnetrzne.map(k => k.nazwa).join(', ');
    return [
      `${z.jednostka.etykieta}: ${e.kierunek} o ${(Math.abs(e.zmianaProcent) * 100).toFixed(0)}%`,
      `od ${e.od} do ${e.do}`,
      `(${e.rodzaj === 'przesuniecie' ? 'trwała zmiana poziomu' : 'chwilowy wyskok'})`,
      zewn ? `wyjaśnienie zewnętrzne: ${zewn}` : null,
      z.najmocniejszy ? `najmocniejszy dowód: ${z.najmocniejszy.nazwa} — ${z.najmocniejszy.opis}` : 'brak kandydata na przyczynę',
      z.skalowanie ? `możliwe skalowanie: od ${z.skalowanie.miesiecznieOd} do ${z.skalowanie.miesiecznieDo} miesięcznie` : null
    ].filter(Boolean).join('; ');
  }).join('\n');
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const zrodlo = sprawdzZrodlo(req.headers.origin);
  if (!zrodlo.ok) {
    res.status(403).json({ blad: 'Ta funkcja obsługuje tylko własną stronę.', powod: 'obce_zrodlo' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    try {
      const metryka = (req.url.match(/[?&]metryka=([a-z0-9]+)/) || [])[1] || 'pobranie';
      res.status(200).json(await raport(metryka));
    } catch (e) {
      console.error('[kokpit]', e);
      res.status(502).json({ blad: e.message, powod: 'zrodlo' });
    }
    return;
  }

  // POST: podsumowanie od AI, z limitem zapytań jak przy innych wywołaniach modelu
  await obsluz(req, res, async (cialo) => {
    const r = await raport(String(cialo.metryka || 'pobranie'));
    if (!r.znaleziska.length) {
      return { podsumowanie: 'Przez ostatnie 90 dni żadna zmiana nie przekroczyła progu istotności. To nie znaczy, że nic się nie dzieje — znaczy, że nic nie odstaje od tła.', bezAI: true };
    }
    const podsumowanie = await tekstOdModelu({
      system: wczytajPrompt('podsumowanie-kokpitu'),
      wiadomosc: `Wykryte zmiany (metryka: ${r.metryka}, okres: ${r.dni} dni):\n${fakty(r)}`
    });
    return { podsumowanie };
  });
}
