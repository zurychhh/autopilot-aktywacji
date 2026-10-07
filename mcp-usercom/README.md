# Serwer MCP nad API User.com

Pięć narzędzi, przez które agent pracuje z marketing automation Locona:
od segmentu przez zdarzenie po szkic kampanii i jej wyniki.

| Narzędzie | Co robi | Endpoint User.com |
| --- | --- | --- |
| `list_segments` | segmenty użytkowników z liczebnością | `GET /segments/` |
| `get_user` | jeden użytkownik po id, e-mailu albo telefonie | `GET /users/:id/`, `GET /users/search/` |
| `create_event` | zapisuje mikrokonwersję na koncie użytkownika | `POST /events/` |
| `create_test_campaign` | kampania SMS jako **szkic**, bez wysyłki | `POST /sms-campaign/` |
| `get_campaign_stats` | wyniki kampanii SMS albo e-mail | `GET /sms-campaign/`, `GET /email-campaign/` |

Wszystkie chodzą przez wspólnego klienta `lib/usercom.js` — tego samego, którego
używa backend. Jedno miejsce na adresy, nagłówki i obsługę błędów.

## DRY_RUN jest domyślnie włączony

Bez `DRY_RUN=false` **żadne wywołanie nie wychodzi w sieć**. Narzędzia zwracają
przykładowe odpowiedzi oznaczone polem `"tryb": "dry-run"` i zdaniem, że dane
są wymyślone. Narzędzie, które domyślnie wysyła kampanie SMS, byłoby groźne —
łatwiej włączyć tryb bojowy świadomie, niż naprawiać wysłaną wiadomość.

`create_test_campaign` nawet po wyłączeniu DRY_RUN tworzy kampanię ze statusem
`draft`. Wysyłkę uruchamia człowiek w panelu User.com; ten serwer tego nie robi
i nie zrobi bez wyraźnej zmiany w kodzie.

## Zmienne środowiskowe

| Zmienna | Wartość | Uwagi |
| --- | --- | --- |
| `USERCOM_BASE_URL` | `https://<subdomena>.user.com/api/public/` | z ukośnikiem na końcu |
| `USERCOM_TOKEN` | 64-znakowy klucz | Settings → Workspace settings → API & Integrations → Public API |
| `DRY_RUN` | `true` | tylko dosłowne `false` włącza prawdziwe wywołania |

### Co zmienić po założeniu konta

1. Podstaw swoją subdomenę w `USERCOM_BASE_URL` — to część adresu, pod którym
   logujesz się do panelu.
2. Wygeneruj klucz i wpisz go w `USERCOM_TOKEN` (nigdy w repozytorium).
3. Zostaw `DRY_RUN=true`, póki nie sprawdzisz odpowiedzi na podglądzie.
4. Dopiero potem `DRY_RUN=false` — i nadal nic się samo nie wyśle.

**Czego nie sprawdziliśmy:** czy darmowy plan User.com daje dostęp do Public API.
Strona mówi o darmowym planie bez karty, ale nie znaleźliśmy potwierdzenia, że
zakładka API & Integrations jest na nim dostępna. Jeśli jej nie ma, token
wymaga planu płatnego.

## Podłączenie do Claude Code

```bash
claude mcp add usercom -- node /ABSOLUTNA/SCIEZKA/mcp-usercom/server.js
```

Albo ręcznie w `.mcp.json` w katalogu projektu:

```json
{
  "mcpServers": {
    "usercom": {
      "command": "node",
      "args": ["mcp-usercom/server.js"],
      "env": {
        "USERCOM_BASE_URL": "https://<subdomena>.user.com/api/public/",
        "USERCOM_TOKEN": "<64 znaki>",
        "DRY_RUN": "true"
      }
    }
  }
}
```

Sprawdzenie: `claude mcp list` — `usercom` ma być na liście, a `/mcp` w sesji
pokaże pięć narzędzi.

## Podłączenie do Claude Desktop

Plik konfiguracyjny:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "usercom": {
      "command": "node",
      "args": ["/ABSOLUTNA/SCIEZKA/autopilot-aktywacji/mcp-usercom/server.js"],
      "env": {
        "USERCOM_BASE_URL": "https://<subdomena>.user.com/api/public/",
        "USERCOM_TOKEN": "<64 znaki>",
        "DRY_RUN": "true"
      }
    }
  }
}
```

Ścieżka musi być bezwzględna — Claude Desktop nie ma katalogu roboczego projektu.
Po zapisaniu pliku trzeba zamknąć i uruchomić aplikację ponownie.

## Scenariusz demo: z „Paczki do wysyłki" do szkicu kampanii

Krok 4 prototypu kończy się sekcją **„Paczka do wysyłki"** — to JSON z planem
testu: segment, grupy, liczebności, miara główna. Scenariusz pokazuje, jak agent
zamienia ten plan w rzeczy istniejące w User.com.

Skopiuj paczkę ze strony i poproś Claude:

> Weź tę paczkę testu i przygotuj ją w User.com. Najpierw pokaż mi segmenty
> i wybierz ten, który pasuje do warunku z paczki. Potem przygotuj szkic
> kampanii SMS dla wariantu B — treść bez polskich znaków, do 160 znaków.
> Na koniec pokaż statystyki ostatniej kampanii, żebym wiedział, czego się
> spodziewać po liczebności.
>
> ```json
> { … wklejona paczka … }
> ```

Claude wywoła po kolei:

1. **`list_segments`** → zobaczy „Operator: aktywny pakiet, brak pobrania
   aplikacji" (6900 osób) i dopasuje go do warunku z paczki
2. **`create_test_campaign`** → szkic z treścią wariantu B, przypięty do tego
   segmentu; limit 160 znaków jest sprawdzany po stronie klienta, więc za długa
   treść wraca błędem, a nie cichym obcięciem
3. **`get_campaign_stats`** → wysłane, dostarczone, kliknięcia, wypisania

W DRY_RUN każdy krok pokazuje dokładnie, co poszłoby do API — metodę, ścieżkę
i ciało żądania. Dzięki temu da się obejrzeć całą ścieżkę, zanim ktokolwiek
dostanie SMS.

Dodatkowo `create_event` zapisuje mikrokonwersje prototypu (`pierwsza_lokalizacja`,
`strefa_ustawiona`), a `get_user` sprawdza, czy konkretna osoba ma pakiet
i czy pobrała aplikację.

## Testy

```bash
npm test
```

Klient API jest przetestowany na zamockowanym `fetch`: adresy, obydwa wymagane
nagłówki, kształt ciała żądania, zamiana błędu HTTP na wyjątek, odpowiedź, która
nie jest JSON-em, oraz to, że w DRY_RUN nie wychodzi ani jedno żądanie.
