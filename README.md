# Groww Stocks & Mutual Funds Scraper - Prices, NAV & Returns

Scrape Groww stocks and mutual funds data for Indian market research, portfolio discovery, investment comparison, and financial data workflows. Export results to JSON, CSV, Excel, or HTML, or pull them via the Apify API. The actor uses public Groww web data and does not require a Groww login or API key.

## What It Extracts

- Stock and mutual fund names, Groww search IDs, symbols, ISINs, logos, and Groww URLs.
- Stock live or delayed LTP, day change, volume, 52-week range, market cap, P/E, P/B, ROE, EPS, dividend yield, industry, CEO, headquarters, website, and summary when available.
- Mutual fund NAV, NAV date, AUM, expense ratio, Groww rating, risk, 1D/1W/1M/3M/6M/1Y/3Y/5Y/10Y returns, fund house, manager, category, plan type, scheme type, launch date, and minimum investment.
- Clean overview metrics for table browsing plus nested `stock` and `mutualFund` detail objects for API users.

## Use Cases

- Build Indian stock and mutual fund comparison datasets.
- Track Groww-listed funds by category, AUM, NAV, expense ratio, and returns.
- Research listed companies by fundamentals and market-cap segment.
- Feed finance dashboards, sheets, or investment research tools.
- Monitor search-visible Groww assets for market intelligence.

## Pricing

| Event | When charged | Price | 1,000 records | 10,000 records |
| --- | --- | --- | --- | --- |
| `asset-scraped` | Each clean Groww stock or mutual fund record saved | `$0.002` | `$2.00` | `$20.00` |

Charges are made only after a real record is saved to the Apify Dataset.

## Input

| Field | Type | Description |
| --- | --- | --- |
| `source` | `both`, `stocks`, `mutual_funds` | Choose which Groww asset type to scrape. |
| `keywords` | string array | Groww search keywords, stock names, tickers, or fund names. |
| `maxResults` | integer | Maximum unique records to save, up to 500. |
| `includeStockLivePrice` | boolean | Parse Groww stock pages for embedded live/delayed price data. |
| `includeNfoFunds` | boolean | Include NFO fund results in addition to regular schemes. |

## How to Scrape Groww Stocks and Mutual Funds (Step by Step)

1. Choose `both`, `stocks`, or `mutual_funds`.
2. Enter stock names, tickers, fund names, or search keywords.
3. Set the maximum number of results.
4. Run the actor.
5. Download the dataset or access it through the Apify API.

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

The actor searches Groww's public web search endpoint, filters stock and mutual fund results, fetches Groww detail JSON for each asset, and optionally parses embedded stock page data for live or delayed prices. Each unique Groww asset is deduplicated by asset type and search ID.

## Known Limits

- Stock current prices come from Groww page data and may be live or delayed depending on Groww's own display.
- Some older or renamed mutual fund search IDs may return empty details; those records are skipped.
- Search results depend on Groww's ranking for the keywords you provide.

## Disclaimer

This Actor provides public market data for research and informational use only. It is not financial advice.

Each unique asset is saved and charged atomically. The Actor stops further detail requests as soon as the user's spending limit is reached.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
