// POST /api/uzasadnij — uzasadnienie „dlaczego ten test" dla planu następnego testu.
// Liczebność i czas liczy kod i przysyła je gotowe; model ma zakaz ich zmieniania.

import { obsluz } from './_lib/http.js';
import { tekstOdModelu, wczytajPrompt } from './_lib/claude.js';

export default async function handler(req, res) {
  await obsluz(req, res, async (cialo) => {
    const pomysl = String(cialo.pomysl || '').slice(0, 300).trim();
    const strata = String(cialo.strata || '').slice(0, 400).trim();
    const plan = String(cialo.plan || '').slice(0, 400).trim();
    if (!pomysl) return { uzasadnienie: '', blad: 'Brak pomysłu do uzasadnienia.' };

    const uzasadnienie = await tekstOdModelu({
      system: wczytajPrompt('uzasadnienie-testu'),
      wiadomosc: `Pomysł na wariant: ${pomysl}\n\nStrata, z której się bierze: ${strata}\n\nPlan policzony przez kod: ${plan}`
    });

    return { uzasadnienie };
  });
}
