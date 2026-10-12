'use strict';

import * as vscode from 'vscode';

/**
 * VS Code Navigation Adapter - thin wrapper around VS Code editor API
 *
 * This is the ONLY place in the codebase that directly uses vscode workspace/editor APIs.
 * All navigation goes through here.
 *
 * Locations are 1-based ("file:line:column", tactica's format) — the
 * conversion to 0-based happens here and ONLY here.
 */
export class VSCodeNavigation {
	/**
	 * Navigate to a specific file, line, and column
	 */
	static async goTo(filePath: string, line: number, column: number): Promise<void> {
		// Convert from 1-based to 0-based
		const zeroLine = line > 0 ? line - 1 : 0;
		const zeroColumn = column > 0 ? column - 1 : 0;

		const document = await vscode.workspace.openTextDocument(filePath);
		const editor = await vscode.window.showTextDocument(document);

		const position = new vscode.Position(zeroLine, zeroColumn);
		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(
			new vscode.Range(position, position),
			vscode.TextEditorRevealType.InCenter
		);
	}
}
