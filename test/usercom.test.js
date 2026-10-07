import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { klientUserCom, BladUserCom } from '../lib/usercom.js';

const BASE = 'https://locon.user.com/api/public/';
const TOKEN = 'T'.repeat(64);

/** Atrapa fetch: zapisuje wywołania i oddaje zaplanowaną odpowiedź. */
function atrapaFetch(odpowiedzi = [{ status: 200, body: {} }]) {
  const wywolania = [];
  const kolejka = [...odpowiedzi];
  const fn = async (url, opcje) => {
    wywolania.push({ url, ...opcje });
    const { status = 200, body = {} } = kolejka.length > 1 ? kolejka.shift() : kolejka[0];
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    };
  };
  fn.wywolania = wywolania;
  return fn;
}

const naZywo = (fetchImpl) => klientUserCom({ token: TOKEN, baseUrl: BASE, dryRun: false, fetchImpl });

describe('Klient User.com: tryb na żywo', () => {
  test('lista segmentów idzie pod GET /segments/ z obydwoma nagłówkami', async () => {
    const f = atrapaFetch([{ body: { results: [{ id: 1, name: 'A' }] } }]);
    const wynik = await naZywo(f).listSegments();

    const [w] = f.wywolania;
    assert.equal(w.url, 'https://locon.user.com/api/public/segments/');
    assert.equal(w.method, 'GET');
    assert.equal(w.headers.authorization, `Token ${TOKEN}`);
    assert.equal(w.headers.accept, '*/*; version=2', 'bez wersji API zwraca błędy');
    assert.deepEqual(wynik.segmenty, [{ id: 1, name: 'A' }]);
  });

  test('użytkownik po id trafia na /users/:id/', async () => {
    const f = atrapaFetch([{ body: { id: 7, email: 'a@example.com' } }]);
    const wynik = await naZywo(f).getUser({ id: '7' });
    assert.equal(f.wywolania[0].url, 'https://locon.user.com/api/public/users/7/');
    assert.equal(wynik.uzytkownik.id, 7);
  });

  test('użytkownik po e-mailu idzie przez /users/search/ z parametrem', async () => {
    const f = atrapaFetch([{ body: { results: [{ id: 9 }] } }]);
    const wynik = await naZywo(f).getUser({ email: 'a@example.com' });
    const url = new URL(f.wywolania[0].url);
    assert.equal(url.pathname, '/api/public/users/search/');
    assert.equal(url.searchParams.get('email'), 'a@example.com');
    assert.equal(wynik.uzytkownik.id, 9);
  });

  test('puste parametry nie trafiają do zapytania', async () => {
    const f = atrapaFetch([{ body: { results: [] } }]);
    await naZywo(f).getUser({ email: 'a@example.com' });
    assert.equal(new URL(f.wywolania[0].url).searchParams.has('phone_number'), false);
  });

  test('zdarzenie idzie POST-em na /events/ z ciałem w oczekiwanym kształcie', async () => {
    const f = atrapaFetch([{ body: { id: 5 } }]);
    await naZywo(f).createEvent({ userId: '55', nazwa: 'pierwsza_lokalizacja', dane: { kanal: 'operator' } });

    const w = f.wywolania[0];
    assert.equal(w.url, 'https://locon.user.com/api/public/events/');
    assert.equal(w.method, 'POST');
    assert.deepEqual(JSON.parse(w.body), {
      user_id: '55', name: 'pierwsza_lokalizacja', data: { kanal: 'operator' }
    });
  });

  test('kampania powstaje jako szkic, nie jako wysyłka', async () => {
    const f = atrapaFetch([{ body: { id: 900 } }]);
    await naZywo(f).createTestCampaign({ nazwa: 'Wariant B', tresc: 'Play: krotka tresc', segmentId: 101 });

    const cialo = JSON.parse(f.wywolania[0].body);
    assert.equal(cialo.status, 'draft', 'kampania nie może powstawać jako gotowa do wysyłki');
    assert.equal(cialo.segment, 101);
    assert.equal(f.wywolania[0].method, 'POST');
  });

  test('statystyki kampanii e-mail idą na inny endpoint niż SMS', async () => {
    const f = atrapaFetch([{ body: { id: 1, stats: { wyslane: 10 } } }]);
    await naZywo(f).getCampaignStats({ id: 1, kanal: 'email' });
    assert.match(f.wywolania[0].url, /\/email-campaign\/\?id=1$/);

    const g = atrapaFetch([{ body: { id: 1 } }]);
    await naZywo(g).getCampaignStats({ id: 1, kanal: 'sms' });
    assert.match(g.wywolania[0].url, /\/sms-campaign\/\?id=1$/);
  });

  test('odpowiedź błędu zamienia się w BladUserCom ze statusem i treścią', async () => {
    const f = atrapaFetch([{ status: 401, body: { detail: 'Invalid token.' } }]);
    await assert.rejects(
      () => naZywo(f).listSegments(),
      (e) => {
        assert.ok(e instanceof BladUserCom);
        assert.equal(e.status, 401);
        assert.deepEqual(e.tresc, { detail: 'Invalid token.' });
        return true;
      }
    );
  });

  test('odpowiedź, która nie jest JSON-em, nie wywraca klienta', async () => {
    const f = atrapaFetch([{ status: 502, body: '<html>Bad Gateway</html>' }]);
    await assert.rejects(() => naZywo(f).listSegments(), (e) => e.tresc === '<html>Bad Gateway</html>');
  });

  test('brak adresu albo tokenu zatrzymuje wywołanie przed siecią', async () => {
    const f = atrapaFetch();
    await assert.rejects(
      () => klientUserCom({ token: TOKEN, baseUrl: undefined, dryRun: false, fetchImpl: f }).listSegments(),
      /USERCOM_BASE_URL/
    );
    await assert.rejects(
      () => klientUserCom({ token: undefined, baseUrl: BASE, dryRun: false, fetchImpl: f }).listSegments(),
      /USERCOM_TOKEN/
    );
    assert.equal(f.wywolania.length, 0);
  });

  test('adres bazowy bez ukośnika na końcu też działa', async () => {
    const f = atrapaFetch([{ body: {} }]);
    await klientUserCom({ token: TOKEN, baseUrl: 'https://locon.user.com/api/public', dryRun: false, fetchImpl: f }).listSegments();
    assert.equal(f.wywolania[0].url, 'https://locon.user.com/api/public/segments/');
  });
});

describe('Klient User.com: DRY_RUN', () => {
  const suchy = (fetchImpl) => klientUserCom({ token: TOKEN, baseUrl: BASE, dryRun: true, fetchImpl });

  test('domyślnie DRY_RUN jest włączony', () => {
    const byl = process.env.DRY_RUN;
    delete process.env.DRY_RUN;
    try {
      assert.equal(klientUserCom({ token: TOKEN, baseUrl: BASE }).dryRun, true);
    } finally { if (byl !== undefined) process.env.DRY_RUN = byl; }
  });

  test('wyłącza się wyłącznie przez DRY_RUN=false', () => {
    const byl = process.env.DRY_RUN;
    try {
      process.env.DRY_RUN = 'false';
      assert.equal(klientUserCom({ token: TOKEN, baseUrl: BASE }).dryRun, false);
      process.env.DRY_RUN = 'nie';
      assert.equal(klientUserCom({ token: TOKEN, baseUrl: BASE }).dryRun, true, 'każda inna wartość zostawia bezpieczny tryb');
    } finally { if (byl === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = byl; }
  });

  test('żadne narzędzie nie dotyka sieci', async () => {
    const f = atrapaFetch();
    const k = suchy(f);
    await k.listSegments();
    await k.getUser({ email: 'a@example.com' });
    await k.createEvent({ userId: '1', nazwa: 'x' });
    await k.createTestCampaign({ nazwa: 'x', tresc: 'krotka' });
    await k.getCampaignStats({ id: 1 });
    assert.equal(f.wywolania.length, 0, 'DRY_RUN nie może wychodzić do User.com');
  });

  test('odpowiedzi są oznaczone jako przykładowe', async () => {
    const w = await suchy(atrapaFetch()).listSegments();
    assert.equal(w.tryb, 'dry-run');
    assert.match(w.uwaga, /przykładowe/i);
  });

  test('szkic kampanii pokazuje, co poszłoby do API', async () => {
    const w = await suchy(atrapaFetch()).createTestCampaign({ nazwa: 'B', tresc: 'Play: tresc', segmentId: 101 });
    assert.equal(w.wyslano_by.metoda, 'POST');
    assert.equal(w.wyslano_by.sciezka, 'sms-campaign/');
    assert.equal(w.wyslano_by.cialo.status, 'draft');
    assert.match(w.wysylka, /^nie/);
  });
});

describe('Klient User.com: sprawdzanie danych wejściowych', () => {
  const k = klientUserCom({ token: TOKEN, baseUrl: BASE, dryRun: true, fetchImpl: atrapaFetch() });

  test('SMS dłuższy niż 160 znaków jest odrzucany przed wywołaniem', async () => {
    await assert.rejects(
      () => k.createTestCampaign({ nazwa: 'x', tresc: 'a'.repeat(161) }),
      /161 znaków, limit to 160/
    );
  });

  test('dokładnie 160 znaków przechodzi', async () => {
    const w = await k.createTestCampaign({ nazwa: 'x', tresc: 'a'.repeat(160) });
    assert.equal(w.tryb, 'dry-run');
  });

  test('zdarzenie bez użytkownika albo nazwy jest odrzucane', async () => {
    await assert.rejects(() => k.createEvent({ nazwa: 'x' }), /userId i nazwa/);
    await assert.rejects(() => k.createEvent({ userId: '1' }), /userId i nazwa/);
  });

  test('użytkownik bez żadnego identyfikatora jest odrzucany', async () => {
    await assert.rejects(() => k.getUser({}), /id, email albo numer telefonu/);
  });

  test('nieznany kanał kampanii jest odrzucany', async () => {
    await assert.rejects(() => k.getCampaignStats({ kanal: 'push' }), /"sms" albo "email"/);
  });
});
