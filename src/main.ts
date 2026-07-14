import { Actor, log } from 'apify';
import { normalizeInput } from './input.js';
import { scrapeGroww } from './routes.js';
import type { ActorInput } from './types.js';

await Actor.main(async () => {
    const startedAt = Date.now();
    const input = (await Actor.getInput<ActorInput>()) ?? {};

    let options;
    try {
        options = normalizeInput(input);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await Actor.setValue('RUN_STATUS', {
            status: 'failed',
            stage: 'input',
            records: 0,
            durationMs: Date.now() - startedAt,
            failureMessage: message,
        });
        throw error;
    }

    log.info('Starting Groww scrape', {
        source: options.source,
        keywords: options.keywords,
        maxResults: options.maxResults,
        includeStockLivePrice: options.includeStockLivePrice,
        includeNfoFunds: options.includeNfoFunds,
    });

    try {
        const result = await scrapeGroww(options);
        await Actor.setValue('RUN_STATUS', result.runStatus);

        if (result.failureMessage) throw new Error(result.failureMessage);

        if (result.spendingLimitReached) {
            await Actor.setStatusMessage(`Stopped at the user's spending limit after ${result.records} asset(s).`);
            return;
        }
        if (result.runtimeLimitReached) {
            await Actor.setStatusMessage(`Stopped at the safe runtime limit after ${result.records} asset(s).`);
            return;
        }
        if (result.records === 0) {
            await Actor.setStatusMessage('No matching Groww assets found for the supplied filters.');
            return;
        }

        await Actor.setStatusMessage(`Finished with ${result.records} unique asset(s).`);
        log.info('Groww scrape finished', { records: result.records });
    } catch (error) {
        const current = await Actor.getValue<Record<string, unknown>>('RUN_STATUS');
        if (!current) {
            await Actor.setValue('RUN_STATUS', {
                status: 'failed',
                stage: 'run',
                records: 0,
                durationMs: Date.now() - startedAt,
                failureMessage: error instanceof Error ? error.message : String(error),
            });
        }
        throw error;
    }
});
