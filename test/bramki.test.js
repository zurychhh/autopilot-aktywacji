import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAMKI, POWODY, nowyStanBramek, zaakceptuj, odrzuc, opisPowodu,
  paczkaZablokowana, hipotezaDlaStraty, nastepnaHipoteza, kluczStraty,
  kartaOdrzuconejHipotezy,
  cofnij,
  WYJSCIA_DECYZJI,
  skutekDecyzji,
  POMYSLY_NA_TEST,
  nastepnyPomysl,
  POWOD_INNY_POMYSL
} from '../public/bramki.js';
import { cloneFunnel, losses } from '../public/logic.js';

const ZEGAR = { teraz: () => Date.parse('2026-10-13T10:00:00Z') };
const straty = losses(cloneFunnel()).slice(0, 3);

describe('Stan bramek', () => {
  test('na starcie wszystkie czekają', () => {
    const s = nowyStanBramek();
    assert.deepEqual(Object.keys(s).sort(), [...BRAMKI].sort());
    for (const b of BRAMKI) assert.equal(s[b].stan, 'czeka');
  });

  test('akceptacja zapisuje datę', () => {
    const s = zaakceptuj(nowyStanBramek(), 'hipoteza', ZEGAR);
    assert.equal(s.hipoteza.stan, 'zaakceptowana');
    assert.equal(s.hipoteza.data, '2026-10-13T10:00:00.000Z');
  });

  test('bramki są od siebie niezależne', () => {
    const s = zaakceptuj(nowyStanBramek(), 'hipoteza', ZEGAR);
    assert.equal(s.tresci.stan, 'czeka');
  });

  test('nieznana bramka to błąd, nie cicha zmiana', () => {
    assert.throws(() => zaakceptuj(nowyStanBramek(), 'wymyslona'), /Nieznana bramka/);
    assert.throws(() => odrzuc(nowyStanBramek(), 'wymyslona', { powod: 'x' }), /Nieznana bramka/);
  });
});

describe('Cofnięcie bramki', () => {
  test('zaakceptowana wraca do oczekiwania', () => {
    const s = cofnij(zaakceptuj(nowyStanBramek(), 'tresci', ZEGAR), 'tresci');
    assert.equal(s.tresci.stan, 'czeka');
    assert.equal(s.tresci.data, null);
  });

  test('licznik odrzuceń zostaje, bo historia się nie cofa', () => {
    let s = odrzuc(nowyStanBramek(), 'tresci', { powod: 'Obietnica za mocna', ...ZEGAR });
    s = cofnij(s, 'tresci');
    assert.equal(s.tresci.stan, 'czeka');
    assert.equal(s.tresci.powod, null);
    assert.equal(s.tresci.licznikOdrzucen, 1);
  });

  test('inne bramki zostają nietknięte', () => {
    let s = zaakceptuj(nowyStanBramek(), 'hipoteza', ZEGAR);
    s = cofnij(zaakceptuj(s, 'tresci', ZEGAR), 'tresci');
    assert.equal(s.hipoteza.stan, 'zaakceptowana');
  });

  test('nieznana bramka to błąd', () => {
    assert.throws(() => cofnij(nowyStanBramek(), 'wymyslona'), /Nieznana bramka/);
  });
});

describe('Odrzucenie wymaga powodu', () => {
  test('bez powodu i bez uwag nie przechodzi', () => {
    for (const dane of [{}, { powod: '' }, { uwagi: '   ' }, { powod: '  ', uwagi: '' }]) {
      assert.throws(() => odrzuc(nowyStanBramek(), 'hipoteza', dane), /wymaga powodu/,
        `przeszło dla ${JSON.stringify(dane)}`);
    }
  });

  test('sam powód z listy wystarcza', () => {
    const s = odrzuc(nowyStanBramek(), 'hipoteza', { powod: POWODY.hipoteza[0], ...ZEGAR });
    assert.equal(s.hipoteza.stan, 'odrzucona');
    assert.equal(s.hipoteza.powod, POWODY.hipoteza[0]);
  });

  test('same uwagi własne też wystarczają', () => {
    const s = odrzuc(nowyStanBramek(), 'hipoteza', { uwagi: 'Operator się nie zgodzi', ...ZEGAR });
    assert.equal(s.hipoteza.stan, 'odrzucona');
    assert.equal(s.hipoteza.uwagi, 'Operator się nie zgodzi');
  });

  test('powód i uwagi łączą się w jedno zdanie', () => {
    const s = odrzuc(nowyStanBramek(), 'tresci', { powod: 'Ton nie pasuje do marki', uwagi: 'za dużo wykrzykników', ...ZEGAR });
    assert.equal(opisPowodu(s.tresci), 'Ton nie pasuje do marki — za dużo wykrzykników');
  });

  test('odrzucenia są liczone, bo po trzecim zmienia się zachowanie', () => {
    let s = nowyStanBramek();
    for (let i = 1; i <= 3; i++) {
      s = odrzuc(s, 'tresci', { powod: 'Obietnica za mocna', ...ZEGAR });
      assert.equal(s.tresci.licznikOdrzucen, i);
    }
  });

  test('akceptacja po odrzuceniu kasuje powód, ale nie licznik', () => {
    let s = odrzuc(nowyStanBramek(), 'hipoteza', { powod: 'Już to sprawdzaliśmy', ...ZEGAR });
    s = zaakceptuj(s, 'hipoteza', ZEGAR);
    assert.equal(s.hipoteza.powod, null);
    assert.equal(s.hipoteza.uwagi, '');
    assert.equal(s.hipoteza.licznikOdrzucen, 1, 'historia odrzuceń zostaje');
  });

  test('każda bramka ma gotowe powody do wyboru', () => {
    for (const b of BRAMKI) {
      assert.ok(POWODY[b]?.length >= 4, `${b}: za mało powodów`);
    }
  });
});

describe('Paczka do wysyłki', () => {
  test('na starcie zablokowana i mówi, na co czeka', () => {
    const w = paczkaZablokowana(nowyStanBramek());
    assert.equal(w.zablokowana, true);
    assert.match(w.powod, /czeka na akceptację hipotezy i treści/);
  });

  test('sama hipoteza nie wystarcza', () => {
    const w = paczkaZablokowana(zaakceptuj(nowyStanBramek(), 'hipoteza', ZEGAR));
    assert.equal(w.zablokowana, true);
    assert.deepEqual(w.brakujace, ['tresci']);
  });

  test('obie zaakceptowane odblokowują', () => {
    let s = zaakceptuj(nowyStanBramek(), 'hipoteza', ZEGAR);
    s = zaakceptuj(s, 'tresci', ZEGAR);
    assert.equal(paczkaZablokowana(s).zablokowana, false);
  });

  test('odrzucenie jest widoczne w powodzie blokady', () => {
    let s = zaakceptuj(nowyStanBramek(), 'hipoteza', ZEGAR);
    s = odrzuc(s, 'tresci', { powod: 'Obietnica za mocna', ...ZEGAR });
    assert.match(paczkaZablokowana(s).powod, /treści \(odrzucone\)/);
  });

  test('decyzja i uzasadnienie nie blokują wysyłki', () => {
    // Dotyczą tego, co PO teście — wstrzymywanie nimi paczki nie miałoby sensu
    let s = zaakceptuj(zaakceptuj(nowyStanBramek(), 'hipoteza', ZEGAR), 'tresci', ZEGAR);
    s = odrzuc(s, 'decyzja', { powod: 'Wynik prawdziwy, ale nie na teraz', ...ZEGAR });
    assert.equal(paczkaZablokowana(s).zablokowana, false);
  });
});

describe('Następstwo odrzucenia hipotezy', () => {
  test('hipoteza jest dobrana do kroku, na którym kończy się strata', () => {
    const h = hipotezaDlaStraty(straty[0]);   // operator: Start → Pobranie
    assert.equal(straty[0].to, 1);
    assert.match(h.nazwa, /Najpierw wartość/);
    assert.match(h.dlaczegoTenTest, /6900 osób miesięcznie/);
    assert.match(h.dlaczegoTenTest, /operator/);
  });

  test('po odrzuceniu pierwszej dostajemy hipotezę dla straty nr 2', () => {
    const pierwsza = nastepnaHipoteza(straty, []);
    assert.equal(pierwsza.numerStraty, 1);

    const druga = nastepnaHipoteza(straty, [pierwsza.klucz]);
    assert.equal(druga.numerStraty, 2);
    assert.notEqual(druga.klucz, pierwsza.klucz);
    assert.equal(druga.strata.lost, straty[1].lost);
  });

  test('odrzucone straty nie wracają w kółko', () => {
    const odrzucone = straty.slice(0, 2).map(kluczStraty);
    const trzecia = nastepnaHipoteza(straty, odrzucone);
    assert.equal(trzecia.numerStraty, 3);
  });

  test('gdy wszystko odrzucone, nie wymyślamy hipotezy na siłę', () => {
    assert.equal(nastepnaHipoteza(straty, straty.map(kluczStraty)), null);
  });

  test('strata na kroku bez szablonu jest pomijana, a nie opisywana byle czym', () => {
    const dziwna = { ch: { id: 'op', short: 'operator', name: 'Operator' }, from: 5, to: 6, lost: 10 };
    assert.equal(hipotezaDlaStraty(dziwna), null);
    assert.equal(nastepnaHipoteza([dziwna], []), null);
  });
});

describe('Karta odrzuconej hipotezy w banku wiedzy', () => {
  const wpis = odrzuc(nowyStanBramek(), 'hipoteza',
    { powod: 'Wymaga zgody, której nie dostaniemy', uwagi: 'operator nie da pakietu SMS', ...ZEGAR }).hipoteza;

  test('mówi wprost, że nie było testu', () => {
    const k = kartaOdrzuconejHipotezy({ hipoteza: hipotezaDlaStraty(straty[0]), wpis, strata: straty[0] });
    assert.equal(k.odrzucona, true);
    assert.equal(k.tytul, 'Najpierw wartość, potem aplikacja');
    assert.match(k.wynik, /Nie testowano/);
  });

  test('niesie powód i datę, bo bez nich karta jest bezużyteczna', () => {
    const k = kartaOdrzuconejHipotezy({ hipoteza: hipotezaDlaStraty(straty[0]), wpis, strata: straty[0] });
    assert.match(k.decyzja, /Wymaga zgody, której nie dostaniemy/);
    assert.match(k.decyzja, /operator nie da pakietu SMS/);
    assert.match(k.decyzja, /13\.10\.2026/);
  });

  test('ma komplet pól, których oczekuje bank wiedzy', () => {
    const k = kartaOdrzuconejHipotezy({ hipoteza: hipotezaDlaStraty(straty[0]), wpis, strata: straty[0] });
    for (const pole of ['tytul', 'hip', 'kanal', 'wynik', 'decyzja', 'przenaszalnosc']) {
      assert.ok(k[pole], `brak pola ${pole}`);
    }
    assert.ok(!JSON.stringify(k).includes('undefined'));
  });

  test('krok lejka wchodzi nazwą ze strony, a bez niego numerem', () => {
    const dane = { hipoteza: hipotezaDlaStraty(straty[0]), wpis, strata: straty[0] };
    assert.match(kartaOdrzuconejHipotezy({ ...dane, krok: 'Start → Pobranie' }).kanal, /Start → Pobranie/);
    assert.match(kartaOdrzuconejHipotezy(dane).kanal, /0 → 1/);
  });
});

describe('Odrzucona decyzja o wdrożeniu', () => {
  const wpis = odrzuc(nowyStanBramek(), 'decyzja',
    { powod: 'Wynik prawdziwy, ale nie na teraz', uwagi: 'zamrożenie przed świętami', ...ZEGAR }).decyzja;
  const wynik = { nazwa: 'Wariant B', opis: '+4,9 pkt proc. pierwszej wartości', kanal: 'SMS operatora' };

  test('wyjścia mają rozłączne identyfikatory i opisy', () => {
    const id = WYJSCIA_DECYZJI.map(w => w.id);
    assert.equal(new Set(id).size, id.length);
    for (const w of WYJSCIA_DECYZJI) assert.ok(w.etykieta && w.opis, w.id);
  });

  test('bez wyboru nie ma skutku', () => {
    assert.throws(() => skutekDecyzji({ wpis, wynik }), /Wybierz/);
    assert.throws(() => skutekDecyzji({ wybor: 'wymyslone', wpis, wynik }), /Wybierz/);
  });

  test('„nie wdrażamy” zostawia kartę z powodem i nie rusza punktu odniesienia', () => {
    const s = skutekDecyzji({ wybor: 'nie-wdrazamy', wpis, wynik });
    assert.equal(s.baselineBezZmian, true);
    assert.match(s.karta.tytul, /wygrał, nie wdrożony/);
    assert.match(s.karta.decyzja, /Wynik prawdziwy, ale nie na teraz/);
    assert.match(s.karta.decyzja, /zamrożenie przed świętami/);
    assert.match(s.karta.decyzja, /13\.10\.2026/);
    assert.equal(s.planPowtorki, false);
  });

  test('„powtarzamy test” prosi o nowy plan', () => {
    const s = skutekDecyzji({ wybor: 'powtorz', wpis, wynik });
    assert.equal(s.planPowtorki, true);
    assert.equal(s.baselineBezZmian, true);
    assert.match(s.karta.tytul, /do potwierdzenia/);
  });

  test('wdrożenie częściowe bez zakresu nie przechodzi', () => {
    assert.throws(() => skutekDecyzji({ wybor: 'czesciowo', wpis, wynik }), /wymaga zakresu/);
    assert.throws(() => skutekDecyzji({ wybor: 'czesciowo', zakres: '   ', wpis, wynik }), /wymaga zakresu/);
  });

  test('wdrożenie częściowe niesie zakres wszędzie, gdzie go widać', () => {
    const s = skutekDecyzji({ wybor: 'czesciowo', zakres: 'tylko Android', wpis, wynik });
    assert.match(s.naglowek, /tylko Android/);
    assert.match(s.karta.decyzja, /tylko Android/);
    assert.equal(s.zakres, 'tylko Android');
    assert.equal(s.baselineBezZmian, true);
  });

  test('karta zawsze niesie wynik testu, bo zmieniła się decyzja, nie pomiar', () => {
    for (const w of WYJSCIA_DECYZJI) {
      const s = skutekDecyzji({ wybor: w.id, zakres: 'tylko Android', wpis, wynik });
      assert.match(s.karta.wynik, /\+4,9 pkt proc/, w.id);
      assert.equal(s.karta.odrzucona, true, w.id);
      assert.ok(!JSON.stringify(s.karta).includes('undefined'), w.id);
    }
  });
});

describe('Pomysły na następny test', () => {
  test('każdy pomysł ma identyfikator, nazwę i powód', () => {
    for (const p of POMYSLY_NA_TEST) {
      assert.ok(p.id && p.nazwa && p.dlaczego, JSON.stringify(p));
    }
    const id = POMYSLY_NA_TEST.map(p => p.id);
    assert.equal(new Set(id).size, id.length);
  });

  test('odrzucone pomysły nie wracają', () => {
    const pierwszy = nastepnyPomysl([]);
    assert.equal(pierwszy.id, POMYSLY_NA_TEST[0].id);
    assert.equal(nastepnyPomysl([pierwszy.id]).id, POMYSLY_NA_TEST[1].id);
  });

  test('po wyczerpaniu listy nie udajemy, że coś zostało', () => {
    assert.equal(nastepnyPomysl(POMYSLY_NA_TEST.map(p => p.id)), null);
  });

  test('powód „wolę inny pomysł” jest na liście powodów do uzasadnienia', () => {
    assert.ok(POWODY.uzasadnienie.includes(POWOD_INNY_POMYSL));
  });
});
