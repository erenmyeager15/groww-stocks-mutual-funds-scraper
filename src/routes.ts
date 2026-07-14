import { Actor, log } from 'apify';
import type {
    AssetSource,
    GrowwAssetRecord,
    GrowwLivePrice,
    GrowwSearchItem,
    GrowwRunStatus,
    KeywordRunStatus,
    MutualFundDetails,
    ScrapeResult,
    SearchOptions,
    StockDetails,
} from './types.js';

const BASE_URL = 'https://groww.in';
const SEARCH_PAGE_SIZE = 30;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_FETCH_ATTEMPTS = 3;
const RUNTIME_LIMIT_MS = 15 * 60 * 1000;
const DEFAULT_HEADERS: Record<string, string> = {
    accept: 'application/json,text/html,*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
};

interface ChargeResult {
    chargedCount: number;
    eventChargeLimitReached: boolean;
}

export interface ScrapeDependencies {
    fetch: typeof globalThis.fetch;
    pushData: (record: GrowwAssetRecord, eventName: string) => Promise<ChargeResult>;
    sleep: (milliseconds: number) => Promise<void>;
    now: () => number;
    isoNow: () => string;
    randomDelay: () => number;
    requestTimeoutMs: number;
    maxFetchAttempts: number;
    runtimeLimitMs: number;
}

interface SearchGroup {
    keyword: string;
    items: GrowwSearchItem[];
    status: KeywordRunStatus;
}

interface StockFundamentals {
    marketCapCr: number | null;
    peRatio: number | null;
    pbRatio: number | null;
    dividendYieldPercent: number | null;
    epsTtm: number | null;
    roePercent: number | null;
    bookValue: number | null;
    cappedType: string | null;
}

interface BuiltRecord {
    record: GrowwAssetRecord;
    livePriceMissing: boolean;
}

class HttpStatusError extends Error {
    constructor(
        public readonly status: number,
        public readonly retryable: boolean,
        url: string,
    ) {
        super(`HTTP ${status} from ${url}`);
        this.name = 'HttpStatusError';
    }
}

const defaultDependencies: ScrapeDependencies = {
    fetch: globalThis.fetch,
    pushData: async (record, eventName) => Actor.pushData(record, eventName),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => Date.now(),
    isoNow: () => new Date().toISOString(),
    randomDelay: () => randomInteger(150, 500),
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    maxFetchAttempts: MAX_FETCH_ATTEMPTS,
    runtimeLimitMs: RUNTIME_LIMIT_MS,
};

export async function scrapeGroww(
    options: SearchOptions,
    dependencyOverrides: Partial<ScrapeDependencies> = {},
): Promise<ScrapeResult> {
    const dependencies = { ...defaultDependencies, ...dependencyOverrides };
    const startedAt = dependencies.now();
    const attempted = new Set<string>();
    const searchGroups: SearchGroup[] = [];
    let pushed = 0;
    let searchRequests = 0;
    let successfulSearches = 0;
    let failedSearches = 0;
    let eligibleCandidates = 0;
    let duplicateCandidates = 0;
    let detailFailures = 0;
    let invalidRecords = 0;
    let livePriceMisses = 0;
    let spendingLimitReached = false;
    let runtimeLimitReached = false;

    const keywordResults = options.keywords.map<KeywordRunStatus>((keyword) => ({
        keyword,
        outcome: 'not_run',
        searchResults: 0,
        eligibleResults: 0,
        saved: 0,
        detailFailures: 0,
        invalidRecords: 0,
        error: null,
        lastDetailError: null,
    }));

    for (const keywordStatus of keywordResults) {
        if (hasReachedRuntimeLimit(startedAt, dependencies)) {
            runtimeLimitReached = true;
            break;
        }

        searchRequests++;
        try {
            const items = await fetchSearch(keywordStatus.keyword, dependencies);
            const eligible = items.filter((item) => isWantedItem(item, options.source, options.includeNfoFunds));
            successfulSearches++;
            keywordStatus.outcome = 'empty';
            keywordStatus.searchResults = items.length;
            keywordStatus.eligibleResults = eligible.length;
            searchGroups.push({ keyword: keywordStatus.keyword, items, status: keywordStatus });
            log.info('Groww search parsed', {
                keyword: keywordStatus.keyword,
                results: items.length,
                eligible: eligible.length,
            });
        } catch (error) {
            failedSearches++;
            keywordStatus.outcome = 'failed';
            keywordStatus.error = errorMessage(error);
            log.warning('Groww search request failed', {
                keyword: keywordStatus.keyword,
                reason: keywordStatus.error,
            });
        }
    }

    const maxGroupLength = Math.max(0, ...searchGroups.map((group) => group.items.length));

    processing:
    for (let index = 0; index < maxGroupLength && pushed < options.maxResults; index++) {
        for (const group of searchGroups) {
            if (pushed >= options.maxResults) break processing;
            if (hasReachedRuntimeLimit(startedAt, dependencies)) {
                runtimeLimitReached = true;
                break processing;
            }

            const item = group.items[index];
            if (!item || !isWantedItem(item, options.source, options.includeNfoFunds)) continue;

            const searchId = cleanText(item.search_id, 300) ?? cleanText(item.id, 300);
            const assetType = isStockItem(item) ? 'stock' : 'mutual_fund';
            if (!searchId) {
                eligibleCandidates++;
                invalidRecords++;
                group.status.invalidRecords++;
                group.status.lastDetailError = 'Eligible search result did not contain a search ID.';
                continue;
            }

            const dedupeKey = `${assetType}:${searchId.toLocaleLowerCase('en-US')}`;
            if (attempted.has(dedupeKey)) {
                duplicateCandidates++;
                continue;
            }
            attempted.add(dedupeKey);
            eligibleCandidates++;

            let built: BuiltRecord;
            try {
                built = assetType === 'stock'
                    ? await buildStockRecord(item, group.keyword, searchId, options.includeStockLivePrice, dependencies)
                    : await buildMutualFundRecord(item, group.keyword, searchId, dependencies);
            } catch (error) {
                detailFailures++;
                group.status.detailFailures++;
                group.status.lastDetailError = errorMessage(error);
                log.warning('Skipping Groww asset after detail request failure', {
                    assetType,
                    searchId,
                    reason: group.status.lastDetailError,
                });
                continue;
            }

            if (built.livePriceMissing) livePriceMisses++;
            const validationError = validateRecord(built.record);
            if (validationError) {
                invalidRecords++;
                group.status.invalidRecords++;
                group.status.lastDetailError = validationError;
                log.warning('Skipping invalid Groww record', { searchId, reason: validationError });
                continue;
            }

            const chargeResult = await dependencies.pushData(built.record, 'asset-scraped');
            const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;
            if (recordWasSaved) {
                pushed++;
                group.status.saved++;
                group.status.outcome = 'results';
            }

            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                log.warning(`Stopped at the user's spending limit after ${pushed} asset(s).`);
                break processing;
            }

            if (pushed < options.maxResults) await dependencies.sleep(dependencies.randomDelay());
        }
    }

    for (const keywordStatus of keywordResults) {
        if (keywordStatus.outcome === 'failed' || keywordStatus.outcome === 'not_run' || keywordStatus.saved > 0) continue;
        if (keywordStatus.eligibleResults > 0 && (keywordStatus.detailFailures > 0 || keywordStatus.invalidRecords > 0)) {
            keywordStatus.outcome = 'failed';
            keywordStatus.error = keywordStatus.lastDetailError ?? 'All eligible detail records failed.';
        } else {
            keywordStatus.outcome = 'empty';
        }
    }

    const durationMs = Math.max(0, dependencies.now() - startedAt);
    let status: GrowwRunStatus['status'];
    let failureMessage: string | null = null;

    if (spendingLimitReached) {
        status = 'spending_limit';
    } else if (runtimeLimitReached && pushed > 0) {
        status = 'runtime_limit';
    } else if (runtimeLimitReached) {
        status = 'failed';
        failureMessage = 'Groww scrape reached the 15-minute safety limit before saving a record.';
    } else if (pushed > 0) {
        status = 'results';
    } else if (failedSearches > 0) {
        status = 'failed';
        failureMessage = 'No records were saved because one or more Groww search requests failed.';
    } else if (eligibleCandidates > 0 && (detailFailures > 0 || invalidRecords > 0)) {
        status = 'failed';
        failureMessage = 'Groww returned matching assets, but all detail records failed validation or retrieval.';
    } else {
        status = 'empty';
    }

    const runStatus: GrowwRunStatus = {
        status,
        source: options.source,
        keywords: options.keywords,
        requestedMaxResults: options.maxResults,
        records: pushed,
        searchRequests,
        successfulSearches,
        failedSearches,
        eligibleCandidates,
        duplicateCandidates,
        detailFailures,
        invalidRecords,
        livePriceMisses,
        spendingLimitReached,
        runtimeLimitReached,
        durationMs,
        keywordResults,
        failureMessage,
    };

    return {
        records: pushed,
        spendingLimitReached,
        runtimeLimitReached,
        failureMessage,
        runStatus,
    };
}

async function fetchSearch(keyword: string, dependencies: ScrapeDependencies): Promise<GrowwSearchItem[]> {
    const url = new URL('/v1/api/search/v3/query/global/st_query', BASE_URL);
    url.searchParams.set('query', keyword);
    url.searchParams.set('page', '0');
    url.searchParams.set('size', String(SEARCH_PAGE_SIZE));
    return parseSearchResponse(await fetchJson(url.toString(), dependencies));
}

async function buildStockRecord(
    item: GrowwSearchItem,
    query: string,
    searchId: string,
    includeLivePrice: boolean,
    dependencies: ScrapeDependencies,
): Promise<BuiltRecord> {
    const detailUrl = `${BASE_URL}/v1/api/stocks_data/v1/company/search_id/${encodeURIComponent(searchId)}`;
    const detail = asObject(await fetchJson(detailUrl, dependencies));
    if (!detail) throw new Error('Groww stock detail response was not an object.');

    const header = asObject(detail.header);
    const details = asObject(detail.details);
    const priceData = asObject(detail.priceData);
    const nsePriceData = asObject(priceData?.nse);
    const bsePriceData = asObject(priceData?.bse);
    const fundamentals = parseFundamentalMetrics(detail.fundamentals, detail.stats);
    const live = includeLivePrice ? await fetchStockLivePrice(searchId, header, dependencies) : null;

    const nseScriptCode = cleanText(header?.nseScriptCode, 80) ?? cleanText(item.nse_scrip_code, 80);
    const bseScriptCode = cleanText(header?.bseScriptCode, 80) ?? cleanText(item.bse_scrip_code, 80);
    const name = cleanText(header?.displayName, 300)
        ?? cleanText(details?.fullName, 300)
        ?? cleanText(item.title, 300)
        ?? searchId;
    const currentPrice = numberOrNull(live?.ltp)
        ?? numberOrNull(nsePriceData?.ltp ?? nsePriceData?.currentPrice)
        ?? numberOrNull(bsePriceData?.ltp ?? bsePriceData?.currentPrice);

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
        marketCapCr: fundamentals.marketCapCr,
        peRatio: fundamentals.peRatio,
        pbRatio: fundamentals.pbRatio,
        dividendYieldPercent: fundamentals.dividendYieldPercent,
        epsTtm: fundamentals.epsTtm,
        roePercent: fundamentals.roePercent,
        bookValue: fundamentals.bookValue,
        cappedType: fundamentals.cappedType,
        yearHighPrice: numberOrNull(live?.yearHighPrice)
            ?? numberOrNull(nsePriceData?.yearHighPrice)
            ?? numberOrNull(bsePriceData?.yearHighPrice),
        yearLowPrice: numberOrNull(live?.yearLowPrice)
            ?? numberOrNull(nsePriceData?.yearLowPrice)
            ?? numberOrNull(bsePriceData?.yearLowPrice),
        industryName: cleanText(header?.industryName, 200),
        headquarters: cleanText(details?.headquarters, 300),
        foundedYear: integerOrNull(details?.foundedYear),
        websiteUrl: safeHttpUrl(details?.websiteUrl),
        businessSummary: cleanText(details?.businessSummary, 3_000),
    };

    if (!isUsefulStockRecord(stock, header)) {
        throw new Error('Groww stock detail response did not contain recognizable stock data.');
    }

    const record: GrowwAssetRecord = {
        source: 'groww',
        query,
        assetType: 'stock',
        assetTypeLabel: 'Stock',
        name,
        shortName: cleanText(header?.shortName, 300) ?? cleanText(item.company_short_name, 300),
        searchId,
        symbol: nseScriptCode ?? bseScriptCode,
        isin: cleanText(header?.isin, 80) ?? cleanText(item.isin, 80),
        category: cleanText(header?.industryName, 200),
        subCategory: fundamentals.cappedType,
        logoUrl: safeHttpUrl(header?.logoUrl),
        growwUrl: `${BASE_URL}/stocks/${encodeURIComponent(searchId)}`,
        currency: 'INR',
        priceOrNav: currentPrice,
        changeOrReturn: stock.dayChangePercent,
        marketCapOrAum: stock.marketCapCr,
        peOrRating: stock.peRatio,
        primaryMetricLabel: 'LTP',
        primaryMetricValue: currentPrice,
        secondaryMetricLabel: 'Day change %',
        secondaryMetricValue: stock.dayChangePercent,
        tertiaryMetricLabel: 'Market cap (Cr)',
        tertiaryMetricValue: stock.marketCapCr,
        ratingMetricLabel: 'P/E',
        ratingMetricValue: stock.peRatio,
        stock,
        mutualFund: null,
        scrapedAt: dependencies.isoNow(),
    };

    return { record, livePriceMissing: includeLivePrice && live === null };
}

async function buildMutualFundRecord(
    item: GrowwSearchItem,
    query: string,
    searchId: string,
    dependencies: ScrapeDependencies,
): Promise<BuiltRecord> {
    const detailUrl = `${BASE_URL}/v1/api/data/mf/web/v1/scheme/search/${encodeURIComponent(searchId)}`;
    const detail = asObject(await fetchJson(detailUrl, dependencies));
    if (!detail) throw new Error('Groww mutual fund detail response was not an object.');

    const resolvedSearchId = cleanText(detail.search_id, 300);
    const schemeName = cleanText(detail.scheme_name, 300);
    if (!resolvedSearchId && !schemeName) {
        throw new Error('Groww mutual fund detail response was empty.');
    }

    const returnStats = asObject(arrayValue(detail.return_stats)?.[0]);
    const name = schemeName
        ?? cleanText(detail.fund_name, 300)
        ?? cleanText(item.title, 300)
        ?? searchId;
    const nav = numberOrNull(detail.nav);
    const return1y = roundedNumberOrNull(returnStats?.return1y, 2);
    const aumCr = roundedNumberOrNull(detail.aum, 2);
    const growwRating = numberOrNull(detail.groww_rating);

    const mutualFund: MutualFundDetails = {
        schemeCode: cleanText(detail.scheme_code, 100) ?? cleanText(item.scheme_code, 100),
        schemeName,
        fundHouse: cleanText(detail.fund_house, 300),
        fundManager: cleanText(detail.fund_manager, 500),
        nav,
        navDate: cleanText(detail.nav_date, 80),
        aumCr,
        expenseRatioPercent: roundedNumberOrNull(detail.expense_ratio, 2),
        growwRating,
        risk: cleanText(returnStats?.risk, 100),
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
        launchDate: cleanText(detail.launch_date, 80),
        planType: cleanText(detail.plan_type, 100),
        schemeType: cleanText(detail.scheme_type, 100),
        availableForInvestment: booleanOrNull(detail.available_for_investment),
    };

    const record: GrowwAssetRecord = {
        source: 'groww',
        query,
        assetType: 'mutual_fund',
        assetTypeLabel: 'Mutual fund',
        name,
        shortName: cleanText(detail.fund_name, 300) ?? cleanText(item.title, 300),
        searchId: resolvedSearchId ?? searchId,
        symbol: mutualFund.schemeCode,
        isin: cleanText(detail.isin, 80) ?? cleanText(item.isin, 80),
        category: cleanText(detail.category, 200),
        subCategory: cleanText(detail.sub_category, 200),
        logoUrl: safeHttpUrl(detail.logo_url),
        growwUrl: `${BASE_URL}/mutual-funds/${encodeURIComponent(searchId)}`,
        currency: 'INR',
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
        scrapedAt: dependencies.isoNow(),
    };

    return { record, livePriceMissing: false };
}

async function fetchStockLivePrice(
    searchId: string,
    header: Record<string, unknown> | null,
    dependencies: ScrapeDependencies,
): Promise<GrowwLivePrice | null> {
    try {
        const html = await fetchText(`${BASE_URL}/stocks/${encodeURIComponent(searchId)}`, dependencies);
        const nextData = parseNextData(html);
        return extractLivePriceFromNextData(
            nextData,
            cleanText(header?.nseScriptCode, 80),
            cleanText(header?.bseScriptCode, 80),
        );
    } catch (error) {
        log.debug('Failed to parse Groww live stock price from HTML', {
            searchId,
            message: errorMessage(error),
        });
        return null;
    }
}

export function parseSearchResponse(value: unknown): GrowwSearchItem[] {
    const root = asObject(value);
    const data = asObject(root?.data);
    if (!root || !data || !Array.isArray(data.content)) {
        throw new Error('Groww search response did not contain data.content as an array.');
    }
    if (!data.content.every(isObject)) {
        throw new Error('Groww search response contained a non-object item.');
    }
    return data.content as GrowwSearchItem[];
}

export function parseFundamentalMetrics(current: unknown, legacy: unknown = null): StockFundamentals {
    const legacyStats = asObject(legacy);
    const metrics: StockFundamentals = {
        marketCapCr: numberOrNull(legacyStats?.marketCap),
        peRatio: roundedNumberOrNull(legacyStats?.peRatio, 2),
        pbRatio: roundedNumberOrNull(legacyStats?.pbRatio, 2),
        dividendYieldPercent: roundedNumberOrNull(legacyStats?.dividendYieldInPercent ?? legacyStats?.divYield, 2),
        epsTtm: roundedNumberOrNull(legacyStats?.epsTtm, 2),
        roePercent: roundedNumberOrNull(legacyStats?.returnOnEquity ?? legacyStats?.roe, 2),
        bookValue: roundedNumberOrNull(legacyStats?.bookValue, 2),
        cappedType: cleanText(legacyStats?.cappedType, 100),
    };

    for (const value of arrayValue(current) ?? []) {
        const item = asObject(value);
        if (!item) continue;
        const label = cleanText(item.name ?? item.label ?? item.title ?? item.key, 100)?.toLocaleLowerCase('en-US');
        const raw = item.value ?? item.val ?? item.displayValue;
        if (!label) continue;

        if (label.includes('market cap')) metrics.marketCapCr = parseDisplayNumber(raw);
        else if (label === 'p/e' || label.includes('p/e ratio') || label.includes('price to earnings')) {
            metrics.peRatio = roundedNumberOrNull(raw, 2);
        } else if (label === 'p/b' || label.includes('p/b ratio') || label.includes('price to book')) {
            metrics.pbRatio = roundedNumberOrNull(raw, 2);
        } else if (label.includes('dividend yield')) metrics.dividendYieldPercent = roundedNumberOrNull(raw, 2);
        else if (label.startsWith('eps') || label.includes('earnings per share')) metrics.epsTtm = roundedNumberOrNull(raw, 2);
        else if (label === 'roe' || label.includes('return on equity')) metrics.roePercent = roundedNumberOrNull(raw, 2);
        else if (label.includes('book value')) metrics.bookValue = roundedNumberOrNull(raw, 2);
        else if (label.includes('market cap category') || label.includes('cap type')) {
            metrics.cappedType = cleanText(raw, 100);
        }
    }

    return metrics;
}

export function parseDisplayNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/,/g, '').replace(/[₹$€£]/g, '');
    if (!normalized) return null;
    const match = normalized.match(/^[+\-]?(?:\d+(?:\.\d+)?|\.\d+)/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

export function extractLivePriceFromNextData(
    nextData: unknown,
    nseCode: string | null,
    bseCode: string | null,
): GrowwLivePrice | null {
    const root = asObject(nextData);
    const props = asObject(root?.props);
    const pageProps = asObject(props?.pageProps);
    const livePriceData = asObject(pageProps?.livePriceData);
    if (!livePriceData) return null;

    const keyByUpperCase = new Map(Object.keys(livePriceData).map((key) => [key.toLocaleUpperCase('en-US'), key]));
    for (const candidate of [nseCode, bseCode]) {
        if (!candidate) continue;
        const matchedKey = keyByUpperCase.get(candidate.toLocaleUpperCase('en-US'));
        const live = matchedKey ? asObject(livePriceData[matchedKey]) : null;
        if (live) return live as GrowwLivePrice;
    }
    return null;
}

export function validateRecord(record: GrowwAssetRecord): string | null {
    if (record.source !== 'groww') return 'source must be groww.';
    if (record.currency !== 'INR') return 'currency must be INR.';
    if (!record.query || !record.name || !record.searchId) return 'query, name, and searchId are required.';
    if (!isValidGrowwUrl(record.growwUrl, record.assetType)) return 'growwUrl is not a valid Groww asset URL.';
    if (!Number.isFinite(Date.parse(record.scrapedAt))) return 'scrapedAt is not a valid timestamp.';
    if (record.stock !== null === (record.assetType !== 'stock')) return 'stock details do not match assetType.';
    if (record.mutualFund !== null === (record.assetType !== 'mutual_fund')) return 'mutual fund details do not match assetType.';
    if (!allNumbersFinite(record)) return 'record contains a non-finite numeric value.';
    if (record.stock?.currentPrice !== null && record.stock?.currentPrice !== undefined && record.stock.currentPrice <= 0) {
        return 'stock currentPrice must be positive when present.';
    }
    if (record.mutualFund?.nav !== null && record.mutualFund?.nav !== undefined && record.mutualFund.nav <= 0) {
        return 'mutual fund NAV must be positive when present.';
    }
    const rating = record.mutualFund?.growwRating;
    if (rating !== null && rating !== undefined && (rating < 0 || rating > 5)) return 'Groww rating must be from 0 to 5.';
    return null;
}

function parseNextData(html: string): Record<string, unknown> {
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match?.[1]) throw new Error('Groww __NEXT_DATA__ payload not found.');
    const parsed = JSON.parse(match[1]) as unknown;
    if (!isObject(parsed)) throw new Error('Groww __NEXT_DATA__ payload was not an object.');
    return parsed;
}

async function fetchJson(url: string, dependencies: ScrapeDependencies): Promise<unknown> {
    const text = await fetchPayloadWithRetry(url, dependencies);
    if (!text.trim()) throw new Error(`Empty JSON response from ${url}`);
    if (/^\s*</.test(text)) throw new Error(`Expected JSON but received HTML from ${url}`);
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        throw new Error(`Malformed JSON response from ${url}: ${errorMessage(error)}`);
    }
}

async function fetchText(url: string, dependencies: ScrapeDependencies): Promise<string> {
    return fetchPayloadWithRetry(url, dependencies);
}

async function fetchPayloadWithRetry(url: string, dependencies: ScrapeDependencies): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= dependencies.maxFetchAttempts; attempt++) {
        try {
            const response = await dependencies.fetch(url, {
                headers: DEFAULT_HEADERS,
                signal: AbortSignal.timeout(dependencies.requestTimeoutMs),
            });
            if (response.ok) return await response.text();

            const retryable = response.status === 429 || response.status >= 500;
            const error = new HttpStatusError(response.status, retryable, url);
            if (!retryable) throw error;
            lastError = error;
        } catch (error) {
            if (error instanceof HttpStatusError && !error.retryable) throw error;
            lastError = error instanceof Error ? error : new Error(String(error));
        }

        if (attempt < dependencies.maxFetchAttempts) {
            await dependencies.sleep(Math.min(4_000, 500 * (2 ** (attempt - 1))));
        }
    }

    throw lastError ?? new Error(`Failed to fetch ${url}`);
}

function isWantedItem(item: GrowwSearchItem, source: AssetSource, includeNfoFunds: boolean): boolean {
    if (source === 'stocks') return isStockItem(item);
    if (source === 'mutual_funds') return isMutualFundItem(item, includeNfoFunds);
    return isStockItem(item) || isMutualFundItem(item, includeNfoFunds);
}

function isStockItem(item: GrowwSearchItem): boolean {
    return item.entity_type === 'Stocks';
}

function isMutualFundItem(item: GrowwSearchItem, includeNfoFunds: boolean): boolean {
    return item.entity_type === 'Scheme' || (includeNfoFunds && item.entity_type === 'Nfo');
}

function isUsefulStockRecord(stock: StockDetails, header: Record<string, unknown> | null): boolean {
    const hasTradeData = stock.currentPrice !== null || stock.marketCapCr !== null;
    const hasCompanyProfile = Boolean(stock.industryName || stock.yearHighPrice !== null || stock.yearLowPrice !== null);
    const isStockHeader = cleanText(header?.type, 30) === 'STOCK' || Boolean(stock.nseScriptCode || stock.bseScriptCode);
    return isStockHeader && (hasTradeData || hasCompanyProfile);
}

function numberOrNull(value: unknown): number | null {
    return parseDisplayNumber(value);
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

function cleanText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    return cleaned.slice(0, maxLength);
}

function safeHttpUrl(value: unknown): string | null {
    const text = cleanText(value, 2_000);
    if (!text) return null;
    try {
        const url = new URL(text);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

function isValidGrowwUrl(value: string, assetType: GrowwAssetRecord['assetType']): boolean {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== 'groww.in') return false;
        return assetType === 'stock' ? url.pathname.startsWith('/stocks/') : url.pathname.startsWith('/mutual-funds/');
    } catch {
        return false;
    }
}

function allNumbersFinite(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(allNumbersFinite);
    if (isObject(value)) return Object.values(value).every(allNumbersFinite);
    return true;
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

function hasReachedRuntimeLimit(startedAt: number, dependencies: ScrapeDependencies): boolean {
    return dependencies.now() - startedAt >= dependencies.runtimeLimitMs;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function randomInteger(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
