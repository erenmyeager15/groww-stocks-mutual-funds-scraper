export type AssetSource = 'stocks' | 'mutual_funds' | 'both';
export type AssetType = 'stock' | 'mutual_fund';

export interface ActorInput {
    source?: AssetSource;
    keywords?: string[];
    keyword?: string;
    maxResults?: number;
    includeStockLivePrice?: boolean;
    includeNfoFunds?: boolean;
}

export interface SearchOptions {
    source: AssetSource;
    keywords: string[];
    maxResults: number;
    includeStockLivePrice: boolean;
    includeNfoFunds: boolean;
}

export interface GrowwSearchItem {
    title?: string | null;
    entity_type?: string | null;
    id?: string | null;
    search_id?: string | null;
    company_short_name?: string | null;
    nse_scrip_code?: string | null;
    bse_scrip_code?: string | null;
    groww_contract_id?: string | null;
    scheme_code?: string | null;
    isin?: string | null;
}

export interface GrowwSearchResponse {
    data?: {
        content?: GrowwSearchItem[];
    };
}

export interface GrowwLivePrice {
    ltp?: number | null;
    open?: number | null;
    high?: number | null;
    low?: number | null;
    close?: number | null;
    volume?: number | null;
    dayChange?: number | null;
    dayChangePerc?: number | null;
    yearHighPrice?: number | null;
    yearLowPrice?: number | null;
    lastTradeTime?: number | null;
}

export interface GrowwAssetRecord {
    source: 'groww';
    query: string;
    assetType: AssetType;
    name: string;
    shortName: string | null;
    searchId: string;
    symbol: string | null;
    isin: string | null;
    category: string | null;
    subCategory: string | null;
    logoUrl: string | null;
    growwUrl: string;
    priceOrNav: number | null;
    changeOrReturn: number | null;
    marketCapOrAum: number | null;
    peOrRating: number | null;
    primaryMetricLabel: string;
    primaryMetricValue: number | null;
    secondaryMetricLabel: string;
    secondaryMetricValue: number | null;
    tertiaryMetricLabel: string;
    tertiaryMetricValue: number | null;
    ratingMetricLabel: string;
    ratingMetricValue: number | null;
    stock: StockDetails | null;
    mutualFund: MutualFundDetails | null;
    scrapedAt: string;
}

export interface StockDetails {
    nseScriptCode: string | null;
    bseScriptCode: string | null;
    currentPrice: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    dayChange: number | null;
    dayChangePercent: number | null;
    marketCapCr: number | null;
    peRatio: number | null;
    pbRatio: number | null;
    dividendYieldPercent: number | null;
    epsTtm: number | null;
    roePercent: number | null;
    bookValue: number | null;
    cappedType: string | null;
    yearHighPrice: number | null;
    yearLowPrice: number | null;
    industryName: string | null;
    headquarters: string | null;
    ceo: string | null;
    managingDirector: string | null;
    foundedYear: number | null;
    websiteUrl: string | null;
    businessSummary: string | null;
}

export interface MutualFundDetails {
    schemeCode: string | null;
    schemeName: string | null;
    fundHouse: string | null;
    fundManager: string | null;
    nav: number | null;
    navDate: string | null;
    aumCr: number | null;
    expenseRatioPercent: number | null;
    growwRating: number | null;
    risk: string | null;
    riskRating: number | null;
    return1d: number | null;
    return1w: number | null;
    return1m: number | null;
    return3m: number | null;
    return6m: number | null;
    return1y: number | null;
    return3y: number | null;
    return5y: number | null;
    return10y: number | null;
    returnSinceLaunch: number | null;
    minInvestmentAmount: number | null;
    minSipInvestment: number | null;
    launchDate: string | null;
    planType: string | null;
    schemeType: string | null;
    availableForInvestment: boolean | null;
}
