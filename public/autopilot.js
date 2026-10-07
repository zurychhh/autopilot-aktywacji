// Autopilot testów — symulacja, nie produkcja.
//
// Leży w public/, a nie w lib/, bo liczy się w przeglądarce. Dzięki temu
// strona /autopilot działa bez funkcji serwerowych i bez jednego wywołania
// AI — cała pętla to deterministyczny kod, który każdy może przeliczyć sam.
//
// Pokazuje, jak wyglądałaby pętla, gdyby przydział do wariantów robił algorytm,
// a nie człowiek raz na kwartał. Dwie rzeczy są w niej nienaruszalne:
//
//   1. GRUPA KONTROLNA NIGDY NIE DOSTAJE WARIANTU. Stałe 10% zostaje na
//      pierwotnej ścieżce przez cały czas trwania symulacji. Bez niej po
//      kilkunastu tygodniach nie da się powiedzieć, ile dołożyła cała pętla.
//   2. HAMULEC WYPRZEDZA WYNIK. Wariant, który podnosi wypisania powyżej progu,
//      wypada natychmiast, choćby miał najlepszą konwersję.
//
// Przydział robi próbkowanie Thompsona: dla każdego wariantu losujemy wartość
// z rozkładu beta opisującego naszą obecną niepewność i wysyłamy klienta do
// tego, który wylosował najwięcej. Wariant obiecujący dostaje więcej ruchu,
// ale żaden nie jest wykluczany na podstawie kilku obserwacji.

import { zTest } from './logic.js';

export const UDZIAL_KONTROLI = 0.10;
export const PROG_HAMULCA = 0.005;        // wzrost wypisań o 0,5 pkt proc.
export const MIN_OBSERWACJI_HAMULCA = 500; // zanim hamulec w ogóle się odzywa

/** Deterministyczny generator — ta sama symulacja przy każdym uruchomieniu. */
export function generator(ziarno = 20261007) {
  let s = ziarno;
  const losuj = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Rozkład normalny metodą Boxa-Mullera. */
  const normalny = () => {
    const u = Math.max(losuj(), 1e-12), v = losuj();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /** Rozkład gamma metodą Marsaglii i Tsanga. Potrzebny do rozkładu beta. */
  const gamma = (k) => {
    if (k < 1) return gamma(k + 1) * Math.pow(Math.max(losuj(), 1e-12), 1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = normalny();
      const v = Math.pow(1 + c * x, 3);
      if (v <= 0) continue;
      const u = losuj();
      if (u < 1 - 0.0331 * x ** 4) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };

  /** Rozkład beta — nasza niepewność co do skuteczności wariantu. */
  const beta = (a, b) => {
    const x = gamma(a), y = gamma(b);
    return x + y === 0 ? 0.5 : x / (x + y);
  };

  return { losuj, beta };
}

/** Jeden wariant w symulacji: co umie naprawdę i co o tym dotąd wiemy. */
function nowyWariant({ id, nazwa, skutecznosc, wypisania, odTygodnia = 0, rodzic = null, zmiana = null }) {
  return {
    id, nazwa, skutecznosc, wypisania, odTygodnia, rodzic, zmiana,
    aktywny: true, wylaczonyW: null, powodWylaczenia: null,
    n: 0, sukcesy: 0, wypisani: 0
  };
}

const udzialWypisan = (w) => (w.n ? w.wypisani / w.n : 0);

/**
 * Hamulec. Dwa warunki naraz, bo każdy z osobna zawodzi:
 *
 *   * różnica MUSI przekroczyć próg 0,5 pkt proc. — inaczej wyłączalibyśmy
 *     warianty za szum na drugim miejscu po przecinku,
 *   * i musi być istotna, czyli dolna granica przedziału ufności nad zerem.
 *
 * Przy bazie wypisań rzędu 0,2% samo porównanie odsetków wywalało wszystko:
 * dwa wypisania na 282 osoby to 0,71%, choć prawdziwa wartość wynosiła 0,32%.
 * To ta sama pułapka, co przy ocenie wariantów przed osiągnięciem liczebności.
 */
export function hamulecZadzialal(wariant, kontrola) {
  if (wariant.n < MIN_OBSERWACJI_HAMULCA || kontrola.n < MIN_OBSERWACJI_HAMULCA) return false;
  const t = zTest(kontrola.wypisani, kontrola.n, wariant.wypisani, wariant.n);
  return t.d > PROG_HAMULCA && t.lo > 0;
}

/**
 * Symulacja tygodnia po tygodniu.
 *
 * @param {object} opcje
 * @param {Array}  opcje.zalozenia  warianty z zakładki założeń: skuteczność i wypisania
 * @param {number} opcje.tygodnie
 * @param {number} opcje.naTydzien  ilu klientów wpada tygodniowo
 * @param {Function} opcje.pretendent  (zwyciezca, tydzien) → nowy wariant albo null
 */
export function symuluj({
  zalozenia,
  tygodnie = 12,
  naTydzien = 500,
  ziarno = 20261007,
  pretendent = null
} = {}) {
  const { losuj, beta } = generator(ziarno);

  const kontrola = nowyWariant({ id: 'kontrola', nazwa: 'Kontrola: pierwotna ścieżka', ...zalozenia[0] });
  const warianty = zalozenia.slice(1).map(z => nowyWariant(z));
  const log = [];
  const osCzasu = [];

  for (let tydzien = 1; tydzien <= tygodnie; tydzien++) {
    const aktywne = warianty.filter(w => w.aktywny);

    for (let i = 0; i < naTydzien; i++) {
      // Grupa kontrolna wybierana PRZED jakimkolwiek przydziałem do wariantów
      if (losuj() < UDZIAL_KONTROLI || aktywne.length === 0) {
        obsluzKlienta(kontrola, losuj);
        continue;
      }
      // Próbkowanie Thompsona: wygrywa wariant z najwyższym losowaniem
      let najlepszy = aktywne[0], najlepszaProba = -1;
      for (const w of aktywne) {
        const proba = beta(1 + w.sukcesy, 1 + (w.n - w.sukcesy));
        if (proba > najlepszaProba) { najlepszaProba = proba; najlepszy = w; }
      }
      obsluzKlienta(najlepszy, losuj);
    }

    // Hamulec sprawdzamy co tydzień, przed jakąkolwiek decyzją o wynikach
    for (const w of warianty.filter(w => w.aktywny)) {
      if (hamulecZadzialal(w, kontrola)) {
        w.aktywny = false; w.wylaczonyW = tydzien; w.powodWylaczenia = 'hamulec';
        log.push({
          tydzien, rodzaj: 'hamulec', wariant: w.id,
          uzasadnienie: `Wypisania ${(udzialWypisan(w) * 100).toFixed(2)}% wobec ${(udzialWypisan(kontrola) * 100).toFixed(2)}% w kontroli. ` +
            'Próg 0,5 pkt proc. przekroczony, wynik konwersji nie ma znaczenia.'
        });
      }
    }

    // Co tydzień wypada najsłabszy, o ile jest z czego wybierać
    const zywe = warianty.filter(w => w.aktywny && w.n >= MIN_OBSERWACJI_HAMULCA);
    if (zywe.length >= 2) {
      const najslabszy = zywe.reduce((a, b) => (a.sukcesy / a.n <= b.sukcesy / b.n ? a : b));
      najslabszy.aktywny = false; najslabszy.wylaczonyW = tydzien; najslabszy.powodWylaczenia = 'najslabszy';
      log.push({
        tydzien, rodzaj: 'wylaczenie', wariant: najslabszy.id,
        uzasadnienie: `Najniższa konwersja w tygodniu: ${(najslabszy.sukcesy / najslabszy.n * 100).toFixed(1)}% ` +
          `przy ${najslabszy.n} obserwacjach. Miejsce zwalnia się dla nowego pretendenta.`
      });
    }

    // Nowy pretendent: zmienia JEDEN element zwycięzcy, w zatwierdzonych ramach
    const zwyciezca = warianty.filter(w => w.aktywny && w.n)
      .sort((a, b) => b.sukcesy / b.n - a.sukcesy / a.n)[0];
    if (pretendent && zwyciezca) {
      const nowy = pretendent(zwyciezca, tydzien);
      if (nowy) {
        warianty.push(nowyWariant({ ...nowy, odTygodnia: tydzien, rodzic: zwyciezca.id }));
        log.push({
          tydzien, rodzaj: 'pretendent', wariant: nowy.id,
          uzasadnienie: `Nowy pretendent z banku pomysłów: zmienia „${nowy.zmiana}" w zwycięzcy „${zwyciezca.nazwa}". ` +
            'Jeden element naraz, bo inaczej nie wiadomo, co zadziałało.'
        });
      }
    }

    osCzasu.push({
      tydzien,
      kontrola: migawka(kontrola),
      warianty: warianty.map(migawka),
      lacznie: kontrola.n + warianty.reduce((a, w) => a + w.n, 0)
    });
  }

  return {
    osCzasu, log,
    kontrola: migawka(kontrola),
    warianty: warianty.map(migawka),
    ustawienia: { tygodnie, naTydzien, udzialKontroli: UDZIAL_KONTROLI, progHamulca: PROG_HAMULCA },
    zastrzezenie: `Symulacja przepuszcza ${naTydzien} klientów tygodniowo. Przy prawdziwym napływie ` +
      'pętla jest wolniejsza: pierwszy wiarygodny wynik to kwestia tygodni, nie minut.'
  };
}

function obsluzKlienta(wariant, losuj) {
  wariant.n++;
  if (losuj() < wariant.skutecznosc) wariant.sukcesy++;
  if (losuj() < wariant.wypisania) wariant.wypisani++;
}

const migawka = (w) => ({
  id: w.id, nazwa: w.nazwa, aktywny: w.aktywny, odTygodnia: w.odTygodnia,
  rodzic: w.rodzic, zmiana: w.zmiana,
  wylaczonyW: w.wylaczonyW, powodWylaczenia: w.powodWylaczenia,
  n: w.n, sukcesy: w.sukcesy, wypisani: w.wypisani,
  konwersja: w.n ? w.sukcesy / w.n : 0,
  udzialWypisan: udzialWypisan(w)
});

/** Założenia domyślne: skuteczności wariantów do symulacji. Jawne, nie ukryte w kodzie. */
export const ZALOZENIA = [
  { id: 'kontrola', nazwa: 'Kontrola: pierwotna ścieżka', skutecznosc: 0.110, wypisania: 0.0016 },
  { id: 'A', nazwa: 'A: SMS, najpierw aplikacja', skutecznosc: 0.126, wypisania: 0.0032 },
  { id: 'B', nazwa: 'B: najpierw wartość, mapa bez aplikacji', skutecznosc: 0.161, wypisania: 0.0052 },
  { id: 'C', nazwa: 'C: nachalne przypomnienia co 12 godzin', skutecznosc: 0.168, wypisania: 0.0190 }
];

/** Zatwierdzone ramy: elementy, które pretendent może zmienić. */
export const RAMY_ZMIAN = [
  'nagłówek karty RCS', 'godzina wysyłki', 'pierwsze zdanie SMS-a',
  'treść przycisku', 'kolejność ekranów po kliknięciu'
];

/**
 * Pretendent z banku pomysłów: jedna zmiana naraz, brana z RAMY_ZMIAN.
 * Nazwa mówi wprost, skąd pochodzi — to stała lista zatwierdzonych elementów,
 * a nie model. Podpis „od AI" byłby obietnicą, której ten kod nie spełnia.
 */
export function pretendentZBankuPomyslow(losuj = Math.random) {
  let licznik = 0;
  return (zwyciezca, tydzien) => {
    if (tydzien % 2 !== 0) return null; // nowy pretendent co drugi tydzień
    const zmiana = RAMY_ZMIAN[licznik % RAMY_ZMIAN.length];
    licznik++;
    return {
      id: `${zwyciezca.id}-${licznik}`,
      nazwa: `${zwyciezca.nazwa} + zmiana: ${zmiana}`,
      zmiana,
      // Pretendent jest wariacją zwycięzcy: trochę lepszy albo trochę gorszy
      skutecznosc: Math.max(0.05, zwyciezca.skutecznosc * (0.94 + losuj() * 0.14)),
      wypisania: zwyciezca.wypisania * (0.9 + losuj() * 0.3)
    };
  };
}
