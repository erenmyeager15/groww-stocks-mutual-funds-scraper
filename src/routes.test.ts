import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractLivePriceFromNextData,
    parseDisplayNumber,
    parseFundamentalMetrics,
    parseSearchResponse,
    scrapeGroww,
    validateRecord,
} from './routes.js';
import type { GrowwAssetRecord, SearchOptions } from './types.js';

const fixedTimestamp = '2026-07-15T10:00:00.000Z';

const stockSearchItem = {
    entity_type: 'Stocks',
    search_id: 'reliance-industries-ltd',
    title: 'Reliance Industries',
    nse_scrip_code: 'RELIANCE',
    bse_scrip_code: '500325',
    isin: 'INE002A01018',
};

const fundSearchItem = {
    entity_type: 'Scheme',
    search_id: 'parag-parikh-flexi-cap-fund-direct-growth',
    title: 'Parag Parikh Flexi Cap Fund Direct Growth',
    scheme_code: '122639',
};

const stockDetail = {
    header: {
        type: 'STOCK',
        displayName: 'Reliance Industries',
        shortName: 'Reliance',
        nseScriptCode: 'RELIANCE',
        bseScriptCode: '500325',
        isin: 'INE002A01018',
        industryName: 'Oil & Gas',
    },
    details: {
        fullName: 'Reliance Industries Limited',
        headquarters: 'Mumbai',
        foundedYear: 1973,
        websiteUrl: 'https://www.ril.com',
        businessSummary: 'Public company profile.',
    },
    fundamentals: [
        { name: 'Market Cap', value: '₹17,47,050Cr' },
        { name: 'ROE', value: '8.94%' },
        { name: 'P/E', value: '18.24' },
        { name: 'EPS(TTM)', value: '70.76' },
        { name: 'P/B', value: '1.93' },
        { name: 'Dividend Yield', value: '0.46%' },
        { name: 'Book Value', value: '668.04' },
    ],
    priceData: { nse: { yearHighPrice: 1608.8, yearLowPrice: 1114.85 } },
};

const fundDetail = {
    search_id: 'parag-parikh-flexi-cap-fund-direct-growth',
    scheme_code: '122639',
    scheme_name: 'Parag Parikh Flexi Cap Fund Direct Growth',
    fund_name: 'Parag Parikh Flexi Cap Fund',
    fund_house: 'PPFAS Mutual Fund',
    fund_manager: 'Fund Manager',
    nav: 91.3166,
    nav_date: '2026-07-14',
    aum: 143388.43,
    expense_ratio: '0.7',
    groww_rating: 5,
    category: 'Equity',
    sub_category: 'Flexi Cap',
    available_for_investment: true,
    return_stats: [{ risk: 'Very High', risk_rating: 5, return1y: 11.25, return3y: 18.4 }],
};

function stockOptions(overrides: Partial<SearchOptions> = {}): SearchOptions {
    return {
        source: 'stocks',
        keywords: ['reliance'],
        maxResults: 1,
        includeStockLivePrice: true,
        includeNfoFunds: false,
        ...overrides,
    };
}

function responseJson(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
    return (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

function liveHtml(livePriceData: Record<string, unknown>): string {
    return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { livePriceData } },
    })}</script></html>`;
}

function dependencies(fetcher: typeof fetch, saved: GrowwAssetRecord[] = []) {
    return {
        fetch: fetcher,
        pushData: async (record: GrowwAssetRecord, eventName: string) => {
            assert.equal(eventName, 'asset-scraped');
            saved.push(record);
            return { chargedCount: 1, eventChargeLimitReached: false };
        },
        sleep: async () => undefined,
        now: () => 1_000,
        isoNow: () => fixedTimestamp,
        randomDelay: () => 0,
        requestTimeoutMs: 100,
        maxFetchAttempts: 3,
        runtimeLimitMs: 60_000,
    };
}

function successfulStockFetch(livePriceData: Record<string, unknown> = {
    TCS: { ltp: 3900 },
    RELIANCE: {
        ltp: 1292.5,
        open: 1280,
        high: 1300,
        low: 1275,
        close: 1281,
        dayChange: 11.5,
        dayChangePerc: 0.9,
    },
}): typeof fetch {
    return mockFetch((url) => {
        if (url.includes('/search/v3/')) return responseJson({ data: { content: [stockSearchItem] } });
        if (url.includes('/stocks_data/')) return responseJson(stockDetail);
        if (url.includes('/stocks/')) return new Response(liveHtml(livePriceData));
        return new Response('not found', { status: 404 });
    });
}

test('parseDisplayNumber handles Groww display values without turning blanks into zero', () => {
    assert.equal(parseDisplayNumber('₹17,47,050Cr'), 1_747_050);
    assert.equal(parseDisplayNumber('8.94%'), 8.94);
    assert.equal(parseDisplayNumber(''), null);
    assert.equal(parseDisplayNumber('   '), null);
    assert.equal(parseDisplayNumber('not available'), null);
});

test('parseFundamentalMetrics supports the current fundamentals array', () => {
    const result = parseFundamentalMetrics(stockDetail.fundamentals);
    assert.deepEqual(result, {
        marketCapCr: 1_747_050,
        peRatio: 18.24,
        pbRatio: 1.93,
        dividendYieldPercent: 0.46,
        epsTtm: 70.76,
        roePercent: 8.94,
        bookValue: 668.04,
        cappedType: null,
    });
});

test('parseFundamentalMetrics retains legacy stats as a fallback', () => {
    const result = parseFundamentalMetrics([], { marketCap: 100, peRatio: 10, cappedType: 'Large Cap' });
    assert.equal(result.marketCapCr, 100);
    assert.equal(result.peRatio, 10);
    assert.equal(result.cappedType, 'Large Cap');
});

test('parseSearchResponse accepts an honest empty search and rejects malformed shapes', () => {
    assert.deepEqual(parseSearchResponse({ data: { content: [] } }), []);
    assert.throws(() => parseSearchResponse({ data: {} }), /data\.content/);
    assert.throws(() => parseSearchResponse('<html>blocked</html>'), /data\.content/);
    assert.throws(() => parseSearchResponse({ data: { content: [null] } }), /non-object item/);
});

test('extractLivePriceFromNextData returns only an exact NSE or BSE match', () => {
    const nextData = { props: { pageProps: { livePriceData: { TCS: { ltp: 3_900 }, RELIANCE: { ltp: 1_292.5 } } } } };
    assert.equal(extractLivePriceFromNextData(nextData, 'reliance', '500325')?.ltp, 1_292.5);
    assert.equal(extractLivePriceFromNextData(nextData, 'INFY', '500209'), null);
});

test('scrapeGroww maps a stock with current fundamentals and an exact atomic charge', async () => {
    const saved: GrowwAssetRecord[] = [];
    const result = await scrapeGroww(stockOptions(), dependencies(successfulStockFetch(), saved));

    assert.equal(result.runStatus.status, 'results');
    assert.equal(result.records, 1);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.currency, 'INR');
    assert.equal(saved[0]?.stock?.currentPrice, 1_292.5);
    assert.equal(saved[0]?.stock?.marketCapCr, 1_747_050);
    assert.equal(saved[0]?.stock?.peRatio, 18.24);
    assert.equal(saved[0]?.stock?.roePercent, 8.94);
});

test('scrapeGroww does not assign an unrelated first live-price object', async () => {
    const saved: GrowwAssetRecord[] = [];
    const result = await scrapeGroww(
        stockOptions(),
        dependencies(successfulStockFetch({ TCS: { ltp: 3_900 } }), saved),
    );
    assert.equal(saved[0]?.stock?.currentPrice, null);
    assert.equal(result.runStatus.livePriceMisses, 1);
});

test('scrapeGroww maps a mutual fund response', async () => {
    const saved: GrowwAssetRecord[] = [];
    const fetcher = mockFetch((url) => {
        if (url.includes('/search/v3/')) return responseJson({ data: { content: [fundSearchItem] } });
        if (url.includes('/data/mf/')) return responseJson(fundDetail);
        return new Response('not found', { status: 404 });
    });
    const result = await scrapeGroww(
        stockOptions({ source: 'mutual_funds', keywords: ['parag parikh'], includeStockLivePrice: false }),
        dependencies(fetcher, saved),
    );

    assert.equal(result.runStatus.status, 'results');
    assert.equal(saved[0]?.assetType, 'mutual_fund');
    assert.equal(saved[0]?.mutualFund?.nav, 91.3166);
    assert.equal(saved[0]?.mutualFund?.expenseRatioPercent, 0.7);
    assert.equal(saved[0]?.mutualFund?.return1y, 11.25);
});

test('scrapeGroww treats a valid no-match search as a successful empty run', async () => {
    const fetcher = mockFetch(() => responseJson({ data: { content: [] } }));
    const result = await scrapeGroww(stockOptions(), dependencies(fetcher));
    assert.equal(result.runStatus.status, 'empty');
    assert.equal(result.failureMessage, null);
    assert.equal(result.records, 0);
});

test('scrapeGroww fails when the search response shape is malformed', async () => {
    const fetcher = mockFetch(() => responseJson({ data: {} }));
    const result = await scrapeGroww(stockOptions(), dependencies(fetcher));
    assert.equal(result.runStatus.status, 'failed');
    assert.match(result.failureMessage ?? '', /search requests failed/);
});

test('scrapeGroww fails instead of reporting empty when an eligible item has no ID', async () => {
    const fetcher = mockFetch(() => responseJson({ data: { content: [{ entity_type: 'Stocks', title: 'Broken stock' }] } }));
    const result = await scrapeGroww(stockOptions(), dependencies(fetcher));
    assert.equal(result.runStatus.status, 'failed');
    assert.equal(result.runStatus.invalidRecords, 1);
    assert.match(result.failureMessage ?? '', /all detail records failed/);
});

test('scrapeGroww does not retry a non-retryable 404', async () => {
    let calls = 0;
    const fetcher = mockFetch(() => {
        calls++;
        return new Response('missing', { status: 404 });
    });
    const result = await scrapeGroww(stockOptions(), dependencies(fetcher));
    assert.equal(calls, 1);
    assert.equal(result.runStatus.status, 'failed');
});

test('scrapeGroww retries a 500 and recovers', async () => {
    let calls = 0;
    const fetcher = mockFetch(() => {
        calls++;
        return calls < 3 ? new Response('temporary', { status: 500 }) : responseJson({ data: { content: [] } });
    });
    const result = await scrapeGroww(stockOptions(), dependencies(fetcher));
    assert.equal(calls, 3);
    assert.equal(result.runStatus.status, 'empty');
});

test('scrapeGroww fails when all eligible detail requests fail', async () => {
    const fetcher = mockFetch((url) => {
        if (url.includes('/search/v3/')) return responseJson({ data: { content: [stockSearchItem] } });
        return new Response('temporary', { status: 500 });
    });
    const result = await scrapeGroww(stockOptions(), dependencies(fetcher));
    assert.equal(result.runStatus.status, 'failed');
    assert.equal(result.runStatus.detailFailures, 1);
    assert.match(result.failureMessage ?? '', /all detail records failed/);
});

test('scrapeGroww deduplicates the same asset across keywords before detail work', async () => {
    let detailCalls = 0;
    const saved: GrowwAssetRecord[] = [];
    const fetcher = mockFetch((url) => {
        if (url.includes('/search/v3/')) return responseJson({ data: { content: [stockSearchItem] } });
        if (url.includes('/stocks_data/')) {
            detailCalls++;
            return responseJson(stockDetail);
        }
        if (url.includes('/stocks/')) return new Response(liveHtml({ RELIANCE: { ltp: 1_292.5 } }));
        return new Response('not found', { status: 404 });
    });
    const result = await scrapeGroww(
        stockOptions({ keywords: ['reliance', 'ril'], maxResults: 2 }),
        dependencies(fetcher, saved),
    );
    assert.equal(saved.length, 1);
    assert.equal(detailCalls, 1);
    assert.equal(result.runStatus.duplicateCandidates, 1);
});

test('scrapeGroww stops cleanly at the event spending limit', async () => {
    const deps = dependencies(successfulStockFetch());
    deps.pushData = async () => ({ chargedCount: 0, eventChargeLimitReached: true });
    const result = await scrapeGroww(stockOptions(), deps);
    assert.equal(result.runStatus.status, 'spending_limit');
    assert.equal(result.spendingLimitReached, true);
    assert.equal(result.failureMessage, null);
});

test('scrapeGroww fails honestly if the runtime limit is reached before any search', async () => {
    const deps = dependencies(mockFetch(() => responseJson({ data: { content: [] } })));
    deps.runtimeLimitMs = 0;
    const result = await scrapeGroww(stockOptions(), deps);
    assert.equal(result.runStatus.status, 'failed');
    assert.equal(result.runtimeLimitReached, true);
    assert.match(result.failureMessage ?? '', /safety limit/);
});

test('scrapeGroww rejects a mutual fund with an invalid negative NAV', async () => {
    const fetcher = mockFetch((url) => {
        if (url.includes('/search/v3/')) return responseJson({ data: { content: [fundSearchItem] } });
        return responseJson({ ...fundDetail, nav: -1 });
    });
    const result = await scrapeGroww(
        stockOptions({ source: 'mutual_funds', includeStockLivePrice: false }),
        dependencies(fetcher),
    );
    assert.equal(result.runStatus.status, 'failed');
    assert.equal(result.runStatus.invalidRecords, 1);
});

test('validateRecord rejects a non-Groww URL and non-finite numbers', () => {
    const invalid = {
        source: 'groww',
        query: 'reliance',
        assetType: 'stock',
        assetTypeLabel: 'Stock',
        name: 'Reliance',
        shortName: null,
        searchId: 'reliance',
        symbol: 'RELIANCE',
        isin: null,
        category: null,
        subCategory: null,
        logoUrl: null,
        growwUrl: 'https://example.com/stocks/reliance',
        currency: 'INR',
        priceOrNav: Number.NaN,
        changeOrReturn: null,
        marketCapOrAum: null,
        peOrRating: null,
        primaryMetricLabel: 'LTP',
        primaryMetricValue: null,
        secondaryMetricLabel: 'Change',
        secondaryMetricValue: null,
        tertiaryMetricLabel: 'Market cap',
        tertiaryMetricValue: null,
        ratingMetricLabel: 'P/E',
        ratingMetricValue: null,
        stock: {} as never,
        mutualFund: null,
        scrapedAt: fixedTimestamp,
    } satisfies GrowwAssetRecord;
    assert.match(validateRecord(invalid) ?? '', /Groww asset URL/);
});
