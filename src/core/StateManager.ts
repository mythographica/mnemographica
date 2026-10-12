'use strict';

export type AppState = {
	workspacePath: string | undefined;
	isLoading: boolean;
	lastError: string | undefined;
};

export class StateManager {
	private state: AppState = {
		workspacePath: undefined,
		isLoading: false,
		lastError: undefined
	};

	getState(): AppState {
		return { ...this.state };
	}

	setWorkspacePath(path: string): void {
		this.state.workspacePath = path;
	}

	setLoading(loading: boolean): void {
		this.state.isLoading = loading;
	}

	setError(error: string | undefined): void {
		this.state.lastError = error;
	}

	clearError(): void {
		this.state.lastError = undefined;
	}
}
