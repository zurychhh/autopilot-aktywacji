// Zaproszenia bliskiej osoby i przypomnienie po 48 godzinach.
//
// Zaproszenie to co innego niż prośba o lokalizację z etapu 6. Prośba żyje
// godzinę, bo niesie dane osobowe. Zaproszenie niesie tylko imię i stan,
// więc może żyć tydzień — i musi, bo przypomnienie wychodzi po dwóch dobach.
//
// Przypomnienia NIGDY nie wychodzą same: klient User.com pracuje w DRY_RUN,
// a wynik ląduje w logu widocznym na stronie. Włączenie prawdziwej wysyłki
// wymaga świadomej zmiany zmiennej środowiskowej.

export const GODZINY_DO_PRZYPOMNIENIA = 48;
export const ZYCIE_ZAPROSZENIA_DNI = 7;

const kluczZaproszenia = (id) => `zaproszenie:${id}`;
const KLUCZ_INDEKSU = 'zaproszenie:lista';
const kluczLogu = () => 'zaproszenie:log';

const godzinyMinely = (od, teraz) => (teraz - od) / 3_600_000;

export function uslugaZaproszen(magazyn, { teraz = () => Date.now(), losujId } = {}) {
  const nowyId = losujId || (() => Math.random().toString(36).slice(2, 12).toUpperCase());

  // Każdy odczyt dostaje ten sam zegar co zapis. Bez tego część wpisów
  // sprawdzałaby się prawdziwym czasem i wyglądała na wygasłe.
  async function lista() {
    return (await magazyn.pobierz(KLUCZ_INDEKSU, { teraz: teraz() })) || [];
  }
  async function zapiszListe(ids) {
    await magazyn.ustaw(KLUCZ_INDEKSU, ids, ZYCIE_ZAPROSZENIA_DNI * 86400, { teraz: teraz() });
  }

  return {
    /** Rodzic zaprasza bliską osobę. Zapisujemy imię i nic więcej. */
    async zapros({ imie, kanal = 'link' }) {
      const czyste = String(imie || '').replace(/[<>]/g, '').trim().slice(0, 40);
      if (!czyste) throw new Error('Podaj imię bliskiej osoby.');

      const id = nowyId();
      const t = teraz();
      await magazyn.ustaw(kluczZaproszenia(id), {
        id, imie: czyste, kanal, utworzone: t, stan: 'wyslane', przypomniano: null
      }, ZYCIE_ZAPROSZENIA_DNI * 86400, { teraz: t });

      await zapiszListe([...(await lista()), id].slice(-500));
      return { id, imie: czyste, utworzone: t };
    },

    /** Bliska osoba weszła i się zgodziła — przypomnienie już niepotrzebne. */
    async oznaczAkceptacje(id) {
      const z = await magazyn.pobierz(kluczZaproszenia(id), { teraz: teraz() });
      if (!z) return { ok: false, powod: 'brak' };
      const pozostalo = Math.max(1, Math.ceil((z.utworzone + ZYCIE_ZAPROSZENIA_DNI * 86400_000 - teraz()) / 1000));
      await magazyn.ustaw(kluczZaproszenia(id), { ...z, stan: 'zaakceptowane', zaakceptowane: teraz() }, pozostalo, { teraz: teraz() });
      return { ok: true };
    },

    async pobierz(id) {
      return magazyn.pobierz(kluczZaproszenia(id), { teraz: teraz() });
    },

    /**
     * Zaproszenia czekające na przypomnienie: minęły 48 godzin, nikt nie
     * zaakceptował i nie przypominaliśmy jeszcze. Każdy z tych trzech
     * warunków musi być spełniony — drugie przypomnienie to już nękanie.
     */
    async doPrzypomnienia() {
      const ids = await lista();
      const wszystkie = await Promise.all(ids.map(id => magazyn.pobierz(kluczZaproszenia(id), { teraz: teraz() })));
      return wszystkie.filter(z =>
        z && z.stan === 'wyslane' && !z.przypomniano &&
        godzinyMinely(z.utworzone, teraz()) >= GODZINY_DO_PRZYPOMNIENIA);
    },

    /** Zapisuje, że przypomnienie poszło. Bez tego kolejny przebieg wysłałby je znowu. */
    async oznaczPrzypomnienie(id) {
      const z = await magazyn.pobierz(kluczZaproszenia(id), { teraz: teraz() });
      if (!z) return { ok: false };
      const pozostalo = Math.max(1, Math.ceil((z.utworzone + ZYCIE_ZAPROSZENIA_DNI * 86400_000 - teraz()) / 1000));
      await magazyn.ustaw(kluczZaproszenia(id), { ...z, przypomniano: teraz() }, pozostalo, { teraz: teraz() });
      return { ok: true };
    },

    /** Log widoczny na stronie — inaczej „DRY_RUN z logiem" jest nie do sprawdzenia. */
    async dopiszDoLogu(wpis) {
      const log = (await magazyn.pobierz(kluczLogu(), { teraz: teraz() })) || [];
      const nowy = [{ czas: new Date(teraz()).toISOString(), ...wpis }, ...log].slice(0, 20);
      await magazyn.ustaw(kluczLogu(), nowy, ZYCIE_ZAPROSZENIA_DNI * 86400, { teraz: teraz() });
      return nowy;
    },

    async log() {
      return (await magazyn.pobierz(kluczLogu(), { teraz: teraz() })) || [];
    },

    async podsumowanie() {
      const ids = await lista();
      const wszystkie = (await Promise.all(ids.map(id => magazyn.pobierz(kluczZaproszenia(id), { teraz: teraz() })))).filter(Boolean);
      return {
        wyslane: wszystkie.length,
        zaakceptowane: wszystkie.filter(z => z.stan === 'zaakceptowane').length,
        czekaja: wszystkie.filter(z => z.stan === 'wyslane').length,
        przypomniane: wszystkie.filter(z => z.przypomniano).length
      };
    }
  };
}

/** Treść przypomnienia. SMS, więc bez polskich znaków i do 160 znaków. */
export function trescPrzypomnienia({ imie }) {
  const tekst = `Przypominamy: ${imie} nie otworzyla jeszcze Twojego zaproszenia do Bezpiecznej Rodziny. Link dziala przez tydzien: bezpiecznarodzina.pl/z`;
  return tekst.length > 160 ? tekst.slice(0, 157) + '...' : tekst;
}
