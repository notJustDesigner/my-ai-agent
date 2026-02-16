// file: src/ui/diffManager.ts

import * as vscode from 'vscode';
import { StepStore } from '../state/stepStore';

/**
 * Manages diff views and code change application
 * Handles preview, highlighting, and workspace edits
 */
export class DiffManager {
    private readonly stepStore: StepStore;
    private decorationType: vscode.TextEditorDecorationType | null = null;

    constructor(stepStore: StepStore) {
        this.stepStore = stepStore;
    }

    /**
     * Show diff comparison between original and modified content
     */
    async showDiff(
        filePath: string,
        originalContent: string,
        modifiedContent: string
    ): Promise<void> {
        try {
            // Create virtual URIs for diff view
            const originalUri = vscode.Uri.parse(
                `aiagent-diff-original:${encodeURIComponent(filePath)}`
            );
            const modifiedUri = vscode.Uri.parse(
                `aiagent-diff-modified:${encodeURIComponent(filePath)}`
            );

            // Register content providers
            const originalProvider = this.createContentProvider(originalContent);
            const modifiedProvider = this.createContentProvider(modifiedContent);

            const originalDisposable = vscode.workspace.registerTextDocumentContentProvider(
                'aiagent-diff-original',
                originalProvider
            );
            const modifiedDisposable = vscode.workspace.registerTextDocumentContentProvider(
                'aiagent-diff-modified',
                modifiedProvider
            );

            // Open diff view
            const fileName = filePath.split('/').pop() || 'file';
            await vscode.commands.executeCommand(
                'vscode.diff',
                originalUri,
                modifiedUri,
                `AI Proposal: ${fileName} (Original ↔ Modified)`,
                { preview: true }
            );

            // Clean up providers after delay
            setTimeout(() => {
                originalDisposable.dispose();
                modifiedDisposable.dispose();
            }, 120000); // 2 minutes
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to show diff: ${message}`);
        }
    }

    /**
     * Apply code changes to file with highlighting
     */
    async applyChanges(filePath: string, modifiedContent: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);

            // Read current content
            let document: vscode.TextDocument;
            try {
                document = await vscode.workspace.openTextDocument(uri);
            } catch {
                // File doesn't exist, create it
                const workspaceEdit = new vscode.WorkspaceEdit();
                workspaceEdit.createFile(uri, { ignoreIfExists: true });
                await vscode.workspace.applyEdit(workspaceEdit);
                document = await vscode.workspace.openTextDocument(uri);
            }

            const originalContent = document.getText();

            // Calculate changed lines for highlighting
            const changedLines = this.calculateChangedLines(
                originalContent,
                modifiedContent
            );

            // Apply the edit
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(originalContent.length)
            );
            edit.replace(uri, fullRange, modifiedContent);

            const success = await vscode.workspace.applyEdit(edit);
            if (!success) {
                throw new Error('Failed to apply workspace edit');
            }

            // Save the document
            await document.save();

            // Show and highlight the document
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false
            });

            await this.highlightChangedLines(editor, changedLines);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to apply changes: ${message}`);
        }
    }

    /**
     * Highlight changed lines in editor
     */
    private async highlightChangedLines(
        editor: vscode.TextEditor,
        changedLines: { added: number[]; removed: number[] }
    ): Promise<void> {
        // Clear previous decorations
        if (this.decorationType) {
            this.decorationType.dispose();
        }

        // Create decoration types
        const addedDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });

        const removedDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left
        });

        // Create ranges for added lines
        const addedRanges = changedLines.added.map(lineNum => {
            const line = editor.document.lineAt(lineNum);
            return new vscode.Range(line.range.start, line.range.end);
        });

        // Apply decorations
        editor.setDecorations(addedDecoration, addedRanges);

        // Store for cleanup
        this.decorationType = addedDecoration;

        // Get highlight duration from config
        const config = vscode.workspace.getConfiguration('aiAgent');
        const duration = config.get<number>('highlightDuration', 5000);

        // Auto-clear after duration
        setTimeout(() => {
            addedDecoration.dispose();
            removedDecoration.dispose();
            this.decorationType = null;
        }, duration);
    }

    /**
     * Calculate which lines changed between original and modified
     */
    private calculateChangedLines(
        original: string,
        modified: string
    ): { added: number[]; removed: number[] } {
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');

        const added: number[] = [];
        const removed: number[] = [];

        // Simple line-by-line comparison
        // For production, consider using a proper diff algorithm
        const maxLength = Math.max(originalLines.length, modifiedLines.length);

        for (let i = 0; i < maxLength; i++) {
            const origLine = originalLines[i];
            const modLine = modifiedLines[i];

            if (origLine !== modLine) {
                if (modLine !== undefined) {
                    added.push(i);
                }
                if (origLine !== undefined && modLine === undefined) {
                    removed.push(i);
                }
            }
        }

        return { added, removed };
    }

    /**
     * Create a simple content provider
     */
    private createContentProvider(content: string): vscode.TextDocumentContentProvider {
        return new (class implements vscode.TextDocumentContentProvider {
            provideTextDocumentContent(): string {
                return content;
            }
        })();
    }

    /**
     * Cleanup
     */
    dispose(): void {
        if (this.decorationType) {
            this.decorationType.dispose();
        }
    }
}