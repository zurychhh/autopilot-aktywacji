import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { magazynPamiec } from '../lib/magazyn.js';
import { uslugaZaproszen, trescPrzypomnienia, GODZINY_DO_PRZYPOMNIENIA } from '../lib/zaproszenia.js';

function zegar(start = 1_700_000_000_000) {
  let t = start;
  return { teraz: () => t, przesunGodziny: (g) => { t += g * 3_600_000; } };
}

function usluga() {
  const z = zegar();
  let n = 0;
  return { u: uslugaZaproszen(magazynPamiec(), { teraz: z.teraz, losujId: () => `Z${++n}` }), z };
}

const GODZINA = 1;

describe('Zapraszanie bliskiej osoby', () => {
  test('bez imienia nie powstaje', async () => {
    const { u } = usluga();
    await assert.rejects(() => u.zapros({ imie: '' }), /Podaj imię/);
  });

  test('zapisujemy imię i nic więcej z danych osobowych', async () => {
    const { u } = usluga();
    const { id } = await u.zapros({ imie: 'Zosia', kanal: 'whatsapp' });
    const z = await u.pobierz(id);
    assert.deepEqual(Object.keys(z).sort(), ['id', 'imie', 'kanal', 'przypomniano', 'stan', 'utworzone']);
    assert.equal(z.imie, 'Zosia');
    assert.equal(z.stan, 'wyslane');
  });
});

describe('Przypomnienie po 48 godzinach', () => {
  test('przed 48 godzinami nic nie czeka', async () => {
    const { u, z } = usluga();
    await u.zapros({ imie: 'Zosia' });
    z.przesunGodziny(GODZINY_DO_PRZYPOMNIENIA - GODZINA);
    assert.equal((await u.doPrzypomnienia()).length, 0);
  });

  test('dokładnie po 48 godzinach zaproszenie wchodzi do kolejki', async () => {
    const { u, z } = usluga();
    await u.zapros({ imie: 'Zosia' });
    z.przesunGodziny(GODZINY_DO_PRZYPOMNIENIA);
    const czekaja = await u.doPrzypomnienia();
    assert.equal(czekaja.length, 1);
    assert.equal(czekaja[0].imie, 'Zosia');
  });

  test('zaakceptowane zaproszenie nie dostaje przypomnienia', async () => {
    const { u, z } = usluga();
    const { id } = await u.zapros({ imie: 'Zosia' });
    await u.oznaczAkceptacje(id);
    z.przesunGodziny(GODZINY_DO_PRZYPOMNIENIA + 10);
    assert.equal((await u.doPrzypomnienia()).length, 0);
  });

  test('akceptacja po 48 godzinach, ale przed przebiegiem, też wyłącza przypomnienie', async () => {
    const { u, z } = usluga();
    const { id } = await u.zapros({ imie: 'Zosia' });
    z.przesunGodziny(GODZINY_DO_PRZYPOMNIENIA + 1);
    assert.equal((await u.doPrzypomnienia()).length, 1);
    await u.oznaczAkceptacje(id);
    assert.equal((await u.doPrzypomnienia()).length, 0);
  });

  test('drugie przypomnienie nie wychodzi — to byłoby nękanie', async () => {
    const { u, z } = usluga();
    const { id } = await u.zapros({ imie: 'Zosia' });
    z.przesunGodziny(GODZINY_DO_PRZYPOMNIENIA);
    assert.equal((await u.doPrzypomnienia()).length, 1);
    await u.oznaczPrzypomnienie(id);
    assert.equal((await u.doPrzypomnienia()).length, 0);

    z.przesunGodziny(48);
    assert.equal((await u.doPrzypomnienia()).length, 0, 'raz przypomniane zostaje przypomniane');
  });

  test('kilka zaproszeń: do kolejki wchodzą tylko te dojrzałe', async () => {
    const { u, z } = usluga();
    await u.zapros({ imie: 'Zosia' });
    z.przesunGodziny(30);
    await u.zapros({ imie: 'Antek' });
    z.przesunGodziny(20); // Zosia ma 50 h, Antek 20 h
    const czekaja = await u.doPrzypomnienia();
    assert.deepEqual(czekaja.map(c => c.imie), ['Zosia']);
  });
});

describe('Treść przypomnienia', () => {
  test('mieści się w jednym SMS-ie', () => {
    const t = trescPrzypomnienia({ imie: 'Konstantyna' });
    assert.ok(t.length <= 160, `${t.length} znaków`);
  });

  test('nie ma polskich znaków, bo rozbijałyby wiadomość', () => {
    assert.ok(!/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(trescPrzypomnienia({ imie: 'Zosia' })));
  });

  test('bardzo długie imię nie wypycha treści poza limit', () => {
    const t = trescPrzypomnienia({ imie: 'A'.repeat(40) });
    assert.ok(t.length <= 160);
  });
});

describe('Log i podsumowanie', () => {
  test('podsumowanie liczy stany rozłącznie', async () => {
    const { u, z } = usluga();
    const a = await u.zapros({ imie: 'A' });
    await u.zapros({ imie: 'B' });
    await u.oznaczAkceptacje(a.id);
    z.przesunGodziny(GODZINY_DO_PRZYPOMNIENIA);
    const p = await u.podsumowanie();
    assert.equal(p.wyslane, 2);
    assert.equal(p.zaakceptowane, 1);
    assert.equal(p.czekaja, 1);
  });

  test('log trzyma najnowsze wpisy na górze i nie rośnie bez końca', async () => {
    const { u } = usluga();
    for (let i = 0; i < 25; i++) await u.dopiszDoLogu({ rodzaj: 'przypomnienie', imie: `Osoba ${i}` });
    const log = await u.log();
    assert.equal(log.length, 20);
    assert.equal(log[0].imie, 'Osoba 24');
  });

  test('wpis logu mówi wprost, że nic nie wyszło', async () => {
    const { u } = usluga();
    await u.dopiszDoLogu({ rodzaj: 'przypomnienie', imie: 'Zosia', wyslano: false });
    assert.equal((await u.log())[0].wyslano, false);
  });
});
