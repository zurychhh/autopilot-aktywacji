// Magazyn stanu z czasem życia. Dwie implementacje za jednym interfejsem.
//
//   upstash — Redis przez REST API Upstasha. Bez SDK: wystarczy fetch
//             i dwie zmienne, które dokłada integracja z Vercel Marketplace.
//   pamiec  — mapa w pamięci procesu. TRYB DEMO. Działa tylko w obrębie jednej
//             instancji funkcji, a platforma uruchamia ich wiele i usypia je,
//             więc kod może zniknąć wcześniej, niż mówi jego ważność.
//             Strona musi to powiedzieć wprost, inaczej wygląda jak awaria.
//
// Wybór jest automatyczny: gdy są zmienne Upstasha, używamy Redisa; gdy ich
// nie ma, wchodzi tryb demo. Dzięki temu prototyp działa od razu, a podpięcie
// Upstasha nie wymaga żadnej zmiany w kodzie.

export const TRYB_DEMO = 'pamiec';
export const TRYB_TRWALY = 'upstash';

/** Magazyn w pamięci procesu. Sam sprząta wygasłe wpisy przy każdym odczycie. */
export function magazynPamiec() {
  const dane = new Map();

  const zywy = (wpis, teraz) => wpis && wpis.wygasa > teraz;

  return {
    tryb: TRYB_DEMO,
    trwaly: false,
    async ustaw(klucz, wartosc, sekundy, { teraz = Date.now() } = {}) {
      dane.set(klucz, { wartosc, wygasa: teraz + sekundy * 1000 });
    },
    async pobierz(klucz, { teraz = Date.now() } = {}) {
      const wpis = dane.get(klucz);
      if (!zywy(wpis, teraz)) { dane.delete(klucz); return null; }
      return wpis.wartosc;
    },
    async usun(klucz) { dane.delete(klucz); },
    async zwieksz(klucz, { teraz = Date.now() } = {}) {
      const wpis = dane.get(klucz);
      const ile = (zywy(wpis, teraz) ? Number(wpis.wartosc) || 0 : 0) + 1;
      dane.set(klucz, { wartosc: ile, wygasa: teraz + 30 * 24 * 3600 * 1000 });
      return ile;
    },
    /** Tylko do testów — pamięć procesu nie ma innej drogi czyszczenia. */
    _wyczysc() { dane.clear(); }
  };
}

/**
 * Dane dostępowe do Upstasha. Integracja z Vercel Marketplace nazywa zmienne
 * KV_REST_API_URL / KV_REST_API_TOKEN, czasem z prefiksem (np. STORAGE_),
 * a ręczna konfiguracja: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
 * Bierzemy pierwszą pasującą parę; token tylko do odczytu odrzucamy.
 */
export function daneUpstash(env = process.env) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
  }
  const klucz = Object.keys(env).sort().find(k => /(^|_)KV_REST_API_URL$/.test(k) && env[k]);
  if (!klucz) return { url: undefined, token: undefined };
  const prefiks = klucz.slice(0, -'KV_REST_API_URL'.length);
  return { url: env[klucz], token: env[`${prefiks}KV_REST_API_TOKEN`] };
}

/** Redis przez REST API Upstasha. Polecenia idą jako ścieżki, odpowiedź to {result}. */
export function magazynUpstash({
  url = daneUpstash().url,
  token = daneUpstash().token,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!url || !token) throw new Error('Brak danych Upstasha (UPSTASH_REDIS_REST_* albo KV_REST_API_*).');

  async function polecenie(...czesci) {
    const sciezka = czesci.map(c => encodeURIComponent(String(c))).join('/');
    const odp = await fetchImpl(`${url.replace(/\/$/, '')}/${sciezka}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!odp.ok) throw new Error(`Upstash odpowiedział ${odp.status}.`);
    return (await odp.json()).result;
  }

  return {
    tryb: TRYB_TRWALY,
    trwaly: true,
    async ustaw(klucz, wartosc, sekundy) {
      await polecenie('set', klucz, JSON.stringify(wartosc), 'EX', sekundy);
    },
    async pobierz(klucz) {
      const surowe = await polecenie('get', klucz);
      if (surowe === null || surowe === undefined) return null;
      try { return JSON.parse(surowe); } catch { return surowe; }
    },
    async usun(klucz) { await polecenie('del', klucz); },
    async zwieksz(klucz) {
      const ile = await polecenie('incr', klucz);
      await polecenie('expire', klucz, 30 * 24 * 3600);
      return Number(ile);
    }
  };
}

let wspolny = null;

/** Jeden magazyn na proces. Upstash, gdy jest skonfigurowany; inaczej tryb demo. */
export function magazyn({ wymusTryb } = {}) {
  const tryb = wymusTryb
    || ((({ url, token }) => (url && token))(daneUpstash()) ? TRYB_TRWALY : TRYB_DEMO);
  if (tryb === TRYB_TRWALY) return magazynUpstash();
  if (!wspolny) wspolny = magazynPamiec();
  return wspolny;
}
