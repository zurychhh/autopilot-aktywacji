// Klient API User.com. Jedno miejsce dla serwera MCP i dla backendu.
//
// Dokumentacja: https://apidocs.user.com/get-started/basic-api-usage.html
// Adres bazowy:  https://<subdomena>.user.com/api/public/   (z ukośnikiem)
// Nagłówki:      Authorization: Token <64 znaki>
//                Accept: */*; version=2   (pominięcie wersji daje błędy)
//
// DRY_RUN jest domyślnie włączony i to świadoma decyzja: prototyp powstał bez
// konta User.com, a narzędzie, które domyślnie wysyła kampanie, jest groźne.
// W trybie DRY_RUN żadne wywołanie nie wychodzi w sieć — zwracamy przykładowe
// odpowiedzi oznaczone polem `tryb: 'dry-run'`, żeby nikt nie wziął ich
// za prawdziwe dane.

export class BladUserCom extends Error {
  constructor(komunikat, { status, tresc } = {}) {
    super(komunikat);
    this.name = 'BladUserCom';
    this.status = status;
    this.tresc = tresc;
  }
}

/** Przykładowe odpowiedzi dla trybu DRY_RUN. Realistyczne, ale wymyślone. */
const PRZYKLADY = {
  segmenty: [
    { id: 101, name: 'Operator: aktywny pakiet, brak pobrania aplikacji', users_count: 6900 },
    { id: 102, name: 'Operator: pobranie bez konta', users_count: 500 },
    { id: 103, name: 'Konto bez dodanego bliskiego', users_count: 1150 },
    { id: 104, name: 'Mapa zobaczona, brak strefy', users_count: 760 }
  ],
  uzytkownik: {
    id: 55123,
    email: 'przykladowy@example.com',
    phone_number: '+48600000000',
    first_name: 'Przykładowa',
    last_name: 'Osoba',
    custom_attributes: { kanal: 'operator', pakiet: 'aktywny', pobranie_aplikacji: false }
  }
};

const naglowki = (token) => ({
  authorization: `Token ${token}`,
  accept: '*/*; version=2',
  'content-type': 'application/json'
});

/**
 * @param {object} opcje
 * @param {string} [opcje.token]    USERCOM_TOKEN
 * @param {string} [opcje.baseUrl]  USERCOM_BASE_URL, np. https://locon.user.com/api/public/
 * @param {boolean} [opcje.dryRun]  domyślnie true; false wymaga DRY_RUN=false
 * @param {Function} [opcje.fetchImpl] podmieniany w testach
 */
export function klientUserCom({
  token = process.env.USERCOM_TOKEN,
  baseUrl = process.env.USERCOM_BASE_URL,
  dryRun = process.env.DRY_RUN !== 'false',
  fetchImpl = globalThis.fetch
} = {}) {

  async function wywolaj(sciezka, { metoda = 'GET', cialo, zapytanie } = {}) {
    if (!baseUrl) throw new BladUserCom('Brak USERCOM_BASE_URL.', { status: 0 });
    if (!token) throw new BladUserCom('Brak USERCOM_TOKEN.', { status: 0 });

    const url = new URL(sciezka.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
    for (const [k, v] of Object.entries(zapytanie || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    const odp = await fetchImpl(url.toString(), {
      method: metoda,
      headers: naglowki(token),
      body: cialo === undefined ? undefined : JSON.stringify(cialo)
    });

    const tekst = await odp.text();
    let dane = null;
    try { dane = tekst ? JSON.parse(tekst) : null; } catch { dane = tekst; }

    if (!odp.ok) {
      throw new BladUserCom(`User.com odpowiedziało ${odp.status} na ${metoda} ${sciezka}`, {
        status: odp.status, tresc: dane
      });
    }
    return dane;
  }

  const przyklad = (dane) => ({
    tryb: 'dry-run',
    uwaga: 'Dane przykładowe. Żadne wywołanie nie wyszło do User.com.',
    ...dane
  });

  return {
    get dryRun() { return dryRun; },
    get baseUrl() { return baseUrl; },

    /** GET /segments/ — lista segmentów użytkowników. */
    async listSegments() {
      if (dryRun) return przyklad({ segmenty: PRZYKLADY.segmenty });
      const dane = await wywolaj('segments/');
      return { segmenty: dane?.results ?? dane };
    },

    /** GET /users/:id/ albo GET /users/search/ — jeden użytkownik. */
    async getUser({ id, email, phone } = {}) {
      if (!id && !email && !phone) {
        throw new BladUserCom('Podaj id, email albo numer telefonu.', { status: 0 });
      }
      if (dryRun) {
        return przyklad({ uzytkownik: { ...PRZYKLADY.uzytkownik, ...(email && { email }), ...(id && { id }) } });
      }
      if (id) return { uzytkownik: await wywolaj(`users/${encodeURIComponent(id)}/`) };
      const dane = await wywolaj('users/search/', { zapytanie: { email, phone_number: phone } });
      return { uzytkownik: Array.isArray(dane?.results) ? dane.results[0] ?? null : dane };
    },

    /** POST /events/ — zdarzenie na koncie użytkownika (mikrokonwersja). */
    async createEvent({ userId, nazwa, dane = {} }) {
      if (!userId || !nazwa) throw new BladUserCom('Wymagane: userId i nazwa.', { status: 0 });
      const cialo = { user_id: userId, name: nazwa, data: dane };
      if (dryRun) return przyklad({ wyslano_by: { metoda: 'POST', sciezka: 'events/', cialo } });
      return { zdarzenie: await wywolaj('events/', { metoda: 'POST', cialo }) };
    },

    /**
     * POST /sms-campaign/ — kampania SMS utworzona, ale NIE wysłana.
     * Wysyłka to osobne działanie w panelu; ten klient jej nie robi
     * i nie będzie robił bez wyraźnej zmiany w kodzie.
     */
    async createTestCampaign({ nazwa, tresc, segmentId }) {
      if (!nazwa || !tresc) throw new BladUserCom('Wymagane: nazwa i tresc.', { status: 0 });
      if (tresc.length > 160) {
        throw new BladUserCom(`Treść SMS ma ${tresc.length} znaków, limit to 160.`, { status: 0 });
      }
      const cialo = { name: nazwa, content: tresc, status: 'draft', ...(segmentId && { segment: segmentId }) };
      if (dryRun) {
        return przyklad({
          wyslano_by: { metoda: 'POST', sciezka: 'sms-campaign/', cialo },
          wysylka: 'nie — kampania powstaje jako szkic, wysyłkę uruchamia człowiek w panelu'
        });
      }
      return { kampania: await wywolaj('sms-campaign/', { metoda: 'POST', cialo }) };
    },

    /** GET /sms-campaign/ albo GET /email-campaign/ — statystyki kampanii. */
    async getCampaignStats({ id, kanal = 'sms' } = {}) {
      if (!['sms', 'email'].includes(kanal)) {
        throw new BladUserCom('Kanał musi być "sms" albo "email".', { status: 0 });
      }
      const sciezka = kanal === 'sms' ? 'sms-campaign/' : 'email-campaign/';
      if (dryRun) {
        return przyklad({
          kampania: { id: id ?? 9001, name: 'Najpierw wartość — wariant B', kanal },
          statystyki: { wyslane: 1904, dostarczone: 1871, klikniete: 412, wypisania: 10 }
        });
      }
      const dane = await wywolaj(sciezka, { zapytanie: { id } });
      return { kampania: dane, statystyki: dane?.stats ?? null };
    }
  };
}
