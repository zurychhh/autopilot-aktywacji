# Funkcje serwerowe

Dwie funkcje wołające Claude API. Klucz czytany wyłącznie ze zmiennej
środowiskowej `ANTHROPIC_API_KEY` — nigdy nie trafia do przeglądarki.

| Ścieżka | Metoda | Wejście | Wyjście |
| --- | --- | --- | --- |
| `/api/generate` | POST | `{ segment }` | `{ warianty: [{ nazwa, sms, rcs_tytul, rcs_opis, rcs_przyciski, whatsapp }] }` |
| `/api/narrate` | POST | `{ fakty, decyzja }` | `{ opis }` |

GET na obie zwraca 405 — strona używa tego jako darmowej sondy stanu backendu.

## Co jest gdzie

- `prompts/` — prompty systemowe jako czytelne pliki Markdown (źródło prawdy;
  kopia dla przeglądarki powstaje przez `npm run sync-prompt`)
- `_lib/claude.js` — wywołanie modelu i ponowna próba przy złym schemacie
- `_lib/walidacja.js` — sprawdzanie odpowiedzi modelu, bez bibliotek
- `_lib/limit.js` — limit zapytań w pamięci procesu (uproszczenie demo, patrz README)
- `_lib/http.js` — metoda, limit, mapowanie błędów na kody HTTP

Podkreślnik w nazwie `_lib/` to konwencja platform serverless: takie katalogi
nie stają się osobnymi funkcjami.

## Błędy

Każda odpowiedź inna niż 200 ma kształt `{ blad, powod, szczegoly }`. Strona
traktuje je wszystkie tak samo — wraca do treści przygotowanych wcześniej —
ale pokazuje `blad` użytkownikowi, żeby było wiadomo, co się stało.

| `powod` | Kod | Znaczenie |
| --- | --- | --- |
| `zla_metoda` | 405 | GET zamiast POST |
| `zle_zadanie` | 400 | ciało żądania nie jest JSON-em |
| `limit` | 429 | limit zapytań zużyty |
| `brak_klucza` | 503 | serwer nie ma `ANTHROPIC_API_KEY` |
| `odmowa` | 502 | model odmówił odpowiedzi |
| `zly_schemat` | 502 | odpowiedź nie spełnia schematu po dwóch próbach |
| `awaria` | 502 | nieoczekiwany błąd; szczegóły tylko w logach |
