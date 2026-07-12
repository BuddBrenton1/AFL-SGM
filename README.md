# BOUNCE — AFL Same Game Multi Scanner

Deep-scan upcoming AFL fixtures and build Same Game Multis from:

- Player form (season averages + last 5)
- Home / away splits
- Latest ins / outs
- Weather at the venue
- Ladder ranking & mismatch
- Venue / home advantage
- Blowout / territory projections

## How it works

1. Choose **by legs** (2–6) or **by target odds** (e.g. $10, $25)
2. Pick fixtures (or scan the next slate)
3. Bounce enumerates same-game combinations, applies a correlation haircut, and ranks by confidence + edge

## Stack

- Next.js App Router
- Live fixtures & ladder via [Squiggle API](https://api.squiggle.com.au/)
- Modelled player markets + weather/list context in `/src/lib`

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API

- `GET /api/fixtures` — enriched upcoming games
- `POST /api/scan` — body `{ mode: "legs"|"odds", legCount?, targetOdds?, gameIds? }`

Odds shown are research estimates, not bookmaker prices.
