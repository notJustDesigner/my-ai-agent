// file: src/providers/inlineProvider.ts

import * as vscode from 'vscode';
import { APIClient } from '../api/client';

/**
 * Inline completion provider for comment-to-code suggestions
 * Triggers only on comment lines and provides AI-generated code
 */
export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private readonly apiClient: APIClient;
    private readonly commentPatterns: Map<string, RegExp>;

    constructor(apiClient: APIClient) {
        this.apiClient = apiClient;

        // Language-specific comment patterns
        this.commentPatterns = new Map([
            ['javascript', /^\s*(\/\/|\/\*)/],
            ['typescript', /^\s*(\/\/|\/\*)/],
            ['python', /^\s*#/],
            ['java', /^\s*(\/\/|\/\*)/],
            ['c', /^\s*(\/\/|\/\*)/],
            ['cpp', /^\s*(\/\/|\/\*)/],
            ['csharp', /^\s*(\/\/|\/\*)/],
            ['go', /^\s*\/\//],
            ['rust', /^\s*\/\//],
            ['ruby', /^\s*#/],
            ['php', /^\s*(\/\/|\/\*|#)/],
            ['html', /^\s*<!--/],
            ['css', /^\s*\/\*/],
        ]);
    }

    /**
     * Provide inline completion items
     * Only triggers for comment lines
     */
    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
        // Skip if triggered by acceptance of another completion
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
            return null;
        }

        const line = document.lineAt(position.line);
        const lineText = line.text;

        // Check if current line is a comment
        if (!this.isCommentLine(lineText, document.languageId)) {
            return null;
        }

        // Extract comment content
        const comment = this.extractCommentContent(lineText, document.languageId);
        if (!comment || comment.trim().length < 5) {
            return null; // Ignore very short comments
        }

        // Don't trigger if user is still typing the comment
        const cursorAtEnd = position.character >= lineText.length;
        if (!cursorAtEnd) {
            return null;
        }

        // Get context: previous lines
        const contextLines = this.getContextLines(document, position.line);

        try {
            // Request completion from backend
            const completion = await this.apiClient.getInlineCompletion(
                comment,
                contextLines,
                document.languageId
            );

            if (!completion || token.isCancellationRequested) {
                return null;
            }

            // Create inline completion item
            const completionItem = new vscode.InlineCompletionItem(
                '\n' + completion,
                new vscode.Range(position, position)
            );

            return [completionItem];
        } catch (error) {
            console.error('Inline completion error:', error);
            return null;
        }
    }

    /**
     * Check if a line is a comment based on language
     */
    private isCommentLine(lineText: string, languageId: string): boolean {
        const pattern = this.commentPatterns.get(languageId);
        if (!pattern) {
            // Default fallback: check for common comment patterns
            return /^\s*(\/\/|\/\*|#|<!--|%)/.test(lineText);
        }
        return pattern.test(lineText);
    }

    /**
     * Extract actual comment content without comment syntax
     */
    private extractCommentContent(lineText: string, languageId: string): string {
        const trimmed = lineText.trim();

        // Remove common comment prefixes
        const patterns = [
            /^\/\/\s*/,
            /^\/\*\s*/,
            /^#\s*/,
            /^<!--\s*/,
            /^%\s*/
        ];

        let content = trimmed;
        for (const pattern of patterns) {
            content = content.replace(pattern, '');
        }

        // Remove trailing comment closers
        content = content.replace(/\s*\*\/\s*$/, '');
        content = content.replace(/\s*-->\s*$/, '');

        return content.trim();
    }

    /**
     * Get context lines before current position
     */
    private getContextLines(document: vscode.TextDocument, currentLine: number): string {
        const startLine = Math.max(0, currentLine - 20); // Previous 20 lines
        const lines: string[] = [];

        for (let i = startLine; i < currentLine; i++) {
            lines.push(document.lineAt(i).text);
        }

        return lines.join('\n');
    }
}