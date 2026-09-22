'use strict';

import { createTypesCollection } from 'mnemonica';

/**
 * The extension's own two universes. Backend holds the data/load models
 * (Types, Trie, Usages, …), Frontend the 3D scene tree (Scene3D and
 * its subtypes). Models self-define via `Backend.define(...)` /
 * `Frontend.define(...)`; subtypes inherit the parent's collection.
 * The infrastructure roots — Main, Registry, LoggerTab — live in the
 * DEFAULT collection instead (free `define()`), so their lookups are
 * free `lookup()` too; the collection models go collection-scoped
 * (`Backend.lookup('Types')`).
 *
 * The registry interfaces are the Option-B typing hook: tactica emits
 * the per-collection aliases and augmentations for them, so collection
 * types keep generated typings instead of falling back to casts.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Option-B augmentation target: tactica's generated registry.ts merges the entries in
export interface BackendRegistry {}
export const Backend = createTypesCollection<BackendRegistry>();

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Option-B augmentation target: tactica's generated registry.ts merges the entries in
export interface FrontendRegistry {}
export const Frontend = createTypesCollection<FrontendRegistry>();
