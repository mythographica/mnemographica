/**
 * Type definitions for Mnemonica Graphica extension
 */

// Local tactica type definitions
export type {
	TypeNode,
	PropertyInfo,
	TypeGraph,
	AnalyzeResult,
	AnalyzeError,
	GeneratedTypes
} from './tactica-types';

/**
 * D3-compatible node format for visualization
 */
export interface D3Node {
	/** Unique identifier (fullPath from TypeNode) */
	id: string;
	/** Display name */
	name: string;
	/** Depth in hierarchy */
	depth: number;
	/** Whether this is a root type (no parent) */
	isRoot: boolean;
	/** Properties as array for D3 */
	properties: Array<{ name: string; type: string; optional?: boolean }>;
	/** Source location for go-to-definition */
	location?: {
		fileName: string;
		line: number;
		column: number;
	};
	/** X position (set by D3 simulation) */
	x?: number;
	/** Y position (set by D3 simulation) */
	y?: number;
	/** Fixed X position (when dragging) */
	fx?: number | null;
	/** Fixed Y position (when dragging) */
	fy?: number | null;
}

/**
 * D3-compatible link format
 */
export interface D3Link {
	/** Source node ID or reference */
	source: string | D3Node;
	/** Target node ID or reference */
	target: string | D3Node;
}

/**
 * Complete graph data for D3
 */
export interface GraphData {
	/** Array of nodes */
	nodes: D3Node[];
	/** Array of links */
	links: D3Link[];
}

/**
 * Messages passed between webview and extension
 */
export interface WebviewMessage {
	/** Command type */
	command: 'goToDefinition' | 'nodeHover' | 'ready' | 'refresh';
	/** Optional payload */
	data?: unknown;
}

/**
 * Extension configuration from settings
 */
export interface ExtensionConfiguration {
	/** Graph layout algorithm */
	layout: 'force' | 'tree' | 'cluster';
	/** How to size nodes */
	nodeSize: 'propertyCount' | 'uniform';
	/** Show properties on hover */
	showProperties: boolean;
	/** Auto-refresh on file changes */
	autoRefresh: boolean;
}