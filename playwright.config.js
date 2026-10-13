// Testy przeglądarkowe. Jest ich mało i celowo: sprawdzają rzeczy, których
// test jednostkowy nie zobaczy, bo zależą od nagłówków odpowiedzi i od zgód
// przeglądarki. Resztę pokrywa `npm test`.
//
// Serwer deweloperski stosuje nagłówki z vercel.json, więc test naprawdę
// sprawdza to, co dostanie przeglądarka na produkcji — bez tego sprawdzałby
// świat, w którym permissions-policy nie istnieje.

import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure'
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      permissions: ['geolocation'],
      geolocation: { latitude: 52.2297, longitude: 21.0122 }, // Warszawa
      locale: 'pl-PL'
    }
  }],
  webServer: {
    command: `PORT=${PORT} node tools/serve.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  }
});
