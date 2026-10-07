// POST /api/generate — komplet treści dla sześciu ekranów testu z kroku 3.
// Prompt systemowy: api/prompts/komunikaty.md (ten sam tekst pokazuje strona).

import { obsluz } from './_lib/http.js';
import { jsonOdModelu, wczytajPrompt } from './_lib/claude.js';
import { SCHEMAT_KOMUNIKATOW } from './_lib/walidacja.js';

export default async function handler(req, res) {
  await obsluz(req, res, async (cialo) => {
    const segment = String(cialo.segment || '').slice(0, 300).trim()
      || 'operator, krok Start → Pobranie';

    const zestaw = await jsonOdModelu({
      system: wczytajPrompt('komunikaty'),
      wiadomosc: `Napisz nowy komplet treści do testu „najpierw wartość, potem aplikacja” dla segmentu: ${segment}.`,
      schemat: SCHEMAT_KOMUNIKATOW
    });

    return zestaw;
  });
}
