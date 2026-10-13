import { test, expect } from '@playwright/test';

/**
 * Bramka odrzucenia hipotezy. Model stanu ma własne testy jednostkowe
 * (test/bramki.test.js), więc tutaj sprawdzamy tylko to, czego one nie widzą:
 * czy odrzucenie naprawdę zmienia stronę — blokuje paczkę, dopisuje kartę do
 * banku wiedzy i przesuwa pracę na kolejną stratę z diagnozy.
 */

const gateHyp = '#gateHyp';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#trescHipotezy')).toContainText('Strata nr 1');
});

test('paczka jest zablokowana, dopóki hipoteza i treści nie są zaakceptowane', async ({ page }) => {
  await expect(page.locator('#pack')).toHaveClass(/zablokowana/);
  await expect(page.locator('#blokadaPaczki')).toContainText('czeka na akceptację hipotezy i treści');

  await page.click('#btnHyp');
  await expect(page.locator('#blokadaPaczki')).toContainText('czeka na akceptację treści');

  await page.click('#btnCopy');
  await expect(page.locator('#pack')).not.toHaveClass(/zablokowana/);
  await expect(page.locator('#blokadaPaczki')).toBeHidden();
});

test('odrzucenie bez powodu nie przechodzi', async ({ page }) => {
  await page.click('#btnHypNie');
  await page.click(`${gateHyp} .powod .potwierdz`);

  await expect(page.locator(`${gateHyp} .powod .blad`)).toContainText('wymaga powodu');
  await expect(page.locator(gateHyp)).not.toHaveClass(/nie/);
  await expect(page.locator('#trescHipotezy')).toContainText('Strata nr 1');
});

test('odrzucenie z powodem zapisuje kartę i proponuje kolejną stratę', async ({ page }) => {
  await page.click('#btnHypNie');
  await page.check(`${gateHyp} input[value="Ważniejsza jest inna strata"]`);
  await page.fill(`${gateHyp} .powod textarea`, 'Wracamy do tego po świętach.');
  await page.click(`${gateHyp} .powod .potwierdz`);

  // bramka pokazuje powód, panel znika
  await expect(page.locator(`${gateHyp} .powod`)).toHaveCount(0);
  await expect(page.locator('#stanHyp'))
    .toContainText('Ważniejsza jest inna strata — Wracamy do tego po świętach.');

  // praca przesuwa się na kolejną stratę, a treści są oznaczone jako nieaktualne
  await expect(page.locator('#trescHipotezy')).toContainText('Strata nr 2');
  await expect(page.locator('#actIntro')).toContainText('straty nr 2');
  await expect(page.locator('#actIntro')).toContainText('napisano pod poprzednią hipotezę');

  // karta trafia do banku wiedzy
  const karta = page.locator('#bankCards .kcard.odrzucona').first();
  await expect(karta.locator('.tag')).toHaveText('Odrzucona przed testem');
  await expect(karta).toContainText('Nie testowano');
  await expect(karta).toContainText('Ważniejsza jest inna strata');
  await expect(karta).toContainText('Start → Pobranie');

  // paczka dalej zablokowana: nowa hipoteza czeka na akceptację
  await expect(page.locator('#pack')).toHaveClass(/zablokowana/);
});

test('odrzucenie hipotezy cofa wcześniejszą akceptację treści', async ({ page }) => {
  await page.click('#btnCopy');
  await expect(page.locator('#stanCopy')).toContainText('Treści: zaakceptowano');

  await page.click('#btnHypNie');
  await page.check(`${gateHyp} input[value="Nie wierzę w mechanizm"]`);
  await page.click(`${gateHyp} .powod .potwierdz`);

  await expect(page.locator('#stanCopy')).toBeHidden();
  await expect(page.locator('#pack')).toHaveClass(/zablokowana/);
});

test('po odrzuceniu wszystkich trzech strat narzędzie mówi wprost, że nie ma pomysłu', async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    await page.click('#btnHypNie');
    await page.check(`${gateHyp} input[value="Nie wierzę w mechanizm"]`);
    await page.click(`${gateHyp} .powod .potwierdz`);
  }

  await expect(page.locator('#trescHipotezy')).toContainText('Wszystkie trzy straty z diagnozy odrzucone');
  await expect(page.locator('#bankCards .kcard.odrzucona')).toHaveCount(3);
  await expect(page.locator('#pack')).toHaveClass(/zablokowana/);
});

/**
 * Odrzucenie treści. Model wołamy przez zaślepkę, bo test ma sprawdzić, co
 * strona wysyła i co robi z odpowiedzią, a nie czy Claude dziś dobrze pisze.
 */
const NOWE = {
  smsA: 'Play: Bezpieczna Rodzina jest w Twoim abonamencie. Sprawdz, gdzie sa bliscy: bezpiecznarodzina.pl/start',
  smsB: 'Play: Zobacz bliska osobe na mapie w przegladarce, w cenie abonamentu: bezpiecznarodzina.pl/mapa',
  rcs: { tytul: 'Masz to w abonamencie', opis: 'Poproś bliską osobę o zgodę i zobacz ją na mapie.', przyciski: ['Wyślij prośbę', 'Jak to działa'] },
  whatsapp: { powitanie: 'Cześć. Podaj numer bliskiej osoby, a wyślemy jej prośbę o zgodę.', potwierdzenie: 'Gotowe. Decyzja należy do niej — dam znać, gdy się zgodzi.' },
  smsBliski: 'Anna prosi Cie o jednorazowe udostepnienie lokalizacji: bezpiecznarodzina.pl/z/7KQ2. Mozesz odmowic.',
  strona: { naglowek: 'Zosia jest w szkole', pytanie: 'Chcesz wiedzieć, gdy wróci do domu?', cta: 'Ustaw strefę w aplikacji' }
};

async function odrzucTresci(page, powod) {
  await page.click('#btnCopyNie');
  await page.check(`#gateCopy input[value="${powod}"]`);
  await page.click('#gateCopy .powod .potwierdz');
}

test('odrzucone treści wracają do modelu razem z uwagami i poprzednią wersją', async ({ page }) => {
  let zadanie = null;
  await page.route('**/api/generate', async route => {
    zadanie = route.request().postDataJSON();
    await route.fulfill({ json: NOWE });
  });

  await page.click('#btnCopy');
  await expect(page.locator('#stanCopy')).toContainText('Treści: zaakceptowano');

  await odrzucTresci(page, 'Obietnica za mocna');
  await expect(page.locator('#genStatus')).toContainText('poprawił sześć ekranów');

  expect(zadanie.uwagi).toContain('Obietnica za mocna');
  expect(zadanie.poprzednie.smsA).toContain('bezpiecznarodzina.pl/start');

  // nowa wersja jest na ekranie i znów czeka na akceptację
  await expect(page.locator('.phone').first()).toContainText('Bezpieczna Rodzina jest w Twoim abonamencie');
  await expect(page.locator('#stanCopy')).toBeHidden();
  await expect(page.locator('#pack')).toHaveClass(/zablokowana/);
});

test('po trzecim odrzuceniu treści poprawia człowiek, nie model', async ({ page }) => {
  let wywolan = 0;
  await page.route('**/api/generate', async route => {
    wywolan++;
    await route.fulfill({ json: NOWE });
  });

  for (const powod of ['Ton nie pasuje do marki', 'Obietnica za mocna', 'Treść myli odbiorcę']) {
    await odrzucTresci(page, powod);
  }

  expect(wywolan, 'przy trzecim odrzuceniu nie wołamy już modelu').toBe(2);
  await expect(page.locator('#trybReczny')).toBeVisible();
  await expect(page.locator('#genStatus')).toContainText('popraw treści ręcznie');
  await expect(page.locator('[data-pole="smsA"]')).toHaveAttribute('contenteditable', 'plaintext-only');
});

test('gdy model nie odpowie, strona od razu oddaje klawiaturę człowiekowi', async ({ page }) => {
  await page.route('**/api/generate', route => route.fulfill({
    status: 503,
    json: { blad: 'Brak klucza ANTHROPIC_API_KEY po stronie serwera.', powod: 'brak_klucza' }
  }));

  await odrzucTresci(page, 'Dział prawny tego nie puści');

  await expect(page.locator('#trybReczny')).toBeVisible();
  await expect(page.locator('#genStatus')).toContainText('popraw je ręcznie');
});

test('ręczna poprawka liczy znaki i unieważnia wcześniejszą akceptację', async ({ page }) => {
  await page.route('**/api/generate', route => route.fulfill({ status: 503, json: { blad: 'Brak klucza.', powod: 'brak_klucza' } }));
  await odrzucTresci(page, 'Treść myli odbiorcę');
  await expect(page.locator('#trybReczny')).toBeVisible();

  await page.click('#btnCopy');
  await expect(page.locator('#stanCopy')).toContainText('Treści: zaakceptowano');

  const pole = page.locator('[data-pole="smsA"]');
  const krotki = 'Play: Krotka tresc testowa bezpiecznarodzina.pl/start';
  await pole.fill(krotki);
  await expect(page.locator('[data-licznik="smsA"]')).toHaveText(String(krotki.length));
  await expect(page.locator('[data-licznik="smsA"]')).not.toHaveClass(/zaDlugi/);

  // zmiana po akceptacji ją unieważnia — inaczej paczka pojechałaby z innym tekstem
  await expect(page.locator('#stanCopy')).toBeHidden();
  await expect(page.locator('#pack')).toHaveClass(/zablokowana/);

  await pole.fill('Play: ' + 'a'.repeat(200));
  await expect(page.locator('[data-licznik="smsA"]')).toHaveClass(/zaDlugi/);
});

/** Odrzucenie decyzji o wdrożeniu: trzy wyjścia, każde z innym następstwem. */
async function odrzucDecyzje(page, { powod, wyjscie, zakres }) {
  await page.click('#btnScaleNie');
  await page.check(`#gateScale input[value="${powod}"]`);
  if (wyjscie) await page.check(`#gateScale input[name="wyjscie"][value="${wyjscie}"]`);
  if (zakres) await page.fill('#gateScale .powod .zakres', zakres);
  await page.click('#gateScale .powod .potwierdz');
}

test('odrzucenie decyzji bez wyboru wyjścia nie przechodzi', async ({ page }) => {
  await odrzucDecyzje(page, { powod: 'Wynik prawdziwy, ale nie na teraz' });

  await expect(page.locator('#gateScale .powod .blad')).toContainText('Wybierz');
  await expect(page.locator('#gateScale')).not.toHaveClass(/nie/);
});

test('„nie wdrażamy” zostawia kartę i wpis w historii', async ({ page }) => {
  await odrzucDecyzje(page, { powod: 'Wynik prawdziwy, ale nie na teraz', wyjscie: 'nie-wdrazamy' });

  await expect(page.locator('#stanScale')).toContainText('Nie wdrażamy zwycięzcy');
  await expect(page.locator('#stanScale')).toContainText('punkt odniesienia bez zmian');

  const karta = page.locator('#bankCards .kcard.odrzucona').first();
  await expect(karta).toContainText('wygrał, nie wdrożony');
  await expect(karta).toContainText('Wynik prawdziwy, ale nie na teraz');

  await expect(page.locator('#decyzjeCzlowieka')).toContainText('Nie wdrażamy zwycięzcy');
});

test('„powtarzamy test” pokazuje plan liczony od zmierzonej kontroli', async ({ page }) => {
  await odrzucDecyzje(page, { powod: 'Za mała próba jak na wagę decyzji', wyjscie: 'powtorz' });

  await expect(page.locator('#planBox')).toBeVisible();
  await expect(page.locator('#planTytul')).toHaveText('Plan powtórzonego testu');
  // kontrola w przykładowych wynikach: 213 z 1904, czyli 11,2%
  await expect(page.locator('#planLiczby')).toContainText('11,2%');
  await expect(page.locator('#planLiczby')).toContainText('osób na grupę');
});

test('wdrożenie częściowe wymaga zakresu i niesie go dalej', async ({ page }) => {
  await odrzucDecyzje(page, { powod: 'Działa tylko na części urządzeń', wyjscie: 'czesciowo' });
  await expect(page.locator('#gateScale .powod .blad')).toContainText('wymaga zakresu');

  await page.fill('#gateScale .powod .zakres', 'tylko Android');
  await page.click('#gateScale .powod .potwierdz');

  await expect(page.locator('#stanScale')).toContainText('Wdrażamy częściowo: tylko Android');
  await expect(page.locator('#bankCards .kcard.odrzucona').first()).toContainText('tylko Android');
  await expect(page.locator('#decyzjeCzlowieka')).toContainText('tylko Android');
});

test('zatwierdzone wdrożenie też zostaje w historii', async ({ page }) => {
  await page.click('#btnScale');

  await expect(page.locator('#stanScale')).toContainText('Decyzja: zaakceptowano');
  await expect(page.locator('#decyzjeCzlowieka')).toContainText('Wdrażamy zwycięzcę dla wszystkich');
  await expect(page.locator('#decyzjeCzlowieka li')).toHaveClass(/tak/);
});

/** Bramka uzasadnienia: przepisanie z uwagami albo zmiana samego pomysłu. */
async function odrzucUzasadnienie(page, powod) {
  await page.click('#btnUzasNie');
  await page.check(`#gateUzas input[value="${powod}"]`);
  await page.click('#gateUzas .powod .potwierdz');
}

test('uzasadnienie czeka na człowieka, a odrzucone wraca z uwagami', async ({ page }) => {
  const zadania = [];
  await page.route('**/api/uzasadnij', async route => {
    zadania.push(route.request().postDataJSON());
    await route.fulfill({ json: { uzasadnienie: `Uzasadnienie nr ${zadania.length}.` } });
  });

  await page.click('#btnPlan');
  await expect(page.locator('#planUzasadnienie')).toHaveText('Uzasadnienie nr 1.');
  await expect(page.locator('#gateUzas')).toBeVisible();

  await odrzucUzasadnienie(page, 'Za ogólne, nie da się z tym pracować');

  await expect(page.locator('#planUzasadnienie')).toHaveText('Uzasadnienie nr 2.');
  expect(zadania[1].uwagi).toContain('Za ogólne');
  expect(zadania[1].poprzednie).toBe('Uzasadnienie nr 1.');
  // przepisany tekst znów czeka na akceptację
  await expect(page.locator('#stanUzas')).toBeHidden();

  await page.click('#btnUzas');
  await expect(page.locator('#stanUzas')).toContainText('Uzasadnienie: zaakceptowano');
});

test('„wolę inny pomysł z banku” zmienia test, a nie tekst', async ({ page }) => {
  const pomysly = [];
  await page.route('**/api/uzasadnij', async route => {
    pomysly.push(route.request().postDataJSON().pomysl);
    await route.fulfill({ json: { uzasadnienie: 'Uzasadnienie.' } });
  });

  await page.click('#btnPlan');
  await expect(page.locator('#planLiczby')).toContainText('Prowadzenie do pierwszej strefy');

  await odrzucUzasadnienie(page, 'Wolę inny pomysł z banku');

  await expect(page.locator('#planLiczby')).toContainText('Rozpoznanie numeru zamiast formularza');
  expect(pomysly[1]).toContain('Rozpoznanie numeru');
  expect(pomysly[1]).not.toBe(pomysly[0]);
});

test('po wyczerpaniu banku pomysłów narzędzie mówi to wprost', async ({ page }) => {
  await page.route('**/api/uzasadnij', route => route.fulfill({ json: { uzasadnienie: 'Uzasadnienie.' } }));
  await page.click('#btnPlan');

  for (let i = 0; i < 4; i++) {
    await expect(page.locator('#gateUzas')).toBeVisible();
    await odrzucUzasadnienie(page, 'Wolę inny pomysł z banku');
  }

  await expect(page.locator('#planStatus')).toContainText('Lista pomysłów z banku się skończyła');
  await expect(page.locator('#gateUzas')).toBeHidden();
});

test('gdy model nie odpowie, liczby zostają, a bramki uzasadnienia nie ma', async ({ page }) => {
  await page.route('**/api/uzasadnij', route => route.fulfill({
    status: 503, json: { blad: 'Brak klucza ANTHROPIC_API_KEY po stronie serwera.', powod: 'brak_klucza' }
  }));

  await page.click('#btnPlan');

  await expect(page.locator('#planLiczby')).toContainText('osób na grupę');
  await expect(page.locator('#planStatus')).toContainText('Liczby powyżej policzył kod');
  await expect(page.locator('#gateUzas')).toBeHidden();
});
