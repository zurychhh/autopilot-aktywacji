import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneFunnel, losses, bestRate, firstValueRates, ONB_LAST, STAGE_SHORT,
  valueModel, nPerArm, testPlan, zTest, classifyArm, evaluate,
  GUARDRAIL, INTERIM_Z, SAMPLE_RESULTS
} from '../public/logic.js';

const funnel = cloneFunnel();
/** Porównanie liczb z tolerancją – przedziały ufności są zmiennoprzecinkowe. */
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b} (±${eps})`);

describe('Krok 1: diagnoza', () => {
  test('trzy największe straty to kroki kanału operatora', () => {
    const top3 = losses(funnel).slice(0, 3);
    assert.equal(top3.length, 3);
    assert.deepEqual(
      top3.map(l => `${l.ch.id} ${STAGE_SHORT[l.from]}→${STAGE_SHORT[l.to]} -${l.lost}`),
      ['op Start→Pobranie -6900', 'op Konto→Bliski dodany -1150', 'op Pobranie→Konto -500']
    );
  });

  test('największa strata to porzucenie przed pobraniem aplikacji', () => {
    const [worst] = losses(funnel);
    assert.equal(worst.ch.id, 'op');
    assert.equal(worst.from, 0);
    assert.equal(worst.lost, 6900);
    close(worst.rate, 0.31);
  });

  test('straty obejmują tylko onboarding, nie zaangażowanie po mapie', () => {
    assert.ok(losses(funnel).every(l => l.to <= ONB_LAST));
  });

  test('strata nie jest ujemna, gdy etap rośnie (dane wpisane ręcznie)', () => {
    const odd = cloneFunnel();
    odd.ret[2] = 2000; // więcej kont niż pobrań
    assert.ok(losses(odd).every(l => l.lost >= 0));
  });

  test('najlepszy kanał na kroku „Start → Pobranie” to sprzedaż własna', () => {
    close(bestRate(funnel, 0), 1840 / 2000);
  });

  test('do pierwszej wartości dochodzi 11% klientów operatora i 62% sprzedaży własnej', () => {
    const r = Object.fromEntries(firstValueRates(funnel).map(x => [x.ch.id, x.rate]));
    close(r.op, 0.11);
    close(r.own, 0.62);
    close(r.ret, 0.54);
  });

  test('puste wejście nie wywraca obliczeń', () => {
    const zero = { op: [0, 0, 0, 0, 0, 0, 0], own: [0, 0, 0, 0, 0, 0, 0], ret: [0, 0, 0, 0, 0, 0, 0] };
    assert.ok(losses(zero).every(l => l.lost === 0 && l.rate === 0));
    assert.equal(bestRate(zero, 0), 0);
    assert.ok(firstValueRates(zero).every(x => x.rate === 0));
  });
});

describe('Krok 2: prawdziwa wartość', () => {
  test('to samo ziarno daje ten sam wynik', () => {
    assert.deepEqual(valueModel(funnel), valueModel(funnel));
  });

  test('najsilniejszy związek z aktywnością w 30. dniu ma pierwsze powiadomienie', () => {
    const [best] = valueModel(funnel);
    assert.equal(best.id, 'notif');
    assert.ok(best.lift > 1.3, `lift ${best.lift} powinien być wyraźnie powyżej 1`);
    assert.ok(best.ry > best.rn);
  });

  test('zachowania bez wpływu w generatorze nie udają momentu aha', () => {
    const two = valueModel(funnel).find(b => b.id === 'two');
    assert.ok(Math.abs(two.lift - 1) < 0.1, `lift ${two.lift} powinien być blisko 1`);
  });

  test('udziały i wskaźniki mieszczą się w zakresie 0–1', () => {
    for (const b of valueModel(funnel)) {
      for (const k of ['share', 'ry', 'rn']) assert.ok(b[k] >= 0 && b[k] <= 1, `${b.id}.${k} = ${b[k]}`);
    }
  });
});

describe('Krok 4: plan testu', () => {
  test('przy 11% i wzroście do 14% potrzeba 1904 osób na grupę', () => {
    assert.equal(nPerArm(0.11, 0.03), 1904);
  });

  test('plan dla kanału operatora bierze punkt odniesienia z lejka', () => {
    const plan = testPlan({ funnel, mde: 0.03, arms: 2 });
    close(plan.p0, 0.11);
    assert.equal(plan.n, 1904);
    assert.equal(plan.total, 1904 * 3); // kontrola plus dwa warianty
  });

  test('mniejszy wzrost do wykrycia wymaga większych grup', () => {
    assert.ok(nPerArm(0.11, 0.01) > nPerArm(0.11, 0.03));
  });

  test('trzeci wariant wydłuża zapisy', () => {
    const dwa = testPlan({ funnel, arms: 2 });
    const trzy = testPlan({ funnel, arms: 3 });
    assert.ok(trzy.weeks >= dwa.weeks);
    assert.equal(trzy.total, trzy.n * 4);
  });

  test('zapas klientów skraca zapisy, ale nie poniżej tygodnia', () => {
    const bez = testPlan({ funnel, arms: 2, stock: 0 });
    const zZapasem = testPlan({ funnel, arms: 2, stock: 6000 });
    assert.ok(zZapasem.weeks < bez.weeks);
    assert.equal(testPlan({ funnel, arms: 2, stock: 999999 }).weeks, 1);
  });

  test('wynik jest po zapisach plus okno pomiaru', () => {
    const plan = testPlan({ funnel, arms: 2, measureWindow: 30 });
    assert.equal(plan.days, plan.weeks * 7 + 30);
  });

  test('okno pomiaru i wzrost do wykrycia mają dolne ograniczniki', () => {
    assert.equal(testPlan({ funnel, measureWindow: 1 }).win, 7);
    close(testPlan({ funnel, mde: 0 }).mde, 0.005);
  });
});

describe('Krok 5: wynik i decyzja', () => {
  const [kontrola, wariantA, wariantB] = SAMPLE_RESULTS;

  test('wariant B daje +4,9 pkt proc. z przedziałem od 2,8 do 7,1', () => {
    const t = zTest(kontrola.conv, kontrola.n, wariantB.conv, wariantB.n);
    close(t.d * 100, 4.94, 0.01);
    close(t.lo * 100, 2.76, 0.01);
    close(t.hi * 100, 7.11, 0.01);
    assert.ok(t.lo > 0, 'dolna granica nad zerem, więc wariant wygrywa');
  });

  test('wariant A nie rozstrzyga, bo przedział obejmuje zero', () => {
    const t = zTest(kontrola.conv, kontrola.n, wariantA.conv, wariantA.n);
    close(t.d * 100, 1.42, 0.01);
    assert.ok(t.lo < 0 && t.hi > 0);
  });

  test('brak różnicy daje przedział symetryczny wokół zera', () => {
    const t = zTest(200, 2000, 200, 2000);
    close(t.d, 0);
    close(t.z, 0);
    close(t.lo, -t.hi, 1e-12);
  });

  test('statystyka z jest zgodna ze znakiem różnicy', () => {
    assert.ok(zTest(213, 1904, 307, 1904).z > 0);
    assert.ok(zTest(307, 1904, 213, 1904).z < 0);
  });

  const plan = testPlan({ funnel, mde: 0.03, arms: 2 });

  test('przy pełnej liczebności wariant B wygrywa i to on jest decyzją', () => {
    const out = evaluate({ results: SAMPLE_RESULTS, plan });
    assert.equal(out.status, 'ok');
    assert.equal(out.winner.arm.name, 'Wariant B');
    assert.equal(out.items.find(i => i.arm.name === 'Wariant A').label, 'Bez rozstrzygnięcia');
  });

  test('efekt miesięczny liczy się od napływu i ostrożnie od dolnej granicy', () => {
    const out = evaluate({ results: SAMPLE_RESULTS, plan });
    close(out.extra, out.winner.t.d * 10000, 1e-6);
    close(out.extraLo, out.winner.t.lo * 10000, 1e-6);
    assert.ok(out.extraLo < out.extra);
  });

  test('hamulec zatrzymuje wariant, nawet gdy wynik jest lepszy', () => {
    const z = classifyArm({
      control: kontrola,
      arm: { ...wariantB, out: kontrola.out + Math.ceil(GUARDRAIL * wariantB.n) + 1 },
      requiredN: plan.n
    });
    assert.equal(z.status, 'bad');
    assert.equal(z.label, 'Zatrzymany przez hamulec');
    assert.ok(z.t.lo > 0, 'wynik był wygrywający, a jednak hamulec ma pierwszeństwo');
  });

  test('wzrost wypisań dokładnie o 0,5 pkt proc. jeszcze nie hamuje', () => {
    const n = 2000;
    const z = classifyArm({
      control: { n, conv: 220, c24: 80, out: 10 },
      arm: { n, conv: 221, c24: 80, out: 10 + GUARDRAIL * n },
      requiredN: 1904
    });
    assert.notEqual(z.label, 'Zatrzymany przez hamulec');
  });

  test('za małe grupy bez wyraźnej różnicy to „za wcześnie”, a nie brak wyniku', () => {
    const mały = [
      { name: 'Kontrola', n: 400, conv: 45, c24: 18, out: 1 },
      { name: 'Wariant A', n: 400, conv: 48, c24: 20, out: 1 },
      { name: 'Wariant B', n: 400, conv: 50, c24: 22, out: 1 }
    ];
    const out = evaluate({ results: mały, plan });
    assert.equal(out.status, 'warn');
    assert.ok(out.items.every(i => i.label === 'Za wcześnie'));
    assert.equal(out.winner, null);
  });

  // Przed osiągnięciem liczebności obowiązuje próg Haybittle–Peto. Zwykłe 95%
  // na niepełnych grupach to podglądanie wyników i zawyża fałszywe zwycięstwa.
  const polowa = { n: 952, c24: 40, out: 1 };

  test('przy połowie liczebności bardzo mocny dowód rozstrzyga', () => {
    const z = classifyArm({
      control: { ...polowa, conv: 107 },
      arm: { ...polowa, conv: 154 },
      requiredN: plan.n
    });
    assert.equal(z.enough, false);
    close(z.t.z, 3.132, 0.001);
    assert.ok(z.t.z >= INTERIM_Z);
    assert.equal(z.label, 'Wygrywa');
  });

  test('przy połowie liczebności sama istotność na 5% to za mało', () => {
    const z = classifyArm({
      control: { ...polowa, conv: 107 },
      arm: { ...polowa, conv: 140 },
      requiredN: plan.n
    });
    assert.equal(z.enough, false);
    close(z.t.z, 2.251, 0.001);
    assert.ok(z.t.lo > 0, 'po staremu byłby to już zwycięzca');
    assert.ok(z.t.z < INTERIM_Z);
    assert.equal(z.label, 'Za wcześnie');
  });

  test('przy połowie liczebności bardzo mocny dowód szkody też rozstrzyga', () => {
    const z = classifyArm({
      control: { ...polowa, conv: 154 },
      arm: { ...polowa, conv: 107 },
      requiredN: plan.n
    });
    assert.ok(z.t.z <= -INTERIM_Z);
    assert.equal(z.label, 'Szkodzi');
  });

  test('hamulec wyprzedza nawet bardzo mocny dowód przed czasem', () => {
    const z = classifyArm({
      control: { ...polowa, conv: 107 },
      arm: { ...polowa, conv: 154, out: 1 + Math.ceil(GUARDRAIL * polowa.n) + 1 },
      requiredN: plan.n
    });
    assert.equal(z.label, 'Zatrzymany przez hamulec');
  });

  test('przy pełnej liczebności wariant wyraźnie gorszy dostaje „szkodzi”', () => {
    const z = classifyArm({
      control: { n: 1904, conv: 307, c24: 215, out: 3 },
      arm: { n: 1904, conv: 213, c24: 76, out: 3 },
      requiredN: 1904
    });
    assert.equal(z.status, 'bad');
    assert.equal(z.label, 'Szkodzi');
  });

  test('przy dwóch wariantach trzeci nie jest oceniany', () => {
    const results = [...SAMPLE_RESULTS, { name: 'Wariant C', n: 1904, conv: 400, c24: 300, out: 3 }];
    assert.equal(evaluate({ results, plan }).items.length, 2);
    assert.equal(evaluate({ results, plan: testPlan({ funnel, arms: 3 }) }).items.length, 3);
  });

  test('puste grupy są pomijane, a nie dzielone przez zero', () => {
    const out = evaluate({ results: [{ ...kontrola }, { ...wariantB, n: 0 }], plan });
    assert.equal(out.items.length, 0);
    assert.equal(out.status, 'bad');
  });
});
