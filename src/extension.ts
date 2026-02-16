// file: src/extension.ts

import * as vscode from 'vscode';
import { ChatViewProvider } from './providers/chatProvider';
import { InlineCompletionProvider } from './providers/inlineProvider';
import { ModelSelector } from './providers/modelSelector';
import { StepHistoryProvider } from './providers/stepHistoryProvider';
import { StepStore } from './state/stepStore';
import { APIClient } from './api/client';

/**
 * Extension activation entry point
 * Initializes all providers, commands, and services
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('AI Coding Agent extension is now active');

    // Initialize core services
    const stepStore = new StepStore();
    const apiClient = new APIClient();
    const modelSelector = new ModelSelector(apiClient);

    // Register chat view provider
    const chatProvider = new ChatViewProvider(context.extensionUri, apiClient, stepStore);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'aiAgent.chatView',
            chatProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Register step history tree view
    const stepHistoryProvider = new StepHistoryProvider(stepStore);
    const stepHistoryTreeView = vscode.window.createTreeView('aiAgent.stepHistory', {
        treeDataProvider: stepHistoryProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(stepHistoryTreeView);

    // Register inline completion provider
    const config = vscode.workspace.getConfiguration('aiAgent');
    if (config.get<boolean>('enableInlineCompletions', true)) {
        const inlineProvider = new InlineCompletionProvider(apiClient);
        context.subscriptions.push(
            vscode.languages.registerInlineCompletionItemProvider(
                { pattern: '**' },
                inlineProvider
            )
        );
    }

    // Register commands
    registerCommands(context, modelSelector, stepStore, chatProvider, stepHistoryProvider);

    // Show welcome message
    vscode.window.showInformationMessage('AI Coding Agent activated successfully!');
}

/**
 * Register all extension commands
 */
function registerCommands(
    context: vscode.ExtensionContext,
    modelSelector: ModelSelector,
    stepStore: StepStore,
    chatProvider: ChatViewProvider,
    stepHistoryProvider: StepHistoryProvider
): void {
    // Select Ollama model
    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgent.selectModel', async () => {
            await modelSelector.selectModel();
        })
    );

    // Open chat view
    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgent.openChat', async () => {
            await vscode.commands.executeCommand('aiAgent.chatView.focus');
        })
    );

    // Clear step history
    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgent.clearHistory', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to clear all step history?',
                { modal: true },
                'Clear'
            );
            if (confirm === 'Clear') {
                stepStore.clear();
                stepHistoryProvider.refresh();
                vscode.window.showInformationMessage('Step history cleared');
            }
        })
    );

    // View step diff
    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgent.viewStepDiff', async (step) => {
            if (step && step.filePath && step.diff) {
                await openDiffView(step.filePath, step.diff.original, step.diff.modified);
            }
        })
    );

    // Revert to step
    context.subscriptions.push(
        vscode.commands.registerCommand('aiAgent.revertToStep', async (step) => {
            if (!step || !step.filePath) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Revert ${step.filePath} to this version?`,
                { modal: true },
                'Revert'
            );

            if (confirm === 'Revert' && step.diff && step.diff.original) {
                try {
                    const uri = vscode.Uri.file(step.filePath);
                    const edit = new vscode.WorkspaceEdit();
                    const document = await vscode.workspace.openTextDocument(uri);
                    const fullRange = new vscode.Range(
                        document.positionAt(0),
                        document.positionAt(document.getText().length)
                    );
                    edit.replace(uri, fullRange, step.diff.original);
                    await vscode.workspace.applyEdit(edit);
                    await document.save();
                    vscode.window.showInformationMessage('File reverted successfully');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to revert: ${error}`);
                }
            }
        })
    );
}

/**
 * Open diff view comparing original and modified content
 */
async function openDiffView(
    filePath: string,
    originalContent: string,
    modifiedContent: string
): Promise<void> {
    const originalUri = vscode.Uri.parse(`aiagent-original:${filePath}`);
    const modifiedUri = vscode.Uri.parse(`aiagent-modified:${filePath}`);

    // Register text document content providers
    const originalProvider = new (class implements vscode.TextDocumentContentProvider {
        provideTextDocumentContent(): string {
            return originalContent;
        }
    })();

    const modifiedProvider = new (class implements vscode.TextDocumentContentProvider {
        provideTextDocumentContent(): string {
            return modifiedContent;
        }
    })();

    const originalDisposable = vscode.workspace.registerTextDocumentContentProvider(
        'aiagent-original',
        originalProvider
    );
    const modifiedDisposable = vscode.workspace.registerTextDocumentContentProvider(
        'aiagent-modified',
        modifiedProvider
    );

    await vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        modifiedUri,
        `AI Agent: ${filePath.split('/').pop()} (Original ↔ Modified)`
    );

    // Clean up providers after a delay
    setTimeout(() => {
        originalDisposable.dispose();
        modifiedDisposable.dispose();
    }, 60000);
}

/**
 * Extension deactivation cleanup
 */
export function deactivate(): void {
    console.log('AI Coding Agent extension deactivated');
}