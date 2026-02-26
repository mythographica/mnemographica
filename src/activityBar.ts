import * as vscode from 'vscode';

export class MnemonicaActivityBarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'mnemonicaWelcome';

	// eslint-disable-next-line no-unused-private-class-members
	private _view?: vscode.WebviewView;

	constructor(private readonly _extensionUri: vscode.Uri) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;
		// Store reference for potential future use (e.g., posting messages)
		void this._view;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(message => {
			switch (message.command) {
			case 'showGraph':
				vscode.commands.executeCommand('mnemographica.showTypeGraph');
				return;
			}
		});
	}

	private _getHtmlForWebview(_webview: vscode.Webview) {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Mnemonica</title>
	<style>
		body {
			padding: 20px;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
		}
		.welcome-container {
			text-align: center;
		}
		.logo {
			font-size: 48px;
			margin-bottom: 10px;
		}
		h1 {
			font-size: 18px;
			margin-bottom: 20px;
		}
		.description {
			font-size: 13px;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 30px;
			line-height: 1.5;
		}
		.button {
			display: block;
			width: 100%;
			padding: 12px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 4px;
			font-size: 14px;
			cursor: pointer;
			text-align: center;
			margin-bottom: 10px;
		}
		.button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.icon {
			margin-right: 8px;
		}
	</style>
</head>
<body>
	<div class="welcome-container">
		<div class="logo">&#x1F332;</div>
		<h1>Mnemonica</h1>
		<p class="description">
			Visualize your instance inheritance hierarchy.<br>
			Show type graphs in 2D or 3D.
		</p>
		<button class="button" id="showGraphBtn">
			<span class="icon">&#x1F4CA;</span> Show Type Graph
		</button>
	</div>
	<script>
		const vscode = acquireVsCodeApi();
		document.getElementById('showGraphBtn').addEventListener('click', () => {
			vscode.postMessage({ command: 'showGraph' });
		});
	</script>
</body>
</html>`;
	}
}
