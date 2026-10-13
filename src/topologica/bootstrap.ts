'use strict';

import * as path from 'path';
import { define } from 'mnemonica';
import * as topologicaLoader from '@mnemonica/topologica';
import { getLogger } from '../services/LoggerService';

/** True once loadModels() finished — LoggerService resolves its LoggerTab
 *  lazily against this, extension.ts gates the first load on it */
export let modelsLoaded = false;

/**
 * Bootstrap mnemonica models using topologica loader
 * Loads all types from src/models directory
 */
export function loadModels (extensionPath: string): void {
	const logger = getLogger();
	const modelsPath = path.join(extensionPath, 'out', 'src', 'models');

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

	modelsLoaded = true;
}
