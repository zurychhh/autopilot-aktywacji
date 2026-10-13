// Logika prośby o jednorazowe udostępnienie lokalizacji.
//
// Zasady, które mają pierwszeństwo nad wygodą:
//   * lokalizacja pojawia się WYŁĄCZNIE po kliknięciu przez osobę lokalizowaną
//   * prośba żyje godzinę i po tym czasie znika razem z lokalizacją
//   * odmowa kasuje wszystko natychmiast, bez śladu „ktoś odmówił o 14:03"
//   * poza imieniem wpisanym przez proszącego nie trzymamy żadnych danych
//     osobowych: ani numeru, ani adresu, ani identyfikatora urządzenia

export const WAZNOSC_SEKUNDY = 3600;
export const DLUGOSC_KODU = 10;

/** Znaki bez tych, które łatwo pomylić przy przepisywaniu z ekranu. */
const ALFABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function losowyKod(losuj = () => Math.random()) {
  let kod = '';
  for (let i = 0; i < DLUGOSC_KODU; i++) kod += ALFABET[Math.floor(losuj() * ALFABET.length)];
  return kod;
}

export const ZDARZENIA = ['link_utworzony', 'link_otwarty', 'zgoda', 'odmowa', 'mapa_wyswietlona'];

const kluczProsby = (kod) => `mapa:prosba:${kod}`;
const kluczLicznika = (nazwa) => `mapa:licznik:${nazwa}`;

/** Imię jest jedyną daną od człowieka — przycinamy i czyścimy. */
function oczyscImie(imie) {
  return String(imie || '').replace(/[<>]/g, '').trim().slice(0, 40);
}

export function uslugaMapy(magazyn, { losuj, teraz = () => Date.now() } = {}) {

  // Zegar idzie wszędzie, także do liczników — inaczej przy podstawionym
  // czasie część odczytów używałaby prawdziwego i wyglądała na wygasłe.
  const licz = (nazwa) => magazyn.zwieksz(kluczLicznika(nazwa), { teraz: teraz() }).catch(() => null);

  return {
    tryb: magazyn.tryb,
    trwaly: magazyn.trwaly,

    /** Prosi o lokalizację. Zwraca kod do przekazania bliskiej osobie. */
    async utworzProsbe({ imie, odKogo }) {
      const czysteImie = oczyscImie(imie);
      if (!czysteImie) throw new Error('Podaj imię bliskiej osoby.');

      const kod = losowyKod(losuj);
      const t = teraz();
      await magazyn.ustaw(kluczProsby(kod), {
        imie: czysteImie,
        odKogo: oczyscImie(odKogo) || 'Ktoś bliski',
        utworzona: t,
        wygasa: t + WAZNOSC_SEKUNDY * 1000,
        stan: 'czeka',
        lokalizacja: null
      }, WAZNOSC_SEKUNDY, { teraz: t });

      await licz('link_utworzony');
      return { kod, wygasa: t + WAZNOSC_SEKUNDY * 1000, waznoscSekundy: WAZNOSC_SEKUNDY };
    },

    /** Co widzi osoba lokalizowana po otwarciu linku. Bez lokalizacji — jeszcze jej nie ma. */
    async pokazProsbe(kod, { liczOtwarcie = true } = {}) {
      const p = await magazyn.pobierz(kluczProsby(kod), { teraz: teraz() });
      if (!p) return null;
      if (liczOtwarcie && p.stan === 'czeka') await licz('link_otwarty');
      return { imie: p.imie, odKogo: p.odKogo, stan: p.stan, wygasa: p.wygasa };
    },

    /**
     * Zgoda razem z pozycją. Jedyna droga, którą lokalizacja trafia do magazynu.
     * Bez tego wywołania nie ma współrzędnych — nigdzie.
     */
    async zapiszZgode(kod, { lat, lon, dokladnosc }) {
      const p = await magazyn.pobierz(kluczProsby(kod), { teraz: teraz() });
      if (!p) return { ok: false, powod: 'brak_lub_wygasla' };
      if (p.stan === 'odmowa') return { ok: false, powod: 'odmowiono' };

      const liczba = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const szerokosc = liczba(lat), dlugosc = liczba(lon);
      if (szerokosc === null || dlugosc === null
          || Math.abs(szerokosc) > 90 || Math.abs(dlugosc) > 180) {
        return { ok: false, powod: 'zle_wspolrzedne' };
      }

      const pozostalo = Math.max(1, Math.ceil((p.wygasa - teraz()) / 1000));
      await magazyn.ustaw(kluczProsby(kod), {
        ...p,
        stan: 'zgoda',
        lokalizacja: { lat: szerokosc, lon: dlugosc, dokladnosc: liczba(dokladnosc), czas: teraz() }
      }, pozostalo, { teraz: teraz() });

      await licz('zgoda');
      return { ok: true };
    },

    /** Odmowa kasuje wpis od razu. Nie zostaje ślad, że ktoś odmówił. */
    async zapiszOdmowe(kod) {
      const p = await magazyn.pobierz(kluczProsby(kod), { teraz: teraz() });
      await magazyn.usun(kluczProsby(kod));
      if (p) await licz('odmowa');
      return { ok: true };
    },

    /** Lokalizacja dla proszącego. Przed zgodą nie ma czego zwrócić. */
    async pobierzLokalizacje(kod) {
      const p = await magazyn.pobierz(kluczProsby(kod), { teraz: teraz() });
      if (!p) return { stan: 'brak_lub_wygasla' };
      if (p.stan !== 'zgoda' || !p.lokalizacja) return { stan: p.stan, imie: p.imie };
      await licz('mapa_wyswietlona');
      return { stan: 'zgoda', imie: p.imie, lokalizacja: p.lokalizacja, wygasa: p.wygasa };
    },

    /**
     * Zeruje WYŁĄCZNIE liczniki mikrokonwersji. Nie dotyka próśb ani
     * lokalizacji — te i tak znikają same po godzinie. Służy do sprzątania
     * po testach, żeby liczby na ekranie nie mieszały ruchu testowego
     * z prawdziwym.
     */
    async wyzerujLiczniki() {
      for (const z of ZDARZENIA) await magazyn.usun(kluczLicznika(z));
      return { wyzerowano: ZDARZENIA.length, zdarzenia: [...ZDARZENIA] };
    },

    /** Mikrokonwersje: ile razy co się wydarzyło. */
    async liczniki() {
      const pary = await Promise.all(ZDARZENIA.map(async (z) =>
        [z, Number(await magazyn.pobierz(kluczLicznika(z), { teraz: teraz() })) || 0]));
      return Object.fromEntries(pary);
    }
  };
}
