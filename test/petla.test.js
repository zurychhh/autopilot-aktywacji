import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  decyzjaZOceny, porownajZBaseline, stanPetli, efektSkumulowany,
  planNastepnegoTestu, UDZIAL_HOLDOUT, cloneFunnel, classifyArm, testPlan
} from '../public/logic.js';

const funnel = cloneFunnel();
/** Porównanie liczb z tolerancją — udziały są zmiennoprzecinkowe. */
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b} (±${eps})`);
const plan = testPlan({ funnel, mde: 0.03, arms: 2 });

/** Wygodne budowanie ocen o konkretnym statusie. */
const ocena = (control, arm) => classifyArm({ control, arm, requiredN: plan.n });
const pelna = (conv, out = 3) => ({ n: 1904, conv, c24: 80, out });

describe('Decyzja wynikająca z oceny', () => {
  test('„wygrywa” przesuwa punkt odniesienia', () => {
    const d = decyzjaZOceny(ocena(pelna(213), pelna(307)));
    assert.equal(d.decyzja, 'wdrozyc');
    assert.equal(d.zmieniaBaseline, true);
  });

  test('„bez rozstrzygnięcia” zostawia baseline i bierze kolejny pomysł', () => {
    const d = decyzjaZOceny(ocena(pelna(213), pelna(240)));
    assert.equal(d.decyzja, 'odrzucic');
    assert.equal(d.zmieniaBaseline, false);
    assert.match(d.powod, /kolejny pomysł/);
  });

  test('„szkodzi” zostawia baseline', () => {
    const d = decyzjaZOceny(ocena(pelna(307), pelna(213)));
    assert.equal(d.decyzja, 'odrzucic');
    assert.equal(d.zmieniaBaseline, false);
  });

  test('hamulec zostawia baseline, nawet gdy wynik był lepszy', () => {
    const d = decyzjaZOceny(ocena(pelna(213, 3), pelna(307, 30)));
    assert.equal(d.decyzja, 'odrzucic');
    assert.equal(d.zmieniaBaseline, false);
    assert.match(d.powod, /wynik nie ma znaczenia/);
  });

  test('„za wcześnie” to czekanie, nie odrzucenie', () => {
    const maly = (conv) => ({ n: 400, conv, c24: 20, out: 1 });
    const d = decyzjaZOceny(ocena(maly(45), maly(48)));
    assert.equal(d.decyzja, 'czekac');
    assert.equal(d.zmieniaBaseline, false);
  });

  test('brak oceny nie wywraca pętli', () => {
    assert.equal(decyzjaZOceny(null).decyzja, 'czekac');
    assert.equal(decyzjaZOceny({ label: 'coś nowego' }).decyzja, 'czekac');
  });
});

describe('Porównanie tylko w tym samym okresie', () => {
  const okres = '2026-09';

  test('ten sam okres przechodzi i liczy różnicę', () => {
    const w = porownajZBaseline({
      baseline: { okres, conv: 213, n: 1904 },
      wariant: { okres, conv: 307, n: 1904 }
    });
    assert.ok(Math.abs(w.d * 100 - 4.94) < 0.01);
  });

  test('porównanie z historią jest odrzucane, a nie liczone po cichu', () => {
    assert.throws(
      () => porownajZBaseline({
        baseline: { okres: '2026-03', conv: 180, n: 1904 },
        wariant: { okres: '2026-09', conv: 307, n: 1904 }
      }),
      /tym samym okresie/
    );
  });

  test('brak okresu też jest odrzucany', () => {
    assert.throws(() => porownajZBaseline({ baseline: { conv: 1, n: 2 }, wariant: { okres: 'x', conv: 1, n: 2 } }), /wymaga okresu/);
  });
});

describe('Stan pętli: historia i aktualny baseline', () => {
  const t = (id, decyzja, data, wariant) => ({
    id, decyzja, data_rozstrzygniecia: data, wariant, status: 'rozstrzygniety',
    uzasadnienie_decyzji: `uzasadnienie ${id}`, dlaczego_ten_test: `dlaczego ${id}`
  });

  test('pusta historia zostawia pierwotną ścieżkę', () => {
    const s = stanPetli([]);
    assert.equal(s.baseline.id, 'baseline-00');
    assert.equal(s.liczbaZmian, 0);
  });

  test('zwycięski test staje się nowym punktem odniesienia', () => {
    const s = stanPetli([t('t1', 'wdrozyc', '2026-09-01', 'B: najpierw wartość')]);
    assert.equal(s.baseline.id, 't1');
    assert.equal(s.baseline.nazwa, 'B: najpierw wartość');
    assert.equal(s.liczbaZmian, 1);
  });

  test('odrzucony test nie rusza punktu odniesienia', () => {
    const s = stanPetli([t('t1', 'wdrozyc', '2026-09-01', 'B'), t('t2', 'odrzucic', '2026-09-20', 'C')]);
    assert.equal(s.baseline.id, 't1', 'baseline ma zostać przy zwycięzcy');
    assert.equal(s.historia.length, 2);
  });

  test('kolejne zwycięstwo przesuwa baseline dalej', () => {
    const s = stanPetli([
      t('t1', 'wdrozyc', '2026-09-01', 'B'),
      t('t2', 'odrzucic', '2026-09-20', 'C'),
      t('t3', 'wdrozyc', '2026-10-01', 'D')
    ]);
    assert.equal(s.baseline.id, 't3');
    assert.equal(s.liczbaZmian, 2);
  });

  test('historia jest w kolejności rozstrzygnięć, niezależnie od kolejności wejścia', () => {
    const s = stanPetli([t('t3', 'wdrozyc', '2026-10-01', 'D'), t('t1', 'wdrozyc', '2026-09-01', 'B')]);
    assert.deepEqual(s.historia.map(h => h.test.id), ['t1', 't3']);
    assert.equal(s.baseline.id, 't3');
  });

  test('każdy wpis historii niesie uzasadnienie decyzji i powód podjęcia testu', () => {
    const [h] = stanPetli([t('t1', 'wdrozyc', '2026-09-01', 'B')]).historia;
    assert.equal(h.uzasadnienie, 'uzasadnienie t1');
    assert.equal(h.dlaczegoTenTest, 'dlaczego t1');
    assert.equal(h.baselinePrzed, 'baseline-00');
  });

  test('czekający test nie przesuwa baseline', () => {
    const s = stanPetli([{ id: 't1', decyzja: 'czekac', data_rozstrzygniecia: '', status: 'trwa' }]);
    assert.equal(s.baseline.id, 'baseline-00');
    assert.equal(s.rozstrzygniete, 0);
  });
});

describe('Efekt skumulowany wobec grupy trzymanej', () => {
  test('grupa trzymana to 5 procent', () => {
    assert.equal(UDZIAL_HOLDOUT, 0.05);
  });

  test('wyraźna poprawa wobec pierwotnej ścieżki jest rozpoznana', () => {
    const e = efektSkumulowany({ aktualna: { conv: 620, n: 3000 }, holdout: { conv: 165, n: 1500 } });
    assert.equal(e.istotny, true);
    assert.ok(e.d > 0);
    assert.match(e.opis, /Wszystkie wdrożenia razem/);
  });

  test('brak różnicy nie jest ogłaszany jako sukces', () => {
    const e = efektSkumulowany({ aktualna: { conv: 330, n: 3000 }, holdout: { conv: 165, n: 1500 } });
    assert.equal(e.istotny, false);
    assert.match(e.opis, /nie odróżnia się/);
  });
});

describe('Plan następnego testu', () => {
  const pierwotny = { id: 'baseline-00', nazwa: 'Pierwotna ścieżka onboardingu', konwersja: null };
  const poWygranej = { id: 't1', nazwa: 'B: najpierw wartość', konwersja: 307 / 1904 };

  test('liczebność liczy kod, nie AI', () => {
    const p = planNastepnegoTestu({ funnel, baseline: pierwotny, pomysl: { nazwa: 'C: prośba do bliskiego' } });
    assert.equal(p.liczebnosc_planowana, 1904);
    assert.equal(p.razem_osob, 1904 * 3);
    assert.equal(p.status, 'zaplanowany');
  });

  test('po wygranym teście liczebność rośnie, bo baza jest wyższa', () => {
    // Pierwotna baza to 11% z lejka, ale wariant B dowiózł 16,1%. Plan liczony
    // od starej bazy byłby o jedną czwartą za mały, a test skończyłby się
    // bez rozstrzygnięcia przy prawdziwej różnicy.
    const p = planNastepnegoTestu({ funnel, baseline: poWygranej, mde: 0.03 });
    close(p.baseline_konwersja, 307 / 1904, 1e-9);
    assert.equal(p.liczebnosc_planowana, 2529);
    assert.ok(p.liczebnosc_planowana > 1904 * 1.25,
      `${p.liczebnosc_planowana} to za mało jak na bazę ${(p.baseline_konwersja * 100).toFixed(1)}%`);
  });

  test('plan pokazuje nazwę punktu odniesienia, nie identyfikator', () => {
    const p = planNastepnegoTestu({ funnel, baseline: poWygranej });
    assert.equal(p.baseline_nazwa, 'B: najpierw wartość');
    assert.equal(p.baseline_id, 't1');
  });

  test('baseline bez zapisanej konwersji wraca do wartości z lejka', () => {
    const p = planNastepnegoTestu({ funnel, baseline: pierwotny });
    close(p.baseline_konwersja, 0.11, 1e-9);
  });

  test('stan pętli przenosi konwersję zwycięzcy do punktu odniesienia', () => {
    const s = stanPetli([{
      id: 't1', decyzja: 'wdrozyc', data_rozstrzygniecia: '2026-09-01',
      wariant: 'B', status: 'rozstrzygniety', konwersja_wariantu: 0.1612
    }]);
    close(s.baseline.konwersja, 0.1612, 1e-9);

    // Plan złożony z tego stanu liczy już od nowej bazy
    const p = planNastepnegoTestu({ funnel, baseline: s.baseline });
    assert.ok(p.liczebnosc_planowana > 2400);
  });

  test('brak pomysłu zostawia puste miejsce, nie zmyśloną treść', () => {
    const p = planNastepnegoTestu({ funnel, baseline: pierwotny });
    assert.equal(p.hipoteza, '');
    assert.equal(p.dlaczego_ten_test, '');
    assert.equal(p.wariant, 'do uzupełnienia');
  });

  test('mniejszy wzrost do wykrycia wymaga większych grup', () => {
    const a = planNastepnegoTestu({ funnel, baseline: pierwotny, mde: 0.03 });
    const b = planNastepnegoTestu({ funnel, baseline: pierwotny, mde: 0.01 });
    assert.ok(b.liczebnosc_planowana > a.liczebnosc_planowana);
  });
});
