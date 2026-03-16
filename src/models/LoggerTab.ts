'use strict';

import { define } from 'mnemonica';

// LogEntry data structure matching .tactica/types.ts
export type LogEntryData = {
	level: 'info' | 'warning' | 'error';
	message: string;
	timestamp: number;
	typeName?: string;
	error?: Error;
	args?: Array<unknown>;
};

// LoggerTab - Root type for log data
export const LoggerTab = define('LoggerTab', class {
	createdAt: number;
	constructor() {
		this.createdAt = Date.now();
	}
});

// LogEntry - Individual log entry type (defined AFTER LoggerTab)
export const LogEntry = LoggerTab.define('LogEntry', function (this: LogEntryData, data: LogEntryData) {
	Object.assign(this, data);
});

// Type alias for LogEntry instances (must be after LogEntry definition)
export type LogEntry = InstanceType<typeof LogEntry>;

export default LoggerTab;
