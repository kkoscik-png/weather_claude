# Baltic Android 1.0.0

Pierwsza instalacyjna wersja aplikacji Android, przygotowana z `dist/` repozytorium
`kkoscik-png/weather_claude`, commit `8906e45eeaca8ea760bb1e2f5a90ec9d8547f543`.
Pakiet: `co.seasync.baltic`, versionCode: `1`, Android 8.0 lub nowszy.

## Jak działa

Natywna aplikacja Android wyświetla aktualny interfejs w systemowym WebView.
HTML, JavaScript, CSS, Leaflet, ikony i geometria mapy są w APK. Żądania `/api/`
trafiają do istniejącego `https://weather.seasync.co`; prognozy, kafelki mapy i
fonty wymagają internetu. Istniejąca pamięć prognoz działa niezależnie od
przeglądarki telefonu. W trybie offline nie ma nowych danych; widoczny pasek
informuje, że zapisane prognozy mogą być nieaktualne.

Wygląd, modele, wybór portów, mapy, wykresy, motyw i szwedzka strefa czasu
pochodzą bezpośrednio z obecnej strony. Klucze API pozostają na serwerze.
Przycisk Wstecz zamyka najpierw okno informacji lub pełny ekran mapy, potem
cofa nawigację lub zamyka aplikację. Linki do innych stron otwiera przeglądarka.

W APK wyłączono jedynie rejestrację webowego service workera. Zasoby statyczne
są obsługiwane z paczki pod tym samym origin co serwer, dzięki czemu nie trzeba
zmieniać CORS ani API. Kontrola wersji strony widzi wersję dołączoną do APK.
Nie następuje automatyczna podmiana interfejsu na nowsze pliki strony.

## Instalacja

Pobierz i otwórz `Baltic-1.0.0.apk` w telefonie. Jeśli Android poprosi, zezwól
używanej aplikacji na instalowanie z tego źródła. Nie wymaga konta Google Play.
Utrzymuj Android System WebView/Chrome w aktualnej wersji.

## Budowanie

Wymagania: pełny JDK 17, Gradle 8.9, Android SDK Platform 35, Build Tools 35.0.0, Python 3.
Ustaw `ANDROID_HOME` i uruchom z katalogu `android/`:

```sh
gradle assembleDebug
```

Zadanie `prepareWeb` odtwarza zasoby z `../dist/` i nie zmienia strony.
Do podpisania wersji instalacyjnej ustaw:

```sh
export BALTIC_KEYSTORE=/absolute/private/path/baltic-release.p12
export BALTIC_KEY_PASSWORD='<hasło z prywatnej kopii>'
gradle assembleRelease
```

Alias klucza: `baltic`. Bez zmiennych wersja release pozostaje niepodpisana.
Klucz, hasło, APK i wygenerowane zasoby nie są dodawane do GitHuba.

Przekazane APK zbudowano bezpośrednio oficjalnymi narzędziami SDK (javac,
d8, aapt, zipalign, apksigner), bez zależności Gradle. Ten wariant budowania
jest odtwarzalny z głównego katalogu repozytorium:

```sh
export BALTIC_KEY_PASSWORD_FILE=/absolute/private/path/password.txt
python3 android/scripts/build_sdk.py
```

Wymaga również `ANDROID_HOME` i `BALTIC_KEYSTORE`. Plik wynikowy znajduje się
w `android/app/build/sdk/Baltic-1.0.0.apk`. Ta ścieżka ma własne numery wersji
w skrypcie; przy aktualizacji podnieś je równocześnie z `app/build.gradle`.

## Weryfikacja pierwszego APK

`npm test`: wszystkie kontrole i 78 testów przeszły. Kod Androida skompilowano,
sprawdzono manifest, dołączone zasoby, wyrównanie ZIP oraz podpis APK v2/v3.
W środowisku budowania nie było możliwości uruchomienia aplikacji na urządzeniu
ani emulatorze Androida. Przed dalszym wydaniem sprawdź na telefonie: wybór
portu i modelu, mapę, tabelę, motyw, obrót, Wstecz, offline i powrót internetu.

## Następne aktualizacje

Zachowuj identyczny applicationId i klucz podpisujący. Zwiększ versionCode
przed kolejnym wydaniem, zmień versionName, przebuduj zasoby z `dist/`.
Kolejne APK można zainstalować na poprzednim bez usuwania ustawień.
Prywatna kopia klucza została przekazana osobno właścicielowi; nie publikuj jej.
Zmiany backendu Cloudflare działają od razu; zmiany spakowanego interfejsu
wymagają nowego APK. Aplikacja nie została zgłoszona do Google Play.
