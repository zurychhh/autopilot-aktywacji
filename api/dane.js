// GET /api/dane?zestaw=funnel_daily|actions_log|calendar|tests
//
// Strona nie czyta plików z data/ bezpośrednio, bo źródłem może być też arkusz
// Google albo docelowo BigQuery. Ten endpoint jest jedynym wejściem i zawsze
// mówi, z którego źródła przyszły dane.
//
// Bez limitu zapytań i bez sprawdzania źródła: nic nie kosztuje, nic nie
// zdradza i ma działać także dla monitoringu.

import { zrodloDanych, ZESTAWY } from '../lib/datasource.js';

const METODY = {
  funnel_daily: 'getFunnelDaily',
  actions_log: 'getActionsLog',
  calendar: 'getCalendar',
  tests: 'getTests'
};

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ blad: 'Ta funkcja przyjmuje tylko GET.', powod: 'zla_metoda' });
    return;
  }

  const zestaw = (req.url.match(/[?&]zestaw=([a-z_]+)/) || [])[1];
  if (!zestaw || !ZESTAWY.includes(zestaw)) {
    res.status(400).json({ blad: `Podaj zestaw: ${ZESTAWY.join(', ')}.`, powod: 'zly_zestaw' });
    return;
  }

  try {
    const zrodlo = zrodloDanych();
    const dane = await zrodlo[METODY[zestaw]]();
    res.status(200).json({ zrodlo: zrodlo.zrodlo, zestaw, liczba: dane.length, dane });
  } catch (e) {
    console.error('[dane]', e);
    res.status(502).json({ blad: e.message, powod: e.name === 'BladZrodla' ? 'zrodlo' : 'awaria' });
  }
}
