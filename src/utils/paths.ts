'use strict';

import * as path from 'path';

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
