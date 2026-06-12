import { Actor, log } from 'apify';
import { normalizeInput, scrapeGroww } from './routes.js';
import type { ActorInput } from './types.js';

await Actor.main(async () => {
    const input = (await Actor.getInput<ActorInput>()) ?? {};
    const options = normalizeInput(input);

    log.info('Starting Groww scrape', {
        source: options.source,
        keywords: options.keywords,
        maxResults: options.maxResults,
        includeStockLivePrice: options.includeStockLivePrice,
        includeNfoFunds: options.includeNfoFunds,
    });

    const records = await scrapeGroww(options);
    if (records === 0) {
        throw new Error('No Groww stock or mutual fund records were scraped. Try broader keywords or another source filter.');
    }

    log.info('Groww scrape finished', { records });
});
