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
