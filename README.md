# BOUNCE — AFL Same Game Multi Scanner

Deep-scan upcoming AFL fixtures and build Same Game Multis from:

- Player form (season averages + last 5)
- Home / away splits
- Latest ins / outs
- Weather at the venue
- Ladder ranking & mismatch
- Venue / home advantage
- **Live Sportsbet prices** (optional, via The Odds API)

## How it works

1. Choose **by legs** (2–6) or **by target odds** (e.g. $10, $25)
2. Pick fixtures (or scan the next slate)
3. Bounce enumerates same-game combinations, applies a correlation haircut, and ranks by confidence + edge
4. When Sportsbet is linked, matching legs show live SB prices and the multi uses those prices

## Sportsbet prices

Sportsbet does not offer a public odds API. Bounce pulls Sportsbet AFL markets through [The Odds API](https://the-odds-api.com/) (`bookmakers=sportsbet`).

1. Get a free key at https://the-odds-api.com/
2. Copy `.env.example` → `.env.local`
3. Set `ODDS_API_KEY=your_key`
4. Restart `npm run dev`

Without a key, Bounce still scans using model odds. With a key, head-to-head, totals, anytime goals, goals overs, disposals and tackles are matched onto legs where possible.

**Note:** Sportsbet Same Game Multi prices are not published as a single combo feed — Bounce multiplies matched leg prices. The app’s SGM total is an estimate; Sportsbet may adjust for correlation inside their SGM builder.

## Stack

- Next.js App Router
- Live fixtures & ladder via [Squiggle API](https://api.squiggle.com.au/)
- Sportsbet odds via The Odds API
- Modelled player markets + weather/list context in `/src/lib`

## Develop

```bash
npm install
cp .env.example .env.local   # optional: add ODDS_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API

- `GET /api/fixtures` — enriched upcoming games
- `GET /api/sportsbet` — Sportsbet link status (`?probe=1` to test key)
- `POST /api/scan` — body `{ mode: "legs"|"odds", legCount?, targetOdds?, gameIds? }`

Research tool only — gamble responsibly.
