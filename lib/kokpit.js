// Kokpit aktywacji: co się zmieniło, dlaczego i jak mocny jest dowód.
//
// Wszystko tutaj liczy kod. AI dostaje gotowe fakty i ma je tylko streścić —
// nie wolno jej niczego wykryć, wyjaśnić ani oszacować.
//
// Kolejność wyjaśniania jest celowa i odwrotna do odruchu:
//   1. NAJPIERW KALENDARZ. Zanim zaczniemy szukać winnego po naszej stronie,
//      sprawdzamy, czy to nie rok szkolny, ferie albo premiera systemu.
//   2. POTEM NASZE AKCJE, z jawną siłą dowodu:
//      „zbieżność w czasie"   — coś zrobiliśmy w oknie 7 dni. Najsłabszy dowód:
//                               zbieżność nie jest przyczyną.
//      „porównanie naturalne" — zmiana dotknęła jednego operatora, a pozostali
//                               w tym samym czasie się nie ruszyli. Mocniejsze,
//                               bo rynek i sezon działają na wszystkich.
//      „test"                 — był losowy przydział. Jedyny prawdziwy dowód.

import { etykietaJednostki } from '../public/logic.js';

export const PROG_Z = 1.8;          // ile odchyleń od bazy uznajemy za sygnał
export const OKNO_PRZESUNIECIA = 7; // z ilu dni liczymy nowy poziom
export const MIN_PRZESUNIECIE = 0.2; // o ile musi się zmienić poziom, żeby to był sygnał
export const MIN_DNI_EPIZODU = 3;   // jednodniowy wyskok to szum, nie zmiana
export const DNI_BAZY = 28;         // cztery pełne tygodnie, żeby uśrednić dni tygodnia
export const OKNO_AKCJI = 7;        // w ilu dniach przed zmianą szukamy naszej akcji

export const SILA = {
  kalendarz: { poziom: 0, nazwa: 'wyjaśnienie zewnętrzne' },
  zbieznosc: { poziom: 1, nazwa: 'zbieżność w czasie' },
  porownanie: { poziom: 2, nazwa: 'porównanie naturalne' },
  test: { poziom: 3, nazwa: 'test' }
};

const srednia = (t) => (t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0);

const odchylenie = (t) => {
  if (t.length < 2) return 0;
  const m = srednia(t);
  return Math.sqrt(t.reduce((a, b) => a + (b - m) ** 2, 0) / (t.length - 1));
};

export const mediana = (t) => {
  if (!t.length) return 0;
  const s = [...t].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

/**
 * Odchylenie medianowe przeskalowane do porównywalności z odchyleniem
 * standardowym. Używamy go zamiast średniej i odchylenia, bo w bazie siedzą
 * zdarzenia takie jak początek roku szkolnego: jeden tydzień skoku zawyża
 * odchylenie na tyle, że kolejne prawdziwe zmiany przestają odstawać.
 * Mediana i MAD tego nie widzą — i dzięki temu widzą resztę.
 */
export const mad = (t) => {
  if (t.length < 2) return 0;
  const m = mediana(t);
  return 1.4826 * mediana(t.map(v => Math.abs(v - m)));
};
const dzienPlus = (iso, ile) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + ile);
  return d.toISOString().slice(0, 10);
};

/** Dzienna seria dla jednej jednostki (kanał albo kanał + operator). */
export function seria(lejek, { kanal, operator = null, metryka = 'pobranie' }) {
  const wg = new Map();
  for (const w of lejek) {
    if (w.kanal !== kanal) continue;
    if (operator !== null && w.operator !== operator) continue;
    wg.set(w.data, (wg.get(w.data) || 0) + Number(w[metryka] || 0));
  }
  return [...wg.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, wartosc]) => ({ data, wartosc }));
}

/** Jednostki do obserwowania: każdy kanał zbiorczo i każdy operator osobno. */
export function jednostki(lejek) {
  const out = [];
  const kanaly = [...new Set(lejek.map(w => w.kanal))].sort();
  for (const kanal of kanaly) {
    out.push({ kanal, operator: null, etykieta: etykietaJednostki({ kanal }) });
    const operatorzy = [...new Set(lejek.filter(w => w.kanal === kanal && w.operator).map(w => w.operator))].sort();
    for (const operator of operatorzy) {
      out.push({ kanal, operator, etykieta: etykietaJednostki({ kanal, operator }) });
    }
  }
  return out;
}

/**
 * Epizody: ciągi dni, w których wartość odstaje od 28-dniowej bazy.
 * Pojedynczy dzień nie wystarcza — szum dzienny jest duży i bez tego progu
 * kokpit krzyczałby codziennie, a wtedy nikt by go nie czytał.
 */
export function wykryjEpizody(serie, { progZ = PROG_Z, dniBazy = DNI_BAZY, minDni = MIN_DNI_EPIZODU } = {}) {
  const oznaczone = serie.map((punkt, i) => {
    const baza = serie.slice(Math.max(0, i - dniBazy), i).map(p => p.wartosc);
    if (baza.length < dniBazy) return { ...punkt, z: 0, sygnal: 0 };

    const m = mediana(baza);
    // MAD bywa zerem, gdy ponad połowa dni ma tę samą wartość — wtedy
    // odchylenie standardowe jest jedyną dostępną miarą rozrzutu
    const rozrzut = mad(baza) || odchylenie(baza);
    const z = rozrzut > 0 ? (punkt.wartosc - m) / rozrzut : 0;
    return { ...punkt, bazaSrednia: m, bazaOdchylenie: rozrzut, z, sygnal: Math.abs(z) >= progZ ? Math.sign(z) : 0 };
  });

  const epizody = [];
  let biezacy = null;
  for (const p of oznaczone) {
    if (p.sygnal !== 0 && (!biezacy || biezacy.kierunek === p.sygnal)) {
      biezacy = biezacy || { od: p.data, kierunek: p.sygnal, punkty: [] };
      biezacy.punkty.push(p);
      biezacy.do = p.data;
    } else if (biezacy) {
      if (biezacy.punkty.length >= minDni) epizody.push(biezacy);
      biezacy = p.sygnal !== 0 ? { od: p.data, do: p.data, kierunek: p.sygnal, punkty: [p] } : null;
    }
  }
  if (biezacy && biezacy.punkty.length >= minDni) epizody.push(biezacy);

  return epizody.map(e => {
    const wartosci = e.punkty.map(p => p.wartosc);
    const bazaSr = mediana(e.punkty.map(p => p.bazaSrednia));
    const sr = srednia(wartosci);
    return {
      rodzaj: 'wyskok',
      od: e.od, do: e.do, dni: e.punkty.length,
      kierunek: e.kierunek > 0 ? 'wzrost' : 'spadek',
      sredniaWEpizodzie: sr,
      bazaSrednia: bazaSr,
      roznicaDzienna: sr - bazaSr,
      zmianaProcent: bazaSr ? (sr - bazaSr) / bazaSr : 0,
      maxZ: Math.max(...e.punkty.map(p => Math.abs(p.z)))
    };
  });
}

/**
 * Wyjaśnienia zewnętrzne sprawdzamy wokół POCZĄTKU zmiany, nie na całej jej
 * długości. Przy epizodzie ciągnącym się trzy tygodnie dowolna premiera
 * systemu w końcu się nałoży i kokpit tłumaczyłby wszystko wszystkim.
 */
function zKalendarza(epizod, kalendarz) {
  const od = dzienPlus(epizod.od, -2);
  const do_ = dzienPlus(epizod.od, 2);
  return (kalendarz || []).filter(k =>
    k.data_od <= do_ && (k.data_do || k.data_od) >= od);
}

/** Nasze akcje w oknie 7 dni przed początkiem epizodu. */
function akcjeWOknie(epizod, akcje, jednostka) {
  const od = dzienPlus(epizod.od, -OKNO_AKCJI);
  return (akcje || []).filter(a => {
    if (a.data < od || a.data > epizod.do) return false;
    const pasujeKanal = !a.kanal || a.kanal === 'wszystkie' || a.kanal === jednostka.kanal;
    const pasujeOperator = !a.operator || a.operator === jednostka.operator;
    return pasujeKanal && pasujeOperator;
  });
}

/**
 * Porównanie naturalne: czy w tym samym okresie pozostali operatorzy tego
 * kanału zachowali się inaczej. Jeśli tak, zmiana jest własnością tego jednego
 * operatora, a nie rynku — to różnica w różnicach, najmocniejszy dowód, jaki
 * da się mieć bez losowego przydziału.
 */
function porownanieNaturalne({ epizod, jednostka, lejek, metryka }) {
  if (!jednostka.operator) return null;

  const pozostali = [...new Set(
    lejek.filter(w => w.kanal === jednostka.kanal && w.operator && w.operator !== jednostka.operator)
      .map(w => w.operator)
  )];
  if (!pozostali.length) return null;

  const zmiana = (operator) => {
    const s = seria(lejek, { kanal: jednostka.kanal, operator, metryka });
    const wEpizodzie = s.filter(p => p.data >= epizod.od && p.data <= epizod.do).map(p => p.wartosc);
    const przed = s.filter(p => p.data < epizod.od && p.data >= dzienPlus(epizod.od, -DNI_BAZY)).map(p => p.wartosc);
    const bazowa = srednia(przed);
    return bazowa ? (srednia(wEpizodzie) - bazowa) / bazowa : 0;
  };

  const nasz = zmiana(jednostka.operator);
  const inni = srednia(pozostali.map(zmiana));
  const roznica = nasz - inni;

  // Mniej niż 15 punktów procentowych różnicy to nie jest „inaczej”
  if (Math.abs(roznica) < 0.15) return null;

  return {
    nasz, inni, roznica, pozostali,
    opis: `U operatora ${jednostka.operator} zmiana wyniosła ${(nasz * 100).toFixed(0)}%, ` +
      `a u pozostałych (${pozostali.join(', ')}) średnio ${(inni * 100).toFixed(0)}%. ` +
      `Różnica ${(roznica * 100).toFixed(0)} pkt proc. oznacza, że to nie rynek ani sezon.`
  };
}

/**
 * Test z rejestru, który naprawdę dotyczy tej jednostki i tego okresu.
 * Dopasowanie po kanale jest obowiązkowe — bez tego kokpit przypisywał wzrost
 * sprzedaży własnej do testu prowadzonego na kanale operatora i ogłaszał
 * „dowód: test" tam, gdzie żadnego testu nie było.
 */
function zTestu(epizod, testy, jednostka) {
  return (testy || []).find(t => {
    if (!t.data_rozstrzygniecia) return false;
    if (t.kanal !== jednostka.kanal) return false;

    // Zmiana u jednego operatora nie może pochodzić z testu obejmującego cały
    // kanał — taki test ruszyłby wszystkich operatorów naraz.
    if (jednostka.operator && t.operator !== jednostka.operator) return false;

    // Wdrożony wariant tłumaczy wzrost, nie spadek. Bez tego kokpit
    // przypisywał spadek u operatora do wygranego testu.
    const kierunekTestu = t.decyzja === 'wdrozyc' ? 'wzrost' : null;
    if (kierunekTestu && kierunekTestu !== epizod.kierunek) return false;

    return t.data_rozstrzygniecia >= dzienPlus(epizod.od, -DNI_BAZY)
        && t.data_rozstrzygniecia <= dzienPlus(epizod.do, OKNO_AKCJI);
  }) || null;
}

/** Układa kandydatów na przyczynę, od najmocniejszego dowodu. */
export function wyjasnij({ epizod, jednostka, lejek, akcje, kalendarz, testy, metryka = 'pobranie' }) {
  const zewnetrzne = zKalendarza(epizod, kalendarz);
  const kandydaci = [];

  const test = zTestu(epizod, testy, jednostka);
  if (test) kandydaci.push({
    typ: 'test', ...SILA.test,
    opis: `Rozstrzygnięty test „${test.wariant || test.id}" obejmuje ten okres. Losowy przydział to jedyny dowód przyczyny.`,
    zrodlo: test
  });

  const porownanie = porownanieNaturalne({ epizod, jednostka, lejek, metryka });
  if (porownanie) kandydaci.push({ typ: 'porownanie', ...SILA.porownanie, opis: porownanie.opis, zrodlo: porownanie });

  for (const a of akcjeWOknie(epizod, akcje, jednostka)) {
    kandydaci.push({
      typ: 'zbieznosc', ...SILA.zbieznosc,
      opis: `„${a.nazwa}" (${a.rodzaj}, ${a.wlasciciel}) wypadła ${a.data}, w oknie ${OKNO_AKCJI} dni przed zmianą. ` +
        'Zbieżność w czasie nie dowodzi przyczyny.',
      zrodlo: a
    });
  }

  return {
    wyjasnienieZewnetrzne: zewnetrzne,
    kandydaci: kandydaci.sort((a, b) => b.poziom - a.poziom),
    najmocniejszy: kandydaci.length ? kandydaci[0] : null
  };
}

/**
 * Propozycja skalowania: ile dałoby przeniesienie tego, co zadziałało,
 * na pozostałe jednostki. Z przedziałem, bo to szacunek, nie obietnica.
 */
export function propozycjaSkalowania({ epizod, jednostka, lejek, metryka = 'pobranie' }) {
  if (epizod.kierunek !== 'wzrost') return null;

  const pozostale = jednostki(lejek).filter(j =>
    j.operator && j.kanal === jednostka.kanal && j.operator !== jednostka.operator);
  if (!pozostale.length) return null;

  const dzienneTlo = pozostale.map(j => {
    const s = seria(lejek, { ...j, metryka });
    return srednia(s.slice(-DNI_BAZY).map(p => p.wartosc));
  });

  const efekt = epizod.zmianaProcent;
  const srodek = srednia(dzienneTlo) * pozostale.length * 30 * efekt;
  // Przedział z grubsza: efekt rzadko przenosi się w całości, więc od połowy do pełnego
  return {
    jednostki: pozostale.map(j => j.etykieta),
    efektProcent: efekt,
    miesiecznieOd: Math.round(srodek * 0.5),
    miesiecznieDo: Math.round(srodek),
    zastrzezenie: 'Szacunek zakłada, że efekt przeniesie się w połowie do całości. To nie jest obietnica, tylko rząd wielkości.'
  };
}

/**
 * Trwała zmiana poziomu. Wyskok i przesunięcie to dwie różne rzeczy i jeden
 * detektor nie wyłapie obu: wyskok wraca do normy, więc odstaje od bazy przez
 * cały czas trwania, a przesunięcie zostaje — po kilku dniach wchodzi do bazy
 * i przestaje odstawać, mimo że problem trwa dalej.
 *
 * Dlatego porównujemy ostatnie 7 dni z 28 dniami SPRZED tego okna. Baza nie
 * jest wtedy zanieczyszczona zmianą, której szukamy.
 */
export function wykryjPrzesuniecia(serie, {
  oknoDni = OKNO_PRZESUNIECIA, dniBazy = DNI_BAZY, minZmiana = MIN_PRZESUNIECIE
} = {}) {
  const flagi = serie.map((punkt, i) => {
    if (i + 1 < dniBazy + oknoDni) return { ...punkt, zmiana: 0, sygnal: 0 };
    const okno = serie.slice(i - oknoDni + 1, i + 1).map(p => p.wartosc);
    const baza = serie.slice(i - oknoDni + 1 - dniBazy, i - oknoDni + 1).map(p => p.wartosc);
    const poziomOkna = mediana(okno), poziomBazy = mediana(baza);
    const zmiana = poziomBazy ? (poziomOkna - poziomBazy) / poziomBazy : 0;
    return {
      ...punkt, poziomOkna, poziomBazy, zmiana,
      sygnal: Math.abs(zmiana) >= minZmiana ? Math.sign(zmiana) : 0
    };
  });

  const epizody = [];
  let biezacy = null;
  for (let i = 0; i < flagi.length; i++) {
    const p = flagi[i];
    if (p.sygnal !== 0 && (!biezacy || biezacy.kierunek === p.sygnal)) {
      if (!biezacy) {
        // Okno sięga wstecz, więc zmiana zaczęła się przed dniem sygnału.
        // Za początek bierzemy dzień największego skoku wewnątrz okna —
        // to on wskazuje akcję, która mogła tę zmianę wywołać.
        const kandydaci = flagi.slice(Math.max(0, i - oknoDni + 1), i + 1);
        let poczatek = kandydaci[0].data, najwiekszy = 0;
        for (let k = 1; k < kandydaci.length; k++) {
          const skok = (kandydaci[k].wartosc - kandydaci[k - 1].wartosc) * p.sygnal;
          if (skok > najwiekszy) { najwiekszy = skok; poczatek = kandydaci[k].data; }
        }
        biezacy = { od: poczatek, kierunek: p.sygnal, punkty: [] };
      }
      biezacy.punkty.push(p);
      biezacy.do = p.data;
    } else if (biezacy) {
      epizody.push(biezacy);
      biezacy = null;
    }
  }
  if (biezacy) epizody.push(biezacy);

  return epizody.map(e => ({
    rodzaj: 'przesuniecie',
    od: e.od, do: e.do, dni: e.punkty.length,
    kierunek: e.kierunek > 0 ? 'wzrost' : 'spadek',
    sredniaWEpizodzie: mediana(e.punkty.map(p => p.poziomOkna)),
    bazaSrednia: mediana(e.punkty.map(p => p.poziomBazy)),
    roznicaDzienna: mediana(e.punkty.map(p => p.poziomOkna - p.poziomBazy)),
    zmianaProcent: mediana(e.punkty.map(p => p.zmiana)),
    maxZ: null
  }));
}

/** Pełny raport kokpitu. Jedna funkcja, bo tak najłatwiej go przetestować. */
export function kokpit({ lejek, akcje = [], kalendarz = [], testy = [], metryka = 'pobranie', opcje = {} }) {
  const obserwowane = jednostki(lejek);
  const znaleziska = [];

  for (const j of obserwowane) {
    const s = seria(lejek, { ...j, metryka });
    const epizody = [...wykryjEpizody(s, opcje), ...wykryjPrzesuniecia(s, opcje)];
    for (const epizod of epizody) {
      const w = wyjasnij({ epizod, jednostka: j, lejek, akcje, kalendarz, testy, metryka });
      znaleziska.push({
        jednostka: j, epizod, ...w,
        skalowanie: w.najmocniejszy && w.najmocniejszy.poziom >= SILA.porownanie.poziom
          ? propozycjaSkalowania({ epizod, jednostka: j, lejek, metryka })
          : null
      });
    }
  }

  // Jedno zdarzenie bywa widziane przez oba detektory. Zostawiamy mocniejszy
  // opis i notujemy, że oba się zgodziły — zgodność sama w sobie coś znaczy.
  const scalone = [];
  for (const z of znaleziska) {
    const blizniak = scalone.find(s =>
      s.jednostka.etykieta === z.jednostka.etykieta &&
      s.epizod.kierunek === z.epizod.kierunek &&
      s.epizod.od <= z.epizod.do && z.epizod.od <= s.epizod.do);
    if (!blizniak) { scalone.push({ ...z, potwierdzonyDrugimDetektorem: false }); continue; }
    blizniak.potwierdzonyDrugimDetektorem = true;
    if (Math.abs(z.epizod.zmianaProcent) > Math.abs(blizniak.epizod.zmianaProcent)) {
      const { potwierdzonyDrugimDetektorem, ...reszta } = blizniak;
      Object.assign(blizniak, z, { potwierdzonyDrugimDetektorem: true });
    }
  }
  scalone.sort((a, b) =>
    b.epizod.do.localeCompare(a.epizod.do) ||
    Math.abs(b.epizod.roznicaDzienna) - Math.abs(a.epizod.roznicaDzienna));
  znaleziska.length = 0;
  znaleziska.push(...scalone);

  return {
    metryka,
    dni: [...new Set(lejek.map(w => w.data))].length,
    znaleziska,
    podsumowanie: {
      zmian: znaleziska.length,
      zWyjasnieniemZewnetrznym: znaleziska.filter(z => z.wyjasnienieZewnetrzne.length).length,
      zMocnymDowodem: znaleziska.filter(z => z.najmocniejszy?.poziom >= SILA.porownanie.poziom).length
    }
  };
}
