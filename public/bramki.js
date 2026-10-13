// Bramki człowieka: akceptacja albo odrzucenie, z powodem i następstwem.
//
// Dotąd bramka była jednym przyciskiem, który przełączał się w „zaakceptowane”.
// Nie dało się nic odrzucić, a to jest połowa pracy osoby decydującej — i ta
// ciekawsza, bo odrzucenie niesie informację, której akceptacja nie niesie.
//
// Trzy rzeczy, które ten moduł wymusza:
//   1. ODRZUCENIE WYMAGA POWODU. Bez powodu bank wiedzy zbiera same „nie”,
//      a następny obrót pętli zaczyna od zera.
//   2. ODRZUCENIE MA NASTĘPSTWO. Nie kończy się na zmianie koloru przycisku:
//      hipoteza odrzucona przesuwa pracę na kolejną stratę z diagnozy.
//   3. PACZKA DO WYSYŁKI JEST ZABLOKOWANA, dopóki hipoteza i treści nie są
//      zaakceptowane. Inaczej da się wysłać coś, czego nikt nie zatwierdził.

export const BRAMKI = ['hipoteza', 'tresci', 'decyzja', 'uzasadnienie'];

/** Odrzucenie uzasadnienia z tym powodem znaczy „zmień pomysł”, nie „przepisz”. */
export const POWOD_INNY_POMYSL = 'Wolę inny pomysł z banku';

/** Gotowe powody do wyboru. Pole tekstowe jest zawsze dodatkiem, nie zamiennikiem. */
export const POWODY = {
  hipoteza: [
    'Nie wierzę w mechanizm',
    'Ważniejsza jest inna strata',
    'Koszt wdrożenia nie zwróci się przy tym efekcie',
    'Wymaga zgody, której nie dostaniemy',
    'Już to sprawdzaliśmy'
  ],
  tresci: [
    'Ton nie pasuje do marki',
    'Obietnica za mocna',
    'Dział prawny tego nie puści',
    'Ten kanał nie dotrze do tych klientów',
    'Treść myli odbiorcę'
  ],
  decyzja: [
    'Wynik prawdziwy, ale nie na teraz',
    'Za mała próba jak na wagę decyzji',
    'Wdrożenie wymaga pracy, której nie mamy',
    'Działa tylko na części urządzeń'
  ],
  uzasadnienie: [
    'Nie wynika z liczb',
    'Pomija ważne ryzyko',
    'Za ogólne, nie da się z tym pracować',
    POWOD_INNY_POMYSL
  ]
};

/**
 * Hipotezy przypisane do kroku lejka, na którym kończy się strata.
 * Dzięki temu propozycja po odrzuceniu nie jest kolejną pozycją ze sztywnej
 * listy, tylko odpowiedzią na to, gdzie naprawdę tracimy ludzi.
 *
 * Klucz to indeks kroku docelowego: 1 pobranie, 2 konto, 3 bliski, 4 mapa.
 */
export const HIPOTEZY_WG_KROKU = {
  1: {
    nazwa: 'Najpierw wartość, potem aplikacja',
    hipoteza: 'Klient z pakietem, który zobaczy bliskiego na mapie bez instalowania aplikacji, częściej dojdzie do pierwszej wartości i potem pobierze aplikację.',
    dlaczego: 'Ci klienci nie mają aplikacji, więc push do nich nie dotrze. Zostaje kanał operatora i mapa w przeglądarce.'
  },
  2: {
    nazwa: 'Rozpoznanie numeru zamiast formularza',
    hipoteza: 'Klient, który nie musi przepisywać numeru ani kodu z SMS-a, częściej zakłada konto.',
    dlaczego: 'Między pobraniem a kontem stoi formularz i kod SMS. Rozpoznanie numeru przez sieć usuwa oba kroki.'
  },
  3: {
    nazwa: 'Prośba do bliskiego wysyłana za klienta',
    hipoteza: 'Klient, za którego wyślemy prośbę o zgodę SMS-em, częściej dodaje pierwszą bliską osobę.',
    dlaczego: 'Klient zakłada konto i utyka, bo nie ma kogo dodać. Prośba od operatora ma wyższą dostarczalność niż nasza.'
  },
  4: {
    nazwa: 'Mapa w przeglądarce dla tych, którzy już dodali bliskiego',
    hipoteza: 'Klient, który ma dodaną bliską osobę, ale nie widział mapy, zobaczy ją po linku bez instalacji.',
    dlaczego: 'Wartość jest o jedno kliknięcie, a klient jej nie widzi.'
  }
};

/**
 * Pomysły na następny test, po kolei. Lista jest krótka i jawna, bo przy
 * bramce uzasadnienia człowiek ma mieć co wybrać — „to uzasadnienie jest złe”
 * często znaczy „to nie jest pomysł, który chcę teraz sprawdzać”.
 */
export const POMYSLY_NA_TEST = [
  {
    id: 'strefa',
    nazwa: 'Prowadzenie do pierwszej strefy i pierwszego powiadomienia',
    dlaczego: 'Zwycięski wariant doprowadza do pierwszej lokalizacji. Powodem, żeby wrócić, jest strefa i powiadomienie — bez nich klient widzi mapę raz.'
  },
  {
    id: 'rozpoznanie',
    nazwa: 'Rozpoznanie numeru zamiast formularza',
    dlaczego: HIPOTEZY_WG_KROKU[2].dlaczego
  },
  {
    id: 'prosba',
    nazwa: 'Prośba do bliskiego wysyłana za klienta',
    dlaczego: HIPOTEZY_WG_KROKU[3].dlaczego
  },
  {
    id: 'rcs',
    nazwa: 'Karta RCS zamiast SMS-a tam, gdzie działa',
    dlaczego: 'RCS pokazuje nadawcę i mapę w podglądzie. Na Androidzie z RCS-em da się porównać ten sam komunikat w dwóch opakowaniach.'
  }
];

/** Pierwszy pomysł, którego człowiek jeszcze nie odrzucił. Bez nich: null. */
export function nastepnyPomysl(odrzucone = []) {
  return POMYSLY_NA_TEST.find(p => !odrzucone.includes(p.id)) || null;
}

export function nowyStanBramek() {
  return Object.fromEntries(BRAMKI.map(b => [b, {
    stan: 'czeka', powod: null, uwagi: '', data: null, licznikOdrzucen: 0
  }]));
}

/** Akceptacja kasuje wcześniejszy powód — nie chcemy go pokazywać przy zielonej bramce. */
export function zaakceptuj(stanBramek, bramka, { teraz = () => Date.now() } = {}) {
  if (!BRAMKI.includes(bramka)) throw new Error(`Nieznana bramka: ${bramka}`);
  const b = stanBramek[bramka];
  return {
    ...stanBramek,
    [bramka]: { ...b, stan: 'zaakceptowana', powod: null, uwagi: '', data: new Date(teraz()).toISOString() }
  };
}

/**
 * Odrzucenie. Powód jest obowiązkowy: albo pozycja z listy, albo własny tekst.
 * Bez tego odrzucenie nie niesie żadnej informacji dalej.
 */
export function odrzuc(stanBramek, bramka, { powod, uwagi = '', teraz = () => Date.now() } = {}) {
  if (!BRAMKI.includes(bramka)) throw new Error(`Nieznana bramka: ${bramka}`);
  const wybrany = String(powod || '').trim();
  const wlasny = String(uwagi || '').trim();
  if (!wybrany && !wlasny) {
    throw new Error('Odrzucenie wymaga powodu: wybierz z listy albo opisz własnymi słowami.');
  }
  const b = stanBramek[bramka];
  return {
    ...stanBramek,
    [bramka]: {
      stan: 'odrzucona',
      powod: wybrany || null,
      uwagi: wlasny,
      data: new Date(teraz()).toISOString(),
      licznikOdrzucen: b.licznikOdrzucen + 1
    }
  };
}

/**
 * Cofnięcie bramki do oczekiwania. Nie jest przeciwieństwem odrzucenia — nie
 * kasuje licznika — tylko mówi „to, co zaakceptowano, już nie obowiązuje”.
 * Tak się dzieje, gdy treści zmienią się po akceptacji albo gdy odrzucona
 * hipoteza unieważnia komunikaty napisane pod poprzednią stratę.
 */
export function cofnij(stanBramek, bramka) {
  if (!BRAMKI.includes(bramka)) throw new Error(`Nieznana bramka: ${bramka}`);
  return {
    ...stanBramek,
    [bramka]: { ...stanBramek[bramka], stan: 'czeka', powod: null, uwagi: '', data: null }
  };
}

/** Jednym zdaniem: co człowiek napisał przy odrzuceniu. */
export function opisPowodu(wpis) {
  if (!wpis || wpis.stan !== 'odrzucona') return '';
  if (wpis.powod && wpis.uwagi) return `${wpis.powod} — ${wpis.uwagi}`;
  return wpis.powod || wpis.uwagi;
}

/**
 * Paczka do wysyłki jedzie dopiero, gdy hipoteza i treści są zaakceptowane.
 * Decyzja i uzasadnienie jej nie blokują — dotyczą tego, co po teście.
 */
export function paczkaZablokowana(stanBramek) {
  const brakujace = ['hipoteza', 'tresci'].filter(b => stanBramek[b].stan !== 'zaakceptowana');
  if (!brakujace.length) return { zablokowana: false, powod: '' };

  const nazwy = { hipoteza: 'hipotezy', tresci: 'treści' };
  const opis = brakujace.map(b =>
    stanBramek[b].stan === 'odrzucona' ? `${nazwy[b]} (odrzucone)` : nazwy[b]).join(' i ');
  return {
    zablokowana: true,
    powod: `Zablokowana, czeka na akceptację ${opis}.`,
    brakujace
  };
}

/** Hipoteza pasująca do konkretnej straty z diagnozy. */
export function hipotezaDlaStraty(strata) {
  const szablon = HIPOTEZY_WG_KROKU[strata?.to];
  if (!szablon) return null;
  return {
    ...szablon,
    strata,
    // „dlaczego ten test” łączy szablon z liczbą, która go uzasadnia
    dlaczegoTenTest: `${szablon.dlaczego} Strata na tym kroku to ${strata.lost} osób miesięcznie w kanale ${strata.ch.short}.`
  };
}

/**
 * Następna hipoteza po odrzuceniu. Bierze kolejną stratę z diagnozy, pomijając
 * te, dla których hipotezę już odrzucono — inaczej narzędzie proponowałoby
 * w kółko to samo.
 */
export function nastepnaHipoteza(straty, odrzucone = []) {
  const pominiete = new Set(odrzucone);
  for (let i = 0; i < straty.length; i++) {
    const s = straty[i];
    const klucz = kluczStraty(s);
    if (pominiete.has(klucz)) continue;
    const h = hipotezaDlaStraty(s);
    if (h) return { ...h, numerStraty: i + 1, klucz };
  }
  return null;
}

/** Stabilny klucz straty: kanał i krok. Po nim poznajemy, że już ją odrzucono. */
export const kluczStraty = (s) => `${s.ch.id}:${s.from}-${s.to}`;

/**
 * Trzy wyjścia z odrzuconej decyzji o wdrożeniu. „Nie wdrażamy” znaczy
 * w praktyce trzy różne rzeczy, a każda co innego robi z punktem odniesienia
 * i z następnym testem — więc człowiek wybiera, a nie tylko mówi „nie”.
 */
export const WYJSCIA_DECYZJI = [
  {
    id: 'nie-wdrazamy',
    etykieta: 'Nie wdrażamy',
    opis: 'Wynik zostaje w banku wiedzy, punkt odniesienia bez zmian.'
  },
  {
    id: 'powtorz',
    etykieta: 'Powtarzamy test',
    opis: 'Ten sam pomysł jeszcze raz, liczebność liczona od zmierzonej kontroli.'
  },
  {
    id: 'czesciowo',
    etykieta: 'Wdrażamy częściowo',
    opis: 'Na części klientów albo urządzeń — trzeba opisać zakres.'
  }
];

const WYJSCIE = Object.fromEntries(WYJSCIA_DECYZJI.map(w => [w.id, w]));

/**
 * Skutek odrzuconej decyzji: co napisać na ekranie, co trafia do banku wiedzy
 * i czy punkt odniesienia się zmienia. Nie zmienia się w żadnym z trzech
 * wyjść — zwycięzca, którego nie wdrożono w całości, nie jest nową bazą.
 *
 * `wynik` opisuje stronę ({nazwa, opis}), bo to ona formatuje liczby.
 */
export function skutekDecyzji({ wybor, zakres = '', wpis, wynik = {} }) {
  if (!WYJSCIE[wybor]) throw new Error('Wybierz, co robimy zamiast wdrożenia.');

  const opisZakresu = String(zakres || '').trim();
  if (wybor === 'czesciowo' && !opisZakresu) {
    throw new Error('Wdrożenie częściowe wymaga zakresu: na kim albo na czym je włączamy.');
  }

  const nazwa = wynik.nazwa || 'Zwycięski wariant';
  const powod = opisPowodu(wpis) || '—';
  const data = wpis?.data ? new Date(wpis.data).toLocaleDateString('pl-PL') : '';
  const wspolne = {
    odrzucona: true,
    hip: wynik.hipoteza || '—',
    kanal: wynik.kanal || '—',
    wynik: wynik.opis || 'Wynik testu bez zmian — zmieniła się tylko decyzja o wdrożeniu.',
    przenaszalnosc: wynik.przenaszalnosc || 'Decyzja dotyczy tego rynku; wynik testu przenosi się osobno.'
  };

  if (wybor === 'powtorz') {
    return {
      wyjscie: wybor,
      naglowek: 'Powtarzamy test.',
      opis: 'Punkt odniesienia zostaje bez zmian, dopóki powtórzony test nie rozstrzygnie.',
      baselineBezZmian: true,
      planPowtorki: true,
      karta: { ...wspolne, tytul: `${nazwa} — wynik do potwierdzenia`, decyzja: `Powtarzamy test${data ? ` (${data})` : ''}: ${powod}` }
    };
  }

  if (wybor === 'czesciowo') {
    return {
      wyjscie: wybor,
      naglowek: `Wdrażamy częściowo: ${opisZakresu}.`,
      opis: 'Punkt odniesienia zostaje bez zmian — liczony jest dla wszystkich, a zmiana objęła część.',
      baselineBezZmian: true,
      planPowtorki: false,
      zakres: opisZakresu,
      karta: { ...wspolne, tytul: `${nazwa} — wdrożony częściowo`, decyzja: `Wdrożenie częściowe, ${opisZakresu}${data ? ` (${data})` : ''}: ${powod}` }
    };
  }

  return {
    wyjscie: wybor,
    naglowek: 'Nie wdrażamy zwycięzcy.',
    opis: 'Wynik zostaje w banku wiedzy, punkt odniesienia bez zmian, a kolejny test bierze następny pomysł.',
    baselineBezZmian: true,
    planPowtorki: false,
    karta: { ...wspolne, tytul: `${nazwa} — wygrał, nie wdrożony`, decyzja: `Nie wdrażamy${data ? ` (${data})` : ''}: ${powod}` }
  };
}

/**
 * Karta do banku wiedzy z odrzuconej hipotezy. Zapisujemy ją, bo „sprawdziliśmy
 * i odrzuciliśmy przed testem” jest wiedzą tak samo jak wynik testu — i chroni
 * następny obrót pętli przed powtórzeniem tej samej rozmowy.
 */
export function kartaOdrzuconejHipotezy({ hipoteza, wpis, strata, krok }) {
  // `krok` dostajemy ze strony, bo tylko ona zna nazwy etapów lejka; bez niego
  // karta pokazuje numery, co nadal jest czytelne w teście.
  const nazwaKroku = krok || (strata ? `${strata.from} → ${strata.to}` : '');
  return {
    odrzucona: true,
    tytul: hipoteza?.nazwa || 'Hipoteza odrzucona przed testem',
    hip: hipoteza?.hipoteza || '—',
    kanal: strata ? `${strata.ch.name}, krok ${nazwaKroku}` : '—',
    wynik: 'Nie testowano — człowiek odrzucił hipotezę przed uruchomieniem testu.',
    decyzja: `Odrzucona ${wpis?.data ? new Date(wpis.data).toLocaleDateString('pl-PL') : ''}: ${opisPowodu(wpis) || '—'}`,
    przenaszalnosc: 'Powód odrzucenia dotyczy tego rynku; na innym może nie obowiązywać.'
  };
}
