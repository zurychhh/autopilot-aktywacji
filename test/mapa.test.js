import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { magazynPamiec, magazynUpstash, magazyn, daneUpstash, TRYB_DEMO, TRYB_TRWALY } from '../lib/magazyn.js';
import { uslugaMapy, losowyKod, WAZNOSC_SEKUNDY, DLUGOSC_KODU } from '../lib/mapa.js';

/** Zegar, którym da się przesunąć czas bez czekania. */
function zegar(start = 1_700_000_000_000) {
  let t = start;
  return { teraz: () => t, przesun: (sekundy) => { t += sekundy * 1000; } };
}

function usluga(opcje = {}) {
  const m = magazynPamiec();
  const z = opcje.zegar || zegar();
  let i = 0;
  const losuj = () => { i = (i * 9301 + 49297) % 233280; return i / 233280; };
  return { u: uslugaMapy(m, { losuj, teraz: z.teraz }), m, z };
}

describe('Kod prośby', () => {
  test('ma ustaloną długość', () => {
    assert.equal(losowyKod(() => 0.5).length, DLUGOSC_KODU);
  });

  test('nie zawiera znaków łatwych do pomylenia', () => {
    const kod = losowyKod(() => 0.99);
    assert.ok(!/[O0I1]/.test(kod), `kod ${kod} zawiera mylące znaki`);
  });

  test('dwa kody pod rząd są różne', () => {
    let n = 0;
    const losuj = () => { n += 0.137; return n % 1; };
    assert.notEqual(losowyKod(losuj), losowyKod(losuj));
  });
});

describe('Prośba o lokalizację', () => {
  test('bez imienia nie powstaje', async () => {
    const { u } = usluga();
    await assert.rejects(() => u.utworzProsbe({ imie: '  ' }), /Podaj imię/);
  });

  test('powstaje z kodem i godzinną ważnością', async () => {
    const { u, z } = usluga();
    const p = await u.utworzProsbe({ imie: 'Zosia', odKogo: 'Mama' });
    assert.equal(p.kod.length, DLUGOSC_KODU);
    assert.equal(p.waznoscSekundy, WAZNOSC_SEKUNDY);
    assert.equal(p.wygasa, z.teraz() + WAZNOSC_SEKUNDY * 1000);
  });

  test('osoba lokalizowana widzi, kto prosi i o kogo chodzi', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia', odKogo: 'Mama' });
    const w = await u.pokazProsbe(kod);
    assert.equal(w.imie, 'Zosia');
    assert.equal(w.odKogo, 'Mama');
    assert.equal(w.stan, 'czeka');
  });

  test('podgląd prośby nie zdradza lokalizacji, bo jeszcze jej nie ma', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    assert.equal('lokalizacja' in (await u.pokazProsbe(kod)), false);
  });

  test('imię jest przycinane i czyszczone ze znaków znaczników', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: '  <b>Zosia</b>  ' });
    assert.equal((await u.pokazProsbe(kod)).imie, 'bZosia/b');
  });
});

describe('Bez zgody nie ma lokalizacji', () => {
  test('przed zgodą proszący nie dostaje współrzędnych', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    const w = await u.pobierzLokalizacje(kod);
    assert.equal(w.stan, 'czeka');
    assert.equal(w.lokalizacja, undefined);
  });

  test('po zgodzie współrzędne są dostępne', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    await u.zapiszZgode(kod, { lat: 52.23, lon: 21.01, dokladnosc: 20 });
    const w = await u.pobierzLokalizacje(kod);
    assert.equal(w.stan, 'zgoda');
    assert.equal(w.lokalizacja.lat, 52.23);
    assert.equal(w.lokalizacja.dokladnosc, 20);
  });

  test('zgoda na nieistniejący kod nie tworzy wpisu', async () => {
    const { u } = usluga();
    const w = await u.zapiszZgode('NIEMAKODU', { lat: 1, lon: 1 });
    assert.equal(w.ok, false);
    assert.equal(w.powod, 'brak_lub_wygasla');
  });

  test('bzdurne współrzędne są odrzucane', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    for (const zle of [{ lat: 'x', lon: 1 }, { lat: 91, lon: 1 }, { lat: 1, lon: 181 }, { lat: NaN, lon: 1 }]) {
      assert.equal((await u.zapiszZgode(kod, zle)).powod, 'zle_wspolrzedne', JSON.stringify(zle));
    }
    assert.equal((await u.pobierzLokalizacje(kod)).stan, 'czeka', 'stan nie mógł się zmienić');
  });
});

describe('Odmowa kasuje dane', () => {
  test('po odmowie prośba znika', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    await u.zapiszOdmowe(kod);
    assert.equal(await u.pokazProsbe(kod), null);
    assert.equal((await u.pobierzLokalizacje(kod)).stan, 'brak_lub_wygasla');
  });

  test('odmowa po wcześniejszej zgodzie kasuje także lokalizację', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    await u.zapiszZgode(kod, { lat: 52.23, lon: 21.01 });
    await u.zapiszOdmowe(kod);
    const w = await u.pobierzLokalizacje(kod);
    assert.equal(w.stan, 'brak_lub_wygasla');
    assert.equal(w.lokalizacja, undefined);
  });

  test('odmowa na nieistniejący kod niczego nie psuje', async () => {
    const { u } = usluga();
    assert.equal((await u.zapiszOdmowe('NIEMAKODU')).ok, true);
  });
});

describe('Wygasanie po godzinie', () => {
  test('tuż przed godziną prośba jeszcze żyje', async () => {
    const z = zegar();
    const { u } = usluga({ zegar: z });
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    z.przesun(WAZNOSC_SEKUNDY - 10);
    assert.notEqual(await u.pokazProsbe(kod), null);
  });

  test('po godzinie prośba znika', async () => {
    const z = zegar();
    const { u } = usluga({ zegar: z });
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    z.przesun(WAZNOSC_SEKUNDY + 1);
    assert.equal(await u.pokazProsbe(kod), null);
  });

  test('lokalizacja też znika po godzinie od utworzenia prośby', async () => {
    const z = zegar();
    const { u } = usluga({ zegar: z });
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    z.przesun(60);
    await u.zapiszZgode(kod, { lat: 52.23, lon: 21.01 });
    assert.equal((await u.pobierzLokalizacje(kod)).stan, 'zgoda');

    z.przesun(WAZNOSC_SEKUNDY);
    assert.equal((await u.pobierzLokalizacje(kod)).stan, 'brak_lub_wygasla',
      'zgoda nie może przedłużać życia danych');
  });
});

describe('Liczniki mikrokonwersji', () => {
  test('liczą każdy krok ścieżki', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    await u.pokazProsbe(kod);
    await u.zapiszZgode(kod, { lat: 52.23, lon: 21.01 });
    await u.pobierzLokalizacje(kod);

    const l = await u.liczniki();
    assert.equal(l.link_utworzony, 1);
    assert.equal(l.link_otwarty, 1);
    assert.equal(l.zgoda, 1);
    assert.equal(l.mapa_wyswietlona, 1);
    assert.equal(l.odmowa, 0);
  });

  test('odmowa jest liczona osobno', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    await u.zapiszOdmowe(kod);
    const l = await u.liczniki();
    assert.equal(l.odmowa, 1);
    assert.equal(l.zgoda, 0);
  });
});

describe('Magazyn', () => {
  test('bez zmiennych Upstasha wchodzi tryb demo', () => {
    const byly = [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN];
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    try {
      const m = magazyn();
      assert.equal(m.tryb, TRYB_DEMO);
      assert.equal(m.trwaly, false, 'tryb demo musi się przyznawać, że nie jest trwały');
    } finally {
      if (byly[0]) process.env.UPSTASH_REDIS_REST_URL = byly[0];
      if (byly[1]) process.env.UPSTASH_REDIS_REST_TOKEN = byly[1];
    }
  });

  test('Upstash bez konfiguracji odmawia zamiast cicho nie działać', () => {
    assert.throws(() => magazynUpstash({ url: undefined, token: undefined }), /UPSTASH/);
  });

  test('Upstash używa REST API z tokenem w nagłówku', async () => {
    const wywolania = [];
    const fetchImpl = async (url, opcje) => {
      wywolania.push({ url, ...opcje });
      return { ok: true, status: 200, json: async () => ({ result: null }) };
    };
    const m = magazynUpstash({ url: 'https://redis.example/', token: 'TOKEN', fetchImpl });
    await m.ustaw('k', { a: 1 }, 60);
    assert.match(wywolania[0].url, /^https:\/\/redis\.example\/set\/k\//);
    assert.match(wywolania[0].url, /EX\/60$/);
    assert.equal(wywolania[0].headers.authorization, 'Bearer TOKEN');
  });

  test('Upstash zgłasza błąd zamiast udawać pusty wynik', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500 });
    const m = magazynUpstash({ url: 'https://r.example', token: 't', fetchImpl });
    await assert.rejects(() => m.pobierz('k'), /500/);
  });

  test('ta sama usługa działa na obu magazynach', async () => {
    const udawanyRedis = new Map();
    const fetchImpl = async (url) => {
      const [, cmd, klucz, wartosc] = url.replace('https://r.example/', '').match(/^([a-z]+)\/([^/]+)(?:\/([^/]+))?/) ? ['', ...url.replace('https://r.example/', '').split('/')] : [];
      let result = null;
      if (cmd === 'set') { udawanyRedis.set(decodeURIComponent(klucz), decodeURIComponent(wartosc)); result = 'OK'; }
      if (cmd === 'get') result = udawanyRedis.get(decodeURIComponent(klucz)) ?? null;
      if (cmd === 'del') { udawanyRedis.delete(decodeURIComponent(klucz)); result = 1; }
      if (cmd === 'incr') { const k = decodeURIComponent(klucz); const n = (Number(udawanyRedis.get(k)) || 0) + 1; udawanyRedis.set(k, String(n)); result = n; }
      if (cmd === 'expire') result = 1;
      return { ok: true, status: 200, json: async () => ({ result }) };
    };
    const m = magazynUpstash({ url: 'https://r.example', token: 't', fetchImpl });
    assert.equal(m.tryb, TRYB_TRWALY);
    const u = uslugaMapy(m, { losuj: () => 0.5 });
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    assert.equal((await u.pokazProsbe(kod)).imie, 'Zosia');
    await u.zapiszZgode(kod, { lat: 52.23, lon: 21.01 });
    assert.equal((await u.pobierzLokalizacje(kod)).stan, 'zgoda');
    await u.zapiszOdmowe(kod);
    assert.equal(await u.pokazProsbe(kod), null);
  });
});

describe('Dane dostępowe Upstasha', () => {
  test('nazwy z ręcznej konfiguracji', () => {
    assert.deepEqual(daneUpstash({ UPSTASH_REDIS_REST_URL: 'https://a', UPSTASH_REDIS_REST_TOKEN: 't' }), { url: 'https://a', token: 't' });
  });
  test('nazwy z integracji Vercel Marketplace, także z prefiksem', () => {
    assert.deepEqual(daneUpstash({ KV_REST_API_URL: 'https://b', KV_REST_API_TOKEN: 'u' }), { url: 'https://b', token: 'u' });
    assert.deepEqual(daneUpstash({ STORAGE_KV_REST_API_URL: 'https://c', STORAGE_KV_REST_API_TOKEN: 'w', STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'r' }), { url: 'https://c', token: 'w' });
  });
  test('bez zmiennych zostaje tryb demo', () => {
    assert.deepEqual(daneUpstash({}), { url: undefined, token: undefined });
  });
});

describe('Zerowanie liczników', () => {
  test('czyści liczniki i nie dotyka próśb', async () => {
    const { u } = usluga();
    const { kod } = await u.utworzProsbe({ imie: 'Zosia' });
    await u.zapiszZgode(kod, { lat: 52.23, lon: 21.01 });
    await u.pobierzLokalizacje(kod);
    assert.ok((await u.liczniki()).link_utworzony > 0);

    const w = await u.wyzerujLiczniki();
    assert.equal(w.wyzerowano, 5);
    assert.deepEqual(await u.liczniki(), {
      link_utworzony: 0, link_otwarty: 0, zgoda: 0, odmowa: 0, mapa_wyswietlona: 0
    });

    // prośba i lokalizacja zostają nietknięte
    const po = await u.pobierzLokalizacje(kod);
    assert.equal(po.stan, 'zgoda');
    assert.equal(po.lokalizacja.lat, 52.23);
  });

  test('po wyzerowaniu liczniki znów rosną od zera', async () => {
    const { u } = usluga();
    await u.utworzProsbe({ imie: 'A' });
    await u.wyzerujLiczniki();
    await u.utworzProsbe({ imie: 'B' });
    assert.equal((await u.liczniki()).link_utworzony, 1);
  });
});

describe('Rozpoznawanie nazwy działania w adresie', () => {
  const nazwaDzialania = (url) => (url.match(/[?&]akcja=([a-z-]+)/) || [])[1];

  test('nazwy z myślnikiem są rozpoznawane w całości', () => {
    // Wzorzec bez myślnika ucinał „wyzeruj-liczniki” do „wyzeruj”,
    // przez co działanie wpadało w gałąź nieznanego
    assert.equal(nazwaDzialania('/api/mapa?akcja=wyzeruj-liczniki'), 'wyzeruj-liczniki');
  });

  test('zwykłe nazwy działają jak wcześniej', () => {
    for (const a of ['utworz', 'prosba', 'zgoda', 'odmowa', 'lokalizacja', 'liczniki', 'zapros', 'zaproszenia']) {
      assert.equal(nazwaDzialania(`/api/mapa?akcja=${a}&kod=X`), a);
    }
  });
});
