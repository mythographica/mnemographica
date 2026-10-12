'use strict';

import * as fs from 'fs';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';
import { getLogger } from '../services/LoggerService';

// The seven .tactica files of the lethe contract — the ONLY .tactica
// files mnemographica reads. types.ts / registry.ts / modules.json /
// scopes.json / instrumentation.json are generator-internal and never
// read here.
export type tacticaContractKind =
	| 'hierarchy'
	| 'definitions'
	| 'collections'
	| 'usages'
	| 'flow'
	| 'eds'
	| 'control';

// Compiled lazily, once per kind. The schemas ship inside @mnemonica/lethe
// (tactica/*.schema.json); the package root resolves through its
// package.json, which npm always packs.
const validators = new Map<tacticaContractKind, ValidateFunction>();

const getValidator = function (kind: tacticaContractKind): ValidateFunction {
	const cached = validators.get(kind);
	if (cached) {
		return cached;
	}
	const letheRoot = path.dirname(require.resolve('@mnemonica/lethe/package.json'));
	const schemaPath = path.join(letheRoot, 'tactica', `${kind}.schema.json`);
	const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
	const ajv = new Ajv2020({ allErrors : true, strict : true });
	const validator = ajv.compile(schema);
	validators.set(kind, validator);
	return validator;
};

/**
 * Validate one parsed .tactica payload against its lethe schema. An invalid
 * file is a logged warning naming the file and the first errors — the
 * caller leaves the corresponding model empty and moves on; validation
 * never throws.
 */
export const validateTacticaFile = function (
	kind: tacticaContractKind,
	filePath: string,
	data: unknown
): boolean {
	const logger = getLogger();
	let validator: ValidateFunction;
	try {
		validator = getValidator(kind);
	} catch (error) {
		logger.warn(`[lethe] : cannot validate ${filePath} — schema unavailable (${(error as Error).message})`);
		return false;
	}
	const valid = validator(data);
	if (valid) {
		return true;
	}
	const errors = (validator.errors ?? [])
		.slice(0, 3)
		.map((e) => `${e.instancePath || '/'} ${e.message}`)
		.join('; ');
	logger.warn(`[lethe] : ${filePath} failed the ${kind} schema — skipping (${errors})`);
	return false;
};
