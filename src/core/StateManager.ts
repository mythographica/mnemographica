'use strict';

export type AppState = {
	workspacePath: string | undefined;
	isLoading: boolean;
	lastError: string | undefined;
};

export class StateManager {
	private state: AppState;
	private listeners: Set<(state: AppState) => void> = new Set();

	constructor() {
		this.state = {
			workspacePath: undefined,
			isLoading: false,
			lastError: undefined
		};
	}

	getState(): AppState {
		return { ...this.state };
	}

	setWorkspacePath(path: string): void {
		this.state.workspacePath = path;
		this.notify();
	}

	setLoading(loading: boolean): void {
		this.state.isLoading = loading;
		this.notify();
	}

	setError(error: string | undefined): void {
		this.state.lastError = error;
		this.notify();
	}

	clearError(): void {
		this.state.lastError = undefined;
		this.notify();
	}

	subscribe(listener: (state: AppState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener(this.getState());
		}
	}
}
