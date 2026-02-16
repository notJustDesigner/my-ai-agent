// file: src/providers/stepHistoryProvider.ts

import * as vscode from 'vscode';
import { StepStore, Step } from '../state/stepStore';

/**
 * Tree item for step history
 */
class StepTreeItem extends vscode.TreeItem {
    constructor(
        public readonly step: Step,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(step.description || 'Code Change', collapsibleState);

        this.tooltip = this.buildTooltip(step);
        this.description = this.buildDescription(step);
        this.iconPath = this.getIcon(step);
        this.contextValue = 'step';

        // Make items clickable
        this.command = {
            command: 'aiAgent.viewStepDiff',
            title: 'View Diff',
            arguments: [step]
        };
    }

    /**
     * Build tooltip with step details
     */
    private buildTooltip(step: Step): string {
        const lines = [
            `File: ${step.filePath}`,
            `Model: ${step.model}`,
            `Status: ${step.status}`,
            `Time: ${step.timestamp.toLocaleString()}`
        ];
        
        if (step.description) {
            lines.push(`\nDescription: ${step.description}`);
        }

        return lines.join('\n');
    }

    /**
     * Build description shown next to label
     */
    private buildDescription(step: Step): string {
        const fileName = step.filePath.split('/').pop() || step.filePath;
        const time = this.formatRelativeTime(step.timestamp);
        return `${fileName} • ${time}`;
    }

    /**
     * Get icon based on step status
     */
    private getIcon(step: Step): vscode.ThemeIcon {
        switch (step.status) {
            case 'accepted':
                return new vscode.ThemeIcon(
                    'check',
                    new vscode.ThemeColor('charts.green')
                );
            case 'rejected':
                return new vscode.ThemeIcon(
                    'close',
                    new vscode.ThemeColor('charts.red')
                );
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    /**
     * Format timestamp as relative time
     */
    private formatRelativeTime(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) {
            return 'just now';
        } else if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffMins < 1440) {
            const hours = Math.floor(diffMins / 60);
            return `${hours}h ago`;
        } else {
            const days = Math.floor(diffMins / 1440);
            return `${days}d ago`;
        }
    }
}

/**
 * Tree data provider for step history
 * Displays chronological list of AI actions
 */
export class StepHistoryProvider implements vscode.TreeDataProvider<Step> {
    private _onDidChangeTreeData = new vscode.EventEmitter<Step | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly stepStore: StepStore) {
        // Refresh when steps change
        stepStore.onDidChangeSteps(() => {
            this.refresh();
        });
    }

    /**
     * Refresh tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item for a step
     */
    getTreeItem(element: Step): vscode.TreeItem {
        return new StepTreeItem(element, vscode.TreeItemCollapsibleState.None);
    }

    /**
     * Get children (all steps in chronological order)
     */
    getChildren(element?: Step): Thenable<Step[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const steps = this.stepStore.getAllSteps();
        // Reverse to show newest first
        return Promise.resolve(steps.reverse());
    }

    /**
     * Get parent (not used, flat list)
     */
    getParent(): Thenable<Step | undefined> {
        return Promise.resolve(undefined);
    }
}