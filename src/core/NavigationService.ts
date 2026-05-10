'use strict';

/**
 * Navigation descriptor - pure data, no VS Code dependencies
 */
export type NavigationTarget = {
	filePath: string;
	line: number;
	column: number;
};

/**
 * Pure navigation service - converts between 1-based and 0-based coordinates
 */
export class NavigationService {
	/**
	 * Convert 1-based coordinates (from tactica JSON) to 0-based (for editors)
	 */
	static toZeroBased(line: number, column: number): { line: number; column: number } {
		return {
			line: line > 0 ? line - 1 : 0,
			column: column > 0 ? column - 1 : 0
		};
	}

	/**
	 * Create a navigation target from raw data
	 */
	static createTarget(filePath: string, line: number, column: number): NavigationTarget {
		return { filePath, line, column };
	}

	/**
	 * Parse a location string like "file.ts:10:5" into a navigation target
	 */
	static parseLocation(location: string): NavigationTarget | undefined {
		const match = location.match(/^(.+):(\d+):(\d+)$/);
		if (!match) {
			return undefined;
		}
		return {
			filePath: match[1],
			line: parseInt(match[2], 10),
			column: parseInt(match[3], 10)
		};
	}
}
