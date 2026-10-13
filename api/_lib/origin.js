// Kto może wołać nasze funkcje.
//
// Bez tego każdy mógłby wstawić na swoją stronę fetch('https://nasz-adres/api/generate')
// i generować treści na nasz rachunek. Przeglądarka dokłada nagłówek Origin do
// każdego POST-a, także w obrębie tej samej domeny, więc wystarczy go sprawdzić.
//
// Ograniczenie, które trzeba znać: curl i każdy inny klient spoza przeglądarki
// może Origin podrobić albo go nie wysłać. To zabezpieczenie odcina cudzą
// stronę, nie zdeterminowanego człowieka — przed tym drugim broni limit
// zapytań i limit wydatków w konsoli Anthropic.

/** Lista dozwolonych źródeł: z env, z adresu nadanego przez hosting, plus localhost. */
export function dozwoloneZrodla(env = process.env) {
  const lista = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  // Adres produkcyjny projektu — pod nim naprawdę działa strona. Ustawiany
  // zawsze, także we wdrożeniach podglądowych. Źródło: dokumentacja Vercel,
  // "System environment variables".
  if (env.VERCEL_PROJECT_PRODUCTION_URL) lista.push(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  // VERCEL_URL to adres pojedynczego wdrożenia, VERCEL_BRANCH_URL adres gałęzi.
  // Oba przydają się przy podglądach, ale żaden nie jest aliasem produkcyjnym.
  if (env.VERCEL_URL) lista.push(`https://${env.VERCEL_URL}`);
  if (env.VERCEL_BRANCH_URL) lista.push(`https://${env.VERCEL_BRANCH_URL}`);
  return lista;
}

/**
 * Zwraca `{ ok, powod }`. Brak nagłówka Origin przepuszczamy — tak wyglądają
 * żądania z curla, z monitoringu i z testów, a i tak da się go podrobić,
 * więc blokowanie go dawałoby złudzenie bezpieczeństwa kosztem użyteczności.
 */
export function sprawdzZrodlo(origin, env = process.env) {
  if (!origin) return { ok: true, powod: 'brak_origin' };

  const czyste = String(origin).replace(/\/$/, '');
  const dozwolone = dozwoloneZrodla(env);

  // Pusta lista = praca lokalna, gdzie hosting nie nadał jeszcze adresu
  if (dozwolone.length === 0) return { ok: true, powod: 'lista_pusta' };

  if (dozwolone.includes(czyste)) return { ok: true, powod: 'na_liscie' };
  return { ok: false, powod: 'obce_zrodlo' };
}
