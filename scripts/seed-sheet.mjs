// Generator danych wejściowych dla prototypu.
//
// Tworzy cztery pliki CSV w data/. Te same pliki wkleja się do zakładek arkusza
// Google, jeśli ktoś woli źródło "sheets" — kolumny są identyczne.
//
// Dwie zasady, od których zależy wiarygodność całej reszty:
//
// 1. OSTATNIE 30 DNI SUMUJE SIĘ DOKŁADNIE DO TABELI WEJŚCIOWEJ. To ten miesiąc
//    pokazuje krok 1 prototypu, więc liczby muszą się zgadzać co do sztuki.
//    Wcześniejsze dni mają swobodę i to tam mieszkają trendy.
// 2. ZIARNO JEST STAŁE. Ten sam plik przy każdym uruchomieniu, inaczej testy
//    nie mogłyby niczego pilnować.
//
// Wbudowane są trzy zdarzenia do wykrycia przez kokpit (etap 7):
//   A. spadek pobrań u jednego operatora po zmianie jego oferty — suma kanału
//      się nie zmienia, bo pozostali operatorzy nadrabiają; widać to dopiero
//      w rozbiciu na operatorów, nie w zbiorczej liczbie
//   B. wzrost po kampanii z dziennika akcji
//   C. sezonowy skok na początku roku szkolnego

import { writeFileSync, mkdirSync } from 'node:fs';
import { makeRng, DEFAULT_FUNNEL, CHANNELS } from '../public/logic.js';

const DZIS = new Date('2026-10-07T00:00:00Z');
const DNI = 90;
const OKNO_DOKLADNE = 30; // tyle ostatnich dni sumuje się do tabeli wejściowej

const KROKI = ['start', 'pobranie', 'konto', 'bliski', 'mapa', 'd7', 'd30'];
const OPERATORZY = ['Play', 'Orange', 'T-Mobile', 'Plus'];
const UDZIAL_OPERATOROW = { Play: 0.34, Orange: 0.26, 'T-Mobile': 0.22, Plus: 0.18 };

const dataISO = (przesuniecie) => {
  const d = new Date(DZIS);
  d.setUTCDate(d.getUTCDate() - przesuniecie);
  return d.toISOString().slice(0, 10);
};

/** Dni od najstarszego do najnowszego; indeks 0 to najstarszy. */
const DNI_LISTA = Array.from({ length: DNI }, (_, i) => dataISO(DNI - 1 - i));
const W_OKNIE = (iso) => DNI_LISTA.indexOf(iso) >= DNI - OKNO_DOKLADNE;

// ---------- zdarzenia wbudowane w dane ----------
const ZMIANA_OFERTY_PLAY = dataISO(18);  // A: w oknie dokładnym
const KAMPANIA_WLASNA = dataISO(11);     // B: w oknie dokładnym
const ROK_SZKOLNY = '2026-09-01';        // C: poza oknem dokładnym

/**
 * Mnożnik dla danego dnia, kanału, operatora i KROKU lejka.
 *
 * Krok ma znaczenie, bo zdarzenia nie działają na wszystko po równo:
 * zmiana oferty operatora nie zmniejsza liczby aktywnych subskrypcji — ludzie
 * nadal mają usługę w pakiecie — tylko psuje konwersję na pobranie. Gdyby
 * mnożnik szedł na wszystkie kroki naraz, konwersja zostałaby bez zmian
 * i problem byłby niewidoczny tam, gdzie najbardziej boli.
 */
function mnoznik(iso, kanal, operator, rnd, krok) {
  let m = 1;

  // Dzień tygodnia: w weekend mniej aktywacji na każdym kroku
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  if (dow === 0 || dow === 6) m *= 0.82;

  // A. Zmiana oferty psuje konwersję na pobranie i wszystko dalej,
  //    ale nie rusza liczby aktywnych subskrypcji
  if (kanal === 'op' && operator === 'Play' && iso >= ZMIANA_OFERTY_PLAY && krok > 0) m *= 0.62;

  // B. Kampania sprzedażowa przyciąga NOWYCH klientów, więc działa od samej
  //    góry lejka. Mailing do istniejącej bazy nie miałby tu czego poprawić:
  //    w sprzedaży własnej aplikację pobiera już 92 procent klientów.
  if (kanal === 'own' && iso >= KAMPANIA_WLASNA && iso < dataISO(6)) m *= 1.45;

  // C. Początek roku szkolnego: więcej ludzi w ogóle kupuje, więc wszystkie kroki
  if (iso >= ROK_SZKOLNY && iso <= '2026-09-07') m *= 1.5;

  return m * (0.92 + rnd() * 0.16); // szum ±8%
}

/**
 * Rozdziela `suma` na `wagi` z SUFITEM na każdą pozycję. Sufitem jest wartość
 * poprzedniego kroku lejka — nikt nie pobierze aplikacji, nie mając subskrypcji.
 *
 * Nadmiar z pozycji, które uderzyły w sufit, wraca do puli i rozchodzi się
 * między pozostałe. Bez tego trzeba było przycinać wartości po rozdziale,
 * co psuło zgodność sum z tabelą wejściową.
 */
function rozdzielZSufitem(suma, wagi, sufity) {
  const wynik = wagi.map(() => 0);
  let doRozdania = Math.min(suma, sufity.reduce((a, b) => a + b, 0));
  const otwarte = new Set(wagi.map((_, i) => i).filter(i => sufity[i] > 0));

  // Kilka przebiegów: po każdym część pozycji dobija do sufitu i wypada z puli
  for (let przebieg = 0; przebieg < 20 && doRozdania > 0 && otwarte.size; przebieg++) {
    const indeksy = [...otwarte];
    const czesci = rozdziel(doRozdania, indeksy.map(i => wagi[i]));
    let rozdane = 0;
    for (let k = 0; k < indeksy.length; k++) {
      const i = indeksy[k];
      const ile = Math.min(czesci[k], sufity[i] - wynik[i]);
      wynik[i] += ile;
      rozdane += ile;
      if (wynik[i] >= sufity[i]) otwarte.delete(i);
    }
    doRozdania -= rozdane;
    if (rozdane === 0) break; // nie ma gdzie dołożyć
  }

  // Reszta po całkowitym podziale trafia tam, gdzie jeszcze jest miejsce
  for (const i of [...otwarte]) {
    if (doRozdania <= 0) break;
    const ile = Math.min(doRozdania, sufity[i] - wynik[i]);
    wynik[i] += ile;
    doRozdania -= ile;
  }
  return wynik;
}

/**
 * Rozdziela `suma` na `wagi` tak, żeby części były całkowite i sumowały się
 * dokładnie do `suma` (metoda największych reszt).
 */
function rozdziel(suma, wagi) {
  const lacznie = wagi.reduce((a, b) => a + b, 0);
  if (lacznie === 0) return wagi.map(() => 0);
  const dokladne = wagi.map(w => (w / lacznie) * suma);
  const dolne = dokladne.map(Math.floor);
  let brakuje = suma - dolne.reduce((a, b) => a + b, 0);
  const kolejnosc = dokladne
    .map((d, i) => ({ i, reszta: d - Math.floor(d) }))
    .sort((a, b) => b.reszta - a.reszta);
  for (let k = 0; k < brakuje; k++) dolne[kolejnosc[k % kolejnosc.length].i]++;
  return dolne;
}

function generujLejek() {
  const rnd = makeRng(20261007);
  // klucz: `${iso}|${kanal}|${operator}` → { start, pobranie, ... }
  const wiersze = new Map();
  const klucz = (iso, kanal, op) => `${iso}|${kanal}|${op}`;

  for (const kanal of CHANNELS.map(c => c.id)) {
    const cele = DEFAULT_FUNNEL[kanal];
    const jednostki = kanal === 'op' ? OPERATORZY : [''];

    KROKI.forEach((krok, i) => {
      // Wagi liczone osobno dla każdego kroku, bo zdarzenia działają na kroki
      // różnie — na tym polega różnica między spadkiem sprzedaży a spadkiem
      // konwersji, a kokpit ma je od siebie odróżnić.
      const pary = [];
      for (const iso of DNI_LISTA) {
        for (const op of jednostki) {
          const bazowa = kanal === 'op' ? UDZIAL_OPERATOROW[op] : 1;
          pary.push({ iso, op, waga: bazowa * mnoznik(iso, kanal, op, rnd, i) });
        }
      }

      const wOknie = pary.filter(p => W_OKNIE(p.iso));
      const pozaOknem = pary.filter(p => !W_OKNIE(p.iso));

      // Okno dokładne: rozdzielamy dokładnie cel z tabeli wejściowej, ale żadna
      // pozycja nie może przebić poprzedniego kroku lejka
      const sufity = wOknie.map(p => {
        if (i === 0) return Number.MAX_SAFE_INTEGER;
        return wiersze.get(klucz(p.iso, kanal, p.op))?.[KROKI[i - 1]] ?? 0;
      });
      const czesci = rozdzielZSufitem(cele[i], wOknie.map(p => p.waga), sufity);
      wOknie.forEach((p, j) => {
        const k = klucz(p.iso, kanal, p.op);
        if (!wiersze.has(k)) wiersze.set(k, { data: p.iso, kanal, operator: p.op });
        wiersze.get(k)[krok] = czesci[j];
      });

      // Poza oknem: ta sama skala dzienna, ale bez wymuszania sumy
      const skala = cele[i] / OKNO_DOKLADNE;
      pozaOknem.forEach(p => {
        const k = klucz(p.iso, kanal, p.op);
        if (!wiersze.has(k)) wiersze.set(k, { data: p.iso, kanal, operator: p.op });
        const udzial = kanal === 'op' ? UDZIAL_OPERATOROW[p.op] : 1;
        const sufit = i === 0 ? Number.MAX_SAFE_INTEGER : (wiersze.get(k)[KROKI[i - 1]] ?? 0);
        wiersze.get(k)[krok] = Math.min(sufit, Math.max(0, Math.round(skala * udzial * (p.waga / (udzial || 1)))));
      });
    });
  }

  return [...wiersze.values()].sort((a, b) =>
    a.data.localeCompare(b.data) || a.kanal.localeCompare(b.kanal) || a.operator.localeCompare(b.operator));
}

const DZIENNIK_AKCJI = [
  { data: ROK_SZKOLNY, kanal: 'wszystkie', operator: '', rodzaj: 'kampania', nazwa: 'Powrót do szkoły: mailing i social', wlasciciel: 'Marketing Locon', uwagi: 'Start roku szkolnego, najwyższy sezon' },
  { data: KAMPANIA_WLASNA, kanal: 'own', operator: '', rodzaj: 'kampania', nazwa: 'Kampania sprzedażowa: Bezpieczna Rodzina dla rodzin', wlasciciel: 'Marketing Locon', uwagi: 'Pięć dni płatnej promocji w kanale własnym' },
  { data: ZMIANA_OFERTY_PLAY, kanal: 'op', operator: 'Play', rodzaj: 'zmiana_oferty', nazwa: 'Play przenosi usługę do droższego pakietu', wlasciciel: 'Partner', uwagi: 'Zmiana po stronie operatora, poza kontrolą Locon' },
  { data: dataISO(45), kanal: 'ret', operator: '', rodzaj: 'proces', nazwa: 'Nowy skrypt sprzedażowy w salonach', wlasciciel: 'Sprzedaż', uwagi: 'Wdrożenie stopniowe' },
  { data: dataISO(30), kanal: 'op', operator: '', rodzaj: 'produkt', nazwa: 'Skrócenie formularza rejestracji o dwa pola', wlasciciel: 'Produkt', uwagi: 'Dotyczy wszystkich kanałów, najmocniej operatora' }
];

const KALENDARZ = [
  { data_od: '2026-09-01', data_do: '2026-09-07', rodzaj: 'rok_szkolny', nazwa: 'Początek roku szkolnego', wplyw: 'wysoki' },
  { data_od: '2026-07-01', data_do: '2026-08-31', rodzaj: 'wakacje', nazwa: 'Wakacje letnie', wplyw: 'sredni' },
  { data_od: '2026-09-16', data_do: '2026-09-16', rodzaj: 'premiera_os', nazwa: 'Premiera iOS', wplyw: 'sredni' },
  { data_od: '2026-10-05', data_do: '2026-10-05', rodzaj: 'premiera_os', nazwa: 'Premiera Androida', wplyw: 'sredni' },
  { data_od: '2026-10-31', data_do: '2026-11-02', rodzaj: 'ferie', nazwa: 'Dni wolne', wplyw: 'niski' }
];

const TESTY = [
  {
    id: 'onb-op-najpierw-wartosc-01',
    kanal: 'op',
    operator: '',
    hipoteza: 'Klient z pakietem, który zobaczy bliskiego bez instalowania aplikacji, częściej dojdzie do pierwszej wartości.',
    dlaczego_ten_test: 'Największa strata w lejku to 6900 osób miesięcznie na kroku Start → Pobranie w kanale operatora. Te osoby nie mają aplikacji, więc push do nich nie dotrze.',
    baseline_id: 'baseline-00',
    wariant: 'B: najpierw wartość, mapa bez aplikacji',
    liczebnosc_planowana: 1904,
    status: 'rozstrzygniety',
    decyzja: 'wdrozyc',
    // Konwersja wariantu, który wygrał. Bez niej plan następnego testu liczyłby
    // liczebność od pierwotnej wartości z lejka, a nie od obowiązującej bazy.
    konwersja_wariantu: (307 / 1904).toFixed(4),
    uzasadnienie_decyzji: 'Wzrost o 4,9 pkt proc. z przedziałem od 2,8 do 7,1; dolna granica nad zerem przy pełnej liczebności.',
    data_rozstrzygniecia: dataISO(3)
  }
];

// ---------- zapis ----------
const csv = (naglowki, wiersze) => [
  naglowki.join(','),
  ...wiersze.map(w => naglowki.map(h => {
    const v = w[h] ?? '';
    return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  }).join(','))
].join('\n') + '\n';

const KATALOG = new URL('../data/', import.meta.url);
mkdirSync(KATALOG, { recursive: true });

const pliki = {
  'funnel_daily.csv': csv(['data', 'kanal', 'operator', ...KROKI], generujLejek()),
  'actions_log.csv': csv(['data', 'kanal', 'operator', 'rodzaj', 'nazwa', 'wlasciciel', 'uwagi'], DZIENNIK_AKCJI),
  'calendar.csv': csv(['data_od', 'data_do', 'rodzaj', 'nazwa', 'wplyw'], KALENDARZ),
  'tests.csv': csv(['id', 'kanal', 'operator', 'hipoteza', 'dlaczego_ten_test', 'baseline_id', 'wariant', 'liczebnosc_planowana', 'status', 'decyzja', 'konwersja_wariantu', 'uzasadnienie_decyzji', 'data_rozstrzygniecia'], TESTY)
};

for (const [nazwa, tresc] of Object.entries(pliki)) {
  writeFileSync(new URL(nazwa, KATALOG), tresc);
  console.log(`${nazwa}: ${tresc.split('\n').length - 2} wierszy`);
}
