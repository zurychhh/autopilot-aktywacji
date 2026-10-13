// Tygodniowy stan aktywacji wspólnych klientów dla jednego operatora.
//
// To jedyny widok prototypu pisany dla kogoś spoza Locona, więc rządzi nim
// inna zasada: żadnego porównania, które stawia partnera w gorszym świetle
// bez podania, co z tym zrobić. Liczby mają prowadzić do wspólnej akcji,
// a nie do kłótni, kto zawinił.

import { KROKI_LEJKA } from './datasource.js';

export const DNI_TYGODNIA = 7;

/** Nazwy kroków po ludzku — brief czyta ktoś, kto nie zna naszych skrótów. */
export const NAZWY_KROKOW = {
  start: 'aktywna subskrypcja',
  pobranie: 'pobranie aplikacji',
  konto: 'założenie konta',
  bliski: 'dodanie bliskiej osoby',
  mapa: 'pierwsze zobaczenie lokalizacji',
  d7: 'aktywność w 7. dniu',
  d30: 'aktywność w 30. dniu'
};

const suma = (w, pole) => w.reduce((a, r) => a + Number(r[pole] || 0), 0);

/**
 * Formatowanie liczb po polsku, z rozróżnieniem dwóch rzeczy, które łatwo
 * pomylić:
 *   udzial()   — ile procent klientów coś zrobiło            → „7,4%”
 *   pktProc()  — RÓŻNICA między dwoma udziałami              → „4,9 pkt proc.”
 * Mieszanie ich w jednym akapicie sprawia, że partner czyta wzrost o 2,8%
 * jako wzrost o 2,8 punktu procentowego, a to zupełnie inna liczba.
 */
export const udzial = (x, d = 1) =>
  `${(x * 100).toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;

export const pktProc = (x, d = 1) =>
  `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d })} pkt proc.`;

export const liczba = (n) => Math.round(n).toLocaleString('pl-PL');

export function operatorzy(lejek) {
  return [...new Set(lejek.filter(w => w.kanal === 'op' && w.operator).map(w => w.operator))].sort();
}

/** Dopasowanie nazwy z adresu do nazwy w danych, bez rozróżniania wielkości liter. */
export function dopasujOperatora(lejek, nazwa) {
  const szukana = String(nazwa || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return operatorzy(lejek).find(o => o.toLowerCase().replace(/[^a-z0-9]/g, '') === szukana) || null;
}

/**
 * Stan tygodnia: ostatnie 7 dni wobec poprzednich 7 oraz wobec pozostałych
 * operatorów w tym samym okresie. Porównanie w tym samym okresie, nie z historią
 * — ta sama zasada co w pętli testów.
 */
export function stanTygodnia({ lejek, operator }) {
  const dni = [...new Set(lejek.map(w => w.data))].sort();
  const ostatnie = dni.slice(-DNI_TYGODNIA);
  const poprzednie = dni.slice(-2 * DNI_TYGODNIA, -DNI_TYGODNIA);

  const wiersze = (op, okres) => lejek.filter(w => w.kanal === 'op' && w.operator === op && okres.includes(w.data));

  const krokiDla = (op, okres) => Object.fromEntries(
    KROKI_LEJKA.map(k => [k, suma(wiersze(op, okres), k)]));

  const teraz = krokiDla(operator, ostatnie);
  const przed = krokiDla(operator, poprzednie);

  const doWartosci = (k) => (k.start ? k.mapa / k.start : 0);

  const pozostali = operatorzy(lejek).filter(o => o !== operator);
  const udzialyInnych = pozostali.map(o => doWartosci(krokiDla(o, ostatnie)));
  const najlepszyInny = pozostali.length
    ? pozostali[udzialyInnych.indexOf(Math.max(...udzialyInnych))]
    : null;

  // Krok, na którym operator traci najwięcej względem najlepszego z pozostałych
  let najwiekszaRoznica = null;
  if (najlepszyInny) {
    const najlepszy = krokiDla(najlepszyInny, ostatnie);
    for (let i = 0; i < KROKI_LEJKA.length - 1; i++) {
      const z = KROKI_LEJKA[i], na = KROKI_LEJKA[i + 1];
      const nasz = teraz[z] ? teraz[na] / teraz[z] : 0;
      const ich = najlepszy[z] ? najlepszy[na] / najlepszy[z] : 0;
      const roznica = ich - nasz;
      if (!najwiekszaRoznica || roznica > najwiekszaRoznica.roznica) {
        najwiekszaRoznica = { zKroku: z, naKrok: na, nasz, ich, roznica, osobTygodniowo: Math.round(teraz[z] * roznica) };
      }
    }
  }

  return {
    operator,
    okres: { od: ostatnie[0], do: ostatnie[ostatnie.length - 1] },
    kroki: teraz,
    krokiPoprzedniTydzien: przed,
    doPierwszejWartosci: doWartosci(teraz),
    doPierwszejWartosciPoprzednio: doWartosci(przed),
    // Różnica w punktach procentowych — to ją pokazujemy partnerowi.
    // Zmiana względna zostaje dla kompletu, ale nie trafia na ekran.
    zmianaPktProc: doWartosci(teraz) - doWartosci(przed),
    zmianaTygodniowa: doWartosci(przed) ? (doWartosci(teraz) - doWartosci(przed)) / doWartosci(przed) : 0,
    najlepszyInny,
    udzialNajlepszego: najlepszyInny ? Math.max(...udzialyInnych) : 0,
    najwiekszaRoznica
  };
}

/**
 * Rekomendowana wspólna akcja. Wynika z kroku, na którym operator traci
 * najwięcej — i jest sformułowana jako coś, co robimy razem, bo żadnej z tych
 * rzeczy żadna strona nie zrobi sama.
 */
export function rekomendacja(stan, { akcje = [] } = {}) {
  const r = stan.najwiekszaRoznica;
  if (!r || r.roznica < 0.03) {
    return {
      krok: null,
      tytul: 'Bez pilnej akcji',
      opis: `Na żadnym kroku ${stan.operator} nie odstaje istotnie od najlepszego kanału. Trzymamy kurs i wracamy do rozmowy za tydzień.`,
      osobTygodniowo: 0
    };
  }

  const propozycje = {
    pobranie: {
      tytul: 'SMS z pakietu operatora, prowadzący najpierw do wartości',
      opis: 'Klienci z aktywnym pakietem nie mają aplikacji, więc push do nich nie dotrze. Wysyłka SMS-em z nadawcą operatora, z linkiem do mapy w przeglądarce zamiast do sklepu z aplikacjami. Treści po naszej stronie, kanał po Waszej.'
    },
    konto: {
      tytul: 'Rozpoznanie numeru przez sieć zamiast formularza',
      opis: 'Największa strata siedzi między pobraniem a kontem. Rozpoznanie numeru przez sieć operatora usuwa formularz z drogi. Integracja po Waszej stronie, ekran po naszej.'
    },
    bliski: {
      tytul: 'Prośba do bliskiej osoby wysyłana SMS-em',
      opis: 'Klient zakłada konto i utyka, bo nie ma kogo dodać. Prośba o zgodę wysłana SMS-em z nadawcą operatora ma wyższą dostarczalność niż nasza. Zgoda bliskiej osoby pozostaje warunkiem.'
    },
    mapa: {
      tytul: 'Mapa w przeglądarce dla klientów bez aplikacji',
      opis: 'Klient dodał bliską osobę, ale nie zobaczył mapy. Link do widoku w przeglądarce omija instalację i pokazuje wartość od razu.'
    }
  };

  const p = propozycje[r.naKrok] || {
    tytul: `Wspólna praca nad krokiem „${NAZWY_KROKOW[r.naKrok] || r.naKrok}"`,
    opis: 'Ten krok odstaje najbardziej; szczegóły do ustalenia na wspólnym spotkaniu.'
  };

  const ostatniaAkcja = akcje
    .filter(a => a.operator === stan.operator)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)))[0];

  return {
    krok: r.naKrok,
    ...p,
    osobTygodniowo: r.osobTygodniowo,
    roznicaPktProc: r.roznica * 100,
    wzgledem: stan.najlepszyInny,
    ostatniaAkcja: ostatniaAkcja || null
  };
}

/** Fakty dla modelu: same wyliczone liczby. Model ma je ubrać w zdania, nie wymyślać. */
export function faktyDoBriefu(stan, rek) {
  return [
    `Operator: ${stan.operator}`,
    `Okres: ${stan.okres.od} do ${stan.okres.do}`,
    `Aktywne subskrypcje w tygodniu: ${liczba(stan.kroki.start)}`,
    `Doszło do pierwszej wartości: ${liczba(stan.kroki.mapa)} osób, czyli ${udzial(stan.doPierwszejWartosci)}`,
    `Tydzień wcześniej: ${udzial(stan.doPierwszejWartosciPoprzednio)}, czyli zmiana o ${pktProc(stan.zmianaPktProc)}`,
    stan.najlepszyInny ? `Najlepszy z pozostałych operatorów (${stan.najlepszyInny}): ${udzial(stan.udzialNajlepszego)}` : null,
    rek.krok
      ? `Największa różnica na kroku „${NAZWY_KROKOW[rek.krok] || rek.krok}": ${pktProc(rek.roznicaPktProc / 100)}, czyli około ${liczba(rek.osobTygodniowo)} osób tygodniowo`
      : 'Żaden krok nie odstaje istotnie',
    `Rekomendowana wspólna akcja: ${rek.tytul}`,
    'Zapis liczb: procent to udział klientów, punkt procentowy to różnica między dwoma udziałami.'
  ].filter(Boolean).join('\n');
}

/** Wersja do skopiowania do maila — gotowa, bez AI, zawsze działa. */
export function briefDoMaila(stan, rek, { opisAI = '' } = {}) {
  return [
    `Aktywacja Bezpiecznej Rodziny — ${stan.operator}, tydzień ${stan.okres.od} do ${stan.okres.do}`,
    '',
    opisAI || null,
    opisAI ? '' : null,
    `Liczby tygodnia:`,
    `- aktywne subskrypcje: ${liczba(stan.kroki.start)}`,
    `- doszło do pierwszej wartości: ${liczba(stan.kroki.mapa)} osób, czyli ${udzial(stan.doPierwszejWartosci)} wszystkich`,
    `- tydzień wcześniej: ${udzial(stan.doPierwszejWartosciPoprzednio)}, czyli zmiana o ${pktProc(stan.zmianaPktProc)}`,
    stan.najlepszyInny ? `- najlepszy z pozostałych kanałów operatorskich: ${udzial(stan.udzialNajlepszego)}` : null,
    '',
    `Propozycja wspólnej akcji: ${rek.tytul}`,
    rek.opis,
    rek.osobTygodniowo
      ? `Rząd wielkości: około ${liczba(rek.osobTygodniowo)} osób tygodniowo, czyli różnica ${pktProc(rek.roznicaPktProc / 100)} na tym kroku.`
      : null,
    '',
    'Procent oznacza udział klientów, punkt procentowy — różnicę między dwoma udziałami.',
    'Wszystkie liczby pochodzą z prototypu i są przykładowe.'
  ].filter(l => l !== null).join('\n');
}
