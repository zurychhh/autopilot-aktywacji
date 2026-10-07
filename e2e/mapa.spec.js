import { test, expect } from '@playwright/test';

/**
 * Pełna ścieżka mapy bez aplikacji: rodzic tworzy prośbę, bliska osoba zgadza
 * się na jednorazowe udostępnienie, punkt pojawia się na mapie.
 *
 * Ten test istnieje z konkretnego powodu. Nagłówek
 * `permissions-policy: geolocation=()` szedł na wszystkie adresy i blokował
 * `navigator.geolocation` na stronie zgody — mimo że użytkownik się zgadzał,
 * przeglądarka odmawiała. Żaden test jednostkowy tego nie widział, bo to
 * zachowanie przeglądarki wobec nagłówka odpowiedzi, a nie logiki.
 */

async function utworzProsbe(page) {
  await page.goto('/mapa');
  await page.getByLabel('Kogo chcesz zobaczyć?').fill('Zosia');
  await page.getByLabel('Jak ma Cię rozpoznać?').fill('Mama');
  await page.getByRole('button', { name: 'Przygotuj prośbę' }).click();

  const link = page.locator('#link');
  await expect(link).toContainText('/z/');
  const kod = (await link.textContent()).match(/\/z\/([A-Z0-9]+)/)[1];
  return kod;
}

test('nagłówek pozwala na geolokalizację na stronie zgody, a nie wszędzie', async ({ request }) => {
  const zgoda = await request.get('/z/ABCDEFGHJK');
  expect(zgoda.headers()['permissions-policy']).toContain('geolocation=(self)');

  const glowna = await request.get('/');
  expect(glowna.headers()['permissions-policy']).toContain('geolocation=()');
});

test('prośba, zgoda, punkt na mapie', async ({ page, context }) => {
  const kod = await utworzProsbe(page);

  // Bliska osoba otwiera link: widzi, kto prosi i o kogo chodzi
  const bliski = await context.newPage();
  await bliski.goto(`/z/${kod}`);
  await expect(bliski.locator('#naglowek')).toHaveText('Mama prosi o Twoją lokalizację');
  await expect(bliski.locator('#opis')).toContainText('Zosia');

  // Zgoda uruchamia prawdziwe navigator.geolocation — z przyznanym pozwoleniem
  await bliski.getByRole('button', { name: 'Udostępnij raz' }).click();
  await expect(bliski.locator('#koniecTytul')).toHaveText('Gotowe', { timeout: 15_000 });

  // Rodzic widzi punkt na mapie
  await page.goto(`/mapa/${kod}`);
  await expect(page.locator('#naglowek')).toHaveText('Zosia jest tutaj', { timeout: 15_000 });
  await expect(page.locator('.leaflet-marker-icon')).toBeVisible();
  await expect(page.locator('#dalej')).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
});

test('odmowa kasuje prośbę i nie pokazuje lokalizacji', async ({ page, context }) => {
  const kod = await utworzProsbe(page);

  const bliski = await context.newPage();
  await bliski.goto(`/z/${kod}`);
  await bliski.getByRole('button', { name: 'Odmów' }).click();
  await expect(bliski.locator('#koniecTytul')).toHaveText('Odmówiono');

  await page.goto(`/mapa/${kod}`);
  await expect(page.locator('#naglowek')).toHaveText('Prośba wygasła', { timeout: 15_000 });
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);
});

test('bez zgody przeglądarki nic nie jest wysyłane', async ({ page, context }) => {
  const kod = await utworzProsbe(page);
  await context.clearPermissions(); // przeglądarka odmawia dostępu do lokalizacji

  const bliski = await context.newPage();
  await bliski.goto(`/z/${kod}`);
  await bliski.getByRole('button', { name: 'Udostępnij raz' }).click();
  await expect(bliski.locator('#stan')).toContainText('Nic nie zostało wysłane', { timeout: 15_000 });

  await page.goto(`/mapa/${kod}`);
  await expect(page.locator('#naglowek')).toHaveText('Czekam na zgodę…');
});
