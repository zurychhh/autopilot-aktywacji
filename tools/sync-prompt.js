// Kopiuje prompty systemowe z api/prompts/ do public/prompts/.
//
// Źródłem prawdy jest api/prompts/ — tam czyta je funkcja serwerowa. Strona
// musi pokazać ten sam tekst w sekcji „Jak to działa", także gdy /api nie
// odpowiada, więc potrzebuje własnej kopii obok siebie. Test pilnuje, żeby
// kopia nie rozjechała się z oryginałem.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ZRODLO = new URL('../api/prompts/', import.meta.url);
const CEL = new URL('../public/prompts/', import.meta.url);

mkdirSync(CEL, { recursive: true });
for (const plik of readdirSync(ZRODLO).filter(p => p.endsWith('.md'))) {
  writeFileSync(new URL(plik, CEL), readFileSync(new URL(plik, ZRODLO)));
  console.log('skopiowano', plik);
}
