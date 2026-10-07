import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { sprawdz, wyciagnijJson, SCHEMAT_KOMUNIKATOW } from '../api/_lib/walidacja.js';
import { sprawdzLimit, wyczyscLimity } from '../api/_lib/limit.js';
import { obsluz } from '../api/_lib/http.js';
import { BladModelu, MODEL, wczytajPrompt } from '../api/_lib/claude.js';

/** Poprawna odpowiedź modelu – punkt wyjścia dla przypadków z błędem. */
const dobry = () => ({
  smsA: 'Play: Masz w abonamencie usluge Bezpieczna Rodzina, bez doplat. Sprawdz w 1 minute, gdzie sa Twoi bliscy: bezpiecznarodzina.pl/start',
  smsB: 'Play: Zobacz na mapie, gdzie jest Twoje dziecko lub rodzic. Bez instalowania aplikacji, w cenie abonamentu: bezpiecznarodzina.pl/mapa',
  rcs: {
    tytul: 'Bezpieczna Rodzina jest w abonamencie',
    opis: 'Wyślij bliskiej osobie prośbę o lokalizację i zobacz ją na mapie.',
    przyciski: ['Pokaż na mapie', 'Jak to działa']
  },
  whatsapp: {
    powitanie: 'Cześć! Masz Bezpieczną Rodzinę w abonamencie. Podaj numer bliskiej osoby.',
    potwierdzenie: 'Gotowe. Gdy Zosia się zgodzi, pokażę Ci ją tutaj na mapie.'
  },
  smsBliski: 'Anna prosi Cie o jednorazowe udostepnienie lokalizacji. Zgoda: bezpiecznarodzina.pl/z/7KQ2. Mozesz odmowic.',
  strona: { naglowek: 'Zosia jest w szkole', pytanie: 'Chcesz dostać powiadomienie, gdy wróci do domu?', cta: 'Ustaw strefę w aplikacji' }
});

describe('Walidacja odpowiedzi modelu', () => {
  test('poprawna odpowiedź przechodzi', () => {
    const w = sprawdz(dobry(), SCHEMAT_KOMUNIKATOW);
    assert.deepEqual(w.bledy, []);
    assert.equal(w.ok, true);
  });

  test('brak pola jest wskazany po nazwie', () => {
    const d = dobry();
    delete d.smsB;
    const w = sprawdz(d, SCHEMAT_KOMUNIKATOW);
    assert.equal(w.ok, false);
    assert.ok(w.bledy.some(b => b.includes('smsB')), w.bledy.join('; '));
  });

  test('zły typ jest wskazany razem z typem, który przyszedł', () => {
    const d = dobry();
    d.smsA = 160;
    const w = sprawdz(d, SCHEMAT_KOMUNIKATOW);
    assert.equal(w.ok, false);
    assert.ok(w.bledy.some(b => b.includes('ma być tekstem') && b.includes('number')), w.bledy.join('; '));
  });

  test('SMS dłuższy niż jeden segment nie przechodzi', () => {
    const d = dobry();
    d.smsB = 'Play: ' + 'a'.repeat(130) + ' bezpiecznarodzina.pl/mapa';
    const w = sprawdz(d, SCHEMAT_KOMUNIKATOW);
    assert.equal(w.ok, false);
    assert.ok(w.bledy.some(b => b.includes('smsB') && b.includes('160')), w.bledy.join('; '));
  });

  test('polskie znaki w SMS nie przechodzą, bo rozbijają wiadomość', () => {
    const d = dobry();
    d.smsBliski = 'Anna prosi Cię o lokalizację: bezpiecznarodzina.pl/z/7KQ2. Możesz odmówić.';
    const w = sprawdz(d, SCHEMAT_KOMUNIKATOW);
    assert.equal(w.ok, false);
    assert.ok(w.bledy.some(b => b.includes('diakrytyczne')), w.bledy.join('; '));
  });

  test('polskie znaki poza SMS są w porządku', () => {
    const d = dobry();
    d.rcs.opis = 'Wyślij prośbę o udostępnienie lokalizacji.';
    assert.equal(sprawdz(d, SCHEMAT_KOMUNIKATOW).ok, true);
  });

  test('wariant B nie może prowadzić do pobrania aplikacji', () => {
    const d = dobry();
    d.smsB = 'Play: Pobierz aplikacje i zobacz bliskich na mapie: bezpiecznarodzina.pl/mapa';
    const w = sprawdz(d, SCHEMAT_KOMUNIKATOW);
    assert.equal(w.ok, false);
    assert.ok(w.bledy.some(b => b.includes('pobierz')), w.bledy.join('; '));
  });

  test('każdy SMS ma swój stały link', () => {
    const d = dobry();
    d.smsA = 'Play: Masz Bezpieczna Rodzine w abonamencie: [link]';
    const w = sprawdz(d, SCHEMAT_KOMUNIKATOW);
    assert.ok(w.bledy.some(b => b.includes('bezpiecznarodzina.pl/start')), w.bledy.join('; '));
  });

  test('SMS operatora zaczyna się od nazwy operatora', () => {
    const d = dobry();
    d.smsB = 'Orange: Zobacz bliskich na mapie, bez aplikacji: bezpiecznarodzina.pl/mapa';
    assert.ok(sprawdz(d, SCHEMAT_KOMUNIKATOW).bledy.some(b => b.includes('Play:')));
  });

  test('prośba do bliskiego musi mówić, że można odmówić', () => {
    const d = dobry();
    d.smsBliski = 'Anna prosi Cie o udostepnienie lokalizacji: bezpiecznarodzina.pl/z/7KQ2';
    const w = sprawdz(d, SCHEMAT_KOMUNIKATOW);
    assert.ok(w.bledy.some(b => b.includes('odmow')), w.bledy.join('; '));
  });

  test('zła liczba przycisków RCS nie przechodzi', () => {
    const d = dobry();
    d.rcs.przyciski = ['tylko jeden'];
    const w = sprawdz(d, SCHEMAT_KOMUNIKATOW);
    assert.equal(w.ok, false);
    assert.ok(w.bledy.some(b => b.includes('rcs.przyciski')), w.bledy.join('; '));
  });

  test('pusty tekst to brak treści, nie poprawne pole', () => {
    const d = dobry();
    d.strona.cta = '   ';
    assert.equal(sprawdz(d, SCHEMAT_KOMUNIKATOW).ok, false);
  });

  test('jeden błąd nie przykrywa pozostałych', () => {
    const d = dobry();
    delete d.smsA;
    delete d.whatsapp.powitanie;
    d.rcs.tytul = 'x'.repeat(50);
    assert.equal(sprawdz(d, SCHEMAT_KOMUNIKATOW).bledy.length, 3);
  });
});

describe('Wyciąganie JSON z odpowiedzi', () => {
  test('czysty JSON', () => {
    assert.deepEqual(wyciagnijJson('{"a":1}').dane, { a: 1 });
  });

  test('JSON w bloku kodu, bo model lubi go opakować', () => {
    assert.deepEqual(wyciagnijJson('```json\n{"a":1}\n```').dane, { a: 1 });
    assert.deepEqual(wyciagnijJson('```\n{"a":1}\n```').dane, { a: 1 });
  });

  test('tekst, który nie jest JSON-em, daje błąd zamiast wyjątku', () => {
    const w = wyciagnijJson('Oczywiście! Oto warianty:');
    assert.equal(w.ok, false);
    assert.equal(w.bledy.length, 1);
  });
});

describe('Limit zapytań', () => {
  beforeEach(wyczyscLimity);

  test('przepuszcza do wyczerpania limitu, potem odmawia', () => {
    const opcje = { maks: 3, oknoMs: 60000 };
    const wyniki = [1, 2, 3, 4].map(() => sprawdzLimit('1.2.3.4', opcje).ok);
    assert.deepEqual(wyniki, [true, true, true, false]);
  });

  test('liczy osobno dla każdego adresu', () => {
    const opcje = { maks: 1, oknoMs: 60000 };
    assert.equal(sprawdzLimit('1.1.1.1', opcje).ok, true);
    assert.equal(sprawdzLimit('2.2.2.2', opcje).ok, true);
    assert.equal(sprawdzLimit('1.1.1.1', opcje).ok, false);
  });

  test('po upływie okna znów przepuszcza', () => {
    const t0 = 1_000_000;
    const opcje = { maks: 1, oknoMs: 60000 };
    assert.equal(sprawdzLimit('1.1.1.1', { ...opcje, teraz: t0 }).ok, true);
    assert.equal(sprawdzLimit('1.1.1.1', { ...opcje, teraz: t0 + 59_000 }).ok, false);
    assert.equal(sprawdzLimit('1.1.1.1', { ...opcje, teraz: t0 + 61_000 }).ok, true);
  });

  test('mówi, ile zostało i za ile sekund ponowić', () => {
    const t0 = 1_000_000;
    const opcje = { maks: 2, oknoMs: 60000 };
    assert.equal(sprawdzLimit('1.1.1.1', { ...opcje, teraz: t0 }).zostalo, 1);
    assert.equal(sprawdzLimit('1.1.1.1', { ...opcje, teraz: t0 }).zostalo, 0);
    assert.equal(sprawdzLimit('1.1.1.1', { ...opcje, teraz: t0 + 10_000 }).ponowZa, 50);
  });
});

/** Minimalna atrapa req/res, żeby sprawdzić obsługę żądania bez sieci. */
function atrapa({ method = 'POST', body, ip = '9.9.9.9' } = {}) {
  const res = {
    kod: null, dane: null, naglowki: {},
    setHeader(k, v) { this.naglowki[k] = v; },
    status(k) { this.kod = k; return this; },
    json(d) { this.dane = d; return this; }
  };
  return [{ method, body, headers: { 'x-forwarded-for': ip }, socket: {} }, res];
}

describe('Obsługa żądania', () => {
  beforeEach(wyczyscLimity);

  test('GET jest odrzucany, bo to zapytanie kosztuje pieniądze', async () => {
    const [req, res] = atrapa({ method: 'GET' });
    await obsluz(req, res, async () => ({ nigdy: true }));
    assert.equal(res.kod, 405);
    assert.equal(res.dane.powod, 'zla_metoda');
  });

  test('odpowiedzi nie wolno zapisywać w pamięci podręcznej', async () => {
    const [req, res] = atrapa({ body: {} });
    await obsluz(req, res, async () => ({ ok: true }));
    assert.equal(res.naglowki['cache-control'], 'no-store');
  });

  test('po przekroczeniu limitu wraca 429 z czasem oczekiwania', async () => {
    const maks = Number(process.env.LIMIT_ZAPYTAN) || 20;
    let ostatni;
    for (let i = 0; i <= maks; i++) {
      const [req, res] = atrapa({ body: {} });
      await obsluz(req, res, async () => ({ ok: true }));
      ostatni = res;
    }
    assert.equal(ostatni.kod, 429);
    assert.equal(ostatni.dane.powod, 'limit');
    assert.match(ostatni.dane.blad, /Spróbuj za \d+ s/);
  });

  test('brak klucza daje 503, a nie ogólną awarię', async () => {
    const [req, res] = atrapa({ body: {} });
    await obsluz(req, res, async () => {
      throw new BladModelu('Brak klucza.', { powod: 'brak_klucza' });
    });
    assert.equal(res.kod, 503);
    assert.equal(res.dane.powod, 'brak_klucza');
  });

  test('zły schemat po dwóch próbach daje 502 ze szczegółami', async () => {
    const [req, res] = atrapa({ body: {} });
    await obsluz(req, res, async () => {
      throw new BladModelu('Zły schemat.', { powod: 'zly_schemat', bledy: ['brak pola warianty'] });
    });
    assert.equal(res.kod, 502);
    assert.deepEqual(res.dane.szczegoly, ['brak pola warianty']);
  });

  test('nieoczekiwany wyjątek nie wycieka na zewnątrz', async () => {
    const [req, res] = atrapa({ body: {} });
    const bylError = console.error;
    console.error = () => {};
    try {
      await obsluz(req, res, async () => { throw new Error('hasło=tajne123'); });
    } finally {
      console.error = bylError;
    }
    assert.equal(res.kod, 502);
    assert.equal(res.dane.powod, 'awaria');
    assert.ok(!JSON.stringify(res.dane).includes('tajne123'));
  });
});

describe('Prompty systemowe', () => {
  test('kopia dla strony jest identyczna z oryginałem dla serwera', () => {
    const pliki = readdirSync(new URL('../api/prompts/', import.meta.url)).filter(p => p.endsWith('.md'));
    assert.ok(pliki.length >= 1);
    for (const plik of pliki) {
      const zrodlo = readFileSync(new URL(`../api/prompts/${plik}`, import.meta.url), 'utf8');
      const kopia = readFileSync(new URL(`../public/prompts/${plik}`, import.meta.url), 'utf8');
      assert.equal(kopia, zrodlo, `${plik} rozjechał się – uruchom npm run sync-prompt`);
    }
  });

  test('prompt dla komunikatów niesie zasady projektu', () => {
    const p = wczytajPrompt('komunikaty');
    assert.match(p, /160/);
    assert.match(p, /za zgodą/i);
    assert.match(p, /abonament/i);
    assert.match(p, /Nie strasz/i);
  });

  test('prompt dla opisu wyniku zabrania dokładania liczb', () => {
    const p = wczytajPrompt('opis-wyniku');
    assert.match(p, /wyłącznie na liczbach/i);
    assert.match(p, /przykładowe/i);
  });

  test('model jest brany ze zmiennej środowiskowej z sensownym domyślnym', () => {
    assert.equal(MODEL, process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5');
  });
});

describe('Nieindeksowanie i uprawnienia przeglądarki', () => {
  const korzen = (plik) => readFileSync(new URL(`../${plik}`, import.meta.url), 'utf8');

  test('vercel.json wysyła noindex dla wszystkich ścieżek', () => {
    const robots = JSON.parse(korzen('vercel.json')).headers
      .find(r => r.source === '/(.*)').headers.find(h => h.key.toLowerCase() === 'x-robots-tag');
    assert.ok(robots);
    assert.match(robots.value, /noindex/);
    assert.match(robots.value, /nofollow/);
  });

  test('strona ma meta robots noindex', () => {
    assert.match(korzen('public/index.html'), /<meta name="robots" content="noindex, nofollow">/);
  });

  test('robots.txt zabrania wszystkiego', () => {
    assert.match(korzen('public/robots.txt'), /^Disallow: \/$/m);
    assert.match(korzen('public/robots.txt'), /^User-agent: \*$/m);
  });

  test('geolokalizacja jest dozwolona tylko na stronie zgody', () => {
    const reguly = JSON.parse(korzen('vercel.json')).headers;
    const ogolna = reguly.find(r => r.source === '/(.*)');
    const zgody = reguly.find(r => r.source === '/z/(.*)');
    assert.match(ogolna.headers.find(h => h.key.toLowerCase() === 'permissions-policy').value, /geolocation=\(\)/);
    assert.match(zgody.headers.find(h => h.key.toLowerCase() === 'permissions-policy').value, /geolocation=\(self\)/);
    assert.ok(reguly.indexOf(zgody) > reguly.indexOf(ogolna));
  });
});
