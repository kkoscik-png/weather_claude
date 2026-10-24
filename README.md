# BALTIC — pogoda.seasync.co

Aplikacja pogodowa dla BW Ventspils, Ventspils Berth i Norvik Berth. Gałąź zawiera wyłącznie aplikację pogodową; wszystkie pliki aplikacji są w katalogu głównym repozytorium.

Wersja na własnym Cloudflare działa **bez logowania i kodu PIN**. Każdy znający adres może ją otworzyć. Worker nie wymaga Cloudflare Access, TEAM ani AUD. Klucz Stormglass pozostaje sekretem serwerowym. Oddzielny podgląd Sites zachowuje swoje dotychczasowe ustawienia dostępu.

## Wdrożenie przez panel Cloudflare

Ustaw Root directory `/`. Pliki `package.json` i `wrangler.jsonc` są bezpośrednio w głównym katalogu gałęzi `main`.

1. Sprawdź, czy domena `seasync.co` jest aktywna na Twoim koncie Cloudflare.
2. W Workers & Pages utwórz aplikację Worker z repozytorium GitHub `kkoscik-png/weather_claude`.
3. Wybierz gałąź produkcyjną `main` i katalog główny `/` (główny katalog repozytorium).
4. Ustaw nazwę Workera `pogoda-seasync`, polecenie budowania `npm test`, polecenie wdrożenia `npm run deploy`. Instalacja zależności: `npm ci` (jeśli panel pokazuje osobne pole).
5. Wdróż. Konfiguracja `wrangler.jsonc` deklaruje Custom Domain `pogoda.seasync.co`. Jeśli pojawi się konflikt istniejącego rekordu lub aplikacji, sprawdź, co już obsługuje ten adres, przed zastąpieniem.
6. Nie twórz aplikacji Cloudflare Access ani logowania PIN dla tej strony. Jeśli wcześniej utworzono ochronę Access obejmującą ten host, wyłącz ją dla `pogoda.seasync.co`. Samo wdrożenie kodu nie usuwa osobnej polityki Access na brzegu sieci.
7. Dodaj sekret Stormglass zgodnie z następną sekcją.

Kod jest przygotowany do wdrożenia. Sam zapis w GitHubie nie potwierdza, że domena i produkcyjny Worker zostały już zaktualizowane.

## Stormglass

Po wdrożeniu: Workers & Pages → pogoda-seasync → Settings → Variables and Secrets → Add → Secret. Nazwa: `STORMGLASS_API_KEY`; wartość: Twój klucz Stormglass. Zapisz i zastosuj zmianę. Dodaj go do środowiska działającego Workera, nie tylko środowiska budowania. Sekret z podglądu Sites nie przenosi się automatycznie na własne konto Cloudflare.

W aplikacji wybierz źródło fali `Stormglass AI`. Domyślnie pobierane są trzy pozycje portowe, a odpowiedzi są buforowane przez sześć godzin. Pełna siatka trasy wymaga `STORMGLASS_ROUTE_ENABLED=true` i odpowiedniego limitu konta: obejmuje 59 pozycji. Przy limicie 10 zapytań dziennie pozostaw tę opcję wyłączoną.

## Wdrożenie z terminala

```bash
npm ci
npm test
npx wrangler login
npm run deploy
npx wrangler secret put STORMGLASS_API_KEY
```

Logowanie Wrangler służy zarządzaniu kontem Cloudflare. Odwiedzający stronę nie logują się.

## Weryfikacja

- `pogoda.seasync.co` otwiera aplikację w prywatnym oknie przeglądarki bez przekierowania do Access i bez PIN-u.
- Mapa, wykres i źródła pogody działają.
- `/api/stormglass/status` zwraca `configured: true` po dodaniu sekretu, bez jego wartości.
- Kod i zasoby przeglądarki nie zawierają klucza Stormglass.
- Domeny `workers.dev` oraz podglądy pozostają wyłączone.

Sprawdzenie lokalne: `npm test` oraz `npm run build:check`. Szczegóły funkcji aplikacji: [APP_NOTES.md](APP_NOTES.md).

## Dodatkowe modele i terminy aktualizacji (18.10.2026)

Lista wiatru zachowuje ECMWF IFS, ICON-EU, ICON Global i SMHI SNOW; dodano DMI HARMONIE DINI. Lista fal zachowuje ECMWF WAM, Stormglass AI i dotychczasową nieaktywną pozycję SMHI SWAN; dodano FMI WAM, DMI WAM, DWD EWAM i Copernicus Baltic WAM. Nowe modele pobierają dane dopiero po wybraniu. Każdy ma niezależne dane portów, mapy i 59 próbek trasy.

Pod każdą listą są osobne terminy ostatniej i przewidywanej następnej aktualizacji w strefie Europe/Stockholm. DMI podaje czas cyklu; FMI i Copernicus publikacji; Open-Meteo metadane dostępności. Stormglass nie publikuje jednego czasu cyklu mieszanki: pokazujemy faktyczne pobranie i termin odnowienia sześciogodzinnej pamięci. Godzina pobrania nie jest przedstawiana jako czas uruchomienia modelu. Po minięciu przewidywanego terminu pozostaje informacja o oczekiwaniu; nie przesuwamy pozornie czasu prognozy.

`/api/forecast` przyjmuje tylko ustalone modele i grupy punktów aplikacji. Dane DMI i FMI mają CC BY 4.0. Copernicus Baltic WAM korzysta z publicznego oficjalnego zbioru ARCO/Zarr, bez danych logowania w przeglądarce i bez dodatkowego sekretu. Aktualną wersję zbioru wybieramy z oficjalnego STAC, pomijając wersje przyszłe i wycofane. Wszystkie nowe bezpośrednie adaptery działają bez płatnego planu. Warunki istniejących Open-Meteo i Stormglass pozostają bez zmian.

Punkty leżące na modelowej masce lądu mogą użyć pobliskiego punktu morskiego tego samego modelu; jego współrzędne i odległość są widoczne w szczegółach. Brakujące godziny i wartości pozostają brakujące. FMI/Copernicus używają okresu szczytowego Tp, DMI WAM okresu średniego. Gdy DMI HARMONIE jest przeciążone (HTTP 429) lub nie odpowiada, serwer najpierw zwraca ostatnią dobrą prognozę DMI (do 48 h, oznaczoną jako możliwie nieaktualna), a jeśli jej nie ma, pobiera DMI Seamless przez Open-Meteo (HARMONIE 2 km, dalej ECMWF). Takie dane są w interfejsie wyraźnie podpisane jako źródło zapasowe. DMI WAM i pozostałe modele nie mają zastępczego źródła.

Weryfikacja: `npm test` (dotychczasowe kontrole i nowe testy adapterów, wyboru źródła, czasu szwedzkiego oraz niezależne próbki kompresji Blosc/LZ4) i `npm run build:check`.

## Wydajność, bezpieczeństwo i interfejs (19.10.2026)

- Pliki z parametrem `?v=` (`app.js`, `style.css`) są buforowane przez przeglądarkę na rok, biblioteka Leaflet na tydzień, a `index.html` zawsze sprawdzany ponownie. Przy każdej zmianie `app.js` lub `style.css` podnieś numer `v=` w `index.html`.
- Strona wysyła nagłówki Content-Security-Policy, HSTS i Permissions-Policy. Dozwolone źródła zewnętrzne: kafelki OpenStreetMap i Google Fonts.
- Bufor serwera pamięta prawdziwy czas pobrania, więc kopia z pamięci Cloudflare nie żyje dłużej niż zakładany czas (`test/cache.test.mjs`).
- Zmiana godziny przesuwa tylko zaznaczenie w tabeli i kursor wykresu, a mapa liczy geometrię interpolacji raz na widok. Zmiana godziny trwa ok. 5–8 ms zamiast ok. 100 ms; rysowanie pola mapy ok. 2 ms zamiast ok. 18 ms.
- Interfejs: przyklejony nagłówek, porywy i kierunek na kartach punktów, zakładka DMI, na telefonie kolejność punkty → mapa → tabela → ustawienia, manifest aplikacji i ikona do dodania na ekran główny.

## Stan morza przy wybrzeżu (19.10.2026)

Mapa pokazuje wysokość fali Hs w 20 stałych punktach: 10 wzdłuż wybrzeża Ventspils (reda, podejścia, odcinek od Užavy do Ovīši) i 10 na podejściu do Nynäshamn / Norvik od strony Landsort. Lista jest w `worker/forecast-points.mjs` (`COAST_POINTS`) i w `dist/app.js`; obie muszą być takie same. Punkty pobiera każdy model fal oprócz Stormglass (limit zapytań). DMI WAM używa najbliższej komórki morskiej tego samego modelu. Przycisk „Fale na trasie” włącza i wyłącza zarówno trasę, jak i punkty przy wybrzeżu.

Odtwarzanie prognozy (▶) i przycisk „Teraz” są w lewym górnym rogu tabeli godzinowej; osobny pasek nad tabelą został usunięty.

## Mapa fal: równe rozmieszczenie (19.10.2026)

Liczby Hs na mapie są przerzedzane do jednego, równego odstępu na ekranie (58–84 px, dopasowanego do rozstawu punktów trasy przy danym przybliżeniu), więc punkty przy brzegu nie tworzą skupisk, a trasa nie wygląda na pustą. Kolor liczby odpowiada wysokości fali (przyciemniona skala legendy). Kolorowe pole fali korzysta ze wszystkich bezpośrednich punktów wybranego modelu: siatki regionalnej, trasy i wybrzeża.

## English interface and opening state (19.10.2026)

The interface is in English (en-GB number and date formats, Swedish time zone). Every time the page opens: wind model ICON-EU, wave model ECMWF WAM, flags at Ventspils Berth and Norvik Berth, wind animation and sea-state numbers on, and a default map view from Stockholm / Nynäshamn to Saaremaa / Ventspils (`DEFAULT_VIEW` in `dist/app.js`). The info and refresh buttons were removed from the brand column; "About the data" is in the page footer.

## ICON-EU freshness fix (23 October 2026)

Manual refresh now bypasses browser localStorage and checks the server; server-side cycle caching continues to prevent premature upstream downloads. Background metadata checks also replace forecast records when a newer model publication is discovered. Availability metadata remains separate from the publication stamp of the displayed records, so an old fallback is never relabeled as current. The app asset version is advanced for installed PWAs and browser sessions.

Live checks on 23 October found ICON-EU publication `2026-10-23T05:53:12Z` and reference cycle `2026-10-23T03:00:00Z` at both `weather.seasync.co` and `pogoda.seasync.co`, matching the Open-Meteo metadata. Client-specific stale state could not be inspected on the user's Windows device.
