// POST /api/narrate — opis wyniku testu dla zarządu i dla operatora.
// Prompt systemowy: api/prompts/opis-wyniku.md (ten sam tekst pokazuje strona).

import { obsluz } from './_lib/http.js';
import { tekstOdModelu, wczytajPrompt } from './_lib/claude.js';

export default async function handler(req, res) {
  await obsluz(req, res, async (cialo) => {
    // Liczby liczy kod i przysyła je gotowe. Model ich nie wylicza i nie zmienia.
    const fakty = String(cialo.fakty || '').slice(0, 2000).trim();
    const decyzja = String(cialo.decyzja || '').slice(0, 500).trim();
    if (!fakty) {
      return { opis: '', blad: 'Brak faktów do opisania.' };
    }

    const opis = await tekstOdModelu({
      system: wczytajPrompt('opis-wyniku'),
      wiadomosc: `Liczby z testu:\n${fakty}\n\nDecyzja podjęta przez kod: ${decyzja}`
    });

    return { opis };
  });
}
