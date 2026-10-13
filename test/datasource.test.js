import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsujCsv, csvNaObiekty } from '../lib/csv.js';
import { zrodloDanych, zrodloCsv, zrodloSheets, zrodloBigQuery, BladZrodla, KROKI_LEJKA, SCHEMAT_BIGQUERY } from '../lib/datasource.js';
import { DEFAULT_FUNNEL, CHANNELS } from '../public/logic.js';

describe('Parser CSV', () => {
  test('zwykłe wiersze', () => {
    assert.deepEqual(parsujCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  });

  test('przecinek w cudzysłowie nie rozbija pola', () => {
    // Dziennik akcji ma opisy zdaniami; naiwny split psułby je po cichu
    assert.deepEqual(parsujCsv('a,b\n"jeden, dwa",3\n'), [['a', 'b'], ['jeden, dwa', '3']]);
  });

  test('podwójny cudzysłów to cudzysłów w treści', () => {
    assert.deepEqual(parsujCsv('a\n"on powiedzial ""tak"""\n'), [['a'], ['on powiedzial "tak"']]);
  });

  test('znak nowej linii w cudzysłowie zostaje w polu', () => {
    assert.deepEqual(parsujCsv('a,b\n"dwie\nlinie",x\n'), [['a', 'b'], ['dwie\nlinie', 'x']]);
  });

  test('końcówki linii Windows nie zostawiają śmieci', () => {
    assert.deepEqual(parsujCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });

  test('puste pola zostają puste, a nie znikają', () => {
    assert.deepEqual(parsujCsv('a,b,c\n1,,3\n'), [['a', 'b', 'c'], ['1', '', '3']]);
  });

  test('brak końcowego znaku nowej linii nie gubi ostatniego wiersza', () => {
    assert.deepEqual(parsujCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  test('nagłówek zamienia się w klucze obiektu', () => {
    assert.deepEqual(csvNaObiekty('data,kanal\n2026-01-01,op\n'), [{ data: '2026-01-01', kanal: 'op' }]);
  });

  test('pusty tekst daje pustą listę, a nie wyjątek', () => {
    assert.deepEqual(csvNaObiekty(''), []);
  });

  test('brakująca kolumna w wierszu daje pusty string', () => {
    assert.deepEqual(csvNaObiekty('a,b,c\n1,2\n'), [{ a: '1', b: '2', c: '' }]);
  });
});

describe('Źródło csv: zgodność z tabelą wejściową', () => {
  const zrodlo = zrodloCsv();

  test('domyślnym źródłem jest csv, więc działa bez konfiguracji', () => {
    const byl = process.env.DATA_SOURCE;
    delete process.env.DATA_SOURCE;
    try { assert.equal(zrodloDanych().zrodlo, 'csv'); }
    finally { if (byl !== undefined) process.env.DATA_SOURCE = byl; }
  });

  test('lejek ma 90 dni i wszystkie kanały', async () => {
    const w = await zrodlo.getFunnelDaily();
    const dni = [...new Set(w.map(r => r.data))];
    assert.equal(dni.length, 90);
    assert.deepEqual([...new Set(w.map(r => r.kanal))].sort(), ['op', 'own', 'ret']);
  });

  test('kanał operatora jest rozbity na czterech operatorów', async () => {
    const w = await zrodlo.getFunnelDaily();
    const op = [...new Set(w.filter(r => r.kanal === 'op').map(r => r.operator))].sort();
    assert.deepEqual(op, ['Orange', 'Play', 'Plus', 'T-Mobile']);
    assert.ok(w.filter(r => r.kanal !== 'op').every(r => r.operator === ''));
  });

  test('ostatnie 30 dni sumuje się DOKŁADNIE do tabeli wejściowej', async () => {
    const w = await zrodlo.getFunnelDaily();
    const okno = [...new Set(w.map(r => r.data))].sort().slice(-30);
    for (const { id } of CHANNELS) {
      const sumy = KROKI_LEJKA.map(k =>
        w.filter(r => r.kanal === id && okno.includes(r.data)).reduce((a, r) => a + r[k], 0));
      assert.deepEqual(sumy, DEFAULT_FUNNEL[id], `kanał ${id} nie zgadza się z tabelą`);
    }
  });

  test('lejek nigdzie nie rośnie w dół', async () => {
    const w = await zrodlo.getFunnelDaily();
    for (const r of w) {
      for (let i = 1; i < KROKI_LEJKA.length; i++) {
        assert.ok(r[KROKI_LEJKA[i]] <= r[KROKI_LEJKA[i - 1]],
          `${r.data} ${r.kanal} ${r.operator}: ${KROKI_LEJKA[i]} > ${KROKI_LEJKA[i - 1]}`);
      }
    }
  });

  test('liczby są liczbami, nie tekstem', async () => {
    const [r] = await zrodlo.getFunnelDaily();
    for (const k of KROKI_LEJKA) assert.equal(typeof r[k], 'number');
  });

  test('generator jest powtarzalny — te same dane przy każdym wczytaniu', async () => {
    assert.deepEqual(await zrodlo.getFunnelDaily(), await zrodloCsv().getFunnelDaily());
  });
});

describe('Źródło csv: trzy zdarzenia do wykrycia', () => {
  const zrodlo = zrodloCsv();
  const suma = (w, pole) => w.reduce((a, r) => a + r[pole], 0);

  test('A: pobrania u jednego operatora wyraźnie spadają po zmianie oferty', async () => {
    const w = await zrodlo.getFunnelDaily();
    const akcje = await zrodlo.getActionsLog();
    const zmiana = akcje.find(a => a.rodzaj === 'zmiana_oferty');
    assert.ok(zmiana, 'w dzienniku akcji musi być zmiana oferty');

    const play = (od, doDnia) => w.filter(r => r.operator === zmiana.operator && r.data >= od && r.data < doDnia);
    const przed = suma(play('2026-01-01', zmiana.data), 'pobranie') / w.filter(r => r.operator === zmiana.operator && r.data < zmiana.data).length;
    const po = suma(play(zmiana.data, '2099-01-01'), 'pobranie') / w.filter(r => r.operator === zmiana.operator && r.data >= zmiana.data).length;
    assert.ok(po < przed * 0.8, `średnia dzienna po zmianie (${po.toFixed(1)}) ma być wyraźnie niższa niż przed (${przed.toFixed(1)})`);
  });

  test('A: spadek widać dopiero w rozbiciu na operatorów, nie w sumie kanału', async () => {
    // To jest sedno: zbiorcza liczba kanału zgadza się z tabelą, bo pozostali
    // operatorzy nadrabiają. Kokpit ma wyłapać zmianę mimo spokojnej sumy.
    const w = await zrodlo.getFunnelDaily();
    const okno = [...new Set(w.map(r => r.data))].sort().slice(-30);
    const sumaKanalu = suma(w.filter(r => r.kanal === 'op' && okno.includes(r.data)), 'pobranie');
    assert.equal(sumaKanalu, DEFAULT_FUNNEL.op[1]);
  });

  test('B: kampania z dziennika akcji podnosi wyniki swojego kanału', async () => {
    const w = await zrodlo.getFunnelDaily();
    const akcje = await zrodlo.getActionsLog();
    const kampania = akcje.find(a => a.rodzaj === 'kampania' && a.kanal === 'own');
    assert.ok(kampania);

    const srednia = (od, doDnia) => {
      const d = w.filter(r => r.kanal === 'own' && r.data >= od && r.data < doDnia);
      return d.length ? suma(d, 'pobranie') / d.length : 0;
    };
    const koniec = new Date(kampania.data); koniec.setUTCDate(koniec.getUTCDate() + 5);
    const wTrakcie = srednia(kampania.data, koniec.toISOString().slice(0, 10));
    const poza = srednia('2026-07-10', kampania.data);
    assert.ok(wTrakcie > poza, `w kampanii ${wTrakcie.toFixed(1)} ma być powyżej tła ${poza.toFixed(1)}`);
  });

  test('C: początek roku szkolnego jest w kalendarzu i widać go w danych', async () => {
    const kalendarz = await zrodlo.getCalendar();
    const szkola = kalendarz.find(k => k.rodzaj === 'rok_szkolny');
    assert.ok(szkola, 'kalendarz musi mieć początek roku szkolnego');

    const w = await zrodlo.getFunnelDaily();
    const wSzkole = w.filter(r => r.data >= szkola.data_od && r.data <= szkola.data_do);
    const przed = w.filter(r => r.data >= '2026-08-20' && r.data < szkola.data_od);
    const sr = (d) => suma(d, 'start') / [...new Set(d.map(r => r.data))].length;
    assert.ok(sr(wSzkole) > sr(przed), `rok szkolny ${sr(wSzkole).toFixed(0)} ma być powyżej sierpnia ${sr(przed).toFixed(0)}`);
  });
});

describe('Źródło sheets', () => {
  test('bez SHEET_ID odmawia zamiast cicho nie działać', () => {
    const byl = process.env.SHEET_ID;
    delete process.env.SHEET_ID;
    try { assert.throws(() => zrodloSheets(), /SHEET_ID/); }
    finally { if (byl !== undefined) process.env.SHEET_ID = byl; }
  });

  test('pobiera zakładkę po nazwie, bez klucza API', async () => {
    const wywolania = [];
    const fetchImpl = async (url) => {
      wywolania.push(url);
      return { ok: true, status: 200, text: async () => 'data,kanal\n2026-01-01,op\n' };
    };
    const w = await zrodloSheets({ sheetId: 'ABC123', fetchImpl }).getActionsLog();
    assert.match(wywolania[0], /spreadsheets\/d\/ABC123\/gviz\/tq\?tqx=out:csv&sheet=actions_log/);
    assert.ok(!wywolania[0].includes('key='), 'publiczny arkusz nie potrzebuje klucza');
    assert.deepEqual(w, [{ data: '2026-01-01', kanal: 'op' }]);
  });

  test('nieudostępniony arkusz daje czytelny błąd, nie pustą listę', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, text: async () => '' });
    await assert.rejects(
      () => zrodloSheets({ sheetId: 'ABC', fetchImpl }).getFunnelDaily(),
      (e) => e instanceof BladZrodla && /403/.test(e.message) && /udostępniony/.test(e.message)
    );
  });
});

describe('Źródło bigquery', () => {
  test('mówi wprost, że jest szkieletem, i podaje czego potrzebuje', async () => {
    await assert.rejects(
      () => zrodloBigQuery({ projekt: 'locon', zbior: 'aktywacja' }).getFunnelDaily(),
      (e) => {
        assert.ok(e instanceof BladZrodla);
        assert.match(e.message, /szkielet/);
        assert.match(e.message, /locon\.aktywacja\.funnel_daily/);
        assert.match(e.message, /operator/);
        return true;
      }
    );
  });

  test('schemat opisuje wszystkie cztery zestawy z kolumnami', () => {
    for (const zestaw of ['funnel_daily', 'actions_log', 'calendar', 'tests']) {
      assert.ok(SCHEMAT_BIGQUERY[zestaw]?.opis, `${zestaw} bez opisu`);
      assert.ok(Object.keys(SCHEMAT_BIGQUERY[zestaw].kolumny).length > 0);
    }
  });

  test('kolumny lejka w schemacie pokrywają się z krokami', () => {
    const k = Object.keys(SCHEMAT_BIGQUERY.funnel_daily.kolumny);
    for (const krok of KROKI_LEJKA) assert.ok(k.includes(krok), `brak kolumny ${krok}`);
  });
});

describe('Wybór źródła', () => {
  test('nieznane źródło jest odrzucane z listą dozwolonych', () => {
    assert.throws(() => zrodloDanych({ rodzaj: 'postgres' }), /csv, sheets, bigquery/);
  });

  test('wszystkie trzy mają ten sam interfejs', () => {
    const metody = ['getFunnelDaily', 'getActionsLog', 'getCalendar', 'getTests'];
    for (const z of [zrodloCsv(), zrodloSheets({ sheetId: 'x' }), zrodloBigQuery({})]) {
      for (const m of metody) assert.equal(typeof z[m], 'function', `${z.zrodlo} nie ma ${m}`);
    }
  });
});
