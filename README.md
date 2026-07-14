# Groww Stocks & Mutual Funds Scraper - Indian Stock Prices, Mutual Fund NAV & Returns

Scrape public Groww stock and mutual fund data for Indian market research, portfolio discovery, investment comparison, and finance dashboards. Enter stock names, tickers, fund names, or broad search keywords, then export clean results to JSON, CSV, Excel, HTML, Google Sheets, or your own app through the Apify API.

The actor does not require a Groww login or API key. It is designed for quick research runs as well as repeatable data workflows.

## What It Extracts

- Stock and mutual fund names, Groww search IDs, symbols, ISINs, logos, and Groww URLs.
- Stock live or delayed LTP, day change, volume, 52-week range, market cap, P/E, P/B, ROE, EPS, dividend yield, industry, headquarters, website, and summary when available.
- Mutual fund NAV, NAV date, AUM, expense ratio, Groww rating, risk, 1D/1W/1M/3M/6M/1Y/3Y/5Y/10Y returns, fund house, manager, category, plan type, scheme type, launch date, and minimum investment.
- Clean overview metrics for table browsing plus nested `stock` and `mutualFund` detail objects for API users.

## Use Cases

- Build Indian stock and mutual fund comparison datasets.
- Track Groww-listed funds by category, AUM, NAV, expense ratio, and returns.
- Research listed companies by fundamentals and market-cap segment.
- Feed finance dashboards, sheets, or investment research tools.
- Monitor search-visible Groww assets for market intelligence.

## Quick Start

Use this input for a small first run:

```json
{
  "source": "stocks",
  "keywords": ["reliance"],
  "maxResults": 1,
  "includeStockLivePrice": true,
  "includeNfoFunds": false
}
```

For stocks only:

```json
{
  "source": "stocks",
  "keywords": ["reliance", "tcs", "hdfc bank"],
  "maxResults": 25,
  "includeStockLivePrice": true
}
```

For mutual funds only:

```json
{
  "source": "mutual_funds",
  "keywords": ["parag parikh flexi cap", "nifty index fund", "small cap fund"],
  "maxResults": 25,
  "includeNfoFunds": false
}
```

## Pricing

| Event | When charged | Active price | 1,000 records | 10,000 records |
| --- | --- | --- | --- | --- |
| `apify-actor-start` | Small startup event when a run starts | `$0.00005` per GB, minimum one event | - | - |
| `asset-scraped` | Each validated Groww stock or mutual fund record saved | `$0.002` | `$2.00` | `$20.00` |

The startup event covers basic run initialization. The per-asset event is charged atomically only when a validated record is saved to the Apify Dataset. These values mirror the Actor's active Store pricing; this reliability update does not raise them.

## Input Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `both`, `stocks`, `mutual_funds` | `stocks` | Choose whether to collect stocks, mutual funds, or both. |
| `keywords` | string array | `["reliance"]` | Up to 25 Groww search keywords, stock names, tickers, fund names, or fund categories. |
| `maxResults` | integer | `1` | Maximum unique records to save across all keywords, up to 500. |
| `includeStockLivePrice` | boolean | `true` | Fetch Groww stock pages for embedded live or delayed stock price data when available. |
| `includeNfoFunds` | boolean | `false` | Include NFO fund results in addition to regular mutual fund schemes. |

## How to Scrape Groww Stocks and Mutual Funds (Step by Step)

1. Choose `both`, `stocks`, or `mutual_funds`.
2. Enter stock names, tickers, fund names, or search keywords.
3. Set the maximum number of results.
4. Run the actor.
5. Download the dataset or access it through the Apify API.

## Output Overview

Each dataset item represents one unique Groww asset. The actor saves stock and mutual fund records in one consistent shape so you can compare them in a table or branch by `assetType` in code.

| Field group | Important fields |
| --- | --- |
| Identity | `assetType`, `assetTypeLabel`, `name`, `shortName`, `searchId`, `symbol`, `isin`, `growwUrl` |
| Table metrics | `priceOrNav`, `changeOrReturn`, `marketCapOrAum`, `peOrRating`, `primaryMetricLabel`, `primaryMetricValue` |
| Stock details | `stock.currentPrice`, `stock.marketCapCr`, `stock.peRatio`, `stock.pbRatio`, `stock.roePercent`, `stock.yearHighPrice`, `stock.yearLowPrice`, `stock.industryName` |
| Mutual fund details | `mutualFund.nav`, `mutualFund.aumCr`, `mutualFund.expenseRatioPercent`, `mutualFund.growwRating`, `mutualFund.risk`, `mutualFund.return1y`, `mutualFund.return3y`, `mutualFund.return5y` |
| Run context | `query`, `source`, `currency`, `scrapedAt` |

## Sample Output

```json
{
  "source": "groww",
  "query": "reliance",
  "assetType": "stock",
  "assetTypeLabel": "Stock",
  "name": "Reliance Industries",
  "shortName": "Reliance Industries",
  "searchId": "reliance-industries-ltd",
  "symbol": "RELIANCE",
  "isin": "INE002A01018",
  "category": "Oil",
  "subCategory": "Large Cap",
  "logoUrl": "https://assets-netstorage.groww.in/stock-assets/logos2/RELIANCE.webp",
  "growwUrl": "https://groww.in/stocks/reliance-industries-ltd",
  "currency": "INR",
  "priceOrNav": 1281.2,
  "changeOrReturn": 1.44,
  "marketCapOrAum": 1708617.87,
  "peOrRating": 17.84,
  "primaryMetricLabel": "LTP",
  "primaryMetricValue": 1281.2,
  "secondaryMetricLabel": "Day change %",
  "secondaryMetricValue": 1.44,
  "tertiaryMetricLabel": "Market cap (Cr)",
  "tertiaryMetricValue": 1708617.87,
  "ratingMetricLabel": "P/E",
  "ratingMetricValue": 17.84,
  "stock": {
    "nseScriptCode": "RELIANCE",
    "bseScriptCode": "500325",
    "currentPrice": 1281.2,
    "marketCapCr": 1708617.87,
    "peRatio": 17.84
  },
  "mutualFund": null,
  "scrapedAt": "2026-06-12T08:30:00.000Z"
}
```

```json
{
  "source": "groww",
  "query": "parag parikh flexi cap",
  "assetType": "mutual_fund",
  "assetTypeLabel": "Mutual fund",
  "name": "Parag Parikh Flexi Cap Fund Direct Growth",
  "searchId": "parag-parikh-long-term-value-fund-direct-growth",
  "symbol": "122639",
  "category": "Equity",
  "subCategory": "Flexi Cap",
  "currency": "INR",
  "priceOrNav": 88.484,
  "changeOrReturn": -3.62,
  "marketCapOrAum": 141446.73,
  "peOrRating": 5,
  "primaryMetricLabel": "NAV",
  "primaryMetricValue": 88.484,
  "secondaryMetricLabel": "1Y return %",
  "secondaryMetricValue": -3.62,
  "tertiaryMetricLabel": "AUM (Cr)",
  "tertiaryMetricValue": 141446.73,
  "ratingMetricLabel": "Groww rating",
  "ratingMetricValue": 5,
  "stock": null,
  "mutualFund": {
    "schemeCode": "122639",
    "fundHouse": "PPFAS Mutual Fund",
    "nav": 88.484,
    "expenseRatioPercent": 0.74,
    "risk": "Very High",
    "return3y": 15.11,
    "return5y": 14.75
  },
  "scrapedAt": "2026-06-12T08:30:00.000Z"
}
```

## How It Works

The actor searches Groww's public web search endpoint, validates the response shape, filters stock and mutual fund results, fetches Groww detail JSON with bounded retries and request deadlines, and optionally parses embedded stock page data for live or delayed prices. Live-price records are matched to the exact NSE or BSE code. Each unique Groww asset is deduplicated by asset type and search ID before detail work.

Records are saved with the `asset-scraped` event only after a clean item is pushed to the Apify Dataset. If the user's spending limit is reached, the actor stops further detail requests. The Actor also writes `RUN_STATUS` to the default key-value store with per-keyword outcomes and diagnostic counters. A valid search with no matching assets succeeds with an empty dataset; blocked, malformed, or all-detail-failed runs fail visibly instead of pretending to be empty.

## Known Limits

- Stock current prices come from Groww page data and may be live or delayed depending on Groww's own display.
- Some older or renamed mutual fund search IDs may return empty details; those records are skipped.
- Search results depend on Groww's ranking for the keywords you provide.
- The Actor has an internal 15-minute safety stop in addition to the platform timeout, so broad runs can stop cleanly with partial results.
- This actor is for public research data. It does not place trades, manage portfolios, or provide investment recommendations.

## Tips For Better Results

- Use exact stock names or ticker-like keywords when you want specific listed companies.
- Use category-style terms such as `small cap fund`, `index fund`, or `flexi cap` when discovering mutual funds.
- Keep `maxResults` small for first runs, then increase it after checking the output.
- Use `source: "stocks"` or `source: "mutual_funds"` when you want cleaner category-specific exports.

## Disclaimer

This Actor provides public market data for research and informational use only. It is not financial advice.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
