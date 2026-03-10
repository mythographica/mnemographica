'use strict';

import { define } from 'mnemonica';

export const Usages = define('Usages', function (this: { createdAt: number }) {
	this.createdAt = Date.now();
});

export const UsageEntry = Usages.define('UsageEntry', function (
	this: { id: string; typeName: string; filePath: string; line: number; column: number; context: string },
	data: { id: string; typeName: string; filePath: string; line: number; column: number; context: string }
) {
	this.id = data.id;
	this.typeName = data.typeName;
	this.filePath = data.filePath;
	this.line = data.line;
	this.column = data.column;
	this.context = data.context;
});

export default Usages;
