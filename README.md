# Jeden z Milionów

**[Zagraj w przeglądarce](https://majeranximi.github.io/jeden-z-milionow/)**

Wyścig 3D w przeglądarce (three.js): płyniesz jako plemnik przez szyjkę macicy, macicę i jajowód do jaja, a konkurują z tobą boty.

## Uruchomienie

```bash
npm start
```

Potem otwórz http://localhost:8123. Modele są wbudowane w `dist/game.js`, więc do gry wystarczą `dist/index.html` i `dist/game.js`.

## Praca nad kodem

- `npm run build` składa `dist/` z `src/` i `public/models/` (modele trafiają do bundla).
- `npm run models` przetwarza pobrane modele z `assets/raw/` na `public/models/`.
- `npm run sim` rozgrywa wyścigi bez przeglądarki i pokazuje balans poziomów trudności.
- `npm run deploy` buduje grę i publikuje ją na GitHub Pages.
- Dopisanie `?autopilot=1` do adresu oddaje sterowanie botowi (rekordy się wtedy nie zapisują).

## Modele

- Plemnik i warstwy komórki jajowej: Julio Hidalgo, [Sperm cell](https://tactiles.eu/tactiles/sperm-cell/) i [Human egg cell](https://tactiles.eu/tactiles/human-egg-cell/), Tactiles.eu, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Zmiany: redukcja siatki, wyprostowany i pogrubiony ogonek, półkule złożone w kule. Przetworzone modele (`sperm.glb`, `egg.glb`) są udostępniane na tej samej licencji.
- Biała krwinka i wirus: Poly by Google, [White blood cell](https://poly.pizza/m/aoZ4DjiO35h) i [Virus](https://poly.pizza/m/d_QDWsT0kBG), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- Czerwona krwinka: William Smith, [Healthy Red Blood Cell](https://poly.pizza/m/0QFzCaYkqy_), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

Silnik: [three.js](https://threejs.org/) (MIT). Tunel, cząsteczki i dźwięk są generowane w kodzie gry.
