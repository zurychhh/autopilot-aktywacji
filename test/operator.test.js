import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { zrodloCsv } from '../lib/datasource.js';
import {
  operatorzy, dopasujOperatora, stanTygodnia, rekomendacja,
  faktyDoBriefu, briefDoMaila, DNI_TYGODNIA
} from '../lib/operator.js';

let lejek, akcje;
before(async () => {
  const z = zrodloCsv();
  lejek = await z.getFunnelDaily();
  akcje = await z.getActionsLog();
});

describe('Rozpoznawanie operatora', () => {
  test('zna czterech operatorów z danych', () => {
    assert.deepEqual(operatorzy(lejek), ['Orange', 'Play', 'Plus', 'T-Mobile']);
  });

  test('dopasowanie nie przejmuje się wielkością liter ani myślnikiem', () => {
    assert.equal(dopasujOperatora(lejek, 'play'), 'Play');
    assert.equal(dopasujOperatora(lejek, 'T-MOBILE'), 'T-Mobile');
    assert.equal(dopasujOperatora(lejek, 'tmobile'), 'T-Mobile');
  });

  test('nieznana nazwa daje null, a nie przypadkowego operatora', () => {
    assert.equal(dopasujOperatora(lejek, 'Vectra'), null);
    assert.equal(dopasujOperatora(lejek, ''), null);
  });
});

describe('Stan tygodnia', () => {
  test('obejmuje dokładnie siedem ostatnich dni', () => {
    const s = stanTygodnia({ lejek, operator: 'Play' });
    const dni = [...new Set(lejek.map(w => w.data))].sort();
    assert.equal(s.okres.do, dni[dni.length - 1]);
    assert.equal(s.okres.od, dni[dni.length - DNI_TYGODNIA]);
  });

  test('porównuje z poprzednim tygodniem, nie z historią', () => {
    const s = stanTygodnia({ lejek, operator: 'Play' });
    assert.ok(s.doPierwszejWartosciPoprzednio > 0);
    assert.ok(Number.isFinite(s.zmianaTygodniowa));
  });

  test('wskazuje najlepszy inny kanał operatorski, nie siebie', () => {
    for (const op of operatorzy(lejek)) {
      const s = stanTygodnia({ lejek, operator: op });
      assert.notEqual(s.najlepszyInny, op);
      assert.ok(operatorzy(lejek).includes(s.najlepszyInny));
    }
  });

  test('operator po zmianie oferty wypada wyraźnie gorzej od reszty', () => {
    const play = stanTygodnia({ lejek, operator: 'Play' });
    assert.ok(play.doPierwszejWartosci < play.udzialNajlepszego * 0.8,
      `Play ${(play.doPierwszejWartosci * 100).toFixed(1)}% wobec najlepszego ${(play.udzialNajlepszego * 100).toFixed(1)}%`);
  });

  test('liczby kroków są spójne z lejkiem', () => {
    const s = stanTygodnia({ lejek, operator: 'Play' });
    assert.ok(s.kroki.start >= s.kroki.pobranie);
    assert.ok(s.kroki.pobranie >= s.kroki.konto);
    assert.ok(s.kroki.mapa >= s.kroki.d30);
  });
});

describe('Rekomendacja wspólnej akcji', () => {
  test('dla operatora po zmianie oferty wskazuje krok pobrania', () => {
    const s = stanTygodnia({ lejek, operator: 'Play' });
    const r = rekomendacja(s, { akcje });
    assert.equal(r.krok, 'pobranie');
    assert.match(r.tytul, /SMS/);
    assert.ok(r.osobTygodniowo > 50, `${r.osobTygodniowo} osób tygodniowo to za mało jak na tę różnicę`);
  });

  test('rekomendacja mówi, co robi każda strona', () => {
    const r = rekomendacja(stanTygodnia({ lejek, operator: 'Play' }), { akcje });
    assert.match(r.opis, /Wasz|Waszej|naszej|naszą/i,
      'propozycja ma być wspólna, a nie listą życzeń do partnera');
  });

  test('bez istotnej różnicy nie wymyślamy akcji na siłę', () => {
    const stan = { operator: 'X', najwiekszaRoznica: { roznica: 0.01, naKrok: 'konto', osobTygodniowo: 1 } };
    const r = rekomendacja(stan);
    assert.equal(r.krok, null);
    assert.equal(r.osobTygodniowo, 0);
    assert.match(r.tytul, /Bez pilnej akcji/);
  });

  test('brak porównania też nie kończy się wymyśloną akcją', () => {
    const r = rekomendacja({ operator: 'X', najwiekszaRoznica: null });
    assert.equal(r.krok, null);
  });
});

describe('Brief', () => {
  test('fakty dla modelu zawierają tylko policzone liczby', () => {
    const s = stanTygodnia({ lejek, operator: 'Play' });
    const f = faktyDoBriefu(s, rekomendacja(s, { akcje }));
    assert.match(f, /Operator: Play/);
    assert.match(f, /Okres: \d{4}-\d{2}-\d{2} do \d{4}-\d{2}-\d{2}/);
    assert.match(f, /Rekomendowana wspólna akcja:/);
  });

  test('wersja do maila powstaje bez AI i jest kompletna', () => {
    const s = stanTygodnia({ lejek, operator: 'Play' });
    const m = briefDoMaila(s, rekomendacja(s, { akcje }));
    assert.match(m, /Aktywacja Bezpiecznej Rodziny — Play/);
    assert.match(m, /aktywne subskrypcje: \d+/);
    assert.match(m, /Propozycja wspólnej akcji:/);
    assert.ok(!m.includes('undefined'));
  });

  test('mail zawsze mówi, że liczby są przykładowe', () => {
    for (const op of operatorzy(lejek)) {
      const s = stanTygodnia({ lejek, operator: op });
      assert.match(briefDoMaila(s, rekomendacja(s, { akcje })), /przykładowe/);
    }
  });

  test('akapit od AI trafia na początek, przed liczby', () => {
    const s = stanTygodnia({ lejek, operator: 'Play' });
    const m = briefDoMaila(s, rekomendacja(s, { akcje }), { opisAI: 'AKAPIT OD AI' });
    assert.ok(m.indexOf('AKAPIT OD AI') < m.indexOf('Liczby tygodnia'));
  });
});
