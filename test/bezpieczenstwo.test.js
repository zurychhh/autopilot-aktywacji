import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { obsluz } from '../api/_lib/http.js';
import { sprawdzZrodlo, dozwoloneZrodla } from '../api/_lib/origin.js';
import { wyczyscLimity } from '../api/_lib/limit.js';
import zdrowie from '../api/health.js';

const korzen = (plik) => readFileSync(new URL(`../${plik}`, import.meta.url), 'utf8');

/** Wszystkie pliki tekstowe w katalogu, rekurencyjnie. */
function plikiW(katalog) {
  const baza = new URL(`../${katalog}/`, import.meta.url);
  return readdirSync(baza, { recursive: true })
    .map(n => String(n))
    .filter(n => statSync(new URL(n, baza)).isFile())
    .map(n => ({ nazwa: `${katalog}/${n}`, tresc: readFileSync(new URL(n, baza), 'utf8') }));
}

describe('Klucz nie wycieka do przeglądarki', () => {
  test('żaden plik w public/ nie zawiera prefiksu sk-ant', () => {
    for (const { nazwa, tresc } of plikiW('public')) {
      assert.ok(!tresc.includes('sk-ant'), `${nazwa} zawiera prefiks klucza`);
    }
  });

  test('żaden plik w api/ nie ma klucza wpisanego na sztywno', () => {
    for (const { nazwa, tresc } of plikiW('api')) {
      assert.ok(!tresc.includes('sk-ant'), `${nazwa} zawiera prefiks klucza`);
    }
  });

  test('gdy klucz jest ustawiony w środowisku, nie ma go w żadnym pliku public/', () => {
    const klucz = process.env.ANTHROPIC_API_KEY;
    if (!klucz) return; // w CI nie ma klucza i tak ma być
    for (const { nazwa, tresc } of plikiW('public')) {
      assert.ok(!tresc.includes(klucz), `${nazwa} zawiera wartość klucza`);
    }
  });

  test('.env.example ma tylko zaślepki, nie prawdziwe klucze', () => {
    const plik = korzen('.env.example');
    assert.equal(plik.match(/^ANTHROPIC_API_KEY=(.*)$/m)[1], 'sk-ant-...');
    assert.equal(plik.match(/^USERCOM_TOKEN=(.*)$/m)[1], '<64-znakowy-klucz-z-panelu>');
  });

  test('żadna zaślepka nie wygląda na prawdziwy sekret', () => {
    // gitleaks zgłosił fałszywy alarm na zaślepce przypominającej klucz.
    // Zaślepka ma być oczywista: w nawiasach kątowych albo z wielokropkiem.
    const podejrzane = korzen('.env.example')
      .split('\n')
      .filter(l => /^[A-Z_]*(TOKEN|KEY|SECRET)=/.test(l))
      .filter(l => {
        const v = (l.split('=')[1] || '').trim();
        // pusta wartość to brak zaślepki — nie da się jej wziąć za sekret
        return v !== '' && !v.includes('<') && !v.includes('...');
      });
    assert.deepEqual(podejrzane, [], 'zaślepka bez < > ani ... zostanie wzięta za sekret');
  });

  test('.gitignore zakrywa .env i katalog .vercel', () => {
    const g = korzen('.gitignore');
    assert.match(g, /^\.env$/m);
    assert.match(g, /^\.vercel\/$/m);
  });
});

/** Minimalna atrapa req/res. */
function atrapa({ method = 'POST', body = {}, origin, ip = '7.7.7.7' } = {}) {
  const naglowki = { 'x-forwarded-for': ip };
  if (origin) naglowki.origin = origin;
  const res = {
    kod: null, dane: null, naglowki: {},
    setHeader(k, v) { this.naglowki[k] = v; },
    status(k) { this.kod = k; return this; },
    json(d) { this.dane = d; return this; }
  };
  return [{ method, body, headers: naglowki, socket: {} }, res];
}

describe('Klucz nie wycieka w odpowiedziach /api', () => {
  const SENTYNELA = 'sk-ant-api03-TESTOWY-KLUCZ-ktorego-nie-wolno-zobaczyc';
  let byl;

  beforeEach(() => { byl = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = SENTYNELA; wyczyscLimity(); });
  afterEach(() => { if (byl === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = byl; });

  test('wyjątek z kluczem w treści nie trafia do odpowiedzi', async () => {
    const [req, res] = atrapa();
    const bylError = console.error;
    console.error = () => {};
    try {
      await obsluz(req, res, async () => { throw new Error(`401 Unauthorized dla ${SENTYNELA}`); });
    } finally { console.error = bylError; }
    const cala = JSON.stringify(res.dane);
    assert.ok(!cala.includes(SENTYNELA), 'odpowiedź zawiera klucz');
    assert.ok(!cala.includes('sk-ant'), 'odpowiedź zawiera prefiks klucza');
  });

  test('/api/health mówi, że klucz jest, ale nie mówi jaki', async () => {
    const [req, res] = atrapa({ method: 'GET' });
    await zdrowie(req, res);
    assert.equal(res.kod, 200);
    assert.equal(res.dane.klucz, true);
    const cala = JSON.stringify(res.dane);
    assert.ok(!cala.includes(SENTYNELA));
    assert.ok(!cala.includes('sk-ant'));
  });

  test('/api/health bez klucza mówi o tym wprost', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const [req, res] = atrapa({ method: 'GET' });
    await zdrowie(req, res);
    assert.equal(res.dane.klucz, false);
  });

  test('/api/health nie przyjmuje POST', async () => {
    const [req, res] = atrapa({ method: 'POST' });
    await zdrowie(req, res);
    assert.equal(res.kod, 405);
  });
});

describe('Obce źródła nie korzystają z naszego endpointu', () => {
  const env = { ALLOWED_ORIGINS: 'https://autopilot-aktywacji-ro.vercel.app, https://inna.example' };

  test('własna domena przechodzi', () => {
    assert.equal(sprawdzZrodlo('https://autopilot-aktywacji-ro.vercel.app', env).ok, true);
  });

  test('ukośnik na końcu nie psuje dopasowania', () => {
    assert.equal(sprawdzZrodlo('https://autopilot-aktywacji-ro.vercel.app/', env).ok, true);
  });

  test('obca domena jest odrzucana', () => {
    const w = sprawdzZrodlo('https://zlodziej.example', env);
    assert.equal(w.ok, false);
    assert.equal(w.powod, 'obce_zrodlo');
  });

  test('domena, która tylko zaczyna się tak samo, jest odrzucana', () => {
    assert.equal(sprawdzZrodlo('https://autopilot-aktywacji-ro.vercel.app.zlodziej.example', env).ok, false);
  });

  test('inny protokół to inne źródło', () => {
    assert.equal(sprawdzZrodlo('http://autopilot-aktywacji-ro.vercel.app', env).ok, false);
  });

  test('adres pojedynczego wdrożenia dochodzi do listy sam', () => {
    const e = { VERCEL_URL: 'autopilot-aktywacji-ro-abc123.vercel.app' };
    assert.deepEqual(dozwoloneZrodla(e), ['https://autopilot-aktywacji-ro-abc123.vercel.app']);
    assert.equal(sprawdzZrodlo('https://autopilot-aktywacji-ro-abc123.vercel.app', e).ok, true);
  });

  test('alias produkcyjny projektu też dochodzi sam', () => {
    // To pod nim działa strona. VERCEL_URL wskazuje pojedyncze wdrożenie,
    // więc samo nie wystarczy i bez tego produkcja dostawałaby 403.
    const e = { VERCEL_PROJECT_PRODUCTION_URL: 'autopilot-aktywacji-ro.vercel.app' };
    assert.equal(sprawdzZrodlo('https://autopilot-aktywacji-ro.vercel.app', e).ok, true);
  });

  test('własna domena produkcyjna działa tak samo', () => {
    const e = { VERCEL_PROJECT_PRODUCTION_URL: 'autopilot.example.com' };
    assert.equal(sprawdzZrodlo('https://autopilot.example.com', e).ok, true);
    assert.equal(sprawdzZrodlo('https://zlodziej.example', e).ok, false);
  });

  test('wszystkie trzy adresy od hostingu trafiają na listę naraz', () => {
    const e = {
      VERCEL_PROJECT_PRODUCTION_URL: 'autopilot-aktywacji-ro.vercel.app',
      VERCEL_URL: 'autopilot-aktywacji-ro-abc123.vercel.app',
      VERCEL_BRANCH_URL: 'autopilot-aktywacji-ro-git-main.vercel.app'
    };
    assert.deepEqual(dozwoloneZrodla(e), [
      'https://autopilot-aktywacji-ro.vercel.app',
      'https://autopilot-aktywacji-ro-abc123.vercel.app',
      'https://autopilot-aktywacji-ro-git-main.vercel.app'
    ]);
  });

  test('brak nagłówka Origin przechodzi — tak wygląda curl i monitoring', () => {
    assert.equal(sprawdzZrodlo(undefined, env).powod, 'brak_origin');
    assert.equal(sprawdzZrodlo(undefined, env).ok, true);
  });

  test('pusta lista przepuszcza wszystko — to tryb pracy lokalnej', () => {
    assert.equal(sprawdzZrodlo('https://cokolwiek.example', {}).ok, true);
  });

  test('żądanie z obcej domeny dostaje 403 i nie zużywa limitu', async () => {
    wyczyscLimity();
    const bylo = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'https://autopilot-aktywacji-ro.vercel.app';
    try {
      let wywolano = 0;
      const [req, res] = atrapa({ origin: 'https://zlodziej.example' });
      await obsluz(req, res, async () => { wywolano++; return {}; });
      assert.equal(res.kod, 403);
      assert.equal(res.dane.powod, 'obce_zrodlo');
      assert.equal(wywolano, 0, 'model nie został wywołany');
      assert.equal(res.naglowki['x-limit-zostalo'], undefined, 'limit nie został naruszony');
    } finally {
      if (bylo === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = bylo;
    }
  });
});

describe('Tylko tryb jasny', () => {
  const STRONY = [
    'public/index.html', 'public/styl-mapa.css', 'public/mapa/index.html',
    'public/mapa/podglad.html', 'public/z/index.html', 'public/kokpit/index.html',
    'public/operator/index.html', 'public/autopilot/index.html', 'public/rozpoznanie/index.html',
    'public/prywatnosc.html'
  ];
  const czytaj = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

  test('żadna strona nie ma reguł trybu ciemnego', () => {
    // Tryb ciemny zmieniał kolor marki z #0606e3 na fioletowy, a to już nie
    // jest identyfikacja Locona. bezpiecznarodzina.pl też go nie ma.
    for (const p of STRONY) {
      const s = czytaj(p);
      assert.ok(!/prefers-color-scheme\s*:\s*dark/.test(s), `${p}: reguła prefers-color-scheme: dark`);
      assert.ok(!/color-scheme\s*:\s*dark/.test(s), `${p}: color-scheme: dark`);
      assert.ok(!/data-theme\s*=\s*["']dark/.test(s), `${p}: wariant data-theme="dark"`);
    }
  });

  test('strony deklarują tryb jasny, żeby przeglądarka ich nie przyciemniała', () => {
    // Bez deklaracji przeglądarka włącza własne auto-przyciemnianie
    assert.match(czytaj('public/index.html'), /color-scheme\s*:\s*light/);
    assert.match(czytaj('public/styl-mapa.css'), /color-scheme\s*:\s*light/);
  });

  test('kolor marki zostaje marką Locona', () => {
    assert.match(czytaj('public/index.html'), /--brand\s*:\s*#0606e3/);
    assert.match(czytaj('public/styl-mapa.css'), /--brand\s*:\s*#0606e3/);
  });
});

describe('Wspólna stopka', () => {
  const STRONY = [
    'public/index.html', 'public/kokpit/index.html', 'public/mapa/index.html',
    'public/mapa/podglad.html', 'public/z/index.html', 'public/operator/index.html',
    'public/autopilot/index.html', 'public/rozpoznanie/index.html', 'public/prywatnosc.html'
  ];

  test('każda strona wczytuje jeden wspólny plik stopki', () => {
    for (const p of STRONY) {
      const s = readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
      assert.match(s, /<script type="module" src="\/stopka\.js"><\/script>/, `${p}: brak stopki`);
      assert.equal((s.match(/stopka\.js/g) || []).length, 1, `${p}: stopka wczytana więcej niż raz`);
    }
  });

  test('żadna strona nie ma własnej kopii listy modułów', () => {
    // Dziewięć kopii listy to gwarantowane rozjechanie się po pierwszej zmianie
    for (const p of STRONY) {
      const s = readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
      const stopka = s.match(/<footer[^>]*>([\s\S]*?)<\/footer>/);
      assert.ok(stopka, `${p}: brak znacznika footer`);
      assert.equal(stopka[1].trim(), '', `${p}: stopka ma treść wpisaną w HTML`);
    }
  });
});

describe('Opis biznesowy na stronie głównej', () => {
  const html = () => readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  /** Tekst uzgodniony z klientem — pilnujemy go co do zdania. */
  const AKAPITY = [
    ['Co to jest.', 'Narzędzie dla zespołu Customer Success Bezpiecznej Rodziny, które zamienia dane lejka onboardingu w decyzje. W jednym cyklu wskazuje, gdzie tracimy najwięcej klientów przed pierwszą wartością, przygotowuje komunikaty, które mają tę stratę zmniejszyć, liczy, jak duży i jak długi musi być test, ocenia wynik i proponuje decyzję. Wniosek trafia do banku wiedzy, z którego korzystają kolejne testy i wejście na nowe rynki. Zwycięzca staje się nowym punktem odniesienia, a cykl rusza od nowa po każdym rozstrzygniętym teście.'],
    ['Kto co robi.', 'Liczby liczy kod, treści pisze AI (Claude), a o hipotezie, treściach i wdrożeniu decyduje człowiek.'],
    ['Co jest prawdziwe.', 'Lejek wejściowy, AI piszące treści na żywo i mapa bez aplikacji działają naprawdę. Wyniki testu, dane kokpitu i rozpoznanie numeru przez sieć operatora są przykładowe i tak oznaczone.']
  ];

  test('trzy akapity o uzgodnionej treści, co do słowa', () => {
    const blok = html().match(/<div class="opis">([\s\S]*?)<\/div>/);
    assert.ok(blok, 'brak bloku z opisem');
    const akapity = [...blok[1].matchAll(/<p><b>(.*?)<\/b>\s*([\s\S]*?)<\/p>/g)]
      .map(m => [m[1], m[2].trim()]);
    assert.equal(akapity.length, 3);
    AKAPITY.forEach(([naglowek, tresc], i) => {
      assert.equal(akapity[i][0], naglowek);
      assert.equal(akapity[i][1], tresc, `akapit „${naglowek}” różni się od uzgodnionego`);
    });
  });

  test('opis stoi nad trzema kartami, nie pod nimi', () => {
    const s = html();
    assert.ok(s.indexOf('<div class="opis">') < s.indexOf('<div class="tldr">'));
  });

  test('zwykły tekst, bez ramek', () => {
    const s = html();
    const styl = s.match(/\.opis\{[^}]*\}/)[0];
    assert.ok(!/border\s*:/.test(styl), 'opis ma ramkę');
    assert.ok(!/background\s*:/.test(styl), 'opis ma tło');
  });
});

describe('Konfiguracja CI', () => {
  const ci = () => readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');

  test('każde zadanie ma limit czasu', () => {
    // Pobieranie przeglądarki potrafiło zawisnąć bez końca i blokować scalanie.
    // Bierzemy tylko blok jobs: — klucze z sekcji on: mają to samo wcięcie.
    const bloki = ci().split(/^jobs:$/m)[1].split(/^  (?=\w)/m).filter(b => b.trim());
    assert.equal(bloki.length, 3, `zadań: ${bloki.length}`);
    for (const z of bloki) {
      const nazwa = z.split('\n')[0];
      assert.match(z, /timeout-minutes:\s*\d+/, `zadanie ${nazwa} bez limitu czasu`);
    }
    assert.match(ci(), /timeout-minutes:\s*15/, 'zadanie przeglądarkowe ma mieć 15 minut');
  });

  test('push uruchamia testy tylko na main', () => {
    // Bez tego każdy push odpala ten sam kod dwa razy: z push i z pull_request
    const s = ci();
    assert.match(s, /push:\s*\n\s*branches:\s*\[main\]/);
  });

  test('przeglądarka jest cache’owana po wersji Playwrighta', () => {
    const s = ci();
    assert.match(s, /actions\/cache@v4/);
    assert.match(s, /~\/\.cache\/ms-playwright/);
    // Wersja w kluczu: przy zmianie biblioteki cache unieważnia się sam
    assert.match(s, /key:\s*playwright-\$\{\{ runner\.os \}\}-\$\{\{ steps\.pw\.outputs\.wersja \}\}/);
  });

  test('po trafieniu w cache nadal dociągamy zależności systemowe', () => {
    // Leżą poza katalogiem domowym, więc cache ich nie obejmuje
    const s = ci();
    assert.match(s, /install-deps chromium\n\s*if: steps\.cache-pw\.outputs\.cache-hit == 'true'/);
    assert.match(s, /install --with-deps chromium\n\s*if: steps\.cache-pw\.outputs\.cache-hit != 'true'/);
  });
});
