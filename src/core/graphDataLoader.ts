import { GraphBuilder } from './GraphBuilder';
import { getProjectRegistry } from './registryStore';
import type { GraphData } from '../types';

/**
 * Per-source graph data loader: every 3D panel builds its GraphData from
 * the registryStore's entry for ITS project root — the one loaded
 * Registry per project, shared with the sidebar. No file reads happen
 * here: the store loaded (and validated) the contract files once.
 *
 * `collection` selects the universe the payload renders (tactica keys
 * custom-collection types by a `collectionId::`-prefixed fullPath);
 * undefined lets the builder pick — default collection when present,
 * else the first-seen one.
 *
 * Returns null when the source has no .tactica — the caller keeps the
 * tab's last render instead of wiping it to an empty graph.
 */
export async function loadGraphDataFor (sourceRoot: string, collection?: string): Promise<GraphData | null> {
	const registry = await getProjectRegistry(sourceRoot);
	if (!registry) {
		const missing = null;
		return missing;
	}
	const graphData = GraphBuilder.buildFromRegistry(registry, collection);
	return graphData;
}
