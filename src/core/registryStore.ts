'use strict';

import * as fs from 'fs';
import { lookup } from 'mnemonica';
import type { Registry } from '../../.tactica/types';
import type { tacticaContractKind } from '../utils/letheValidation';
import { projectKey, tacticaDirOf } from '../utils/paths';

/**
 * One loaded Registry per project directory (the directory holding
 * .tactica). The read-once law: each contract file is read, parsed and
 * validated ONCE per load — the sidebar, the 3D panels, the navigation
 * providers and the commands all read from the store's loaded Registry,
 * never from disk. A collection switch or a graph rebuild reads nothing.
 *
 * `getProjectRegistry` loads on first access and caches (a concurrent
 * caller rides the same in-flight load). `reloadProjectRegistry` is the
 * single refresh entry — it reloads IN PLACE, so every holder of the
 * instance sees the fresh data. A project without a .tactica directory
 * resolves to undefined and is NOT cached (tactica may run later).
 */

const registries = new Map<string, Registry>();
const inFlight = new Map<string, Promise<Registry | undefined>>();
const reloadListeners: Array<(sourceRoot: string, origin?: string) => void> = [];

// The store keys on the project directory, normalized — the sidebar,
// panels and the Ctrl+Click provider must never create two entries for
// one project (projectKey everywhere below)

const loadProject = async function (sourceRoot: string): Promise<Registry | undefined> {
	if (!fs.existsSync(tacticaDirOf(sourceRoot))) {
		return undefined;
	}
	// lookup at call time — the models self-define at bootstrap, after
	// module loading (the graphDataLoader pattern)
	const RegistryType = lookup('Registry');
	const registry = new RegistryType();
	await registry.loadFromWorkspace(sourceRoot);
	registries.set(projectKey(sourceRoot), registry);
	return registry;
};

export const getProjectRegistry = function (sourceRoot: string): Promise<Registry | undefined> {
	const key = projectKey(sourceRoot);
	const cached = registries.get(key);
	if (cached) {
		const ready = Promise.resolve(cached);
		return ready;
	}
	const pending = inFlight.get(key);
	if (pending) {
		return pending;
	}
	const loading = loadProject(key).finally(() => {
		inFlight.delete(key);
	});
	inFlight.set(key, loading);
	return loading;
};

/** Sync peek for callers that run strictly after a load (no load triggered) */
export const peekProjectRegistry = function (sourceRoot: string): Registry | undefined {
	const registry = registries.get(projectKey(sourceRoot));
	return registry;
};

/**
 * The panel Refresh button / sidebar refresh: reload the project's entry
 * in place. Listeners fire AFTER the reload with the origin ('sidebar' /
 * 'panel') — the sidebar re-reads its trees only for reloads it did not
 * start itself.
 */
export const reloadProjectRegistry = async function (sourceRoot: string, origin?: string): Promise<Registry | undefined> {
	const key = projectKey(sourceRoot);
	const existing = registries.get(key);
	if (existing) {
		existing.clear();
		await existing.loadFromWorkspace(key);
	} else {
		await loadProject(key);
	}
	const registry = registries.get(key);
	for (const listener of reloadListeners) {
		listener(key, origin);
	}
	return registry;
};

export const onProjectRegistryReload = function (listener: (sourceRoot: string, origin?: string) => void): void {
	reloadListeners.push(listener);
};

/** The loaded file's freshness stamp (undefined when not loaded) */
export const getProjectGeneratedAt = function (sourceRoot: string, kind: tacticaContractKind): string | undefined {
	const registry = registries.get(projectKey(sourceRoot));
	const stamp = registry?.getGeneratedAt(kind);
	return stamp;
};

/** Test hook: drop every cached entry */
export const clearProjectRegistries = function (): void {
	registries.clear();
	inFlight.clear();
	reloadListeners.length = 0;
};
