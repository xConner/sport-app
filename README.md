# Sport-App

Persönliche, offline-fähige Sport-App (PWA). Erstes Feature: Challenge-Tracker
(Klimmzüge, Liegestütze, Laufen in 400-m-Runden) mit Tagesübersicht, Restmenge und Tagessoll.

- Läuft ohne Build-Schritt: `index.html`, `app.js`, `style.css`, `sw.js`
- Daten liegen lokal im Browser (localStorage); Sync mit Firebase folgt
- Lokal testen: `python3 -m http.server` im Ordner, dann http://localhost:8000
- Bei Änderungen die Version in `app.js` (`VERSION`) und `sw.js` (`CACHE`) hochzählen, damit Handys das Update laden
