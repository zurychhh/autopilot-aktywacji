import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makietaOperatora, hashNumeru, poprawnyNumer, BladCamara, ZYCIE_TOKENU_S } from '../lib/camara.js';

function zegar(start = 1_700_000_000_000) {
  let t = start;
  return { teraz: () => t, przesunSekundy: (s) => { t += s * 1000; } };
}

const NUMER = '+48600123456';
function operator(z = zegar()) {
  let n = 0;
  return { m: makietaOperatora({ teraz: z.teraz, losujToken: () => `T${++n}` }), z };
}

describe('Format numeru i hash', () => {
  test('E.164 z plusem przechodzi', () => {
    assert.ok(poprawnyNumer('+48600123456'));
    assert.ok(poprawnyNumer('+12125550100'));
  });

  test('numer bez plusa, z zerem wiodącym albo za krótki nie przechodzi', () => {
    for (const zly of ['48600123456', '+0600123456', '+4860', '600123456', '', null]) {
      assert.equal(poprawnyNumer(zly), false, String(zly));
    }
  });

  test('hash to 64 znaki szesnastkowe i jest powtarzalny', () => {
    const h = hashNumeru(NUMER);
    assert.match(h, /^[a-f0-9]{64}$/);
    assert.equal(h, hashNumeru(NUMER));
    assert.notEqual(h, hashNumeru('+48600123457'));
  });
});

describe('Token: jednorazowy i krótko żyjący', () => {
  test('żyje najwyżej 300 sekund, zgodnie ze specyfikacją', () => {
    const { m } = operator();
    assert.equal(m.wydajToken({ numerWTelefonie: NUMER }).expires_in, ZYCIE_TOKENU_S);
  });

  test('drugie użycie jest odrzucane', () => {
    const { m } = operator();
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    m.verify(t, { phoneNumber: NUMER });
    assert.throws(() => m.verify(t, { phoneNumber: NUMER }), (e) => {
      assert.equal(e.status, 401);
      assert.equal(e.code, 'UNAUTHENTICATED');
      assert.match(e.message, /jednorazowy/);
      return true;
    });
  });

  test('po upływie życia token przestaje działać', () => {
    const z = zegar();
    const { m } = operator(z);
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    z.przesunSekundy(ZYCIE_TOKENU_S + 1);
    assert.throws(() => m.verify(t, { phoneNumber: NUMER }), /wygasł/);
  });

  test('nieznany token jest odrzucany', () => {
    const { m } = operator();
    assert.throws(() => m.verify('nie-ma-takiego', { phoneNumber: NUMER }), (e) => e.status === 401);
  });

  test('token nie powstaje dla numeru w złym formacie', () => {
    const { m } = operator();
    assert.throws(() => m.wydajToken({ numerWTelefonie: '600123456' }), (e) => e.code === 'INVALID_ARGUMENT');
  });
});

describe('POST /verify', () => {
  test('zgodny numer daje true', () => {
    const { m } = operator();
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    assert.deepEqual(m.verify(t, { phoneNumber: NUMER }), { devicePhoneNumberVerified: true });
  });

  test('inny numer daje false, a nie błąd', () => {
    const { m } = operator();
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    assert.deepEqual(m.verify(t, { phoneNumber: '+48600999999' }), { devicePhoneNumberVerified: false });
  });

  test('hash działa tak samo jak numer jawny', () => {
    const { m } = operator();
    const t1 = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    assert.equal(m.verify(t1, { hashedPhoneNumber: hashNumeru(NUMER) }).devicePhoneNumberVerified, true);
    const t2 = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    assert.equal(m.verify(t2, { hashedPhoneNumber: hashNumeru('+48600999999') }).devicePhoneNumberVerified, false);
  });

  test('odpowiedź nigdy nie zawiera samego numeru', () => {
    const { m } = operator();
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    const w = m.verify(t, { phoneNumber: NUMER });
    assert.deepEqual(Object.keys(w), ['devicePhoneNumberVerified']);
    assert.ok(!JSON.stringify(w).includes('600123456'));
  });

  test('dokładnie jedno pole: ani zero, ani dwa', () => {
    const { m } = operator();
    const t = () => m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    assert.throws(() => m.verify(t(), {}), (e) => e.code === 'INVALID_ARGUMENT');
    assert.throws(() => m.verify(t(), { phoneNumber: NUMER, hashedPhoneNumber: hashNumeru(NUMER) }),
      (e) => e.code === 'INVALID_ARGUMENT');
  });

  test('błędne pola są odrzucane przed zużyciem tokenu', () => {
    const { m } = operator();
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    assert.throws(() => m.verify(t, {}), (e) => e.code === 'INVALID_ARGUMENT');
    // token nie został zużyty, więc dalej działa
    assert.equal(m.verify(t, { phoneNumber: NUMER }).devicePhoneNumberVerified, true);
  });

  test('hash o złej długości jest odrzucany', () => {
    const { m } = operator();
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    assert.throws(() => m.verify(t, { hashedPhoneNumber: 'abc' }), (e) => e.code === 'INVALID_ARGUMENT');
  });
});

describe('GET /device-phone-number', () => {
  test('bez osobnej zgody odmawia', () => {
    const { m } = operator();
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    assert.throws(() => m.devicePhoneNumber(t), (e) => {
      assert.equal(e.status, 403);
      assert.equal(e.code, 'PERMISSION_DENIED');
      return true;
    });
  });

  test('ze zgodą zwraca numer', () => {
    const { m } = operator();
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    assert.deepEqual(m.devicePhoneNumber(t, { zgodaNaUdostepnienie: true }), { devicePhoneNumber: NUMER });
  });

  test('odmowa nie zużywa tokenu', () => {
    const { m } = operator();
    const t = m.wydajToken({ numerWTelefonie: NUMER }).access_token;
    try { m.devicePhoneNumber(t); } catch (e) { /* oczekiwane */ }
    assert.deepEqual(m.devicePhoneNumber(t, { zgodaNaUdostepnienie: true }), { devicePhoneNumber: NUMER });
  });
});

describe('Makieta przyznaje się do bycia makietą', () => {
  test('mówi to wprost i podaje, czyją specyfikację odtwarza', () => {
    const { m } = operator();
    assert.equal(m.makieta, true);
    assert.match(m.spec, /CAMARA Number Verification/);
  });

  test('błędy mają kształt zgodny z CAMARA', () => {
    const e = new BladCamara(403, 'PERMISSION_DENIED', 'nie wolno');
    assert.deepEqual(e.doOdpowiedzi(), { status: 403, code: 'PERMISSION_DENIED', message: 'nie wolno' });
  });
});
