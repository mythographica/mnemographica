import * as fs from 'fs';
import * as path from 'path';
import { TypeNode, PropertyInfo } from '../types';

/**
 * Adapter for loading type graph from tactica output or source files
 */
export class TacticaAdapter {
	private cache: Map<string, TypeNode[]> = new Map();

	/**
	 * Load type graph from workspace
	 */
	async loadTypeGraph (workspacePath: string): Promise<TypeNode[]> {
		// Check cache
		if (this.cache.has(workspacePath)) {
			return this.cache.get(workspacePath)!;
		}

		// Try to read .tactica/types.ts first
		const tacticaPath = path.join(workspacePath, '.tactica', 'types.ts');
		if (fs.existsSync(tacticaPath)) {
			console.log('[Mnemonica] Found .tactica/types.ts, parsing...');
			const types = await this.parseTacticaOutput(tacticaPath);
			console.log('[Mnemonica] Parsed', types.length, 'types from tactica output');
			this.cache.set(workspacePath, types);
			return types;
		}

		// Fall back to analyzing source files directly
		console.log('[Mnemonica] No .tactica/types.ts found, analyzing source files...');
		const types = await this.analyzeSourceFiles(workspacePath);
		this.cache.set(workspacePath, types);
		return types;
	}

	/**
	 * Clear the cache
	 */
	clearCache (): void {
		this.cache.clear();
	}

	/**
	 * Parse tactica-generated types.ts file
	 */
	private async parseTacticaOutput (tacticaPath: string): Promise<TypeNode[]> {
		const content = fs.readFileSync(tacticaPath, 'utf-8');

		// First pass: collect all type names and their definitions
		const typeDefs = new Map<string, {
			name: string;
			parentName?: string;
			properties: Map<string, PropertyInfo>;
			line: number;
		}>();

		// Parse type definitions by finding export type declarations
		// and tracking curly braces to find the complete definition
		const lines = content.split('\n');
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];
			const match = line.match(/export\s+type\s+(\w+)\s*=/);

			if (match) {
				const typeName = match[1];
				const startLine = i;
	
				// Collect lines until we close the outermost braces
				// Type definitions look like: export type Name = { ... }
				// We start counting braces after '=', stop when braceDepth returns to 0
				let typeDef = '';
				let braceDepth = 0;
				let foundEnd = false;
				let foundEquals = false;
				let enteredBraces = false;
	
				while (i < lines.length && !foundEnd) {
					const currentLine = lines[i];
					typeDef += currentLine + '\n';
	
					// Only start counting braces after we see '=' on first line
					let startIdx = 0;
					if (!foundEquals && i === startLine) {
						const equalsIdx = currentLine.indexOf('=');
						if (equalsIdx !== -1) {
							foundEquals = true;
							startIdx = equalsIdx + 1;
						}
					}
	
					if (foundEquals) {
						for (let idx = startIdx; idx < currentLine.length; idx++) {
							const char = currentLine[idx];
							if (char === '{') {
								braceDepth++;
								enteredBraces = true;
							}
							else if (char === '}') {
								braceDepth--;
								// When we close the outermost braces, we're done
								if (enteredBraces && braceDepth === 0) {
									foundEnd = true;
									break;
								}
							}
						}
					}
					i++;
				}
	
				// Remove 'export type Name = ' prefix and trailing semicolon/newlines
				let cleanDef = typeDef.replace(/export\s+type\s+\w+\s*=\s*/, '').trim();
				if (cleanDef.endsWith(';')) {
					cleanDef = cleanDef.slice(0, -1).trim();
				}

				// Check for inheritance: Type = ParentType & { ... }
				let parentName: string | undefined;
				const extendsMatch = cleanDef.match(/^(\w+)\s*&/);
				if (extendsMatch) {
					parentName = extendsMatch[1];
				}

				// Parse properties from the full definition
				const properties = this.parseProperties(cleanDef);

				// Find TypeConstructor properties (subtypes)
				const subtypeRegex = /(\w+):\s*TypeConstructor<(\w+)>/g;
				let subtypeMatch;
				while ((subtypeMatch = subtypeRegex.exec(cleanDef)) !== null) {
					const subtypeName = subtypeMatch[1];
					properties.set(subtypeName, {
						name: subtypeName,
						type: `TypeConstructor<${subtypeMatch[2]}>`,
						optional: false
					});
				}

				typeDefs.set(typeName, {
					name: typeName,
					parentName,
					properties,
					line: startLine + 1 // 1-based line number
				});
			} else {
				i++;
			}
		}

		// Second pass: build TypeNode hierarchy
		const typeMap = new Map<string, TypeNode>();
		const rootTypes: TypeNode[] = [];

		// Create all nodes first
		for (const [name, def] of typeDefs) {
			const node: TypeNode = {
				name: name,
				fullPath: name,
				properties: def.properties,
				children: new Map(),
				sourceFile: tacticaPath,
				line: def.line,
				column: 0
			};
			typeMap.set(name, node);
		}

		// Link parents and children
		for (const [name, def] of typeDefs) {
			const node = typeMap.get(name)!;

			if (def.parentName && typeMap.has(def.parentName)) {
				// This type extends another
				const parent = typeMap.get(def.parentName)!;
				node.parent = parent;
				parent.children.set(name, node);
				node.fullPath = parent.fullPath + '.' + name;
			} else if (name.endsWith('Instance')) {
				// Root type (ends with Instance, no parent)
				rootTypes.push(node);
			}
		}

		console.log('[Mnemonica] Found', rootTypes.length, 'root types');
		return rootTypes;
	}

	/**
	 * Parse properties from type definition string
	 */
	private parseProperties (typeDef: string): Map<string, PropertyInfo> {
		const properties = new Map<string, PropertyInfo>();

		// Find the first { and extract content using brace counting
		const braceStart = typeDef.indexOf('{');
		if (braceStart === -1) {
			return properties;
		}

		// Extract content between outermost braces
		let braceDepth = 0;
		const contentStart = braceStart + 1;
		let contentEnd = -1;

		for (let i = braceStart; i < typeDef.length; i++) {
			if (typeDef[i] === '{') braceDepth++;
			else if (typeDef[i] === '}') {
				braceDepth--;
				if (braceDepth === 0) {
					contentEnd = i;
					break;
				}
			}
		}

		if (contentEnd === -1) {
			return properties;
		}

		const propsContent = typeDef.substring(contentStart, contentEnd);

		// Parse each property line
		const propLines = propsContent.split('\n');
		for (const line of propLines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('//')) continue;

			// Skip TypeConstructor properties (handled separately)
			if (trimmed.includes('TypeConstructor')) continue;

			// Parse property: name?: type or name: type
			const propMatch = trimmed.match(/^(\w+)(\?)?:\s*(.+?);?$/);
			if (propMatch) {
				const propName = propMatch[1];
				const optional = propMatch[2] === '?';
				const propType = propMatch[3].trim();

				properties.set(propName, {
					name: propName,
					type: propType,
					optional
				});
			}
		}

		return properties;
	}

	/**
	 * Analyze source files directly when tactica output is not available
	 */
	private async analyzeSourceFiles (workspacePath: string): Promise<TypeNode[]> {
		const types: TypeNode[] = [];

		// Look for source files with define() calls
		const srcPath = path.join(workspacePath, 'src');
		if (fs.existsSync(srcPath)) {
			await this.scanDirectory(srcPath, types);
		}

		return types;
	}

	/**
	 * Recursively scan directory for TypeScript files
	 */
	private async scanDirectory (dirPath: string, types: TypeNode[]): Promise<void> {
		const entries = fs.readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isDirectory()) {
				await this.scanDirectory(fullPath, types);
			} else if (entry.isFile() && entry.name.endsWith('.ts')) {
				await this.parseSourceFile(fullPath, types);
			}
		}
	}

	/**
	 * Parse a source file for define() calls
	 */
	private async parseSourceFile (filePath: string, types: TypeNode[]): Promise<void> {
		const content = fs.readFileSync(filePath, 'utf-8');

		// Look for define() calls - pattern: define('TypeName', ...
		const defineRegex = /define\s*\(\s*['"]([^'"]+)['"]/g;
		let match;

		while ((match = defineRegex.exec(content)) !== null) {
			const typeName = match[1];

			// Create type node
			const typeNode: TypeNode = {
				name: typeName,
				fullPath: typeName,
				properties: new Map<string, PropertyInfo>(),
				children: new Map<string, TypeNode>(),
				sourceFile: filePath,
				line: this.getLineNumber(content, match.index),
				column: 0
			};

			types.push(typeNode);
		}
	}

	/**
	 * Get line number from character index
	 */
	private getLineNumber (content: string, index: number): number {
		const lines = content.substring(0, index).split('\n');
		return lines.length;
	}
}