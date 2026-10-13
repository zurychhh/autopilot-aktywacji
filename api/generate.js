// POST /api/generate — komplet treści dla sześciu ekranów testu z kroku 3.
// Prompt systemowy: api/prompts/komunikaty.md (ten sam tekst pokazuje strona).
//
// Treści można też odrzucić z uwagami. Wtedy w ciele żądania przychodzą `uwagi`
// (czego człowiek nie akceptuje) i `poprzednie` (wersja, którą odrzucił).
// Schemat odpowiedzi jest ten sam — poprawka nie jest wyjątkiem od reguł, tylko
// kolejnym podejściem do tego samego zadania.

import { obsluz } from './_lib/http.js';
import { jsonOdModelu, wczytajPrompt } from './_lib/claude.js';
import { SCHEMAT_KOMUNIKATOW, wedlugSchematu } from './_lib/walidacja.js';

const MAKS_UWAG = 600;

/**
 * Treść zapytania do modelu. Wydzielona, bo to jedyne miejsce, w którym uwagi
 * człowieka trafiają do promptu — i jedyne, które da się sprawdzić testem
 * bez wołania modelu.
 */
export function zbudujProsbe({ segment, uwagi, poprzednie }) {
  const uwagiTekst = String(uwagi || '').slice(0, MAKS_UWAG).trim();
  const stare = wedlugSchematu(poprzednie, SCHEMAT_KOMUNIKATOW);

  if (!uwagiTekst) {
    return `Napisz nowy komplet treści do testu „najpierw wartość, potem aplikacja” dla segmentu: ${segment}.`;
  }

  return [
    `Popraw komplet treści do testu „najpierw wartość, potem aplikacja” dla segmentu: ${segment}.`,
    '',
    'Człowiek odrzucił poprzednią wersję. Jego uwagi:',
    uwagiTekst,
    ...(stare ? [
      '',
      'Odrzucona wersja:',
      JSON.stringify(stare, null, 2),
      '',
      'Zmień to, czego dotyczą uwagi. Reszty nie przepisuj na siłę — jeśli pole było dobre, zostaw je bez zmian.'
    ] : [
      '',
      'Poprzedniej wersji nie mam, więc napisz komplet od nowa, biorąc uwagi pod uwagę.'
    ])
  ].join('\n');
}

export default async function handler(req, res) {
  await obsluz(req, res, async (cialo) => {
    const segment = String(cialo.segment || '').slice(0, 300).trim()
      || 'operator, krok Start → Pobranie';

    const zestaw = await jsonOdModelu({
      system: wczytajPrompt('komunikaty'),
      wiadomosc: zbudujProsbe({ segment, uwagi: cialo.uwagi, poprzednie: cialo.poprzednie }),
      schemat: SCHEMAT_KOMUNIKATOW
    });

    return zestaw;
  });
}
