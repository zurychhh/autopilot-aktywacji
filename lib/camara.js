// Rozpoznanie numeru przez sieć operatora — MAKIETA zgodna ze specyfikacją
// CAMARA Number Verification.
//
// Źródło specyfikacji:
// https://github.com/camaraproject/NumberVerification (API_definitions/number-verification.yaml)
//
// Dlaczego makieta, a nie prawdziwe wywołanie: API wymaga trójstronnego tokenu
// wydanego przez operatora po podpisaniu umowy. Nie da się tego obejść i nie
// powinno się dać — to jest cały sens tego mechanizmu. Zakładanie konta
// u operatora jest poza moim zakresem, więc odtwarzam zachowanie, a nie udaję
// połączenia.
//
// Co makieta odtwarza wiernie:
//   * dwa punkty: POST /verify i GET /device-phone-number
//   * ciało żądania: DOKŁADNIE jedno z pól phoneNumber albo hashedPhoneNumber
//   * hash: SHA-256 w zapisie szesnastkowym z numeru w formacie E.164 z plusem
//   * token jednorazowy, maksymalnie 300 sekund życia, bez odświeżania
//   * kody błędów i kształt odpowiedzi błędu zgodne z CAMARA

import { createHash, randomBytes } from 'node:crypto';

export const ZYCIE_TOKENU_S = 300;      // specyfikacja: nie więcej niż 300 s
export const SPEC = 'CAMARA Number Verification (x-camara-commonalities 0.9.0)';

export class BladCamara extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'BladCamara';
    this.status = status;
    this.code = code;
  }
  /** Kształt odpowiedzi błędu zgodny z CAMARA. */
  doOdpowiedzi() {
    return { status: this.status, code: this.code, message: this.message };
  }
}

export const hashNumeru = (numer) =>
  createHash('sha256').update(String(numer), 'utf8').digest('hex');

/** E.164: plus, kod kraju, od 7 do 15 cyfr łącznie. */
export const poprawnyNumer = (n) => /^\+[1-9][0-9]{6,14}$/.test(String(n || ''));

/**
 * Makieta serwera operatora. Trzyma, który numer jest „w telefonie" dla danego
 * tokenu — tak jak robi to prawdziwa sieć, tyle że tam wie to z SIM-a.
 */
export function makietaOperatora({ teraz = () => Date.now(), losujToken } = {}) {
  const tokeny = new Map();
  const wydaj = losujToken || (() => randomBytes(16).toString('hex'));

  return {
    spec: SPEC,
    makieta: true,

    /**
     * Odpowiednik przepływu OIDC z prompt=none. W produkcji token wydaje
     * operator po rozpoznaniu SIM-a; tutaj podajemy numer wprost, bo bez
     * umowy nie ma czego rozpoznawać.
     */
    wydajToken({ numerWTelefonie }) {
      if (!poprawnyNumer(numerWTelefonie)) {
        throw new BladCamara(400, 'INVALID_ARGUMENT', 'Numer musi być w formacie E.164, na przykład +48600000000.');
      }
      const token = wydaj();
      tokeny.set(token, { numerWTelefonie, wygasa: teraz() + ZYCIE_TOKENU_S * 1000, zuzyty: false });
      return { access_token: token, token_type: 'Bearer', expires_in: ZYCIE_TOKENU_S };
    },

    /** Każde wywołanie zużywa token bezpowrotnie — tak mówi specyfikacja. */
    _zuzyj(token) {
      const t = tokeny.get(token);
      if (!t) throw new BladCamara(401, 'UNAUTHENTICATED', 'Brak tokenu albo token nieznany.');
      if (t.zuzyty) throw new BladCamara(401, 'UNAUTHENTICATED', 'Token jednorazowy został już użyty. Trzeba przeprowadzić nowe uwierzytelnienie.');
      if (teraz() > t.wygasa) throw new BladCamara(401, 'UNAUTHENTICATED', 'Token wygasł. Maksymalne życie tokenu to 300 sekund.');
      t.zuzyty = true;
      return t;
    },

    /** POST /verify — zwraca true/false, nigdy samego numeru. */
    verify(token, cialo) {
      const pola = ['phoneNumber', 'hashedPhoneNumber'].filter(k => cialo && cialo[k] !== undefined && cialo[k] !== '');
      if (pola.length !== 1) {
        throw new BladCamara(400, 'INVALID_ARGUMENT',
          'Podaj dokładnie jedno z pól: phoneNumber albo hashedPhoneNumber.');
      }
      const t = this._zuzyj(token);

      if (pola[0] === 'phoneNumber') {
        if (!poprawnyNumer(cialo.phoneNumber)) {
          throw new BladCamara(400, 'INVALID_ARGUMENT', 'phoneNumber musi być w formacie E.164 z plusem.');
        }
        return { devicePhoneNumberVerified: cialo.phoneNumber === t.numerWTelefonie };
      }

      if (!/^[a-fA-F0-9]{64}$/.test(cialo.hashedPhoneNumber)) {
        throw new BladCamara(400, 'INVALID_ARGUMENT', 'hashedPhoneNumber musi być 64 znakami szesnastkowymi (SHA-256).');
      }
      return {
        devicePhoneNumberVerified:
          cialo.hashedPhoneNumber.toLowerCase() === hashNumeru(t.numerWTelefonie)
      };
    },

    /**
     * GET /device-phone-number — zwraca numer. W produkcji wymaga osobnej
     * zgody i osobnego zakresu, bo to już udostępnienie danych, a nie
     * potwierdzenie czegoś, co aplikacja i tak wie.
     */
    devicePhoneNumber(token, { zgodaNaUdostepnienie = false } = {}) {
      if (!zgodaNaUdostepnienie) {
        throw new BladCamara(403, 'PERMISSION_DENIED',
          'Zwrócenie numeru wymaga osobnego zakresu zgody niż samo potwierdzenie.');
      }
      const t = this._zuzyj(token);
      return { devicePhoneNumber: t.numerWTelefonie };
    }
  };
}

/**
 * Co ta funkcja zmienia w prototypie: krok „Założenie konta" traci formularz.
 * Z lejka wiemy, ile osób na nim odpada — stąd ta liczba w opisie na ekranie.
 */
export const KROK_W_LEJKU = {
  z: 'pobranie',
  na: 'konto',
  opis: 'Rozpoznanie numeru przez sieć zastępuje formularz rejestracji. Klient nie przepisuje numeru i nie czeka na SMS z kodem.'
};
