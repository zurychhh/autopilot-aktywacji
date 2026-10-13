// Wysyłka maili po rozstrzygnięciu testu.
//
// DRY_RUN jest domyślnie włączony: mail trafia do logu zamiast do skrzynki.
// Dostawca: Resend — darmowy plan daje 3000 maili miesięcznie i 100 dziennie,
// a do wysyłki wystarczy jeden klucz w zmiennej środowiskowej, bez SMTP.
// Alternatywą jest User.com, którego Locon już używa; wtedy mail idzie tą samą
// drogą co kampanie i widać go w jednym miejscu z resztą komunikacji.
// Wybór zostawiam człowiekowi — oba są podpięte przez ten sam interfejs.

export class BladMaila extends Error {
  constructor(komunikat, { powod } = {}) {
    super(komunikat);
    this.name = 'BladMaila';
    this.powod = powod;
  }
}

/** Składa treść maila z rozstrzygniętego testu. Czysta funkcja — łatwa do sprawdzenia. */
export function zlozMail({ test, plan, adresProtoptypu, baseline }) {
  const temat = `Autopilot: test „${test.wariant || test.id}" rozstrzygnięty — ${test.decyzja === 'wdrozyc' ? 'wdrażamy' : 'odrzucamy'}`;

  const tresc = [
    `Test: ${test.wariant || test.id}`,
    `Hipoteza: ${test.hipoteza || '—'}`,
    `Dlaczego ten test: ${test.dlaczego_ten_test || '—'}`,
    '',
    `Decyzja: ${test.decyzja === 'wdrozyc' ? 'wdrażamy dla wszystkich' : 'odrzucamy'}`,
    `Uzasadnienie: ${test.uzasadnienie_decyzji || '—'}`,
    `Punkt odniesienia po tej decyzji: ${baseline?.nazwa || '—'}`,
    '',
    plan
      ? `Następny test: ${plan.wariant}, ${plan.liczebnosc_planowana} osób na grupę, wynik za około ${plan.dni_do_wyniku} dni.`
      : 'Następny test: do zaplanowania.',
    '',
    `Prototyp: ${adresProtoptypu}`,
    '',
    'Wszystkie liczby w prototypie są przykładowe i tak oznaczone.'
  ].join('\n');

  return { temat, tresc };
}

/**
 * Wysyła albo zapisuje do logu. Zwraca opis tego, co się stało, żeby strona
 * mogła go pokazać — bez tego „DRY_RUN z logiem" jest niesprawdzalny.
 */
export async function wyslijMail({
  mail,
  odbiorcy = (process.env.MAIL_ODBIORCY || '').split(',').map(s => s.trim()).filter(Boolean),
  nadawca = process.env.MAIL_NADAWCA || 'autopilot@example.com',
  dryRun = process.env.DRY_RUN !== 'false',
  klucz = process.env.RESEND_API_KEY,
  fetchImpl = globalThis.fetch
} = {}) {
  const wpis = {
    czas: new Date().toISOString(),
    nadawca,
    odbiorcy,
    temat: mail.temat,
    tresc: mail.tresc,
    tryb: dryRun ? 'dry-run' : 'wyslany'
  };

  if (dryRun) {
    console.log('[mail dry-run]', JSON.stringify({ ...wpis, tresc: mail.tresc.slice(0, 200) + '…' }));
    return { ...wpis, wyslano: false, uwaga: 'DRY_RUN — mail nie wyszedł, jest tylko w logu.' };
  }

  if (!klucz) throw new BladMaila('Brak RESEND_API_KEY przy wyłączonym DRY_RUN.', { powod: 'brak_klucza' });
  if (!odbiorcy.length) throw new BladMaila('Brak adresatów w MAIL_ODBIORCY.', { powod: 'brak_odbiorcow' });

  const odp = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${klucz}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: nadawca, to: odbiorcy, subject: mail.temat, text: mail.tresc })
  });

  if (!odp.ok) throw new BladMaila(`Dostawca maila odpowiedział ${odp.status}.`, { powod: 'dostawca' });
  return { ...wpis, wyslano: true };
}
