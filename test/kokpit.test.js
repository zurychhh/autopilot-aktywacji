import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { zrodloCsv } from '../lib/datasource.js';
import {
  kokpit, seria, jednostki, wykryjEpizody, wykryjPrzesuniecia,
  mediana, mad, SILA, propozycjaSkalowania
} from '../lib/kokpit.js';
import { etykietaJednostki } from '../public/logic.js';

/** Etykiety bierzemy ze słownika, żeby testy nie wiązały się z napisem. */
const PLAY = etykietaJednostki({ kanal: 'op', operator: 'Play' });
const OPERATOR = etykietaJednostki({ kanal: 'op' });
const WLASNA = etykietaJednostki({ kanal: 'own' });

let dane, raport;
before(async () => {
  const z = zrodloCsv();
  dane = {
    lejek: await z.getFunnelDaily(),
    akcje: await z.getActionsLog(),
    kalendarz: await z.getCalendar(),
    testy: await z.getTests()
  };
  raport = kokpit(dane);
});

/** Znajduje znalezisko po jednostce i kierunku. */
const znajdz = (etykieta, kierunek) =>
  raport.znaleziska.find(z => z.jednostka.etykieta === etykieta && z.epizod.kierunek === kierunek
    && z.epizod.od >= '2026-09-12');

describe('Statystyki odporne na wyskoki', () => {
  test('mediana nie daje się pociągnąć pojedynczej wartości', () => {
    assert.equal(mediana([1, 2, 3, 4, 100]), 3);
  });

  test('MAD też nie — i o to chodzi', () => {
    // Odchylenie standardowe tego zbioru to ponad 40; MAD zostaje przy 1,5
    assert.ok(mad([10, 11, 12, 13, 100]) < 3);
  });

  test('pusty i jednoelementowy zbiór nie wywracają obliczeń', () => {
    assert.equal(mediana([]), 0);
    assert.equal(mad([5]), 0);
  });
});

describe('Dwa detektory wykrywają dwie różne rzeczy', () => {
  const dni = (n, f) => Array.from({ length: n }, (_, i) => ({ data: `2026-01-${String(i + 1).padStart(2, '0')}`, wartosc: f(i) }));

  test('wyskok, który wraca do normy, łapie detektor wyskoków', () => {
    const s = dni(50, i => (i >= 35 && i < 40 ? 90 : 30 + (i % 3)));
    const w = wykryjEpizody(s);
    assert.ok(w.length >= 1, 'wyskok ma zostać wykryty');
    assert.equal(w[0].kierunek, 'wzrost');
    assert.equal(w[0].rodzaj, 'wyskok');
  });

  test('trwałe przesunięcie poziomu umyka detektorowi wyskoków', () => {
    // Po kilku dniach nowy poziom wchodzi do bazy i przestaje odstawać —
    // dokładnie dlatego potrzebny jest drugi detektor
    const s = dni(70, i => (i >= 40 ? 15 : 40 + (i % 3)));
    const wyskoki = wykryjEpizody(s);
    const przesuniecia = wykryjPrzesuniecia(s);
    assert.ok(przesuniecia.length >= 1, 'przesunięcie ma zostać wykryte');
    assert.equal(przesuniecia[0].kierunek, 'spadek');
    assert.ok(przesuniecia[0].dni > (wyskoki[0]?.dni || 0),
      'przesunięcie trwa dłużej niż to, co widzi detektor wyskoków');
  });

  test('spokojna seria nie daje żadnego sygnału', () => {
    const s = dni(70, i => 40 + (i % 3));
    assert.deepEqual(wykryjEpizody(s), []);
    assert.deepEqual(wykryjPrzesuniecia(s), []);
  });
});

describe('Trzy zdarzenia wbudowane w dane', () => {
  test('A: spadek u jednego operatora jest wykryty', () => {
    const z = znajdz(PLAY, 'spadek');
    assert.ok(z, 'spadek u Play musi zostać wykryty');
    assert.equal(z.epizod.od, '2026-09-19', 'początek ma wskazywać dzień zmiany oferty');
    assert.ok(z.epizod.zmianaProcent < -0.25, `spadek ${(z.epizod.zmianaProcent * 100).toFixed(0)}% ma być wyraźny`);
  });

  test('A: dowodem jest porównanie naturalne, nie zbieżność', () => {
    const z = znajdz(PLAY, 'spadek');
    assert.equal(z.najmocniejszy.typ, 'porownanie');
    assert.equal(z.najmocniejszy.poziom, SILA.porownanie.poziom);
    assert.match(z.najmocniejszy.opis, /pozostałych/);
    assert.match(z.najmocniejszy.opis, /nie rynek ani sezon/);
  });

  test('A: suma kanału operatora nie pokazuje tego spadku', () => {
    // To jest sedno zdarzenia: zbiorcza liczba milczy, bo pozostali nadrabiają
    assert.equal(znajdz(OPERATOR, 'spadek'), undefined,
      'gdyby kanał zbiorczo też spadał, zdarzenie nie pokazywałoby wartości rozbicia');
  });

  test('B: wzrost po kampanii jest wykryty i ma dowód ze zbieżności', () => {
    const z = znajdz(WLASNA, 'wzrost');
    assert.ok(z, 'wzrost w sprzedaży własnej musi zostać wykryty');
    assert.equal(z.najmocniejszy.typ, 'zbieznosc');
    assert.match(z.najmocniejszy.opis, /Kampania sprzedażowa/);
    assert.match(z.najmocniejszy.opis, /nie dowodzi przyczyny/);
  });

  test('B: kampanii nie przypisujemy mocniejszego dowodu niż ma', () => {
    const z = znajdz(WLASNA, 'wzrost');
    assert.ok(z.najmocniejszy.poziom < SILA.porownanie.poziom,
      'bez rozbicia na operatorów nie ma porównania naturalnego');
  });

  test('C: początek roku szkolnego tłumaczy się kalendarzem', () => {
    const wRoku = raport.znaleziska.filter(z =>
      z.epizod.od >= '2026-08-29' && z.epizod.od <= '2026-09-03' && z.epizod.kierunek === 'wzrost');
    assert.ok(wRoku.length >= 3, 'skok ma dotyczyć wielu kanałów naraz');
    for (const z of wRoku) {
      assert.ok(z.wyjasnienieZewnetrzne.some(k => k.rodzaj === 'rok_szkolny'),
        `${z.jednostka.etykieta}: brak wyjaśnienia kalendarzem`);
    }
  });

  test('C: skok dotyka wszystkich kanałów, więc to nie nasza zasługa', () => {
    const kanaly = new Set(raport.znaleziska
      .filter(z => z.epizod.od >= '2026-08-29' && z.epizod.od <= '2026-09-03')
      .map(z => z.jednostka.kanal));
    assert.ok(kanaly.size >= 3, 'wyjaśnienie zewnętrzne poznaje się po tym, że działa na wszystkich');
  });
});

describe('Siła dowodu nie jest zawyżana', () => {
  test('rozstrzygnięty test nie tłumaczy spadku', () => {
    for (const z of raport.znaleziska.filter(z => z.epizod.kierunek === 'spadek')) {
      assert.notEqual(z.najmocniejszy?.typ, 'test',
        `${z.jednostka.etykieta}: wdrożony wariant nie może tłumaczyć spadku`);
    }
  });

  test('test obejmujący cały kanał nie tłumaczy zmiany u jednego operatora', () => {
    for (const z of raport.znaleziska.filter(z => z.jednostka.operator)) {
      if (z.najmocniejszy?.typ !== 'test') continue;
      assert.equal(z.najmocniejszy.zrodlo.operator, z.jednostka.operator,
        'test bez wskazanego operatora ruszyłby wszystkich naraz');
    }
  });

  test('kandydaci są ułożeni od najmocniejszego dowodu', () => {
    for (const z of raport.znaleziska) {
      const poziomy = z.kandydaci.map(k => k.poziom);
      assert.deepEqual(poziomy, [...poziomy].sort((a, b) => b - a), z.jednostka.etykieta);
    }
  });

  test('każdy kandydat mówi, czym jest jego dowód', () => {
    for (const z of raport.znaleziska) {
      for (const k of z.kandydaci) {
        assert.ok(k.nazwa && k.opis, `${z.jednostka.etykieta}: kandydat bez opisu`);
      }
    }
  });
});

describe('Raport jako całość', () => {
  test('to samo zdarzenie nie jest raportowane dwa razy', () => {
    const klucze = raport.znaleziska.map(z => `${z.jednostka.etykieta}|${z.epizod.kierunek}|${z.epizod.od}`);
    assert.equal(new Set(klucze).size, klucze.length);
  });

  test('podsumowanie zgadza się ze znaleziskami', () => {
    assert.equal(raport.podsumowanie.zmian, raport.znaleziska.length);
    assert.equal(raport.podsumowanie.zWyjasnieniemZewnetrznym,
      raport.znaleziska.filter(z => z.wyjasnienieZewnetrzne.length).length);
  });

  test('jednostki obejmują kanały zbiorczo i operatorów osobno', () => {
    const j = jednostki(dane.lejek).map(x => x.etykieta);
    assert.ok(j.includes(OPERATOR) && j.includes(PLAY) && j.includes(WLASNA));
  });

  test('etykiety są czytelne, a nie kodami kanałów', () => {
    const j = jednostki(dane.lejek).map(x => x.etykieta);
    assert.ok(!j.some(e => ['op', 'own', 'ret'].includes(e)), `kody na ekranie: ${j.join(', ')}`);
    assert.ok(!j.some(e => e.includes(' / ')), 'ukośnik to zapis z kodu, nie nazwa');
    assert.deepEqual(
      jednostki(dane.lejek).filter(x => x.operator).map(x => x.etykieta).slice(0, 2),
      ['Operator: Orange', 'Operator: Play']
    );
  });

  test('seria sumuje operatorów, gdy pytamy o cały kanał', () => {
    const calosc = seria(dane.lejek, { kanal: 'op', metryka: 'pobranie' });
    const operatorzy = ['Play', 'Orange', 'T-Mobile', 'Plus']
      .map(o => seria(dane.lejek, { kanal: 'op', operator: o, metryka: 'pobranie' }));
    const dzien = calosc[40].data;
    const suma = operatorzy.reduce((a, s) => a + s.find(p => p.data === dzien).wartosc, 0);
    assert.equal(calosc[40].wartosc, suma);
  });

  test('pusty lejek nie wywraca raportu', () => {
    const r = kokpit({ lejek: [] });
    assert.equal(r.znaleziska.length, 0);
    assert.equal(r.podsumowanie.zmian, 0);
  });
});

describe('Propozycja skalowania', () => {
  test('powstaje tylko dla wzrostu', () => {
    const epizod = { kierunek: 'spadek', zmianaProcent: -0.3 };
    assert.equal(propozycjaSkalowania({ epizod, jednostka: { kanal: 'op', operator: 'Play' }, lejek: dane.lejek }), null);
  });

  test('podaje przedział, a nie jedną liczbę, i zastrzega, że to szacunek', () => {
    const p = propozycjaSkalowania({
      epizod: { kierunek: 'wzrost', zmianaProcent: 0.3 },
      jednostka: { kanal: 'op', operator: 'Play' },
      lejek: dane.lejek
    });
    assert.ok(p.miesiecznieDo > p.miesiecznieOd);
    assert.match(p.zastrzezenie, /nie jest obietnica/);
    assert.ok(p.jednostki.length >= 1);
  });
});
