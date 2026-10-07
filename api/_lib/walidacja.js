// Walidacja odpowiedzi modelu. Bez bibliotek, bo schemat jest mały i stały,
// a zależność w funkcji serwerowej to koszt, który trzeba by czymś uzasadnić.
//
// Model potrafi zwrócić poprawny JSON z brakującym polem albo SMS-em dłuższym
// niż jeden segment. Takie rzeczy mają się kończyć ponowną próbą, a nie
// wysypaniem strony — dlatego walidator zwraca listę błędów po polsku,
// którą da się wstawić z powrotem do promptu przy ponownej próbie.

const POLSKIE_ZNAKI = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/** Rekurencyjne sprawdzenie wartości względem opisu pola. */
function sprawdzWartosc(wartosc, opis, sciezka, bledy) {
  if (wartosc === undefined || wartosc === null) {
    if (opis.wymagane) bledy.push(`brak pola ${sciezka}`);
    return;
  }

  if (opis.typ === 'tekst') {
    if (typeof wartosc !== 'string') {
      bledy.push(`${sciezka} ma być tekstem, a jest typu ${typeof wartosc}`);
      return;
    }
    if (opis.wymagane && wartosc.trim() === '') bledy.push(`${sciezka} jest puste`);
    if (opis.maks && wartosc.length > opis.maks) {
      bledy.push(`${sciezka} ma ${wartosc.length} znaków, limit to ${opis.maks}`);
    }
    if (opis.bezPolskichZnakow && POLSKIE_ZNAKI.test(wartosc)) {
      bledy.push(`${sciezka} zawiera polskie znaki diakrytyczne, a nie może`);
    }
    if (opis.zaczynaOd && !wartosc.startsWith(opis.zaczynaOd)) {
      bledy.push(`${sciezka} ma zaczynać się od „${opis.zaczynaOd}”`);
    }
    for (const fragment of opis.zawiera || []) {
      if (!wartosc.toLowerCase().includes(fragment.toLowerCase())) {
        bledy.push(`${sciezka} ma zawierać „${fragment}”`);
      }
    }
    for (const fragment of opis.nieZawiera || []) {
      if (wartosc.toLowerCase().includes(fragment.toLowerCase())) {
        bledy.push(`${sciezka} nie może zawierać „${fragment}”`);
      }
    }
    return;
  }

  if (opis.typ === 'lista') {
    if (!Array.isArray(wartosc)) {
      bledy.push(`${sciezka} ma być listą, a jest typu ${typeof wartosc}`);
      return;
    }
    if (opis.min && wartosc.length < opis.min) {
      bledy.push(`${sciezka} ma ${wartosc.length} elementów, potrzeba co najmniej ${opis.min}`);
    }
    if (opis.maks && wartosc.length > opis.maks) {
      bledy.push(`${sciezka} ma ${wartosc.length} elementów, limit to ${opis.maks}`);
    }
    wartosc.forEach((el, i) => sprawdzWartosc(el, opis.element, `${sciezka}[${i}]`, bledy));
    return;
  }

  if (opis.typ === 'obiekt') {
    if (typeof wartosc !== 'object' || Array.isArray(wartosc)) {
      bledy.push(`${sciezka} ma być obiektem`);
      return;
    }
    for (const [nazwa, opisPola] of Object.entries(opis.pola)) {
      sprawdzWartosc(wartosc[nazwa], opisPola, sciezka ? `${sciezka}.${nazwa}` : nazwa, bledy);
    }
    return;
  }

  bledy.push(`${sciezka}: nieznany typ w schemacie (${opis.typ})`);
}

/** Zwraca `{ ok, bledy }`. Nigdy nie rzuca — wołający decyduje, co zrobić. */
export function sprawdz(dane, schemat) {
  const bledy = [];
  sprawdzWartosc(dane, schemat, '', bledy);
  return { ok: bledy.length === 0, bledy };
}

/**
 * Odpowiedź /api/generate: komplet treści dla sześciu ekranów z kroku 3,
 * czyli dokładnie to, co strona pokazuje — AI podmienia je w miejscu.
 * Limity kanałów pochodzą z api/prompts/komunikaty.md, linki są stałe,
 * bo prowadzą do ekranów, które istnieją (wariant A: aplikacja, B: mapa).
 */
export const LINKI = {
  aplikacja: 'bezpiecznarodzina.pl/start',
  mapa: 'bezpiecznarodzina.pl/mapa',
  zgoda: 'bezpiecznarodzina.pl/z/7KQ2'
};

const SMS = { typ: 'tekst', wymagane: true, maks: 160, bezPolskichZnakow: true };

export const SCHEMAT_KOMUNIKATOW = {
  typ: 'obiekt',
  wymagane: true,
  pola: {
    smsA: { ...SMS, zaczynaOd: 'Play:', zawiera: [LINKI.aplikacja] },
    smsB: { ...SMS, zaczynaOd: 'Play:', zawiera: [LINKI.mapa], nieZawiera: ['pobierz', LINKI.aplikacja] },
    rcs: {
      typ: 'obiekt', wymagane: true,
      pola: {
        tytul: { typ: 'tekst', wymagane: true, maks: 45 },
        opis: { typ: 'tekst', wymagane: true, maks: 120 },
        przyciski: {
          typ: 'lista', wymagane: true, min: 2, maks: 2,
          element: { typ: 'tekst', wymagane: true, maks: 30 }
        }
      }
    },
    whatsapp: {
      typ: 'obiekt', wymagane: true,
      pola: {
        powitanie: { typ: 'tekst', wymagane: true, maks: 300 },
        potwierdzenie: { typ: 'tekst', wymagane: true, maks: 200 }
      }
    },
    smsBliski: { ...SMS, zawiera: [LINKI.zgoda, 'odmow'] },
    strona: {
      typ: 'obiekt', wymagane: true,
      pola: {
        naglowek: { typ: 'tekst', wymagane: true, maks: 40 },
        pytanie: { typ: 'tekst', wymagane: true, maks: 120 },
        cta: { typ: 'tekst', wymagane: true, maks: 30 }
      }
    }
  }
};

/**
 * Wyciąga JSON z odpowiedzi modelu. Model bywa poproszony o czysty JSON,
 * a i tak czasem opakuje go w blok kodu — to tańsze niż ponowna próba.
 */
export function wyciagnijJson(tekst) {
  const bezBloku = String(tekst).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return { ok: true, dane: JSON.parse(bezBloku) };
  } catch (e) {
    return { ok: false, bledy: [`odpowiedź nie jest poprawnym JSON-em: ${e.message}`] };
  }
}
