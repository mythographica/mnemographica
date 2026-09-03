'use strict';

import { define } from 'mnemonica';
import { getLogger } from '../services/LoggerService';

// One entry of tactica's instrumentation.json (NestJS lifecycle
// crossroads, detected syntactically — see tactica AGENTS.md output
// contract). Unlike EDS/Flow, points are a FLAT list, not keyed by type.
export type rawInstrumentationPoint = {
	kind: string;
	className: string;
	location: string;
	code: string;
	scope: string;
	targets?: string[];
};

export type InstrumentationPointInstance = InstanceType<typeof InstrumentationPoint>;

export const Instrumentation = define('Instrumentation', class {
	createdAt: number;
	private points: InstrumentationPointInstance[] = [];
	private logger = getLogger();

	constructor () {
		this.createdAt = Date.now();
		this.logger.info(`[Instrumentation] : constructed at ${this.createdAt}`);
	}

	get size () {
		return this.points.length;
	}

	all (): InstrumentationPointInstance[] {
		return this.points;
	}

	set (points: InstrumentationPointInstance[]): void {
		this.points = points;
	}

	clear (): void {
		this.points = [];
	}
});

const setProps = (to: object, from: object) => {
	Object.defineProperties(to, Object.getOwnPropertyDescriptors(from));
};

export const InstrumentationPoint = Instrumentation.define('InstrumentationPoint', function (
	this: rawInstrumentationPoint,
	data: rawInstrumentationPoint
) {
	setProps(this, data);
});

export default Instrumentation;
