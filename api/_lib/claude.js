// Wołanie Claude API. Klucz czytany wyłącznie ze zmiennej środowiskowej,
// nigdy nie trafia do przeglądarki — front rozmawia tylko z /api.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { sprawdz, wyciagnijJson } from './walidacja.js';

// Źródło identyfikatora: dokumentacja Anthropic, "Models overview"
// https://platform.claude.com/docs/en/about-claude/models/overview
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

// max_tokens to sufit, nie rezerwacja — płacimy za wygenerowane tokeny.
// Zostawiamy zapas, bo w tym modelu myślenie jest zawsze włączone i liczy się
// do tego limitu; za ciasny sufit ucinałby odpowiedź w połowie.
const MAKS_TOKENOW = 8000;

// Krótkie zadanie copywriterskie z jasno opisanymi ograniczeniami — niski
// wysiłek wystarcza, jest tańszy i szybszy. Ustawiamy go wprost, bo domyślny
// poziom różni się między modelami (Sonnet 5.5 ma "high", Opus 5.5 "medium").
const WYSILEK = 'low';

const prompty = new Map();

/** Prompt systemowy z api/prompts/<nazwa>.md. Jedno źródło dla serwera i strony. */
export function wczytajPrompt(nazwa) {
  if (!prompty.has(nazwa)) {
    prompty.set(nazwa, readFileSync(new URL(`../prompts/${nazwa}.md`, import.meta.url), 'utf8'));
  }
  return prompty.get(nazwa);
}

export class BladModelu extends Error {
  constructor(komunikat, { powod, bledy = [] } = {}) {
    super(komunikat);
    this.name = 'BladModelu';
    this.powod = powod;
    this.bledy = bledy;
  }
}

function klient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new BladModelu('Brak klucza ANTHROPIC_API_KEY po stronie serwera.', { powod: 'brak_klucza' });
  }
  return new Anthropic();
}

/** Jedno wywołanie modelu. Zwraca sam tekst odpowiedzi. */
async function wywolaj({ system, wiadomosc }) {
  const odpowiedz = await klient().beta.messages.create({
    model: MODEL,
    max_tokens: MAKS_TOKENOW,
    output_config: { effort: WYSILEK },
    system,
    messages: [{ role: 'user', content: wiadomosc }],
    // Gdyby klasyfikator bezpieczeństwa odrzucił zapytanie, API samo powtarza
    // je na modelu zapasowym zamiast zwracać pustą odpowiedź.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default'
  });

  if (odpowiedz.stop_reason === 'refusal') {
    throw new BladModelu('Model odmówił odpowiedzi na to zapytanie.', {
      powod: 'odmowa',
      bledy: [odpowiedz.stop_details?.explanation || 'bez wyjaśnienia']
    });
  }

  return odpowiedz.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

/** Zwykły tekst od modelu — używa /api/narrate. */
export async function tekstOdModelu({ system, wiadomosc }) {
  return wywolaj({ system, wiadomosc });
}

/**
 * JSON od modelu, sprawdzony schematem. Brak pola albo zły typ to jedna
 * ponowna próba — z listą błędów dopisaną do zapytania, żeby model wiedział,
 * co poprawić. Druga porażka kończy się błędem; stronę ratują treści
 * przygotowane wcześniej.
 */
export async function jsonOdModelu({ system, wiadomosc, schemat }) {
  let ostatnieBledy = [];

  for (const proba of [1, 2]) {
    const prosba = proba === 1
      ? wiadomosc
      : `${wiadomosc}\n\nPoprzednia odpowiedź była niepoprawna:\n` +
        ostatnieBledy.map(b => `- ${b}`).join('\n') +
        '\nPopraw dokładnie te rzeczy i zwróć sam JSON.';

    const tekst = await wywolaj({ system, wiadomosc: prosba });
    const json = wyciagnijJson(tekst);
    if (!json.ok) { ostatnieBledy = json.bledy; continue; }

    const wynik = sprawdz(json.dane, schemat);
    if (wynik.ok) return json.dane;
    ostatnieBledy = wynik.bledy;
  }

  throw new BladModelu('Odpowiedź modelu nie spełnia schematu po dwóch próbach.', {
    powod: 'zly_schemat',
    bledy: ostatnieBledy
  });
}
