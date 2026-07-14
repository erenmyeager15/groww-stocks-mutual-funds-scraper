import type { ActorInput, AssetSource, SearchOptions } from './types.js';

export const MAX_RESULTS = 500;
export const MAX_KEYWORDS = 25;
export const MAX_KEYWORD_LENGTH = 120;

const SOURCES = new Set<AssetSource>(['stocks', 'mutual_funds', 'both']);

export function normalizeInput(input: ActorInput): SearchOptions {
    const source = input.source ?? 'stocks';
    if (!SOURCES.has(source)) {
        throw new Error('source must be one of: stocks, mutual_funds, both.');
    }

    const rawKeywords = input.keywords ?? (input.keyword === undefined ? ['reliance'] : [input.keyword]);
    if (!Array.isArray(rawKeywords) || rawKeywords.length === 0) {
        throw new Error('keywords must contain at least one search term.');
    }
    if (rawKeywords.length > MAX_KEYWORDS) {
        throw new Error(`keywords supports at most ${MAX_KEYWORDS} search terms per run.`);
    }

    const keywords: string[] = [];
    const seen = new Set<string>();
    for (const value of rawKeywords) {
        if (typeof value !== 'string') throw new Error('Every keywords item must be a string.');
        const keyword = value.replace(/\s+/g, ' ').trim();
        if (!keyword) throw new Error('keywords cannot contain blank values.');
        if (keyword.length > MAX_KEYWORD_LENGTH) {
            throw new Error(`Each keyword must be at most ${MAX_KEYWORD_LENGTH} characters.`);
        }
        const normalized = keyword.toLocaleLowerCase('en-US');
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        keywords.push(keyword);
    }

    const maxResults = input.maxResults ?? 1;
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) {
        throw new Error(`maxResults must be an integer from 1 to ${MAX_RESULTS}.`);
    }
    if (input.includeStockLivePrice !== undefined && typeof input.includeStockLivePrice !== 'boolean') {
        throw new Error('includeStockLivePrice must be a boolean.');
    }
    if (input.includeNfoFunds !== undefined && typeof input.includeNfoFunds !== 'boolean') {
        throw new Error('includeNfoFunds must be a boolean.');
    }

    return {
        source,
        keywords,
        maxResults,
        includeStockLivePrice: input.includeStockLivePrice !== false,
        includeNfoFunds: input.includeNfoFunds === true,
    };
}
