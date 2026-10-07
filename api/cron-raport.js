// GET /api/cron-raport — zadanie cykliczne raz dziennie.
//
// Robi dwie rzeczy, bo darmowy plan Vercela daje jeden przebieg na dobę:
//   1. mail po rozstrzygnięciu testu
//   2. przypomnienia o zaproszeniach bez akceptacji po 48 godzinach
//
// Vercel na planie darmowym uruchamia zadania cykliczne raz na dobę, więc
// projekt jest pod to: jeden przebieg dziennie, bez stanu między przebiegami.
// Zadanie czyta rejestr testów, znajduje rozstrzygnięte i składa mail
// z wynikiem, uzasadnieniem i planem następnego testu.
//
// DRY_RUN jest domyślnie włączony: mail idzie do logu, nie do skrzynki.
// ?podglad=1 zwraca złożoną treść bez zapisu do logu — tego używa strona,
// żeby pokazać, co zostałoby wysłane.

import { zrodloDanych } from '../lib/datasource.js';
import { zlozMail, wyslijMail } from '../lib/mail.js';
import { stanPetli, planNastepnegoTestu, cloneFunnel } from '../public/logic.js';
import { magazyn } from '../lib/magazyn.js';
import { uslugaZaproszen, trescPrzypomnienia, GODZINY_DO_PRZYPOMNIENIA } from '../lib/zaproszenia.js';
import { klientUserCom } from '../lib/usercom.js';

const ADRES = process.env.ADRES_PROTOTYPU || 'https://autopilot.oleksiakconsulting.com';

/**
 * Przypomnienia o zaproszeniach bez akceptacji. Kampania powstaje przez
 * klienta User.com w DRY_RUN, więc nic nie wychodzi — widać tylko, co by
 * poszło. Podgląd ze strony niczego nie oznacza jako wysłane.
 */
async function przypomnienia({ podglad }) {
  const u = uslugaZaproszen(magazyn());
  const czekajace = await u.doPrzypomnienia();
  const klient = klientUserCom();

  const przygotowane = [];
  for (const z of czekajace) {
    const tresc = trescPrzypomnienia({ imie: z.imie });
    const kampania = await klient.createTestCampaign({
      nazwa: `Przypomnienie o zaproszeniu — ${z.imie}`,
      tresc
    });
    przygotowane.push({ zaproszenie: z.id, imie: z.imie, tresc, dryRun: klient.dryRun, kampania });
    if (!podglad) {
      await u.oznaczPrzypomnienie(z.id);
      await u.dopiszDoLogu({ rodzaj: 'przypomnienie', zaproszenie: z.id, imie: z.imie, tresc, wyslano: false });
    }
  }

  return {
    poGodzinach: GODZINY_DO_PRZYPOMNIENIA,
    czekalo: czekajace.length,
    przygotowane,
    tryb: klient.dryRun ? 'dry-run' : 'na żywo',
    uwaga: klient.dryRun
      ? 'DRY_RUN — kampanie nie wyszły do User.com, widać tylko, co by poszło.'
      : 'Kampanie powstały jako SZKICE w User.com. Wysyłkę uruchamia człowiek w panelu.',
    podsumowanie: await u.podsumowanie(),
    log: await u.log()
  };
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ blad: 'Ta funkcja przyjmuje tylko GET.', powod: 'zla_metoda' });
    return;
  }

  // Vercel podpisuje wywołania zadania cyklicznego, gdy ustawiono CRON_SECRET.
  // Podgląd ze strony jest jawny, bo nic nie wysyła i niczego nie zdradza.
  const podglad = /[?&]podglad=1/.test(req.url || '');
  const sekret = process.env.CRON_SECRET;
  if (!podglad && sekret && req.headers.authorization !== `Bearer ${sekret}`) {
    res.status(401).json({ blad: 'Zadanie cykliczne wymaga podpisu.', powod: 'brak_podpisu' });
    return;
  }

  try {
    const testy = await zrodloDanych().getTests();
    const stan = stanPetli(testy);
    const doWyslania = testy.filter(t => t.status === 'rozstrzygniety' && t.decyzja);

    if (!doWyslania.length) {
      res.status(200).json({
        ok: true, maile: [], uwaga: 'Żaden test nie ma jeszcze decyzji.',
        przypomnienia: await przypomnienia({ podglad })
      });
      return;
    }

    const plan = planNastepnegoTestu({
      funnel: cloneFunnel(),
      baselineId: stan.baseline.id,
      pomysl: { nazwa: 'Prowadzenie do pierwszej strefy i powiadomienia' }
    });

    const maile = [];
    for (const test of doWyslania) {
      const mail = zlozMail({ test, plan, baseline: stan.baseline, adresProtoptypu: ADRES });
      maile.push(podglad
        ? { ...mail, tryb: 'podglad', uwaga: 'Podgląd ze strony — nic nie zostało wysłane ani zapisane w logu.' }
        : await wyslijMail({ mail }));
    }

    res.status(200).json({
      ok: true, baseline: stan.baseline, liczbaZmian: stan.liczbaZmian, maile,
      przypomnienia: await przypomnienia({ podglad })
    });
  } catch (e) {
    console.error('[cron-raport]', e);
    res.status(500).json({ blad: 'Zadanie cykliczne się nie powiodło.', powod: 'awaria' });
  }
}
