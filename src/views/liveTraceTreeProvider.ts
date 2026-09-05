'use strict';

import * as vscode from 'vscode';
import type { MainOrchestrator, traceEdge } from '../core/MainOrchestrator';

/**
 * Live Trace view (2026-09-01, replaces the Welcome placeholder).
 *
 * The 3D panel's flashes move at machine speed — unobservable for a
 * human. This sidebar collects the stream: traces from the
 * orchestrator's ring, merged by root name AND trace shape
 * (2026-09-05, Viktor's review — a name alone collides distinct
 * traces sharing a root; the shape signature is the sorted set of
 * kind:name edge identities, loop ×N repeats folded out) — one
 * `[2][×49] UserEntity` row per name+shape, discriminated by the
 * trace's endpoint (`→ UserResponse`) when several shapes share a
 * name, expanding to the individual traces (exact-pick while they're in
 * the ring), each expanding to its edges in order. Clicking an edge
 * jumps to its code (callsite for call/method edges, the define()
 * site for create edges); clicking a trace row isolates it in the
 * 3D panel (trace mode, same as clicking a flashing sphere). Sort
 * is tiered: UNKNOWN ERROR (errored trace with no instance to pin
 * to) > ERROR > healthy, newest-first inside a tier. Traces that
 * aged out of the ring are Jaeger's job — the ring is "now".
 */

type traceGroup = {
	rootId: number;
	name: string;
	count: number;
	latest: number;
	edges: traceEdge[];
	hasError: boolean;
	unknownError: boolean;
};

const CALLSITE_RE = /^(.*):(\d+):(\d+)$/;

// Max individual trace rows shown inside one merged group row
const MAX_GROUP_ROWS = 100;

export class LiveTraceTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState
	) {
		super(label, collapsibleState);
	}
}

export class LiveTraceTreeProvider implements vscode.TreeDataProvider<LiveTraceTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<LiveTraceTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private static instance: LiveTraceTreeProvider | null = null;
	private static refreshTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly orchestrator: MainOrchestrator) {
		LiveTraceTreeProvider.instance = this;
	}

	/**
	 * Called from the strategy server's trace/ingest handler (same
	 * pattern as GraphPanel.pushTraceEdges). Throttled: at stream rates
	 * a tree refresh per batch would flood the UI thread.
	 */
	static noteIngest(): void {
		if (!LiveTraceTreeProvider.instance || LiveTraceTreeProvider.refreshTimer) {
			return;
		}
		LiveTraceTreeProvider.refreshTimer = setTimeout(() => {
			LiveTraceTreeProvider.refreshTimer = null;
			LiveTraceTreeProvider.instance?.refresh();
		}, 500);
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: LiveTraceTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: LiveTraceTreeItem): LiveTraceTreeItem[] {
		if (element) {
			const edges = (element as LiveTraceTreeItem & { traceEdges?: traceEdge[] }).traceEdges;
			const members = (element as LiveTraceTreeItem & { traceMembers?: traceGroup[] }).traceMembers;
			if (!edges && members) {
				// Group row → the individual traces (exact-pick while
				// they live in the ring). Cap the fan-out: under load a
				// group can hold hundreds — the overflow is Jaeger's.
				const shown = members.slice(0, MAX_GROUP_ROWS);
				const rows = shown.map(member => this.traceItem(member, true));
				const hidden = members.length - shown.length;
				if (hidden > 0) {
					const more = new LiveTraceTreeItem(
						`… ${hidden} more — search Jaeger for the full history`,
						vscode.TreeItemCollapsibleState.None
					);
					more.iconPath = new vscode.ThemeIcon('info');
					rows.push(more);
				}
				return rows;
			}
			if (!edges) { return []; }
			// Merge identical rows: one trace can invoke the same wrapped
			// callsite N times (dive parents each new call onto the
			// previous still-running one, so a request loop chains them).
			// N identical lines are noise; one line ×N is information.
			// The LATEST edge of each run keeps the code jump; an error
			// anywhere in the run marks the merged row.
			const merged: Array<{ edge: traceEdge; count: number; hasError: boolean }> = [];
			const indexByKey = new Map<string, number>();
			for (const edge of edges) {
				const key = `${edge.kind}:${edge.name}`;
				const at = indexByKey.get(key);
				if (at === undefined) {
					indexByKey.set(key, merged.length);
					merged.push({ edge, count: 1, hasError: edge.status === 'error' });
				} else {
					merged[at].count++;
					merged[at].edge = edge;
					if (edge.status === 'error') { merged[at].hasError = true; }
				}
			}
			const items = merged.map(entry => this.edgeItem(entry.edge, entry.count, entry.hasError));
			return items;
		}
		// Fetch the WHOLE window (not the default 50) so the ×N is the true
		// count of matching traces in the ring, not a slice artifact.
		const groups = this.orchestrator.getTraceGroups(MAX_GROUP_ROWS * 10, 1000);
		// Merge by root name AND trace shape (2026-09-05, Viktor's review —
		// replaces the pure name merge of 2026-09-02): a name alone
		// collides DIFFERENT traces that merely share a root — a trace
		// ending at one wrap site is not the same trace as one ending at
		// another ("UserEntity → UserResponse" is another trace). The
		// signature is the sorted set of the trace's kind:name edge
		// identities (the name carries the callsite for call/method edges —
		// which wrap site fired); multiplicity folds out, so a request
		// loop's ×N repeats stay in one group. The flat list arrives
		// tier-sorted (unknown > error > newest), so members keep that
		// order inside their group and the group row inherits the tier of
		// its worst member.
		const signatureOf = (group: traceGroup): string => {
			const parts = group.edges.map(edge => `${edge.kind}:${edge.name}`);
			const result = Array.from(new Set(parts)).sort().join('|');
			return result;
		};
		// djb2 — group row ids must not collide when two shapes share a name
		const hashOf = (text: string): string => {
			let hash = 5381;
			for (let i = 0; i < text.length; i++) {
				hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
			}
			const result = hash.toString(36);
			return result;
		};
		const byShape = new Map<string, traceGroup[]>();
		for (const group of groups) {
			const key = `${group.name}\n${signatureOf(group)}`;
			const bucket = byShape.get(key);
			if (bucket) {
				bucket.push(group);
			} else {
				byShape.set(key, [group]);
			}
		}
		const shapeGroups = Array.from(byShape.values());
		// When several shapes share one root name the rows must be told
		// apart — append where the trace ENDS (its chronologically last
		// edge: "… → UserResponse")
		const nameCounts = new Map<string, number>();
		for (const members of shapeGroups) {
			nameCounts.set(members[0].name, (nameCounts.get(members[0].name) || 0) + 1);
		}
		const endpointOf = (members: traceGroup[]): string | undefined => {
			if ((nameCounts.get(members[0].name) || 0) < 2) { return undefined; }
			const last = members[0].edges[members[0].edges.length - 1];
			if (!last) { return undefined; }
			const result = this.shortName(last);
			return result;
		};
		const tierOf = (members: traceGroup[]): number => {
			const tier = members.some(member => member.unknownError) ? 0 : members.some(member => member.hasError) ? 1 : 2;
			return tier;
		};
		const latestOf = (members: traceGroup[]): number => {
			const latest = members.reduce((acc, member) => Math.max(acc, member.latest), 0);
			return latest;
		};
		shapeGroups.sort((a, b) => {
			const tier = tierOf(a) - tierOf(b);
			const result = tier !== 0 ? tier : latestOf(b) - latestOf(a);
			return result;
		});
		const items: LiveTraceTreeItem[] = [];
		for (const members of shapeGroups) {
			const endpoint = endpointOf(members);
			const groupHash = hashOf(`${members[0].name}\n${signatureOf(members[0])}`);
			if (members.length === 1) {
				// Single trace — no pointless nesting, the row IS the trace
				items.push(this.traceItem(members[0], false, endpoint));
			} else {
				items.push(this.groupItem(members, endpoint, groupHash));
			}
		}
		return items;
	}

	private groupItem(members: traceGroup[], endpoint?: string, groupHash?: string): LiveTraceTreeItem {
		const name = members[0].name;
		const hasUnknown = members.some(member => member.unknownError);
		const hasError = hasUnknown || members.some(member => member.hasError);
		const latest = members.reduce((acc, member) => Math.max(acc, member.latest), 0);
		// Same-name shapes are told apart by where the trace ENDS
		const label = `[${members[0].count}][×${members.length}] ${name}${endpoint ? ` → ${endpoint}` : ''}`;
		const item = new LiveTraceTreeItem(
			label,
			vscode.TreeItemCollapsibleState.Collapsed
		);
		item.id = `tracegroup-${name}-${groupHash || ''}`;
		const age = this.ageLabel(latest);
		item.description = hasUnknown ? `${age} — UNKNOWN ERROR` : hasError ? `${age} — ERROR` : age;
		const errorNote = hasUnknown ? ', has UNKNOWN ERRORS (no mnemonica instance in trace)' : hasError ? ', has errors' : '';
		const shapeNote = endpoint ? ` — one of several distinct traces rooted at ${name}` : '';
		item.tooltip = `${members.length} traces in the current window (last 1000 edges)${errorNote}${shapeNote} — expand to pick one; older ones live in Jaeger`;
		item.iconPath = hasUnknown
			? new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'))
			: hasError
				? new vscode.ThemeIcon('pulse', new vscode.ThemeColor('errorForeground'))
				: new vscode.ThemeIcon('pulse');
		item.contextValue = 'mnemTraceGroup';
		(item as LiveTraceTreeItem & { traceMembers?: traceGroup[] }).traceMembers = members;
		return item;
	}

	private traceItem(group: traceGroup, asChild = false, endpoint?: string): LiveTraceTreeItem {
		// Error tiers ride the group's own flags (getTraceGroups sorts
		// unknown errors above known ones above healthy, 2026-09-02)
		const hasError = group.hasError;
		const unknownError = group.unknownError;
		// The trace's Jaeger id rides any edge that became an OTEL span —
		// take the latest one that has it
		const withTrace = group.edges.filter(edge => typeof edge.traceId === 'string' && edge.traceId.length > 0);
		const traceId = withTrace.length > 0 ? withTrace[withTrace.length - 1].traceId! : null;
		// Children of a merged group row don't repeat the name — the
		// parent carries it; the rootId is what makes the row exact.
		// A top-level row appends the endpoint when its root name is
		// shared by another shape
		const label = asChild ? `[${group.count}] #${group.rootId}` : `[${group.count}] ${group.name}${endpoint ? ` → ${endpoint}` : ''}`;
		const item = new LiveTraceTreeItem(
			label,
			vscode.TreeItemCollapsibleState.Collapsed
		);
		item.id = `trace-${group.rootId}`;
		const age = this.ageLabel(group.latest);
		item.description = unknownError ? `${age} — UNKNOWN ERROR` : hasError ? `${age} — ERROR` : age;
		const errorNote = unknownError ? ', UNKNOWN ERROR (no mnemonica instance in trace)' : hasError ? ', HAS ERRORS' : '';
		item.tooltip = `${group.count} edges, root #${group.rootId}${errorNote} — click to isolate in the 3D panel${traceId ? `, Jaeger trace ${traceId}` : ''}`;
		// Errored traces go red in the tree; healthy ones keep the calm pulse
		item.iconPath = unknownError
			? new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'))
			: hasError
				? new vscode.ThemeIcon('pulse', new vscode.ThemeColor('errorForeground'))
				: new vscode.ThemeIcon('pulse');
		// Context menu: replay on every trace row, the Jaeger jump only
		// when an OTEL traceId is known (Wanted #2)
		item.contextValue = traceId ? 'mnemTraceJaeger' : 'mnemTrace';
		item.command = {
			command   : 'mnemographica.showTrace',
			title     : 'Isolate in 3D panel',
			// The rootId isolates THIS exact trace — resolving by name
			// alone could bind to a different trace ending on the same type
			arguments : [{ name: group.name, rootId: group.rootId }]
		};
		(item as LiveTraceTreeItem & { traceEdges?: traceEdge[] }).traceEdges = group.edges;
		(item as LiveTraceTreeItem & { traceData?: unknown }).traceData = { name: group.name, rootId: group.rootId, traceId };
		return item;
	}

	private edgeItem(edge: traceEdge, count = 1, hasError = false): LiveTraceTreeItem {
		const shortName = this.shortName(edge);
		const merged = count > 1 ? ` ×${count}` : '';
		const item = new LiveTraceTreeItem(
			`${edge.kind}: ${shortName}${merged}`,
			vscode.TreeItemCollapsibleState.None
		);
		item.id = `trace-edge-${edge.id}`;
		item.description = edge.duration !== null ? `${edge.duration}ms` : edge.status;
		// Ambient attribution (dive's lastContext fallback): possibly a
		// foreign flow's instance — show the doubt instead of hiding it
		const ambient = edge.instanceSource === 'ambient';
		item.tooltip = `#${edge.id} ${edge.kind}:${edge.name} (${edge.status})${count > 1 ? ` — ${count} invocations merged` : ''}${ambient ? ' — AMBIENT attribution, may belong to a different flow' : ''}`;
		const errored = hasError || edge.status === 'error';
		item.iconPath = errored
			? new vscode.ThemeIcon(this.iconForKind(edge.kind), new vscode.ThemeColor('errorForeground'))
			: ambient
				? new vscode.ThemeIcon('question')
				: new vscode.ThemeIcon(this.iconForKind(edge.kind));
		const location = this.locationFor(edge);
		if (location) {
			item.command = {
				command   : 'mnemographica.gotoTraceEdge',
				title     : 'Go to code',
				arguments : [location]
			};
		}
		return item;
	}

	private shortName(edge: traceEdge): string {
		// call/method edges carry the callsite as name — show its tail
		const match = CALLSITE_RE.exec(edge.name);
		if (match) {
			const tail = match[1].split('/').slice(-2).join('/');
			const result = `${tail}:${match[2]}`;
			return result;
		}
		return edge.instanceType || edge.name;
	}

	private locationFor(edge: traceEdge): { filePath: string; line: number; column: number } | null {
		const match = CALLSITE_RE.exec(edge.name);
		if (match) {
			const result = {
				filePath : match[1],
				line     : parseInt(match[2], 10),
				column   : parseInt(match[3], 10)
			};
			return result;
		}
		// create edges: jump to the type's define() site via the graph
		const typeName = edge.instanceType;
		if (typeName) {
			const graphData = this.orchestrator.getGraphData();
			const node = graphData?.nodes.find(n => n.name === typeName);
			if (node?.location) {
				const result = {
					filePath : node.location.fileName,
					line     : node.location.line,
					column   : node.location.column
				};
				return result;
			}
		}
		return null;
	}

	private iconForKind(kind: string): string {
		switch (kind) {
			case 'create': return 'symbol-class';
			case 'call': return 'symbol-method';
			case 'method': return 'symbol-method';
			case 'recontext': return 'arrow-swap';
			default: return 'circle-outline';
		}
	}

	private ageLabel(ts: number): string {
		const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
		if (seconds < 60) { return `${seconds}s ago`; }
		const minutes = Math.round(seconds / 60);
		return `${minutes}m ago`;
	}
}
