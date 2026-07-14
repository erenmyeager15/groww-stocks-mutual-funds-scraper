import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_KEYWORDS, MAX_KEYWORD_LENGTH, MAX_RESULTS, normalizeInput } from './input.js';

test('normalizeInput uses a bounded stock QA default', () => {
    assert.deepEqual(normalizeInput({}), {
        source: 'stocks',
        keywords: ['reliance'],
        maxResults: 1,
        includeStockLivePrice: true,
        includeNfoFunds: false,
    });
});

test('normalizeInput trims and case-insensitively deduplicates keywords', () => {
    const result = normalizeInput({ keywords: [' Reliance ', 'reliance', 'TCS'] });
    assert.deepEqual(result.keywords, ['Reliance', 'TCS']);
});

test('normalizeInput supports the legacy singular keyword field', () => {
    assert.deepEqual(normalizeInput({ keyword: '  nifty fund  ' }).keywords, ['nifty fund']);
});

test('normalizeInput rejects an invalid source', () => {
    assert.throws(() => normalizeInput({ source: 'crypto' as never }), /source must be one of/);
});

test('normalizeInput rejects an empty keyword list', () => {
    assert.throws(() => normalizeInput({ keywords: [] }), /at least one/);
});

test('normalizeInput rejects blank and non-string keywords', () => {
    assert.throws(() => normalizeInput({ keywords: ['  '] }), /blank/);
    assert.throws(() => normalizeInput({ keywords: [42 as never] }), /must be a string/);
});

test('normalizeInput enforces keyword count and length limits', () => {
    assert.throws(
        () => normalizeInput({ keywords: Array.from({ length: MAX_KEYWORDS + 1 }, (_, index) => `stock-${index}`) }),
        /at most 25/,
    );
    assert.throws(() => normalizeInput({ keywords: ['x'.repeat(MAX_KEYWORD_LENGTH + 1)] }), /at most 120/);
});

test('normalizeInput enforces integer result limits', () => {
    for (const maxResults of [0, MAX_RESULTS + 1, 1.5, Number.NaN]) {
        assert.throws(() => normalizeInput({ maxResults }), /integer from 1 to 500/);
    }
});

test('normalizeInput rejects non-boolean flags', () => {
    assert.throws(() => normalizeInput({ includeStockLivePrice: 'yes' as never }), /must be a boolean/);
    assert.throws(() => normalizeInput({ includeNfoFunds: 1 as never }), /must be a boolean/);
});

