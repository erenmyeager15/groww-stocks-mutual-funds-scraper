import { Actor, log } from 'apify';
import type {
    ActorInput,
    AssetSource,
    GrowwAssetRecord,
    GrowwLivePrice,
    GrowwSearchItem,
    GrowwSearchResponse,
    MutualFundDetails,
    SearchOptions,
    StockDetails,
} from './types.js';

const BASE_URL = 'https://groww.in';
const MAX_RESULTS = 500;
const SEARCH_PAGE_SIZE = 30;
const DEFAULT_HEADERS: Record<string, string> = {
    accept: 'application/json,text/html,*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
};

export function normalizeInput(input: ActorInput): SearchOptions {
    const rawKeywords = Array.isArray(input.keywords) && input.keywords.length > 0
        ? input.keywords
        : input.keyword
            ? [input.keyword]
            : ['reliance', 'parag parikh flexi cap'];

    const source = input.source && ['stocks', 'mutual_funds', 'both'].includes(input.source)
        ? input.source
        : 'both';

    return {
        source,
        keywords: unique(rawKeywords.map((keyword) => cleanText(keyword)).filter((keyword): keyword is string => Boolean(keyword))),
        maxResults: clampInteger(input.maxResults ?? 50, 1, MAX_RESULTS),
        includeStockLivePrice: input.includeStockLivePrice !== false,
        includeNfoFunds: input.includeNfoFunds === true,
    };
}

export async function scrapeGroww(options: SearchOptions): Promise<number> {
    const seen = new Set<string>();
    let pushed = 0;
    const searchGroups: Array<{ keyword: string; items: GrowwSearchItem[] }> = [];

    for (const keyword of options.keywords) {
        const searchItems = await fetchSearch(keyword);
        log.info('Groww search parsed', { keyword, results: searchItems.length });
        searchGroups.push({ keyword, items: searchItems });
    }

    const maxGroupLength = Math.max(0, ...searchGroups.map((group) => group.items.length));

    for (let index = 0; index < maxGroupLength && pushed < options.maxResults; index++) {
        for (const group of searchGroups) {
            if (pushed >= options.maxResults) break;
            const item = group.items[index];
            if (!item) continue;
            if (!isWantedItem(item, options.source, options.includeNfoFunds)) continue;

            const searchId = cleanText(item.search_id) ?? cleanText(item.id);
            if (!searchId) continue;

            const assetType = isStockItem(item) ? 'stock' : 'mutual_fund';
            const dedupeKey = `${assetType}:${searchId}`;
            if (seen.has(dedupeKey)) continue;

            const record = assetType === 'stock'
                ? await buildStockRecord(item, group.keyword, searchId, options.includeStockLivePrice)
                : await buildMutualFundRecord(item, group.keyword, searchId);

            if (!record) continue;

            seen.add(dedupeKey);
            await Actor.pushData(record);
            await chargeForRecord();
            pushed++;

            await sleep(randomInteger(250, 800));
        }
    }

    return pushed;
}

async function fetchSearch(keyword: string): Promise<GrowwSearchItem[]> {
    const url = new URL('/v1/api/search/v3/query/global/st_query', BASE_URL);
    url.searchParams.set('query', keyword);
    url.searchParams.set('page', '0');
    url.searchParams.set('size', String(SEARCH_PAGE_SIZE));

    const response = await fetchJson<GrowwSearchResponse>(url.toString());
    return response.data?.content ?? [];
}

async function buildStockRecord(
    item: GrowwSearchItem,
    query: string,
    searchId: string,
    includeLivePrice: boolean,
): Promise<GrowwAssetRecord | null> {
    const detailUrl = `${BASE_URL}/v1/api/stocks_data/v1/company/search_id/${encodeURIComponent(searchId)}`;
    const detail = await fetchJson<Record<string, unknown>>(detailUrl);
    const header = asObject(detail.header);
    const details = asObject(detail.details);
    const stats = asObject(detail.stats);
    const priceData = asObject(detail.priceData);
    const nsePriceData = asObject(priceData?.nse);
    const bsePriceData = asObject(priceData?.bse);
    const live = includeLivePrice ? await fetchStockLivePrice(searchId, header) : null;

    const nseScriptCode = stringValue(header?.nseScriptCode) ?? stringValue(item.nse_scrip_code);
    const bseScriptCode = stringValue(header?.bseScriptCode) ?? stringValue(item.bse_scrip_code);
    const name = stringValue(header?.displayName)
        ?? stringValue(details?.fullName)
        ?? stringValue(item.title)
        ?? searchId;
    const marketCapCr = numberOrNull(stats?.marketCap);
    const currentPrice = numberOrNull(live?.ltp);

    const stock: StockDetails = {
        nseScriptCode,
        bseScriptCode,
        currentPrice,
        open: numberOrNull(live?.open),
        high: numberOrNull(live?.high),
        low: numberOrNull(live?.low),
        close: numberOrNull(live?.close),
        volume: numberOrNull(live?.volume),
        dayChange: numberOrNull(live?.dayChange),
        dayChangePercent: roundedNumberOrNull(live?.dayChangePerc, 2),
        marketCapCr,
        peRatio: roundedNumberOrNull(stats?.peRatio, 2),
        pbRatio: roundedNumberOrNull(stats?.pbRatio, 2),
        dividendYieldPercent: roundedNumberOrNull(stats?.dividendYieldInPercent ?? stats?.divYield, 2),
        epsTtm: roundedNumberOrNull(stats?.epsTtm, 2),
        roePercent: roundedNumberOrNull(stats?.returnOnEquity ?? stats?.roe, 2),
        bookValue: roundedNumberOrNull(stats?.bookValue, 2),
        cappedType: stringValue(stats?.cappedType),
        yearHighPrice: numberOrNull(live?.yearHighPrice) ?? numberOrNull(nsePriceData?.yearHighPrice) ?? numberOrNull(bsePriceData?.yearHighPrice),
        yearLowPrice: numberOrNull(live?.yearLowPrice) ?? numberOrNull(nsePriceData?.yearLowPrice) ?? numberOrNull(bsePriceData?.yearLowPrice),
        industryName: stringValue(header?.industryName),
        headquarters: stringValue(details?.headquarters),
        ceo: stringValue(details?.ceo),
        managingDirector: stringValue(details?.managingDirector),
        foundedYear: integerOrNull(details?.foundedYear),
        websiteUrl: stringValue(details?.websiteUrl),
        businessSummary: stringValue(details?.businessSummary),
    };

    if (!isUsefulStockRecord(stock, header)) {
        log.debug('Skipping sparse Groww stock artifact', { searchId, name });
        return null;
    }

    return {
        source: 'groww',
        query,
        assetType: 'stock',
        assetTypeLabel: 'Stock',
        name,
        shortName: stringValue(header?.shortName) ?? stringValue(item.company_short_name),
        searchId,
        symbol: nseScriptCode ?? bseScriptCode,
        isin: stringValue(header?.isin) ?? stringValue(item.isin),
        category: stringValue(header?.industryName),
        subCategory: stringValue(stats?.cappedType),
        logoUrl: stringValue(header?.logoUrl),
        growwUrl: `${BASE_URL}/stocks/${searchId}`,
        priceOrNav: currentPrice,
        changeOrReturn: stock.dayChangePercent,
        marketCapOrAum: marketCapCr,
        peOrRating: stock.peRatio,
        primaryMetricLabel: 'LTP',
        primaryMetricValue: currentPrice,
        secondaryMetricLabel: 'Day change %',
        secondaryMetricValue: stock.dayChangePercent,
        tertiaryMetricLabel: 'Market cap (Cr)',
        tertiaryMetricValue: marketCapCr,
        ratingMetricLabel: 'P/E',
        ratingMetricValue: stock.peRatio,
        stock,
        mutualFund: null,
        scrapedAt: new Date().toISOString(),
    };
}

async function buildMutualFundRecord(
    item: GrowwSearchItem,
    query: string,
    searchId: string,
): Promise<GrowwAssetRecord | null> {
    const detailUrl = `${BASE_URL}/v1/api/data/mf/web/v1/scheme/search/${encodeURIComponent(searchId)}`;
    const detail = await fetchJson<Record<string, unknown>>(detailUrl);
    const resolvedSearchId = stringValue(detail.search_id);
    if (!resolvedSearchId && !stringValue(detail.scheme_name)) {
        log.debug('Skipping empty Groww mutual fund detail response', { searchId });
        return null;
    }

    const returnStats = asObject(arrayValue(detail.return_stats)?.[0]);
    const name = stringValue(detail.scheme_name)
        ?? stringValue(detail.fund_name)
        ?? stringValue(item.title)
        ?? searchId;
    const nav = numberOrNull(detail.nav);
    const return1y = roundedNumberOrNull(returnStats?.return1y, 2);
    const aumCr = roundedNumberOrNull(detail.aum, 2);
    const growwRating = numberOrNull(detail.groww_rating);

    const mutualFund: MutualFundDetails = {
        schemeCode: stringValue(detail.scheme_code) ?? stringValue(item.scheme_code),
        schemeName: stringValue(detail.scheme_name),
        fundHouse: stringValue(detail.fund_house),
        fundManager: stringValue(detail.fund_manager),
        nav,
        navDate: stringValue(detail.nav_date),
        aumCr,
        expenseRatioPercent: roundedNumberOrNull(detail.expense_ratio, 2),
        growwRating,
        risk: stringValue(returnStats?.risk),
        riskRating: integerOrNull(returnStats?.risk_rating),
        return1d: roundedNumberOrNull(returnStats?.return1d, 2),
        return1w: roundedNumberOrNull(returnStats?.return1w, 2),
        return1m: roundedNumberOrNull(returnStats?.return1m, 2),
        return3m: roundedNumberOrNull(returnStats?.return3m, 2),
        return6m: roundedNumberOrNull(returnStats?.return6m, 2),
        return1y,
        return3y: roundedNumberOrNull(returnStats?.return3y, 2),
        return5y: roundedNumberOrNull(returnStats?.return5y, 2),
        return10y: roundedNumberOrNull(returnStats?.return10y, 2),
        returnSinceLaunch: roundedNumberOrNull(returnStats?.return_since_created, 2),
        minInvestmentAmount: numberOrNull(detail.min_investment_amount),
        minSipInvestment: numberOrNull(detail.min_sip_investment),
        launchDate: stringValue(detail.launch_date),
        planType: stringValue(detail.plan_type),
        schemeType: stringValue(detail.scheme_type),
        availableForInvestment: booleanOrNull(detail.available_for_investment),
    };

    return {
        source: 'groww',
        query,
        assetType: 'mutual_fund',
        assetTypeLabel: 'Mutual fund',
        name,
        shortName: stringValue(detail.fund_name) ?? stringValue(item.title),
        searchId: resolvedSearchId ?? searchId,
        symbol: mutualFund.schemeCode,
        isin: stringValue(detail.isin) ?? stringValue(item.isin),
        category: stringValue(detail.category),
        subCategory: stringValue(detail.sub_category),
        logoUrl: stringValue(detail.logo_url),
        growwUrl: `${BASE_URL}/mutual-funds/${searchId}`,
        priceOrNav: nav,
        changeOrReturn: return1y,
        marketCapOrAum: aumCr,
        peOrRating: growwRating,
        primaryMetricLabel: 'NAV',
        primaryMetricValue: nav,
        secondaryMetricLabel: '1Y return %',
        secondaryMetricValue: return1y,
        tertiaryMetricLabel: 'AUM (Cr)',
        tertiaryMetricValue: aumCr,
        ratingMetricLabel: 'Groww rating',
        ratingMetricValue: growwRating,
        stock: null,
        mutualFund,
        scrapedAt: new Date().toISOString(),
    };
}

async function fetchStockLivePrice(searchId: string, header: Record<string, unknown> | null): Promise<GrowwLivePrice | null> {
    try {
        const html = await fetchText(`${BASE_URL}/stocks/${searchId}`);
        const nextData = parseNextData(html);
        const pageProps = asObject(asObject(nextData.props)?.pageProps);
        const livePriceData = asObject(pageProps?.livePriceData);
        if (!livePriceData) return null;

        const nseCode = stringValue(header?.nseScriptCode);
        const bseCode = stringValue(header?.bseScriptCode);
        const candidates = [nseCode, bseCode].filter((value): value is string => Boolean(value));

        for (const key of candidates) {
            const live = asObject(livePriceData[key]);
            if (live) return live as GrowwLivePrice;
        }

        const first = Object.values(livePriceData).map((value) => asObject(value)).find(Boolean);
        return first as GrowwLivePrice | null;
    } catch (error) {
        log.debug('Failed to parse Groww live stock price from HTML', {
            searchId,
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function parseNextData(html: string): Record<string, unknown> {
    const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match?.[1]) throw new Error('Groww __NEXT_DATA__ payload not found.');
    const parsed = JSON.parse(match[1]) as unknown;
    if (!isObject(parsed)) throw new Error('Groww __NEXT_DATA__ payload was not an object.');
    return parsed;
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetchWithRetry(url, 'json');
    return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
    const response = await fetchWithRetry(url, 'text');
    return response.text();
}

async function fetchWithRetry(url: string, expected: 'json' | 'text'): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(url, { headers: DEFAULT_HEADERS });
            if (response.ok) return response;

            const retryable = response.status === 429 || response.status >= 500;
            if (!retryable) throw new Error(`HTTP ${response.status} from ${url}`);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }

        await sleep(randomInteger(800, 2200) * attempt);
    }

    throw lastError ?? new Error(`Failed to fetch ${expected} from ${url}`);
}

function isWantedItem(item: GrowwSearchItem, source: AssetSource, includeNfoFunds: boolean): boolean {
    if (source === 'stocks') return isStockItem(item);
    if (source === 'mutual_funds') return isMutualFundItem(item, includeNfoFunds);
    return isStockItem(item) || isMutualFundItem(item, includeNfoFunds);
}

function isStockItem(item: GrowwSearchItem): boolean {
    return item.entity_type === 'Stocks';
}

function isUsefulStockRecord(stock: StockDetails, header: Record<string, unknown> | null): boolean {
    const hasTradeData = stock.currentPrice !== null || stock.marketCapCr !== null;
    const hasCompanyProfile = Boolean(stock.industryName || stock.yearHighPrice !== null || stock.yearLowPrice !== null);
    const isStockHeader = stringValue(header?.type) === 'STOCK' || Boolean(stock.nseScriptCode || stock.bseScriptCode);
    return isStockHeader && (hasTradeData || hasCompanyProfile);
}

function isMutualFundItem(item: GrowwSearchItem, includeNfoFunds: boolean): boolean {
    return item.entity_type === 'Scheme' || (includeNfoFunds && item.entity_type === 'Nfo');
}

async function chargeForRecord(): Promise<void> {
    try {
        await Actor.charge({ eventName: 'asset-scraped' });
    } catch (error) {
        log.debug('Actor.charge skipped or failed in current environment', {
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

function cleanText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/\s+/g, ' ').trim();
    return cleaned.length > 0 ? cleaned : null;
}

function stringValue(value: unknown): string | null {
    return cleanText(value);
}

function numberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function roundedNumberOrNull(value: unknown, decimals: number): number | null {
    const number = numberOrNull(value);
    if (number === null) return null;
    const factor = 10 ** decimals;
    return Math.round(number * factor) / factor;
}

function integerOrNull(value: unknown): number | null {
    const number = numberOrNull(value);
    return number === null ? null : Math.trunc(number);
}

function booleanOrNull(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function arrayValue(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
    return isObject(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(Math.trunc(value), min), max);
}

function randomInteger(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
