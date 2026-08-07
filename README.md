# Lake Michigan Auction Watch

A static React dashboard for screening Michigan tax-auction catalogs, promoting promising lots into research, reconciling source changes, and enforcing a diligence gate before a property becomes Bid Ready.

## Privacy model

The repository and GitHub Pages bundle contain public catalog data only. Strategy settings, research notes, diligence checks, acknowledgements, and bid caps are stored in the browser. Use **Export backup** to create a private JSON backup and **Import backup** to restore it on another browser or computer. Never commit an exported backup to the repository.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

The development server normally opens at `http://localhost:5173`.

### Moving from an earlier local MVP

Run this version once at the same local origin you used previously. It migrates the old browser research records into the new private schema. Export a backup from the updated local app, then import that file after opening the GitHub Pages site; browser storage does not move automatically between local and GitHub URLs.

## Validate

```bash
npm test
npm run lint
```

The production build is a conventional static site in `dist/`. There is no server, worker, database, API key, or runtime secret.

## Refresh public catalogs

```bash
npm run refresh
```

The refresh process:

- discovers the current catalog ID for each allowed shoreline county;
- downloads and validates every CSV and lot detail link;
- uses the Tax-Sale.info detail-page ID as the stable property identity;
- detects added, removed, and field-level changes;
- suppresses immaterial cents-only bid changes;
- keeps a capped 30-refresh public history; and
- fails without replacing the last good snapshot if any source is invalid.

County scope and public bid-change materiality live in `data/catalogs.json`.

## Publish with GitHub Pages

1. Create a GitHub repository and push this source to its `main` branch.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. Run **Refresh and deploy Auction Watch** from the Actions tab once, or push a commit.

The included workflow builds and deploys on every push. It also refreshes the public catalogs daily at 8:10 AM America/Chicago and can be run manually. Scheduled/manual refreshes commit changed public snapshots back to the repository with a skip-CI marker, then deploy the same validated data.

## Decision limits

Scores use public catalog text, county-level drive estimates, minimum bids, and SEV as a rough value proxy. They are research leads—not valuations or bid recommendations. Independently verify title, access, zoning, utilities, taxes, assessments, condition, occupancy, possession, and auction terms before bidding.
