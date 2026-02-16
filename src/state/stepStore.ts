// file: src/state/stepStore.ts

import * as vscode from 'vscode';

/**
 * Diff information for a code change
 */
export interface DiffInfo {
    original: string;
    modified: string;
}

/**
 * Step representing a single AI action
 */
export interface Step {
    id: string;
    timestamp: Date;
    filePath: string;
    diff: DiffInfo;
    model: string;
    status: 'accepted' | 'rejected' | 'pending';
    description?: string;
}

/**
 * In-memory store for step history
 * Maintains chronological list of AI actions with event notifications
 */
export class StepStore {
    private steps: Step[] = [];
    private readonly _onDidChangeSteps = new vscode.EventEmitter<void>();
    readonly onDidChangeSteps = this._onDidChangeSteps.event;

    /**
     * Add a new step to history
     */
    addStep(step: Step): void {
        this.steps.push(step);
        this._onDidChangeSteps.fire();
    }

    /**
     * Get all steps in chronological order
     */
    getAllSteps(): Step[] {
        return [...this.steps];
    }

    /**
     * Get step by ID
     */
    getStepById(id: string): Step | undefined {
        return this.steps.find(step => step.id === id);
    }

    /**
     * Get steps for a specific file
     */
    getStepsForFile(filePath: string): Step[] {
        return this.steps.filter(step => step.filePath === filePath);
    }

    /**
     * Get steps by status
     */
    getStepsByStatus(status: 'accepted' | 'rejected' | 'pending'): Step[] {
        return this.steps.filter(step => step.status === status);
    }

    /**
     * Update step status
     */
    updateStepStatus(id: string, status: 'accepted' | 'rejected' | 'pending'): void {
        const step = this.getStepById(id);
        if (step) {
            step.status = status;
            this._onDidChangeSteps.fire();
        }
    }

    /**
     * Remove a step by ID
     */
    removeStep(id: string): void {
        const index = this.steps.findIndex(step => step.id === id);
        if (index !== -1) {
            this.steps.splice(index, 1);
            this._onDidChangeSteps.fire();
        }
    }

    /**
     * Clear all steps
     */
    clear(): void {
        this.steps = [];
        this._onDidChangeSteps.fire();
    }

    /**
     * Get total step count
     */
    getStepCount(): number {
        return this.steps.length;
    }

    /**
     * Get statistics
     */
    getStatistics(): {
        total: number;
        accepted: number;
        rejected: number;
        pending: number;
    } {
        return {
            total: this.steps.length,
            accepted: this.getStepsByStatus('accepted').length,
            rejected: this.getStepsByStatus('rejected').length,
            pending: this.getStepsByStatus('pending').length
        };
    }

    /**
     * Export steps as JSON
     */
    exportToJSON(): string {
        return JSON.stringify(this.steps, null, 2);
    }

    /**
     * Import steps from JSON
     */
    importFromJSON(json: string): void {
        try {
            const imported = JSON.parse(json);
            if (Array.isArray(imported)) {
                // Convert timestamp strings back to Date objects
                this.steps = imported.map(step => ({
                    ...step,
                    timestamp: new Date(step.timestamp)
                }));
                this._onDidChangeSteps.fire();
            }
        } catch (error) {
            throw new Error('Invalid JSON format for steps import');
        }
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this._onDidChangeSteps.dispose();
    }
}