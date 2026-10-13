// POST /api/uzasadnij — uzasadnienie „dlaczego ten test" dla planu następnego testu.
// Liczebność i czas liczy kod i przysyła je gotowe; model ma zakaz ich zmieniania.
//
// Uzasadnienie też przechodzi przez bramkę człowieka. Gdy je odrzuci, wracają
// tu `uwagi` i `poprzednie` — model przepisuje tekst, zamiast pisać go od zera.

import { obsluz } from './_lib/http.js';
import { tekstOdModelu, wczytajPrompt } from './_lib/claude.js';

const MAKS_UWAG = 600;
const MAKS_POPRZEDNIEGO = 1200;

/** Treść zapytania. Wydzielona, żeby dało się ją sprawdzić bez wołania modelu. */
export function zbudujProsbe({ pomysl, strata, plan, uwagi, poprzednie }) {
  const podstawa = `Pomysł na wariant: ${pomysl}\n\nStrata, z której się bierze: ${strata}\n\nPlan policzony przez kod: ${plan}`;
  const uwagiTekst = String(uwagi || '').slice(0, MAKS_UWAG).trim();
  if (!uwagiTekst) return podstawa;

  const stare = String(poprzednie || '').slice(0, MAKS_POPRZEDNIEGO).trim();
  return [
    podstawa,
    '',
    'Człowiek odrzucił poprzednie uzasadnienie. Jego uwagi:',
    uwagiTekst,
    ...(stare ? ['', 'Odrzucone uzasadnienie:', stare] : []),
    '',
    'Napisz je jeszcze raz, odpowiadając na uwagi. Liczby zostają te same — nie wolno ich zmienić.'
  ].join('\n');
}

export default async function handler(req, res) {
  await obsluz(req, res, async (cialo) => {
    const pomysl = String(cialo.pomysl || '').slice(0, 300).trim();
    const strata = String(cialo.strata || '').slice(0, 400).trim();
    const plan = String(cialo.plan || '').slice(0, 400).trim();
    if (!pomysl) return { uzasadnienie: '', blad: 'Brak pomysłu do uzasadnienia.' };

    const uzasadnienie = await tekstOdModelu({
      system: wczytajPrompt('uzasadnienie-testu'),
      wiadomosc: zbudujProsbe({ pomysl, strata, plan, uwagi: cialo.uwagi, poprzednie: cialo.poprzednie })
    });

    return { uzasadnienie };
  });
}
