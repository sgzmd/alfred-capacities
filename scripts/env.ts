import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads CAPACITIES_TOKEN from environment or fallback sibling .env file.
 */
export function loadEnvToken(importMetaUrl: string): string | undefined {
    if (process.env.CAPACITIES_TOKEN) {
        return process.env.CAPACITIES_TOKEN;
    }
    const dirname = path.dirname(fileURLToPath(importMetaUrl));
    const envFile = path.resolve(dirname, '..', '.env');
    if (fs.existsSync(envFile)) {
        const match = fs.readFileSync(envFile, 'utf8').match(/^CAPACITIES_TOKEN=(.*)$/m);
        if (match) {
            process.env.CAPACITIES_TOKEN = match[1].trim();
            return process.env.CAPACITIES_TOKEN;
        }
    }
    return undefined;
}
