// Logika Autopilota Aktywacji. Wszystko tutaj jest czystą funkcją bez DOM,
// żeby te same obliczenia dało się sprawdzić testem w Node i użyć w przeglądarce.
// Zasada projektu: liczby liczy kod deterministycznie, AI pisze tylko treści.

// ---------- DANE WEJŚCIOWE ----------
export const CHANNELS = [
  { id: 'op', name: 'Operator (pakiet)', short: 'operator' },
  { id: 'own', name: 'Sprzedaż własna', short: 'sprzedaż własna' },
  { id: 'ret', name: 'Retail', short: 'retail' }
];

export const STAGES = [
  'Aktywna subskrypcja', 'Pobranie aplikacji', 'Założenie konta',
  'Dodanie bliskiego lub urządzenia', 'Pierwsze zobaczenie lokalizacji',
  'Aktywność w 7. dniu', 'Aktywność w 30. dniu'
];
export const STAGE_SHORT = ['Start', 'Pobranie', 'Konto', 'Bliski dodany', 'Mapa', '7. dzień', '30. dzień'];

/**
 * Czytelna nazwa jednostki obserwacji: kanał albo kanał z operatorem.
 * Jeden słownik dla całego projektu — kody w rodzaju „own” albo „op / Play”
 * są wygodne w kodzie i bezużyteczne na ekranie.
 */
export function etykietaJednostki({ kanal, operator = null } = {}) {
  const ch = CHANNELS.find(c => c.id === kanal);
  if (!ch) return operator ? `${kanal}: ${operator}` : String(kanal ?? '—');
  if (!operator) return ch.name;
  return `Operator: ${operator}`;
}

/** Indeks „Pierwsze zobaczenie lokalizacji” – koniec onboardingu, dalej jest zaangażowanie. */
export const ONB_LAST = 4;

/** Liczby startowe: 10 000 operator, 2 000 sprzedaż własna, 1 500 retail. */
export const DEFAULT_FUNNEL = Object.freeze({
  op: [10000, 3100, 2600, 1450, 1100, 780, 540],
  own: [2000, 1840, 1720, 1380, 1240, 1010, 820],
  ret: [1500, 1200, 1080, 900, 810, 620, 470]
});

export const cloneFunnel = () =>
  Object.fromEntries(Object.entries(DEFAULT_FUNNEL).map(([k, v]) => [k, [...v]]));

// ---------- KROK 1: DIAGNOZA ----------

/**
 * Straty na każdym kroku onboardingu, posortowane od największej w liczbach
 * bezwzględnych. Bezwzględnych, bo to one najbardziej przesuwają przychód:
 * 10% straty na kanale operatora waży więcej niż 10% na retailu.
 */
export function losses(funnel) {
  const out = [];
  for (const ch of CHANNELS) {
    const f = funnel[ch.id];
    for (let i = 0; i < ONB_LAST; i++) {
      out.push({ ch, from: i, to: i + 1, lost: Math.max(0, f[i] - f[i + 1]), rate: f[i] ? f[i + 1] / f[i] : 0 });
    }
  }
  return out.sort((a, b) => b.lost - a.lost);
}

/** Najlepszy wynik na danym kroku wśród kanałów – punkt odniesienia „da się lepiej”. */
export function bestRate(funnel, from) {
  return Math.max(...CHANNELS.map(ch => (funnel[ch.id][from] ? funnel[ch.id][from + 1] / funnel[ch.id][from] : 0)));
}

/** Udział klientów każdego kanału, którzy dochodzą do pierwszej wartości (mapy). */
export function firstValueRates(funnel) {
  return CHANNELS.map(ch => ({
    ch,
    rate: funnel[ch.id][0] ? funnel[ch.id][ONB_LAST] / funnel[ch.id][0] : 0
  }));
}

// ---------- KROK 2: PRAWDZIWA WARTOŚĆ ----------

/** Generator ze stałym ziarnem (mulberry32), żeby dane syntetyczne były powtarzalne. */
export function makeRng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BEHAVIOURS = [
  { id: 'notif', name: 'Pierwsze powiadomienie ze strefy w 7 dni' },
  { id: 'zone', name: 'Ustawienie strefy w 3 dni' },
  { id: 'fast', name: 'Mapa w ciągu 24 godzin od zakupu' },
  { id: 'two', name: 'Dwie lub więcej bliskich osób' }
];

/** Jawne założenia generatora. Na prawdziwych danych z BigQuery żadnego z nich nie ma. */
export const GEN = Object.freeze({
  zone: { op: 0.35, own: 0.55, ret: 0.45 },
  notifGivenZone: 0.8,
  fast: { op: 0.15, own: 0.6, ret: 0.5 },
  two: 0.3,
  multNotif: 1.35,
  multNo: 0.85
});

export const VALUE_SEED = 20261007;

/**
 * Dla osób, które doszły do mapy, porównuje aktywność w 30. dniu z danym
 * zachowaniem i bez niego. Zwraca zachowania posortowane po sile związku (lift).
 * To korelacja na danych syntetycznych, nie dowód – dowodem jest test z kroku 4.
 */
export function valueModel(funnel, seed = VALUE_SEED) {
  const rnd = makeRng(seed);
  const users = [];
  for (const ch of CHANNELS) {
    const f = funnel[ch.id];
    const nMap = f[ONB_LAST];
    if (!nMap) continue;
    // base dobrane tak, żeby średnia aktywność w 30. dniu wyszła jak w lejku
    const target = f[6] / nMap;
    const qn = GEN.zone[ch.id] * GEN.notifGivenZone;
    const base = target / (qn * GEN.multNotif + (1 - qn) * GEN.multNo);
    for (let i = 0; i < nMap; i++) {
      const zone = rnd() < GEN.zone[ch.id];
      const notif = zone && rnd() < GEN.notifGivenZone;
      const fast = rnd() < GEN.fast[ch.id];
      const two = rnd() < GEN.two;
      const p = Math.min(0.97, base * (notif ? GEN.multNotif : GEN.multNo) * (fast ? 1.04 : 0.99));
      users.push({ zone, notif, fast, two, d30: rnd() < p });
    }
  }
  return BEHAVIOURS.map(b => {
    const yes = users.filter(u => u[b.id]);
    const no = users.filter(u => !u[b.id]);
    const ry = yes.length ? yes.filter(u => u.d30).length / yes.length : 0;
    const rn = no.length ? no.filter(u => u.d30).length / no.length : 0;
    return { ...b, ry, rn, share: users.length ? yes.length / users.length : 0, lift: rn ? ry / rn : 0 };
  }).sort((a, b) => b.lift - a.lift);
}

// ---------- KROK 4: PLAN TESTU ----------

/** Istotność 5% dwustronnie i moc 80% – domyślny standard dla testu produktowego. */
export const Z_SIGNIFICANCE = 1.959964;
export const Z_POWER = 0.841621;

/** Liczebność jednej grupy dla porównania dwóch proporcji. */
export function nPerArm(p0, delta) {
  const z = Z_SIGNIFICANCE + Z_POWER;
  const p1 = Math.min(0.999, p0 + delta);
  return Math.ceil((z * z * (p0 * (1 - p0) + p1 * (1 - p1))) / (delta * delta));
}

const WEEKS_PER_MONTH = 4.33;

/**
 * Plan testu dla kanału operatora: ile osób na grupę, jak długo zapisy i kiedy wynik.
 * `stock` to zapas klientów bez pobrania, który skraca zapisy.
 */
export function testPlan({ funnel, mde = 0.03, arms = 2, stock = 0, measureWindow = 30, channel = 'op', p0: p0Zadane } = {}) {
  const f = funnel[channel];
  // Punkt odniesienia można podać z zewnątrz. Po wygranym teście obowiązuje
  // konwersja zwycięzcy, a nie pierwotna wartość z lejka — inaczej plan liczy
  // liczebność dla bazy, której już nie ma, i wychodzi za mała.
  const p0 = Number.isFinite(p0Zadane) && p0Zadane > 0 ? p0Zadane : (f[0] ? f[ONB_LAST] / f[0] : 0);
  const delta = Math.max(0.005, mde);
  const k = arms;
  const win = Math.max(7, measureWindow);
  const n = nPerArm(p0, delta);
  const total = n * (k + 1); // k wariantów plus kontrola
  const monthly = f[0] || 1;
  const weekly = monthly / WEEKS_PER_MONTH;
  const stockUse = Math.min(Math.max(0, stock), total);
  const weeks = Math.max(1, Math.ceil(Math.max(0, total - stockUse) / weekly));
  return { p0, mde: delta, k, n, total, weeks, days: weeks * 7 + win, stock: Math.max(0, stock), stockUse, win, monthly };
}

// ---------- KROK 5: WYNIK I DECYZJA ----------

/**
 * Test z dla dwóch proporcji z 95-procentowym przedziałem różnicy.
 * Przedział liczony na błędzie niepulowanym (opisuje różnicę),
 * statystyka z na pulowanym (testuje hipotezę zerową) – tak to się robi.
 */
export function zTest(c0, n0, c1, n1) {
  const p0 = c0 / n0;
  const p1 = c1 / n1;
  const d = p1 - p0;
  const se = Math.sqrt((p0 * (1 - p0)) / n0 + (p1 * (1 - p1)) / n1);
  const pooled = (c0 + c1) / (n0 + n1);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / n0 + 1 / n1));
  return { p0, p1, d, lo: d - Z_SIGNIFICANCE * se, hi: d + Z_SIGNIFICANCE * se, z: sePooled ? d / sePooled : 0 };
}

/** Hamulec: wzrost wypisań o ponad 0,5 pkt proc. zatrzymuje wariant niezależnie od wyniku. */
export const GUARDRAIL = 0.005;
/** Grupa mniejsza niż 95% planu to podgląd przed czasem, nie wynik końcowy. */
export const ENOUGH_FRACTION = 0.95;

/**
 * Próg dla podglądu przed osiągnięciem liczebności (Haybittle–Peto), odpowiada p < 0,003.
 * Zwykłe 95% na niepełnych grupach to podglądanie wyników: im częściej zaglądamy,
 * tym więcej fałszywych zwycięstw. Wysoki próg sprawia, że wcześniejsze przerwanie
 * testu prawie nie zmienia łącznego ryzyka pomyłki.
 */
export const INTERIM_Z = 3;

/** Reguły decyzji dla jednego wariantu względem kontroli. Kolejność ma znaczenie. */
export function classifyArm({ control, arm, requiredN }) {
  const t = zTest(control.conv, control.n, arm.conv, arm.n);
  const t24 = zTest(control.c24, control.n, arm.c24, arm.n);
  const outD = arm.out / arm.n - control.out / control.n;
  const enough = arm.n >= requiredN * ENOUGH_FRACTION && control.n >= requiredN * ENOUGH_FRACTION;

  let status, label;
  if (outD > GUARDRAIL) {
    // Hamulec zawsze pierwszy: wzrost wypisań unieważnia każdy wynik
    status = 'bad'; label = 'Zatrzymany przez hamulec';
  } else if (!enough) {
    // Podgląd przed czasem – rozstrzyga tylko bardzo mocny dowód
    if (t.d > 0 && t.z >= INTERIM_Z) { status = 'ok'; label = 'Wygrywa'; }
    else if (t.z <= -INTERIM_Z) { status = 'bad'; label = 'Szkodzi'; }
    else { status = 'warn'; label = 'Za wcześnie'; }
  } else if (t.lo > 0) { status = 'ok'; label = 'Wygrywa'; }
  else if (t.hi < 0) { status = 'bad'; label = 'Szkodzi'; }
  else { status = 'warn'; label = 'Bez rozstrzygnięcia'; }

  return { arm, t, t24, outD, enough, status, label };
}

/**
 * Ocena całego testu. Zwycięzca to wariant ze statusem „wygrywa” i największą
 * różnicą; efekt miesięczny liczony ostrożnie także od dolnej granicy przedziału.
 */
export function evaluate({ results, plan }) {
  const control = results[0];
  const items = results
    .slice(1, plan.k + 1)
    .filter(r => r.n > 0 && control.n > 0)
    .map(arm => classifyArm({ control, arm, requiredN: plan.n }));

  const winner = items.filter(i => i.status === 'ok').sort((a, b) => b.t.d - a.t.d)[0] || null;
  const monthly = plan.monthly;

  if (winner) {
    return {
      status: 'ok', winner, items,
      extra: winner.t.d * monthly,
      extraLo: Math.max(0, winner.t.lo) * monthly,
      others: items.filter(i => i !== winner && i.status !== 'ok').length
    };
  }
  const early = items.some(i => i.status === 'warn' && !i.enough);
  return { status: early ? 'warn' : 'bad', winner: null, items, extra: 0, extraLo: 0, others: 0 };
}

/** Wyniki testu – przykładowe, oznaczone tak na ekranie. */
export const SAMPLE_RESULTS = Object.freeze([
  { name: 'Kontrola', n: 1904, conv: 213, c24: 76, out: 3 },
  { name: 'Wariant A', n: 1904, conv: 240, c24: 97, out: 6 },
  { name: 'Wariant B', n: 1904, conv: 307, c24: 215, out: 10 }
]);

// ---------- PĘTLA TESTÓW: PUNKT ODNIESIENIA (etap 12) ----------

/**
 * Stała grupa trzymana na pierwotnej ścieżce. Nie dostaje żadnego wariantu —
 * nigdy, nawet zwycięskiego. Bez niej po kilku obrotach pętli nie da się
 * powiedzieć, ile łącznie dołożyły wszystkie wdrożenia razem: każdy test
 * mierzy się tylko z poprzednim baseline'em, a błędy się kumulują.
 */
export const UDZIAL_HOLDOUT = 0.05;

/** Decyzja wynikająca z oceny wariantu. Jedno miejsce, żeby reguła nie uciekła do widoku. */
export function decyzjaZOceny(ocena) {
  if (!ocena) return { decyzja: 'czekac', zmieniaBaseline: false, powod: 'Brak oceny.' };
  switch (ocena.label) {
    case 'Wygrywa':
      return { decyzja: 'wdrozyc', zmieniaBaseline: true, powod: 'Dolna granica przedziału nad zerem przy pełnej liczebności.' };
    case 'Szkodzi':
      return { decyzja: 'odrzucic', zmieniaBaseline: false, powod: 'Górna granica przedziału poniżej zera.' };
    case 'Zatrzymany przez hamulec':
      return { decyzja: 'odrzucic', zmieniaBaseline: false, powod: 'Wypisania wzrosły powyżej progu, wynik nie ma znaczenia.' };
    case 'Bez rozstrzygnięcia':
      return { decyzja: 'odrzucic', zmieniaBaseline: false, powod: 'Przedział obejmuje zero przy pełnej liczebności; bierzemy kolejny pomysł.' };
    case 'Za wcześnie':
      return { decyzja: 'czekac', zmieniaBaseline: false, powod: 'Grupy mniejsze niż w planie, dowód za słaby.' };
    default:
      return { decyzja: 'czekac', zmieniaBaseline: false, powod: `Nieznany status: ${ocena.label}.` };
  }
}

/**
 * Porównanie wariantu z punktem odniesienia. Oba muszą pochodzić z TEGO SAMEGO
 * okresu — porównanie z liczbą sprzed pół roku mierzy sezon i zmiany w produkcie,
 * nie nasz wariant. Funkcja odmawia zamiast cicho policzyć bzdurę.
 */
export function porownajZBaseline({ baseline, wariant }) {
  if (!baseline?.okres || !wariant?.okres) {
    throw new Error('Porównanie wymaga okresu po obu stronach.');
  }
  if (baseline.okres !== wariant.okres) {
    throw new Error(
      `Porównanie tylko w tym samym okresie: baseline "${baseline.okres}" wobec wariantu "${wariant.okres}". ` +
      'Punkt odniesienia mierzy się równolegle, nie z historii.'
    );
  }
  return zTest(baseline.conv, baseline.n, wariant.conv, wariant.n);
}

/**
 * Składa historię testów w aktualny punkt odniesienia.
 * Zwycięski wariant staje się nowym baseline'em; każdy inny wynik zostawia
 * baseline bez zmian, a kolejny test bierze następny pomysł z listy.
 */
export function stanPetli(testy = []) {
  const posortowane = [...testy].sort((a, b) =>
    String(a.data_rozstrzygniecia || '').localeCompare(String(b.data_rozstrzygniecia || '')));

  let baseline = {
    id: 'baseline-00',
    nazwa: 'Pierwotna ścieżka onboardingu',
    odKtoregoTestu: null,
    konwersja: null // pierwotną bierzemy z lejka; po wygranej z rejestru testów
  };
  const historia = [];

  for (const t of posortowane) {
    const zmienia = t.decyzja === 'wdrozyc';
    historia.push({
      test: t,
      baselinePrzed: baseline.id,
      zmieniaBaseline: zmienia,
      uzasadnienie: t.uzasadnienie_decyzji || '',
      dlaczegoTenTest: t.dlaczego_ten_test || ''
    });
    if (zmienia) {
      const konwersja = Number(t.konwersja_wariantu);
      baseline = {
        id: t.id,
        nazwa: t.wariant || t.id,
        odKtoregoTestu: t.id,
        konwersja: Number.isFinite(konwersja) && konwersja > 0 ? konwersja : null
      };
    }
  }

  return {
    baseline,
    historia,
    liczbaZmian: historia.filter(h => h.zmieniaBaseline).length,
    rozstrzygniete: historia.filter(h => h.test.status === 'rozstrzygniety').length
  };
}

/**
 * Skumulowany efekt wszystkich wdrożeń razem: aktualna ścieżka wobec grupy
 * trzymanej na pierwotnej. To jedyna liczba, która nie kumuluje błędów
 * kolejnych testów, bo nie przechodzi przez żaden pośredni baseline.
 */
export function efektSkumulowany({ aktualna, holdout }) {
  const t = zTest(holdout.conv, holdout.n, aktualna.conv, aktualna.n);
  return {
    ...t,
    udzialHoldout: UDZIAL_HOLDOUT,
    istotny: t.lo > 0,
    opis: t.lo > 0
      ? `Wszystkie wdrożenia razem dały ${(t.d * 100).toFixed(1)} pkt proc. wobec pierwotnej ścieżki.`
      : 'Łączny efekt wdrożeń nie odróżnia się jeszcze od pierwotnej ścieżki.'
  };
}

/**
 * Plan następnego testu. Liczebność liczy kod; uzasadnienie pisze człowiek
 * albo AI — tutaj jest tylko miejsce na nie, nigdy wyliczona treść.
 */
export function planNastepnegoTestu({ funnel, pomysl, baseline, baselineId, mde = 0.03 }) {
  // Liczebność liczy się od AKTUALNEGO punktu odniesienia. Po wygranym teście
  // baza jest wyższa niż pierwotna wartość z lejka, a im wyższa baza, tym
  // więcej osób trzeba, żeby wykryć ten sam przyrost w punktach procentowych.
  const plan = testPlan({ funnel, mde, arms: 2, p0: baseline?.konwersja });
  return {
    baseline_id: baseline?.id ?? baselineId,
    baseline_nazwa: baseline?.nazwa ?? baselineId ?? 'Pierwotna ścieżka onboardingu',
    baseline_konwersja: plan.p0,
    wariant: pomysl?.nazwa || 'do uzupełnienia',
    hipoteza: pomysl?.hipoteza || '',
    dlaczego_ten_test: pomysl?.dlaczego || '',
    liczebnosc_planowana: plan.n,
    razem_osob: plan.total,
    tygodnie_zapisow: plan.weeks,
    dni_do_wyniku: plan.days,
    status: 'zaplanowany'
  };
}
