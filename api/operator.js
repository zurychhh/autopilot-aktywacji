// /api/operator?nazwa=Play
//   GET  → tygodniowy stan i rekomendacja policzone przez kod
//   POST → pięciozdaniowy brief od AI, wyłącznie z przekazanych faktów
//
// Wersja do skopiowania do maila powstaje bez AI i działa zawsze — AI tylko
// dokłada akapit otwierający.

import { zrodloDanych } from '../lib/datasource.js';
import { stanTygodnia, rekomendacja, faktyDoBriefu, briefDoMaila, dopasujOperatora, operatorzy } from '../lib/operator.js';
import { sprawdzZrodlo } from './_lib/origin.js';
import { obsluz } from './_lib/http.js';
import { tekstOdModelu, wczytajPrompt } from './_lib/claude.js';

async function policz(nazwa) {
  const z = zrodloDanych();
  const [lejek, akcje] = await Promise.all([z.getFunnelDaily(), z.getActionsLog()]);
  const operator = dopasujOperatora(lejek, nazwa);
  if (!operator) {
    return { blad: `Nie znam operatora „${nazwa}".`, dostepni: operatorzy(lejek), powod: 'nieznany_operator' };
  }
  const stan = stanTygodnia({ lejek, operator });
  const rek = rekomendacja(stan, { akcje });
  return { stan, rekomendacja: rek, mail: briefDoMaila(stan, rek) };
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const zrodlo = sprawdzZrodlo(req.headers.origin);
  if (!zrodlo.ok) {
    res.status(403).json({ blad: 'Ta funkcja obsługuje tylko własną stronę.', powod: 'obce_zrodlo' });
    return;
  }

  const nazwa = decodeURIComponent((req.url.match(/[?&]nazwa=([^&]+)/) || [])[1] || '');

  if (req.method === 'GET' || req.method === 'HEAD') {
    try {
      const w = await policz(nazwa);
      res.status(w.blad ? 404 : 200).json(w);
    } catch (e) {
      console.error('[operator]', e);
      res.status(502).json({ blad: e.message, powod: 'zrodlo' });
    }
    return;
  }

  await obsluz(req, res, async (cialo) => {
    const w = await policz(String(cialo.nazwa || nazwa));
    if (w.blad) return w;

    const brief = await tekstOdModelu({
      system: wczytajPrompt('brief-operatora'),
      wiadomosc: faktyDoBriefu(w.stan, w.rekomendacja)
    });

    return { brief, mail: briefDoMaila(w.stan, w.rekomendacja, { opisAI: brief }) };
  });
}
