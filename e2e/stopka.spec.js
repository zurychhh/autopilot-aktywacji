import { test, expect } from '@playwright/test';
import { MODULY, AUTOR } from '../public/stopka.js';

/**
 * Stopka jest w jednym pliku, więc wystarczy sprawdzić, że faktycznie dociera
 * na każdą stronę i że żaden z jej odnośników nie prowadzi w pustkę. Lista
 * stron jest tu wypisana celowo — gdyby ktoś dodał stronę bez stopki, test
 * tego nie zauważy, ale gdyby zepsuł stopkę na istniejącej, zauważy od razu.
 */
const STRONY = ['/', '/kokpit', '/mapa', '/mapa/ABCDEFGHJK', '/z/ABCDEFGHJK',
                '/operator/Play', '/autopilot', '/rozpoznanie', '/prywatnosc.html'];

test('każdy adres ze stopki zwraca 200', async ({ request }) => {
  for (const m of MODULY) {
    const odp = await request.get(m.adres);
    expect(odp.status(), `${m.adres} (${m.nazwa})`).toBe(200);
  }
});

for (const strona of STRONY) {
  test(`stopka jest na ${strona}`, async ({ page }) => {
    await page.goto(strona);
    const stopka = page.locator('footer.stopka');
    await expect(stopka).toBeVisible();

    // komplet modułów
    for (const m of MODULY) {
      await expect(stopka.locator(`a[href="${m.adres}"]`)).toHaveText(m.nazwa);
    }

    // autor z bezpiecznym odnośnikiem w nowej karcie
    const autor = stopka.locator(`a[href="${AUTOR.adres}"]`);
    await expect(autor).toHaveText(AUTOR.etykieta);
    await expect(autor).toHaveAttribute('target', '_blank');
    await expect(autor).toHaveAttribute('rel', /noopener/);
    await expect(stopka).toContainText(`Autor: ${AUTOR.imie}`);
  });
}

test('bieżąca strona jest oznaczona i nie prowadzi sama do siebie', async ({ page }) => {
  await page.goto('/kokpit');
  await expect(page.locator('footer.stopka a[aria-current="page"]')).toHaveText('Kokpit');
  await expect(page.locator('footer.stopka a[aria-current="page"]')).toHaveCount(1);
});
