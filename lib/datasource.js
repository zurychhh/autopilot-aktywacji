// Wymienne źródło danych. Jeden interfejs, trzy implementacje.
//
//   csv      — pliki w repozytorium (data/*.csv). DOMYŚLNE, bo dzięki temu
//              wszystko działa od razu po sklonowaniu, bez cudzego arkusza
//              i bez żadnego klucza.
//   sheets   — publiczny arkusz Google przez eksport CSV. Bez klucza API,
//              wystarczy udostępnienie „każdy z linkiem może wyświetlać".
//   bigquery — szkielet docelowy. Nie strzela zapytaniami; opisuje, jakich
//              tabel i kolumn potrzebuje Locon, i mówi to wprost zamiast
//              udawać, że działa.
//
// Wybór przez DATA_SOURCE=csv|sheets|bigquery.

import { readFileSync } from 'node:fs';
import { csvNaObiekty, naLiczby } from './csv.js';

export const KROKI_LEJKA = ['start', 'pobranie', 'konto', 'bliski', 'mapa', 'd7', 'd30'];

/** Nazwy zakładek i plików — te same w obu źródłach CSV. */
export const ZESTAWY = ['funnel_daily', 'actions_log', 'calendar', 'tests'];

export class BladZrodla extends Error {
  constructor(komunikat, { zrodlo, zestaw } = {}) {
    super(komunikat);
    this.name = 'BladZrodla';
    this.zrodlo = zrodlo;
    this.zestaw = zestaw;
  }
}

const porzadkujLejek = (w) => naLiczby(w, KROKI_LEJKA);
const porzadkujTesty = (w) => naLiczby(w, ['liczebnosc_planowana', 'konwersja_wariantu']);

/** Wspólna część dla obu źródeł CSV: surowy tekst → gotowe obiekty. */
function zCsv(czytaj, zrodlo) {
  const pobierz = async (zestaw, porzadkuj = (x) => x) => {
    try {
      return csvNaObiekty(await czytaj(zestaw)).map(porzadkuj);
    } catch (e) {
      throw new BladZrodla(`Nie udało się wczytać ${zestaw}: ${e.message}`, { zrodlo, zestaw });
    }
  };
  return {
    zrodlo,
    getFunnelDaily: () => pobierz('funnel_daily', porzadkujLejek),
    getActionsLog: () => pobierz('actions_log'),
    getCalendar: () => pobierz('calendar'),
    getTests: () => pobierz('tests', porzadkujTesty)
  };
}

/** Pliki z repozytorium. Działa bez sieci i bez żadnej konfiguracji. */
export function zrodloCsv({ katalog = new URL('../data/', import.meta.url) } = {}) {
  return zCsv(async (zestaw) => readFileSync(new URL(`${zestaw}.csv`, katalog), 'utf8'), 'csv');
}

/**
 * Publiczny arkusz Google. Każda zakładka pobierana jako CSV po nazwie,
 * więc nie trzeba znać identyfikatorów zakładek ani mieć klucza API.
 */
export function zrodloSheets({
  sheetId = process.env.SHEET_ID,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!sheetId) throw new BladZrodla('Brak SHEET_ID dla źródła "sheets".', { zrodlo: 'sheets' });

  return zCsv(async (zestaw) => {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(zestaw)}`;
    const odp = await fetchImpl(url);
    if (!odp.ok) {
      throw new Error(`arkusz odpowiedział ${odp.status} (czy jest udostępniony „każdy z linkiem"?)`);
    }
    return odp.text();
  }, 'sheets');
}

/**
 * Szkielet dla BigQuery. Zamiast udawać, że działa, mówi dokładnie, czego
 * potrzebuje — ten opis jest wkładem dla zespołu Locon, nie zaślepką.
 */
export const SCHEMAT_BIGQUERY = {
  funnel_daily: {
    opis: 'Jeden wiersz na dzień, kanał i operatora. Źródłem są zdarzenia aplikacji i systemu zamówień.',
    kolumny: {
      data: 'DATE — dzień aktywacji',
      kanal: 'STRING — op | own | ret',
      operator: 'STRING — Play | Orange | T-Mobile | Plus; puste poza kanałem operatora',
      start: 'INT64 — aktywne subskrypcje tego dnia',
      pobranie: 'INT64 — pobrania aplikacji',
      konto: 'INT64 — założone konta',
      bliski: 'INT64 — dodani bliscy lub urządzenia',
      mapa: 'INT64 — pierwsze zobaczenie lokalizacji',
      d7: 'INT64 — aktywni w 7. dniu',
      d30: 'INT64 — aktywni w 30. dniu'
    }
  },
  actions_log: {
    opis: 'Co zrobiliśmy my i co zrobili partnerzy. Bez tego kokpit nie ma czym tłumaczyć zmian.',
    kolumny: {
      data: 'DATE', kanal: 'STRING', operator: 'STRING',
      rodzaj: 'STRING — kampania | zmiana_oferty | produkt | proces',
      nazwa: 'STRING', wlasciciel: 'STRING', uwagi: 'STRING'
    }
  },
  calendar: {
    opis: 'Wyjaśnienia zewnętrzne: rok szkolny, ferie, premiery systemów. Sprawdzane przed szukaniem winnego po naszej stronie.',
    kolumny: { data_od: 'DATE', data_do: 'DATE', rodzaj: 'STRING', nazwa: 'STRING', wplyw: 'STRING — niski | sredni | wysoki' }
  },
  tests: {
    opis: 'Rejestr testów z punktem odniesienia i uzasadnieniem decyzji.',
    kolumny: {
      id: 'STRING', kanal: 'STRING — op | own | ret', operator: 'STRING — pusty, gdy test obejmuje cały kanał',
      hipoteza: 'STRING', dlaczego_ten_test: 'STRING',
      baseline_id: 'STRING', wariant: 'STRING', liczebnosc_planowana: 'INT64',
      status: 'STRING', decyzja: 'STRING',
      konwersja_wariantu: 'FLOAT64 — konwersja zwycięskiego wariantu; od niej liczy się liczebność następnego testu',
      uzasadnienie_decyzji: 'STRING',
      data_rozstrzygniecia: 'DATE'
    }
  }
};

export function zrodloBigQuery({ projekt = process.env.BIGQUERY_PROJECT, zbior = process.env.BIGQUERY_DATASET } = {}) {
  const nieGotowe = (zestaw) => {
    throw new BladZrodla(
      `Źródło BigQuery to na razie szkielet. Potrzebna tabela \`${projekt || '<projekt>'}.${zbior || '<zbior>'}.${zestaw}\` ` +
      `o kolumnach: ${Object.keys(SCHEMAT_BIGQUERY[zestaw].kolumny).join(', ')}.`,
      { zrodlo: 'bigquery', zestaw }
    );
  };
  return {
    zrodlo: 'bigquery',
    schemat: SCHEMAT_BIGQUERY,
    getFunnelDaily: async () => nieGotowe('funnel_daily'),
    getActionsLog: async () => nieGotowe('actions_log'),
    getCalendar: async () => nieGotowe('calendar'),
    getTests: async () => nieGotowe('tests')
  };
}

/** Fabryka. DATA_SOURCE=csv jest domyślne, żeby wszystko działało bez konfiguracji. */
export function zrodloDanych({ rodzaj = process.env.DATA_SOURCE || 'csv', ...opcje } = {}) {
  if (rodzaj === 'csv') return zrodloCsv(opcje);
  if (rodzaj === 'sheets') return zrodloSheets(opcje);
  if (rodzaj === 'bigquery') return zrodloBigQuery(opcje);
  throw new BladZrodla(`Nieznane źródło danych "${rodzaj}". Dozwolone: csv, sheets, bigquery.`);
}
