import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  symuluj, generator, hamulecZadzialal, pretendentZBankuPomyslow,
  ZALOZENIA, RAMY_ZMIAN, UDZIAL_KONTROLI, PROG_HAMULCA, MIN_OBSERWACJI_HAMULCA
} from '../public/autopilot.js';

const przebieg = (opcje = {}) => {
  const g = generator(opcje.ziarno || 1);
  return symuluj({ zalozenia: ZALOZENIA, tygodnie: 16, naTydzien: 1200, pretendent: pretendentZBankuPomyslow(g.losuj), ...opcje });
};

describe('Generator losowy', () => {
  test('to samo ziarno daje ten sam przebieg', () => {
    assert.deepEqual(przebieg().log, przebieg().log);
  });

  test('rozkład beta mieści się w zakresie od zera do jedynki', () => {
    const { beta } = generator(7);
    for (let i = 0; i < 300; i++) {
      const v = beta(1 + i % 20, 1 + (i * 3) % 30);
      assert.ok(v >= 0 && v <= 1, `beta zwróciła ${v}`);
    }
  });

  test('rozkład beta skupia się tam, gdzie wskazują obserwacje', () => {
    // 80 sukcesów na 100 prób — losowania mają krążyć wokół 0,8
    const { beta } = generator(11);
    const proby = Array.from({ length: 400 }, () => beta(81, 21));
    const srednia = proby.reduce((a, b) => a + b, 0) / proby.length;
    assert.ok(Math.abs(srednia - 0.8) < 0.03, `średnia ${srednia.toFixed(3)}`);
  });
});

describe('Grupa kontrolna jest nietykalna', () => {
  const w = przebieg();

  test('kontrola nigdy nie dostaje żadnego wariantu', () => {
    // Kontrola ma własny licznik i nie pojawia się na liście wariantów
    assert.equal(w.warianty.find(v => v.id === 'kontrola'), undefined);
    assert.ok(w.kontrola.n > 0);
  });

  test('kontrola dostaje mniej więcej zadeklarowane 10 procent ruchu', () => {
    const lacznie = w.kontrola.n + w.warianty.reduce((a, v) => a + v.n, 0);
    const udzial = w.kontrola.n / lacznie;
    assert.ok(Math.abs(udzial - UDZIAL_KONTROLI) < 0.02,
      `kontrola dostała ${(udzial * 100).toFixed(1)}%, a miała ${UDZIAL_KONTROLI * 100}%`);
  });

  test('konwersja kontroli trzyma się pierwotnej ścieżki przez cały czas', () => {
    // Gdyby kontrola kiedykolwiek dostała wariant, jej konwersja by odjechała
    assert.ok(Math.abs(w.kontrola.konwersja - ZALOZENIA[0].skutecznosc) < 0.015,
      `kontrola ma ${(w.kontrola.konwersja * 100).toFixed(1)}%, a założenie to ${ZALOZENIA[0].skutecznosc * 100}%`);
  });

  test('kontrola rośnie w każdym tygodniu, bo nigdy jej nie wyłączamy', () => {
    for (let i = 1; i < w.osCzasu.length; i++) {
      assert.ok(w.osCzasu[i].kontrola.n > w.osCzasu[i - 1].kontrola.n, `tydzień ${i + 1}`);
    }
  });
});

describe('Hamulec', () => {
  test('wyłącza wariant szkodzący, mimo najlepszej konwersji', () => {
    const w = przebieg();
    const szkodliwy = w.warianty.filter(v => v.powodWylaczenia === 'hamulec');
    assert.ok(szkodliwy.length >= 1, 'wariant z wysokimi wypisaniami musi zostać zatrzymany');
    for (const v of szkodliwy) {
      assert.ok(v.udzialWypisan > w.kontrola.udzialWypisan + PROG_HAMULCA,
        `${v.id}: ${(v.udzialWypisan * 100).toFixed(2)}% wobec kontroli ${(w.kontrola.udzialWypisan * 100).toFixed(2)}%`);
    }
  });

  test('zatrzymany wariant miał konwersję wyższą od kontroli — i to nie pomogło', () => {
    const w = przebieg();
    const v = w.warianty.find(x => x.powodWylaczenia === 'hamulec');
    assert.ok(v.konwersja > w.kontrola.konwersja,
      'sedno hamulca: lepszy wynik nie kupuje zgody na wyższe wypisania');
  });

  test('nie odzywa się przy małej liczbie obserwacji', () => {
    const kontrola = { n: 10_000, wypisani: 16 };
    const halasliwy = { n: MIN_OBSERWACJI_HAMULCA - 1, wypisani: 20 };
    assert.equal(hamulecZadzialal(halasliwy, kontrola), false);
  });

  test('nie wyłącza wariantu z nieistotnie wyższymi wypisaniami', () => {
    // 0,36 pkt proc. różnicy przy progu 0,5 pkt proc.
    const kontrola = { n: 20_000, wypisani: 32 };
    const lekkoGorszy = { n: 20_000, wypisani: 104 };
    assert.equal(hamulecZadzialal(lekkoGorszy, kontrola), false);
  });

  test('wyłącza, gdy różnica jest i duża, i istotna', () => {
    const kontrola = { n: 20_000, wypisani: 32 };
    const zly = { n: 20_000, wypisani: 380 };
    assert.equal(hamulecZadzialal(zly, kontrola), true);
  });

  test('log hamulca mówi, dlaczego wynik nie ma znaczenia', () => {
    const w = przebieg();
    const wpis = w.log.find(l => l.rodzaj === 'hamulec');
    assert.match(wpis.uzasadnienie, /wynik konwersji nie ma znaczenia/);
    assert.match(wpis.uzasadnienie, /0,5 pkt proc/);
  });
});

describe('Pretendenci z banku pomysłów', () => {
  test('zmieniają dokładnie jeden element i mówią który', () => {
    const w = przebieg();
    for (const v of w.warianty.filter(v => v.rodzic)) {
      assert.ok(RAMY_ZMIAN.includes(v.zmiana), `${v.id}: zmiana „${v.zmiana}" spoza ram`);
    }
  });

  test('każdy pretendent wywodzi się z wariantu, który istniał wcześniej', () => {
    const w = przebieg();
    for (const v of w.warianty.filter(v => v.rodzic)) {
      const rodzic = [...w.warianty, w.kontrola].find(x => x.id === v.rodzic);
      assert.ok(rodzic, `${v.id}: brak rodzica ${v.rodzic}`);
      assert.ok(rodzic.odTygodnia < v.odTygodnia || rodzic.odTygodnia === 0);
    }
  });

  test('log pretendenta tłumaczy, czemu zmiana jest jedna', () => {
    const w = przebieg();
    const wpis = w.log.find(l => l.rodzaj === 'pretendent');
    assert.match(wpis.uzasadnienie, /Jeden element naraz/);
  });

  test('log nie przypisuje pretendentów modelowi', () => {
    // Pochodzą z zamkniętej listy RAMY_ZMIAN, a nie od AI — podpis ma to oddawać
    const w = przebieg();
    for (const l of w.log.filter(l => l.rodzaj === 'pretendent')) {
      assert.match(l.uzasadnienie, /z banku pomysłów/);
      assert.ok(!/od AI/.test(l.uzasadnienie), l.uzasadnienie);
    }
  });
});

describe('Przebieg jako całość', () => {
  const w = przebieg();

  test('oś czasu ma wpis na każdy tydzień', () => {
    assert.equal(w.osCzasu.length, 16);
    assert.deepEqual(w.osCzasu.map(t => t.tydzien), Array.from({ length: 16 }, (_, i) => i + 1));
  });

  test('każda decyzja ma uzasadnienie', () => {
    assert.ok(w.log.length > 0);
    for (const l of w.log) {
      assert.ok(l.uzasadnienie && l.uzasadnienie.length > 20, `${l.rodzaj} ${l.wariant} bez uzasadnienia`);
    }
  });

  test('symulacja mówi wprost, że przy prawdziwym napływie jest wolniejsza', () => {
    assert.match(w.zastrzezenie, /wolniejsza/);
    assert.match(w.zastrzezenie, /tygodni/);
  });

  test('wyłączony wariant przestaje zbierać ruch', () => {
    const v = w.warianty.find(x => !x.aktywny && x.wylaczonyW < 14);
    const poWylaczeniu = w.osCzasu.slice(v.wylaczonyW);
    const stany = poWylaczeniu.map(t => t.warianty.find(x => x.id === v.id)?.n);
    assert.equal(new Set(stany).size, 1, `${v.id} zbierał ruch po wyłączeniu`);
  });

  test('bez pretendentów symulacja też działa', () => {
    const w2 = symuluj({ zalozenia: ZALOZENIA, tygodnie: 4, naTydzien: 300 });
    assert.equal(w2.osCzasu.length, 4);
    assert.ok(w2.kontrola.n > 0);
  });
});
