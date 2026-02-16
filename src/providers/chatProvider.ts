// file: src/providers/chatProvider.ts

import * as vscode from 'vscode';
import { APIClient, StreamChunk, CodeChangeProposal } from '../api/client';
import { StepStore, Step } from '../state/stepStore';
import { DiffManager } from '../ui/diffManager';

/**
 * Chat view provider for AI conversation interface
 * Handles streaming responses, code proposals, and user interactions
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private readonly apiClient: APIClient;
    private readonly stepStore: StepStore;
    private readonly diffManager: DiffManager;
    private currentProposal: CodeChangeProposal | null = null;

    constructor(
        private readonly extensionUri: vscode.Uri,
        apiClient: APIClient,
        stepStore: StepStore
    ) {
        this.apiClient = apiClient;
        this.stepStore = stepStore;
        this.diffManager = new DiffManager(stepStore);
    }

    /**
     * Resolve webview view on first display
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });
    }

    /**
     * Handle messages from the webview
     */
    private async handleMessage(message: { type: string; value?: string }): Promise<void> {
        switch (message.type) {
            case 'sendMessage':
                if (message.value) {
                    await this.handleUserMessage(message.value);
                }
                break;

            case 'acceptProposal':
                await this.acceptCurrentProposal();
                break;

            case 'rejectProposal':
                this.rejectCurrentProposal();
                break;

            case 'previewChanges':
                await this.previewCurrentProposal();
                break;
        }
    }

    /**
     * Handle user message and stream AI response
     */
    private async handleUserMessage(userMessage: string): Promise<void> {
        if (!this.view) {
            return;
        }

        // Display user message
        this.view.webview.postMessage({
            type: 'userMessage',
            content: userMessage
        });

        // Start assistant response
        this.view.webview.postMessage({
            type: 'assistantMessageStart'
        });

        try {
            // Stream response from backend
            await this.apiClient.sendChatMessage(userMessage, (chunk: StreamChunk) => {
                this.handleStreamChunk(chunk);
            });
        } catch (error) {
            this.view.webview.postMessage({
                type: 'error',
                content: 'Failed to get response from AI backend'
            });
        }
    }

    /**
     * Handle streaming chunk from backend
     */
    private handleStreamChunk(chunk: StreamChunk): void {
        if (!this.view) {
            return;
        }

        switch (chunk.type) {
            case 'token':
                // Stream text token
                this.view.webview.postMessage({
                    type: 'token',
                    content: chunk.content || ''
                });
                break;

            case 'proposal':
                // Code change proposal received
                if (chunk.proposal) {
                    this.currentProposal = chunk.proposal;
                    this.view.webview.postMessage({
                        type: 'proposal',
                        proposal: chunk.proposal
                    });
                }
                break;

            case 'complete':
                // Stream complete
                this.view.webview.postMessage({
                    type: 'complete'
                });
                break;

            case 'error':
                // Error occurred
                this.view.webview.postMessage({
                    type: 'error',
                    content: chunk.error || 'Unknown error'
                });
                break;
        }
    }

    /**
     * Preview current code change proposal in diff view
     */
    private async previewCurrentProposal(): Promise<void> {
        if (!this.currentProposal) {
            return;
        }

        await this.diffManager.showDiff(
            this.currentProposal.filePath,
            this.currentProposal.originalContent,
            this.currentProposal.modifiedContent
        );
    }

    /**
     * Accept and apply current code change proposal
     */
    private async acceptCurrentProposal(): Promise<void> {
        if (!this.currentProposal || !this.view) {
            return;
        }

        try {
            // Apply changes
            await this.diffManager.applyChanges(
                this.currentProposal.filePath,
                this.currentProposal.modifiedContent
            );

            // Save step to history
            const config = vscode.workspace.getConfiguration('aiAgent');
            const model = config.get<string>('selectedModel', 'unknown');

            const step: Step = {
                id: Date.now().toString(),
                timestamp: new Date(),
                filePath: this.currentProposal.filePath,
                diff: {
                    original: this.currentProposal.originalContent,
                    modified: this.currentProposal.modifiedContent
                },
                model,
                status: 'accepted',
                description: this.currentProposal.description
            };

            this.stepStore.addStep(step);

            // Notify webview
            this.view.webview.postMessage({
                type: 'proposalAccepted'
            });

            vscode.window.showInformationMessage('Changes applied successfully');

            // Clear current proposal
            this.currentProposal = null;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to apply changes: ${message}`);
        }
    }

    /**
     * Reject current code change proposal
     */
    private rejectCurrentProposal(): void {
        if (!this.currentProposal || !this.view) {
            return;
        }

        // Save rejected step to history
        const config = vscode.workspace.getConfiguration('aiAgent');
        const model = config.get<string>('selectedModel', 'unknown');

        const step: Step = {
            id: Date.now().toString(),
            timestamp: new Date(),
            filePath: this.currentProposal.filePath,
            diff: {
                original: this.currentProposal.originalContent,
                modified: this.currentProposal.modifiedContent
            },
            model,
            status: 'rejected',
            description: this.currentProposal.description
        };

        this.stepStore.addStep(step);

        // Notify webview
        this.view.webview.postMessage({
            type: 'proposalRejected'
        });

        vscode.window.showInformationMessage('Changes rejected');

        // Clear current proposal
        this.currentProposal = null;
    }

    /**
     * Generate HTML content for chat webview
     */
    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Chat</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 12px;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        #messages {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 12px;
            padding-right: 8px;
        }

        .message {
            margin-bottom: 16px;
            padding: 12px;
            border-radius: 6px;
            line-height: 1.6;
        }

        .user-message {
            background-color: var(--vscode-input-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
        }

        .assistant-message {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-left: 3px solid var(--vscode-charts-green);
        }

        .message-label {
            font-weight: 600;
            margin-bottom: 6px;
            font-size: 0.9em;
            opacity: 0.8;
        }

        .message-content {
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .code-block {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 12px;
            margin: 8px 0;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }

        .proposal-card {
            background-color: var(--vscode-editor-background);
            border: 2px solid var(--vscode-charts-orange);
            border-radius: 8px;
            padding: 16px;
            margin: 12px 0;
        }

        .proposal-title {
            font-weight: 600;
            color: var(--vscode-charts-orange);
            margin-bottom: 8px;
        }

        .proposal-file {
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
            opacity: 0.8;
            margin-bottom: 12px;
        }

        .button-group {
            display: flex;
            gap: 8px;
            margin-top: 12px;
        }

        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            transition: background-color 0.2s;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        #input-container {
            display: flex;
            gap: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        #message-input {
            flex: 1;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 10px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            resize: none;
            min-height: 60px;
        }

        #message-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        #send-button {
            align-self: flex-end;
        }

        .loading {
            opacity: 0.6;
            font-style: italic;
        }

        ::-webkit-scrollbar {
            width: 8px;
        }

        ::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
        }

        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-hoverBackground);
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div id="messages"></div>
    
    <div id="input-container">
        <textarea 
            id="message-input" 
            placeholder="Ask AI to help with your code..."
            rows="3"
        ></textarea>
        <button id="send-button">Send</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messagesDiv = document.getElementById('messages');
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-button');

        let currentAssistantMessage = null;

        // Send message
        function sendMessage() {
            const message = messageInput.value.trim();
            if (!message) return;

            vscode.postMessage({
                type: 'sendMessage',
                value: message
            });

            messageInput.value = '';
            messageInput.focus();
        }

        sendButton.addEventListener('click', sendMessage);
        
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'userMessage':
                    addUserMessage(message.content);
                    break;
                
                case 'assistantMessageStart':
                    startAssistantMessage();
                    break;
                
                case 'token':
                    appendToAssistantMessage(message.content);
                    break;
                
                case 'proposal':
                    addProposal(message.proposal);
                    break;
                
                case 'complete':
                    completeAssistantMessage();
                    break;
                
                case 'error':
                    addErrorMessage(message.content);
                    break;
                
                case 'proposalAccepted':
                case 'proposalRejected':
                    removeProposalButtons();
                    break;
            }
        });

        function addUserMessage(content) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message user-message';
            messageDiv.innerHTML = \`
                <div class="message-label">You</div>
                <div class="message-content">\${escapeHtml(content)}</div>
            \`;
            messagesDiv.appendChild(messageDiv);
            scrollToBottom();
        }

        function startAssistantMessage() {
            currentAssistantMessage = document.createElement('div');
            currentAssistantMessage.className = 'message assistant-message';
            currentAssistantMessage.innerHTML = \`
                <div class="message-label">AI Assistant</div>
                <div class="message-content"></div>
            \`;
            messagesDiv.appendChild(currentAssistantMessage);
            scrollToBottom();
        }

        function appendToAssistantMessage(content) {
            if (!currentAssistantMessage) return;
            const contentDiv = currentAssistantMessage.querySelector('.message-content');
            contentDiv.textContent += content;
            scrollToBottom();
        }

        function completeAssistantMessage() {
            currentAssistantMessage = null;
        }

        function addProposal(proposal) {
            const proposalDiv = document.createElement('div');
            proposalDiv.className = 'proposal-card';
            proposalDiv.innerHTML = \`
                <div class="proposal-title">📝 Code Change Proposal</div>
                <div class="proposal-file">\${escapeHtml(proposal.filePath)}</div>
                <div class="message-content">\${escapeHtml(proposal.description)}</div>
                <div class="button-group">
                    <button onclick="previewChanges()">Preview Changes</button>
                    <button onclick="acceptProposal()">Accept</button>
                    <button class="secondary" onclick="rejectProposal()">Reject</button>
                </div>
            \`;
            messagesDiv.appendChild(proposalDiv);
            scrollToBottom();
        }

        function removeProposalButtons() {
            const buttons = messagesDiv.querySelectorAll('.proposal-card .button-group');
            buttons.forEach(group => group.remove());
        }

        function addErrorMessage(content) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message assistant-message';
            messageDiv.innerHTML = \`
                <div class="message-label">Error</div>
                <div class="message-content" style="color: var(--vscode-errorForeground);">
                    \${escapeHtml(content)}
                </div>
            \`;
            messagesDiv.appendChild(messageDiv);
            scrollToBottom();
        }

        function previewChanges() {
            vscode.postMessage({ type: 'previewChanges' });
        }

        function acceptProposal() {
            vscode.postMessage({ type: 'acceptProposal' });
        }

        function rejectProposal() {
            vscode.postMessage({ type: 'rejectProposal' });
        }

        function scrollToBottom() {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Focus input on load
        messageInput.focus();
    </script>
</body>
</html>`;
    }
}