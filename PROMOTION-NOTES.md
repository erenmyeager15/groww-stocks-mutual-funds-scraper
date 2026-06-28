# Groww Promotion Notes

## YouTube Tutorial Title Options

- How to Scrape Groww Stocks and Mutual Funds Data with Apify
- Groww Stocks and Mutual Funds Scraper: Export NAV, Returns, AUM and Stock Prices
- Build an Indian Stocks and Mutual Funds Dataset from Groww in 2 Minutes

## 60-Second Tutorial Script

1. Show the actor page: "This is a Groww scraper for Indian stocks and mutual funds."
2. Open the input form and select `both`.
3. Add two example keywords: `reliance` and `parag parikh flexi cap`.
4. Set `maxResults` to `10`.
5. Run the actor.
6. Show the dataset table with stock and mutual fund rows.
7. Open one record and point out `priceOrNav`, `marketCapOrAum`, `peOrRating`, `stock`, and `mutualFund`.
8. Export the dataset as CSV or connect via the Apify API.
9. Closing line: "Use this when you need clean Groww research data without a login or manual copy-paste."

## Short Post Copy

I published a Groww Stocks & Mutual Funds Scraper on Apify.

It can search Groww by stock names, tickers, fund names, or categories and export clean records with prices, NAV, AUM, returns, ratings, market cap, P/E, and nested stock or mutual fund details.

Good for Indian market research, dashboards, investment comparison tables, and spreadsheet workflows.

Example input:

```json
{
  "source": "both",
  "keywords": ["reliance", "parag parikh flexi cap"],
  "maxResults": 10
}
```

## SEO Keywords

- Groww scraper
- Groww stocks scraper
- Groww mutual funds scraper
- Indian stock market data scraper
- mutual fund NAV scraper
- Groww API alternative
- Apify Groww scraper
