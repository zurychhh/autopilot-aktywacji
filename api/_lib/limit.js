// Limit zapytań na adres IP.
//
// UWAGA, świadome uproszczenie demo: licznik siedzi w pamięci procesu, więc
// działa tylko w obrębie jednej instancji funkcji serwerowej. Platforma
// uruchamia ich wiele i usypia je, więc realny limit jest wyższy niż ustawiony,
// a po przeskalowaniu do zera zeruje się do końca. Prawdziwym bezpiecznikiem
// kosztów jest limit wydatków w konsoli Anthropic — opisane w README.

const okna = new Map();

export function sprawdzLimit(klucz, { maks, oknoMs, teraz = Date.now() } = {}) {
  const od = teraz - oknoMs;
  const trafienia = (okna.get(klucz) || []).filter(t => t > od);

  if (trafienia.length >= maks) {
    okna.set(klucz, trafienia);
    const najstarsze = trafienia[0];
    return { ok: false, zostalo: 0, ponowZa: Math.ceil((najstarsze + oknoMs - teraz) / 1000) };
  }

  trafienia.push(teraz);
  okna.set(klucz, trafienia);
  return { ok: true, zostalo: maks - trafienia.length, ponowZa: 0 };
}

/** Tylko do testów — pamięć procesu nie ma innego sposobu na czyszczenie. */
export function wyczyscLimity() {
  okna.clear();
}
