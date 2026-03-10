/**
 * Local type definitions mirroring @mnemonica/tactica
 * These are copied here to avoid requiring tactica as a dependency during development
 */

/**
 * Information about a property in a type
 */
export type PropertyInfo = {
	name: string;
	type: string;
	optional: boolean;
};

/**
 * A node in the type hierarchy graph
 */
export type TypeNode = {
	/** Type name (e.g., "SecondType") */
	name: string;
	/** Full path (e.g., "FirstType.SecondType") */
	fullPath: string;
	/** Properties defined in this type's constructor */
	properties: Map<string, PropertyInfo>;
	/** Parent type node */
	parent?: TypeNode;
	/** Child types */
	children: Map<string, TypeNode>;
	/** Source file path */
	sourceFile: string;
	/** Line number in source */
	line: number;
	/** Column number in source */
	column: number;
	/** Constructor function name or class name */
	constructorName?: string;
};

/**
 * Type for type graph operations
 */
export type TypeGraph = {
	/** Root types (defined at module level) */
	roots: Map<string, TypeNode>;
	/** All types by full path */
	allTypes: Map<string, TypeNode>;
	/** Add a root type */
	addRoot(node: TypeNode): void;
	/** Find a type by full path */
	findType(fullPath: string): TypeNode | undefined;
	/** Get all types as array */
	getAllTypes(): TypeNode[];
	/** Clear the graph */
	clear(): void;
};

/**
 * Result of analyzing source files
 */
export type AnalyzeResult = {
	/** Types found in the analysis */
	types: TypeNode[];
	/** Errors encountered */
	errors: AnalyzeError[];
};

/**
 * Error during analysis
 */
export type AnalyzeError = {
	message: string;
	file: string;
	line: number;
	column: number;
};

/**
 * Generated types output
 */
export type GeneratedTypes = {
	/** Content of the .d.ts file */
	content: string;
	/** Types that were generated */
	types: string[];
};
