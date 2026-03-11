'use strict';

import * as path from 'path';
import { define } from 'mnemonica';
import * as topologicaLoader from '@mnemonica/topologica';
import { getLogger } from '../services/LoggerService';

let isInitialized = false;

/**
 * Bootstrap mnemonica models using topologica loader
 * Loads all types from src/models directory
 */
export function loadModels (extensionPath: string): void {
	const logger = getLogger();
	const modelsPath = path.join(extensionPath, 'out', 'models');

	logger.info('[Topologica Bootstrap] Loading models from:', modelsPath);

	// Topologica returns { topology, logs }
	const result = topologicaLoader.default(modelsPath, define);

	if (result.logs) {
		result.logs.forEach((log: string[]) => {
			logger.info('[Topologica]', ...log);
		});
	}

	const typeCount = result.topology ? Object.keys(result.topology).length : 0;
	logger.info(`[Topologica Bootstrap] Loaded ${typeCount} root types`);

	isInitialized = true;
}

// Export getter for initialization state - always returns current value
Object.defineProperty(module.exports, 'modelsLoaded', {
	get () { return isInitialized; }
});

// TypeScript declaration for the exported getter
declare module './bootstrap' {
	export const modelsLoaded: boolean;
}
