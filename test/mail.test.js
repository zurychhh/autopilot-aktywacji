import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { zlozMail, wyslijMail, BladMaila } from '../lib/mail.js';

const test1 = {
  id: 't1', wariant: 'B: najpierw wartość', hipoteza: 'Klient zobaczy mapę bez aplikacji.',
  dlaczego_ten_test: 'Największa strata to 6900 osób.', decyzja: 'wdrozyc',
  uzasadnienie_decyzji: 'Wzrost o 4,9 pkt proc.'
};
const plan = { wariant: 'Prowadzenie do strefy', liczebnosc_planowana: 1904, dni_do_wyniku: 51 };
const baseline = { nazwa: 'B: najpierw wartość' };
const ADRES = 'https://przyklad.test';

describe('Składanie maila po rozstrzygnięciu', () => {
  test('temat mówi, co zdecydowano', () => {
    const m = zlozMail({ test: test1, plan, baseline, adresProtoptypu: ADRES });
    assert.match(m.temat, /rozstrzygnięty/);
    assert.match(m.temat, /wdrażamy/);
  });

  test('odrzucenie ma inny temat niż wdrożenie', () => {
    const m = zlozMail({ test: { ...test1, decyzja: 'odrzucic' }, plan, baseline, adresProtoptypu: ADRES });
    assert.match(m.temat, /odrzucamy/);
  });

  test('treść niesie wynik, uzasadnienie, plan następnego testu i link', () => {
    const { tresc } = zlozMail({ test: test1, plan, baseline, adresProtoptypu: ADRES });
    assert.match(tresc, /Wzrost o 4,9 pkt proc\./);
    assert.match(tresc, /Największa strata to 6900 osób\./);
    assert.match(tresc, /1904 osób na grupę/);
    assert.match(tresc, /51 dni/);
    assert.match(tresc, new RegExp(ADRES));
  });

  test('mail mówi, że liczby są przykładowe', () => {
    const { tresc } = zlozMail({ test: test1, plan, baseline, adresProtoptypu: ADRES });
    assert.match(tresc, /przykładowe/);
  });

  test('brak planu nie wywraca maila', () => {
    const { tresc } = zlozMail({ test: test1, plan: null, baseline, adresProtoptypu: ADRES });
    assert.match(tresc, /do zaplanowania/);
  });

  test('puste pola zamieniają się w kreskę, nie w "undefined"', () => {
    const { tresc } = zlozMail({ test: { id: 'x', decyzja: 'odrzucic' }, plan: null, baseline: null, adresProtoptypu: ADRES });
    assert.ok(!tresc.includes('undefined'));
    assert.match(tresc, /—/);
  });
});

describe('Wysyłka maila', () => {
  const mail = { temat: 'T', tresc: 'C' };

  test('DRY_RUN nie wysyła niczego i mówi to wprost', async () => {
    let wywolano = 0;
    const bylLog = console.log; console.log = () => {};
    try {
      const w = await wyslijMail({ mail, dryRun: true, fetchImpl: async () => { wywolano++; } });
      assert.equal(w.wyslano, false);
      assert.equal(w.tryb, 'dry-run');
      assert.match(w.uwaga, /nie wyszedł/);
      assert.equal(wywolano, 0, 'w DRY_RUN nie wolno dotknąć sieci');
    } finally { console.log = bylLog; }
  });

  test('wpis z logu niesie treść, żeby strona mogła ją pokazać', async () => {
    const bylLog = console.log; console.log = () => {};
    try {
      const w = await wyslijMail({ mail, dryRun: true, odbiorcy: ['a@example.com'] });
      assert.equal(w.temat, 'T');
      assert.equal(w.tresc, 'C');
      assert.deepEqual(w.odbiorcy, ['a@example.com']);
    } finally { console.log = bylLog; }
  });

  test('bez DRY_RUN i bez klucza odmawia zamiast cicho nie wysłać', async () => {
    await assert.rejects(
      () => wyslijMail({ mail, dryRun: false, klucz: undefined, odbiorcy: ['a@example.com'] }),
      (e) => e instanceof BladMaila && e.powod === 'brak_klucza'
    );
  });

  test('bez adresatów też odmawia', async () => {
    await assert.rejects(
      () => wyslijMail({ mail, dryRun: false, klucz: 'k', odbiorcy: [] }),
      (e) => e.powod === 'brak_odbiorcow'
    );
  });

  test('po wyłączeniu DRY_RUN idzie do dostawcy z właściwym ciałem', async () => {
    const wywolania = [];
    const fetchImpl = async (url, opcje) => { wywolania.push({ url, ...opcje }); return { ok: true, status: 200 }; };
    const w = await wyslijMail({ mail, dryRun: false, klucz: 'k', odbiorcy: ['a@example.com'], nadawca: 'x@example.com', fetchImpl });
    assert.equal(w.wyslano, true);
    assert.match(wywolania[0].url, /api\.resend\.com/);
    const cialo = JSON.parse(wywolania[0].body);
    assert.deepEqual(cialo.to, ['a@example.com']);
    assert.equal(cialo.subject, 'T');
  });

  test('błąd dostawcy nie przechodzi po cichu', async () => {
    const fetchImpl = async () => ({ ok: false, status: 422 });
    await assert.rejects(
      () => wyslijMail({ mail, dryRun: false, klucz: 'k', odbiorcy: ['a@example.com'], fetchImpl }),
      (e) => e.powod === 'dostawca' && /422/.test(e.message)
    );
  });
});
