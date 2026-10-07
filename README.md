# Autopilot Aktywacji

[![testy](https://github.com/zurychhh/autopilot-aktywacji/actions/workflows/test.yml/badge.svg)](https://github.com/zurychhh/autopilot-aktywacji/actions/workflows/test.yml)

Prototyp pętli, która poprawia onboarding usługi lokalizacyjnej dla rodzin:
znajduje największą stratę w lejku, proponuje działania, planuje test, ocenia
wynik i zapisuje wniosek — a potem zaczyna od nowa, z nowym punktem odniesienia.

**Działająca wersja: https://autopilot.oleksiakconsulting.com**

> Strona jest celowo nieindeksowana (`noindex` nagłówkiem, metatagiem
> i przez `robots.txt`). Wszystkie liczby na niej są przykładowe i tak oznaczone.

Zasada, na której stoi całość: **liczby liczy kod, treści pisze AI.** Wszystko,
co wpływa na decyzję — diagnoza, liczebność grupy, test statystyczny, reguły
„wygrywa / szkodzi / za wcześnie”, wykrywanie zmian i siła dowodu — jest
deterministyczne i przetestowane. Claude nie dotyka ani jednej liczby; pisze
treści i streszcza gotowe wyniki, a każdy prompt systemowy ma to zapisane wprost.

---

## Co jest w środku

| Moduł | Co robi i jaką daje wartość |
| --- | --- |
| **Pętla aktywacji** `/` | Jeden pełny obrót: diagnoza → prawdziwa wartość → działania → plan testu → wynik → bank wiedzy → historia testów |
| **Kokpit** `/kokpit` | Codziennie odpowiada: co się zmieniło, dlaczego i jak mocny jest dowód |
| **Mapa bez aplikacji** `/mapa` | Klient widzi bliską osobę, zanim cokolwiek zainstaluje |
| **Brief dla operatora** `/operator/Play` | Tygodniowy stan wspólnych klientów i jedna propozycja wspólnej akcji, gotowa do maila |
| **Autopilot testów** `/autopilot` | Symulacja pętli, w której przydział robi algorytm (próbkowanie Thompsona) |
| **Rozpoznanie numeru** `/rozpoznanie` | Makieta CAMARA: pięć kroków rejestracji zamienia się w jeden |
| **Serwer MCP** `mcp-usercom/` | Pięć narzędzi, przez które agent pracuje z marketing automation |

### Co działa naprawdę, a co jest symulacją

| | Element |
| --- | --- |
| **Działa** | cała logika i wszystkie liczby, AI piszące treści przez Claude API, kokpit na 90 dniach danych, mapa z prawdziwą geolokalizacją przeglądarki, brief dla operatora, zadanie cykliczne |
| **Dane przykładowe** | lejek, dziennik akcji, kalendarz i rejestr testów pochodzą z generatora o stałym ziarnie |
| **Symulacja** | autopilot testów — prawdziwa matematyka, wymyśleni klienci |
| **Makieta** | rozpoznanie numeru — wierne odtworzenie specyfikacji CAMARA bez połączenia z siecią operatora |
| **Tryb bezpieczny** | kampanie, maile i przypomnienia chodzą w `DRY_RUN`: widać dokładną treść, nic nie wychodzi w świat |

Wszystko powyższe jest oznaczone **na ekranie**, nie tylko tutaj.

---

## Jak powstawało

Jedenaście etapów rozwoju, **32 scalone pull requesty**. Każdy opisywał cel,
zmiany i sposób sprawdzenia; żaden nie wszedł bez zielonego CI.

| Etap | Co wniósł |
| --- | --- |
| 1 | Obliczenia wyjęte z HTML do osobnego modułu, przykryte testami, CI od pierwszego dnia |
| 2 | Funkcje serwerowe wołające Claude API — AI działa dla każdego, bez konta |
| 3 | Wdrożenie, nieindeksowany link publiczny, skanowanie sekretów, ograniczenie `Origin` |
| 4 | Serwer MCP nad API marketing automation, w trybie `DRY_RUN` |
| 5 | Wymienne źródło danych: pliki CSV, arkusz Google, szkielet BigQuery |
| 12 | Pętla testów z punktem odniesienia champion/challenger i mailem po rozstrzygnięciu |
| 6 | Mapa w przeglądarce bez aplikacji, z jednorazową zgodą i godzinnym życiem danych |
| 7 | Kokpit: wykrywanie zmian i przypisywanie przyczyn z jawną siłą dowodu |
| 8 | Zaproszenia i przypomnienie po 48 godzinach |
| 9 | Brief dla operatora, gotowy do wklejenia w maila |
| 10 | Autopilot testów — symulacja z próbkowaniem Thompsona i hamulcem bezpieczeństwa |
| 11 | Rozpoznanie numeru przez sieć — makieta zgodna z CAMARA |

Kolejność nie jest przypadkowa: etap 12 wszedł zaraz po 5, bo pętla testów
potrzebowała źródła danych, a kokpit z etapu 7 potrzebował obu.

Poza etapami doszły pull requesty z poprawkami: podniesienie progu przy ocenie
wariantu przed osiągnięciem liczebności, naprawa fałszywego alarmu skanera
sekretów, przebudowa czytelności strony głównej i odblokowanie geolokalizacji
na stronie zgody.

### Jak było sprawdzane

- **319 testów jednostkowych** bez sieci, na wbudowanym `node:test`, bez frameworka
- **15 testów przeglądarkowych** (Playwright): pełna ścieżka mapy z przyznaną
  geolokalizacją oraz wspólna stopka na każdej stronie — bo jeden z błędów dało się zobaczyć wyłącznie przez
  zachowanie przeglądarki wobec nagłówka odpowiedzi
- **CI z trzema zadaniami** na każdym pushu i pull requeście: testy na Node 20,
  testy przeglądarkowe i `gitleaks` na pełnej historii

To repozytorium zawiera gotowy kod w jednym commicie. **Pełna historia pracy —
wszystkie pull requesty, opisy decyzji, ślepe uliczki i poprawki — jest
w repozytorium prywatnym i mogę ją udostępnić na prośbę.**

## Jak pracowałem z AI

- **Kontekst w repozytorium, nie w historii czatu.** Zasady projektu,
  identyfikacja wizualna, ton komunikatów i definicja gotowego leżą w plikach.
  Każda sesja startuje z tej samej wiedzy.
- **Prompt jako dokument, nie string w kodzie.** Prompty systemowe są
  w `api/prompts/*.md` i czytelne same z siebie. Ten sam plik widzi recenzent,
  model i odwiedzający stronę — strona pokazuje je w sekcji „Jak to działa”.
- **Testy przed refaktorem.** Logika najpierw dostała testy przypinające liczby,
  dopiero potem wyszła z HTML.
- **Testy wyłapywały moje własne błędy.** Nie raz test, który wyglądał na
  zepsuty, okazywał się poprawny: odczyty z magazynu nie dostawały zegara,
  hamulec autopilota porównywał surowe odsetki przy bazie 0,2%, a kokpit
  przypisywał spadek u operatora do wygranego testu. Każdy z tych przypadków
  ma teraz własny test z komentarzem, dlaczego naiwna wersja zawodzi.
- **Statystyka dobrana do danych, nie do wygody.** Pierwsza wersja kokpitu
  liczyła bazę na średniej i odchyleniu standardowym — jeden tydzień sezonowego
  skoku zawyżał odchylenie tak, że spadek o 35% nie przekraczał progu. Mediana
  i odchylenie medianowe tego tygodnia nie widzą i dzięki temu widzą resztę.
- **Scalanie pilnuje skrypt, nie moja uwaga.** Po tym, jak raz scaliłem pull
  request z czerwonym skanowaniem sekretów, powstał `tools/scal-przy-zielonym.sh`,
  który odmawia, dopóki wszystkie zadania CI nie są zielone.
- **Gdzie decyduje człowiek.** Trzy jawne bramki: akceptacja hipotezy,
  akceptacja treści, zatwierdzenie wdrożenia. Wszystko, co mogłoby wyjść
  w świat, chodzi w `DRY_RUN` i wymaga świadomej zmiany zmiennej środowiskowej.

---

## Uruchomienie

```bash
npm ci
cp .env.example .env     # wpisz swój ANTHROPIC_API_KEY
npm start                # http://localhost:8000
```

Node 20 lub nowszy. **Bez klucza strona też działa** — przyciski AI pokażą
czytelny powód, a na ekranie zostaną treści przygotowane wcześniej. Cała logika
i wszystkie liczby liczą się bez jednego wywołania AI.

```bash
npm test     # 319 testów jednostkowych, bez sieci
npm run e2e  # 15 testów przeglądarkowych (wymaga: npx playwright install chromium)
npm run seed # regeneracja danych w data/*.csv
```

## Testy i CI

**319 testów jednostkowych** na wbudowanym `node:test`, bez frameworka i bez sieci —
żaden nie woła Claude API ani żadnej innej usługi. Do tego **15 testów
przeglądarkowych**: pełna ścieżka mapy i wspólna stopka na każdej stronie. Na każdym pushu i pull requeście
chodzą trzy zadania: testy, testy przeglądarkowe i `gitleaks` na pełnej historii.

| Obszar | Czego pilnują |
| --- | --- |
| Logika | top 3 straty, liczebność grupy, test z i przedział, reguły decyzji |
| Pętla testów | przejścia champion/challenger, odmowa porównania z liczbą z historii |
| Źródło danych | parser CSV, zgodność sum, trzy wbudowane zdarzenia |
| Kokpit | wykrycie wszystkich trzech zdarzeń i **poprawna siła dowodu** |
| Mapa | wygasanie po godzinie, odmowa kasuje też wcześniejszą zgodę |
| Autopilot | hamulec wyłącza wariant o **najwyższej konwersji**; kontrola nigdy nie dostaje wariantu |
| Rozpoznanie numeru | token jednorazowy, odpowiedź nigdy nie zawiera numeru |
| Bezpieczeństwo | klucz nie wycieka nawet przez treść wyjątku |

## Bezpieczeństwo

**Klucz żyje wyłącznie w zmiennych środowiskowych hostingu — nigdy
w repozytorium, nigdy w przeglądarce. Rotacja to nowy klucz w panelu
i redeploy, bez jednej zmiany w kodzie.**

- `gitleaks` w CI skanuje każdy push i pull request razem z całą historią
- testy pilnują, że prefiks klucza nie trafia do `public/` ani `api/`, a treść
  wyjątku nie wycieka do odpowiedzi
- funkcje `/api` sprawdzają nagłówek `Origin` i obsługują tylko własną domenę
- limit zapytań na adres IP; **twardym ograniczeniem kosztów jest limit wydatków
  po stronie dostawcy modelu**, nie licznik w pamięci procesu

## Czego prototyp nie wie

Jak wygląda prawdziwy onboarding w produkcji, co dokładnie dostaje klient w dniu
aktywacji, jakie zgody na kontakt mają poszczególne grupy i czym wysyłane są
powiadomienia. Te odpowiedzi zmieniają liczby, nie logikę.

Trzy rzeczy, których prototyp celowo **nie udaje**, że umie:

- **Autopilot testów to symulacja.** Matematyka jest prawdziwa, klienci nie.
  Przy prawdziwym napływie pętla jest wolniejsza o rząd wielkości.
- **Rozpoznanie numeru to makieta.** Prawdziwe wywołanie wymaga tokenu wydanego
  przez sieć operatora po rozpoznaniu karty SIM — i powinno wymagać.
- **Nic nie wychodzi w świat.** Kampanie, maile i przypomnienia chodzą
  w `DRY_RUN`.

---

Wersja robocza z pełną historią pracy — wszystkimi pull requestami, opisami
decyzji i poprawkami — leży w repozytorium prywatnym. To repozytorium zawiera
gotowy kod w jednym commicie.
