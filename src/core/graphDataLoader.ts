import * as fs from 'fs';
import * as path from 'path';
import { lookup } from 'mnemonica';
import type { Registry } from '../../.tactica/types';
import { GraphBuilder } from './GraphBuilder';
import type { GraphData } from '../types';

/**
 * Per-source graph data loader (2026-09-12 multi-panel refactor, owner
 * item 8): every 3D panel owns its data pipeline — a fresh Registry
 * filled from ITS project root's .tactica, built into GraphData. The
 * MainOrchestrator keeps the workspace-PRIMARY Registry for the sidebar
 * trees; panels never read it, so a refresh of one project can never
 * clobber another project's tab.
 *
 * Returns null when the source has no .tactica — the caller keeps the
 * tab's last render instead of wiping it to an empty graph.
 */
export async function loadGraphDataFor (sourceRoot: string): Promise<GraphData | null> {
	const tacticaPath = path.join(sourceRoot, '.tactica');
	if (!fs.existsSync(tacticaPath)) {
		const missing = null;
		return missing;
	}
	const RegistryType = lookup('Registry');
	const registry = new RegistryType() as Registry;
	await registry.loadFromWorkspace(sourceRoot);
	const graphData = GraphBuilder.buildFromRegistry(registry);
	return graphData;
}
