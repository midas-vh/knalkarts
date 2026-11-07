# RacePlanet

Een 3D-kartracespel voor in de browser van je telefoon. Je kunt online racen met vrienden
(tot 8 spelers), aangevuld met computer-racers.

## Besturing

| Telefoon | Toetsenbord | Wat het doet |
|---|---|---|
| Schuif links | ← → of A D | Sturen (gas geven gaat vanzelf) |
| DRIFT vasthouden | Spatie | Driften in een bocht. Hoe langer je drift, hoe hoger het niveau: blauwe, dan paarse, dan gouden vonken. Laat je los, dan krijg je een turbo die langer duurt naarmate het niveau hoger is. Stuur je mee de bocht in, dan laad je sneller op. |
| ITEM | E | Item gebruiken |
| REM | ↓ of S | Remmen of achteruit |
| ⏸ | Esc | Pauzemenu: verder racen of terug naar het menu. Bij oefenen staat het spel dan stil. Online rijden de anderen door en remt jouw kart af tot stilstand. |

Items haal je uit de draaiende kubussen (die zijn na 1 seconde terug). Hoe verder je achteraan rijdt, hoe beter je items:
- 🍌 **Bananenschil**: laat je achter je vallen, wie erop rijdt gaat spinnen
- 🟢 **Stuiterbal**: schiet je rechtdoor, stuitert tegen de vangrails
- 🎯 **Zoekraket**: zoekt zelf de kart die direct vóór je rijdt en ontploft als hij raakt
- 💣 **Knalbom**: gooi je vooruit, ontploft na ruim een seconde met een flinke knal en laat iedereen in de buurt spinnen
- 🛡️ **Bubbelschild**: houdt één aanval tegen (10 seconden)
- 🚀 **Turbo** en 🚀×3 **Drie turbo's**: even supersnel
- ☄️ **Komeet**: je wordt een vuurbal die 6 seconden zelf over de baan vliegt en karts omverknalt

Oranje pijlen op de weg geven je ook een boost.

## De Sterrenbaan

Je racet over een regenboogweg hoog boven de wolken, met heuvels, een spiraal en schuine bochten.
Alleen op een paar plekken staan vangrails, dus je kunt van de baan af rijden. Dan komt **Takeltje**,
het propellerrobotje, je met zijn haak terugzetten. Dat kost je wel een paar seconden.

Er zitten twee **schansen** in de baan. Kom er met volle snelheid aan, of beter nog: rij over de boostplaat ervoor.
Ben je te langzaam (bijvoorbeeld net na een olievlek), dan val je in het gat.

## Snelheidsklassen

Kies in het menu **100cc**, **150cc** (standaard) of **200cc**. Die keuze geldt als je oefent of als je host bent;
de host kan hem in de lobby nog veranderen. Bij een online race rijdt iedereen in de klasse van de host.

## Modellen (Blender)

In de map `models` staan de Blender-bestanden en de exports die het spel laadt:

| Bestand | Wat |
|---|---|
| `knalkart.blend` → `knalkart.glb` | de kart |
| `sterrenbaan.blend` → `sterrenbaan.glb` + `sterrenbaan.json` | de baan, de omgeving en de baandata (middenlijn, breedte, vangrails, gaten) |
| `sterrenbaan.blend` → `takeltje.glb` | Takeltje |
| `sterrenbaan_build.py` | het script dat de baan in Blender bouwt; pas de controlepunten bovenin aan om de route te veranderen |

De oude baan met gras en bomen staat nog in `track_oud.js`.

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
