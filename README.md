# Knalkarts

Een 3D-kartracespel voor in de browser van je telefoon. Je kunt online racen met vrienden
(tot 8 spelers), aangevuld met computer-racers.

## Besturing

| Telefoon | Toetsenbord | Wat het doet |
|---|---|---|
| Schuif links | ← → of A D | Sturen (gas geven gaat vanzelf) |
| DRIFT vasthouden | Spatie | Driften in een bocht. Laat je los, dan krijg je een turbo. Blauwe vonken geven een kleine turbo, oranje vonken een grote. |
| ITEM | E | Item gebruiken |
| REM | ↓ of S | Remmen of achteruit |

Items haal je uit de draaiende kubussen:
- 🚀 **Turbo**: even supersnel
- 🛢️ **Olievlek**: laat je achter je vallen, wie erin rijdt gaat spinnen
- 💥 **Knalbal**: schiet je vooruit en stuitert tegen de muren

Oranje pijlen op de weg geven je ook een boost.

## Hoe het online spelen werkt

De speler die op **Nieuwe race maken** drukt, wordt de *host* en krijgt een code van 4 letters.
Vrienden vullen die code in (of openen de deellink) en verbinden dan rechtstreeks met de host
(peer-to-peer, via WebRTC/PeerJS). Je hebt dus geen eigen server nodig. Alleen de bestanden
van het spel moeten ergens online staan.

Let op: de host moet de app open houden met het scherm aan. Wifi werkt het best.

## Spelen

**Thuis op dezelfde wifi:** dubbelklik `start-server.bat` op de pc en open op je telefoon het adres
dat het venster laat zien (bijvoorbeeld `http://192.168.1.23:8093`).

**Met vrienden die ergens anders zijn:** zet de map `knalkarts` op een gratis host, zoals
GitHub Pages of Netlify. Daarna stuur je je vrienden gewoon de link.
