'use strict';

import * as fs from 'fs';
import * as path from 'path';

// Type for the models namespace
export type MnemonicaModels = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Definition?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Link?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	LoggerTab?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Main?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Registry?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Scene2D?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Scene3D?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Trie?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Types?: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Usages?: any;
};

// Global models registry
const models: MnemonicaModels = {};
let isLoaded = false;

/**
 * Load models from transpiled output using topologica-style discovery
 * This is Phase 3: Topologica Integration
 */
export function loadModels (extensionPath: string): MnemonicaModels {
	if (isLoaded) {
		return models;
	}

	const modelsPath = path.join(extensionPath, 'out', 'models');

	if (!fs.existsSync(modelsPath)) {
		console.log('[Topologica Bootstrap] Models path not found:', modelsPath);
		return models;
	}

	console.log('[Topologica Bootstrap] Loading models from:', modelsPath);

	// Discover model files
	const files = fs.readdirSync(modelsPath)
		.filter(f => f.endsWith('.js') && f !== 'index.js')
		.map(f => path.join(modelsPath, f));

	console.log('[Topologica Bootstrap] Found model files:', files.length);

	// Load each model file
	for (const file of files) {
		try {
			// Clear require cache for hot reload
			delete require.cache[require.resolve(file)];

			// Load the module
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const modelModule = require(file);

			// Extract model name from filename
			const modelName = path.basename(file, '.js');

			// Store the model constructor
			if (modelModule[modelName]) {
				// Named export
				models[modelName as keyof MnemonicaModels] = modelModule[modelName];
				console.log(`[Topologica Bootstrap] Loaded model: ${modelName}`);
			} else if (modelModule.default) {
				// Default export
				models[modelName as keyof MnemonicaModels] = modelModule.default;
				console.log(`[Topologica Bootstrap] Loaded model (default): ${modelName}`);
			}
		} catch (error) {
			console.error(`[Topologica Bootstrap] Failed to load ${file}:`, error);
		}
	}

	isLoaded = true;
	return models;
}

/**
 * Get a specific model constructor
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getModel<K extends keyof MnemonicaModels> (name: K): any | undefined {
	return models[name];
}

/**
 * Check if models are loaded
 */
export function modelsLoaded (): boolean {
	return isLoaded;
}

/**
 * Clear loaded models (for testing/hot reload)
 */
export function clearModels (): void {
	for (const key of Object.keys(models)) {
		delete models[key as keyof MnemonicaModels];
	}
	isLoaded = false;
}
