// file: src/providers/modelSelector.ts

import * as vscode from 'vscode';
import { APIClient, OllamaModel } from '../api/client';

/**
 * Model selector for choosing Ollama models
 * Fetches available models and updates configuration
 */
export class ModelSelector {
    private readonly apiClient: APIClient;

    constructor(apiClient: APIClient) {
        this.apiClient = apiClient;
    }

    /**
     * Show model selection quick pick
     */
    async selectModel(): Promise<void> {
        try {
            // Show loading indicator
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Loading Ollama models...',
                    cancellable: false
                },
                async () => {
                    const models = await this.apiClient.listOllamaModels();

                    if (models.length === 0) {
                        vscode.window.showWarningMessage(
                            'No Ollama models found. Is Ollama running?'
                        );
                        return;
                    }

                    // Show quick pick
                    const selected = await this.showModelQuickPick(models);

                    if (selected) {
                        await this.setSelectedModel(selected.name);
                        vscode.window.showInformationMessage(
                            `Selected model: ${selected.name}`
                        );
                    }
                }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load models: ${message}`);
        }
    }

    /**
     * Display quick pick for model selection
     */
    private async showModelQuickPick(
        models: OllamaModel[]
    ): Promise<OllamaModel | undefined> {
        const config = vscode.workspace.getConfiguration('aiAgent');
        const currentModel = config.get<string>('selectedModel', '');

        interface ModelQuickPickItem extends vscode.QuickPickItem {
            model: OllamaModel;
        }

        const items: ModelQuickPickItem[] = models.map((model) => ({
            label: model.name,
            description: this.formatModelSize(model.size),
            detail: `Modified: ${this.formatDate(model.modified_at)}`,
            picked: model.name === currentModel,
            model: model
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an Ollama model',
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected?.model;
    }

    /**
     * Update selected model in workspace configuration
     */
    private async setSelectedModel(modelName: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('aiAgent');
        await config.update(
            'selectedModel',
            modelName,
            vscode.ConfigurationTarget.Workspace
        );
    }

    /**
     * Format model size for display
     */
    private formatModelSize(bytes: number): string {
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) {
            return '0 B';
        }
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = bytes / Math.pow(1024, i);
        return `${size.toFixed(2)} ${sizes[i]}`;
    }

    /**
     * Format date for display
     */
    private formatDate(dateString: string): string {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        } catch {
            return dateString;
        }
    }
}