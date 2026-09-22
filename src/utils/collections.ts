'use strict';

// tactica keys custom-collection types by a `collectionId::`-prefixed
// fullPath ("collection_1::Product.Category"); default-collection types
// carry no prefix. The prefix always sits in the first dot-separated
// segment — tactica mints it on the root only, and nested paths inherit
// it from the parent's fullPath.

export const DEFAULT_COLLECTION = 'defaultTypes';

/**
 * The collection a dot-joined fullPath belongs to: the id tactica minted
 * ("collection_1") for a custom collection, 'defaultTypes' for the
 * unprefixed default graph. Same parse as tactica's own
 * (`indexOf('::')`, tactica's module-graph.ts), so both sides agree even
 * on a pathological type name containing a colon.
 */
export const collectionOfPath = function (fullPath: string): string {
	const sep = fullPath.indexOf('::');
	if (sep <= 0) {
		return DEFAULT_COLLECTION;
	}
	const id = fullPath.slice(0, sep);
	return id;
};
