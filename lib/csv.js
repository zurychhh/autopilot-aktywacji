// Parser CSV. Bez biblioteki, bo potrzebujemy jednej rzeczy: pól w cudzysłowach
// z przecinkami i znakami nowej linii w środku. Dziennik akcji ma opisy zdaniami,
// więc naiwny split po przecinku psułby dane po cichu.

/** Zwraca tablicę tablic. Obsługuje "" jako cudzysłów wewnątrz pola. */
export function parsujCsv(tekst) {
  const wiersze = [];
  let pole = '';
  let wiersz = [];
  let wCudzyslowie = false;

  const czysty = String(tekst).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < czysty.length; i++) {
    const z = czysty[i];

    if (wCudzyslowie) {
      if (z === '"') {
        if (czysty[i + 1] === '"') { pole += '"'; i++; }
        else wCudzyslowie = false;
      } else pole += z;
      continue;
    }

    if (z === '"') { wCudzyslowie = true; continue; }
    if (z === ',') { wiersz.push(pole); pole = ''; continue; }
    if (z === '\n') { wiersz.push(pole); wiersze.push(wiersz); wiersz = []; pole = ''; continue; }
    pole += z;
  }

  if (pole !== '' || wiersz.length) { wiersz.push(pole); wiersze.push(wiersz); }
  return wiersze.filter(w => w.length > 1 || (w[0] ?? '') !== '');
}

/** CSV z nagłówkiem → tablica obiektów. Liczby zostają tekstem; konwersja jest jawna. */
export function csvNaObiekty(tekst) {
  const [naglowki, ...reszta] = parsujCsv(tekst);
  if (!naglowki) return [];
  return reszta.map(w => Object.fromEntries(naglowki.map((h, i) => [h.trim(), w[i] ?? ''])));
}

/** Pomocnik: pola liczbowe na liczby, reszta bez zmian. */
export function naLiczby(obiekt, pola) {
  const wynik = { ...obiekt };
  for (const p of pola) wynik[p] = Number(obiekt[p] ?? 0) || 0;
  return wynik;
}
