'use strict';

import * as fs from 'fs';
import * as path from 'path';

/** The canonical key for a project directory — the store, the panels and
 *  the navigation providers must never key one project two ways */
export const projectKey = function (sourceRoot: string): string {
	return path.resolve(sourceRoot);
};

/** The .tactica directory of a project root */
export const tacticaDirOf = function (projectRoot: string): string {
	return path.join(projectRoot, '.tactica');
};

/** A contract file event is <projectRoot>/.tactica/<kind>.json — the
 *  project root is two levels up */
export const projectRootOfContractFile = function (fsPath: string): string {
	return path.dirname(path.dirname(fsPath));
};

/**
 * The nearest .tactica directory above a source file (the Ctrl+Click
 * provider's file → project resolution). Walking covers files outside any
 * workspace folder; vscode.workspace.getWorkspaceFolder cannot.
 */
export const tacticaRootOfFile = function (startPath: string): string | undefined {
	let currentDir = path.dirname(startPath);
	const root = path.parse(currentDir).root;
	while (currentDir !== root) {
		const tacticaPath = tacticaDirOf(currentDir);
		if (fs.existsSync(tacticaPath) && fs.statSync(tacticaPath).isDirectory()) {
			return tacticaPath;
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}
	return undefined;
};

/**
 * One parsed tactica location ("file:line:column", 1-based — the Location
 * Convention in AGENTS.md). The greedy prefix keeps paths containing ':'
 * intact. undefined when the string is not a location.
 */
export const parseTacticaLocation = function (location: string | undefined): { fileName: string; line: number; column: number } | undefined {
	if (!location) { return undefined; }
	const match = location.match(/^(.+):(\d+):(\d+)$/);
	if (!match) { return undefined; }
	return {
		fileName : match[1],
		line     : parseInt(match[2], 10),
		column   : parseInt(match[3], 10)
	};
};

/** "basename:line" for tree rows; the input back when it is not a location */
export const shortLocation = function (location: string): string {
	const parsed = parseTacticaLocation(location);
	if (!parsed) { return location; }
	return `${path.basename(parsed.fileName) || parsed.fileName}:${parsed.line}`;
};

// tactica emits project-relative paths (portable .tactica output);
// older payloads carry absolute ones. A string counts as a path only
// when the WHOLE value looks like one: optional dir segments, a
// source-file extension, optional :line:col suffix. Type fullPaths
// ("UserType.AdminType"), enums, ISO timestamps and code snippets
// never match, so deep-walking parsed payloads is safe.
const PATH_LIKE = /^((?:(?:\.{1,2})?[\w@~.-]*\/)*[\w@~.-]*\.(?:d\.ts|[jt]sx?|m[jt]s|c[jt]s|json))(:\d+:\d+)?$/i;

/**
 * Deep-walk a parsed .tactica payload (values AND object keys) and
 * resolve every relative path string against baseDir — the directory
 * that holds .tactica — so all downstream consumers keep seeing
 * absolute paths. Absolute strings pass through unchanged.
 */
export const resolveWorkspacePaths = function <T>(payload: T, baseDir: string): T {
	const walk = (input: unknown): unknown => {
		if (typeof input === 'string') {
			if (path.isAbsolute(input)) {
				return input;
			}
			const match = PATH_LIKE.exec(input);
			if (!match) {
				return input;
			}
			const resolved = path.resolve(baseDir, match[1]) + (match[2] ?? '');
			return resolved;
		}
		if (Array.isArray(input)) {
			const mapped = input.map(walk);
			return mapped;
		}
		if (input !== null && typeof input === 'object') {
			const result: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(input)) {
				const walkedKey = walk(key) as string;
				result[walkedKey] = walk(value);
			}
			return result;
		}
		return input;
	};
	const result = walk(payload);
	return result as T;
};
