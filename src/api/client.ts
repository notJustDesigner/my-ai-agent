// file: src/api/client.ts

import * as vscode from "vscode";
import WebSocket from "ws";

/**
 * Request payload for inline completion
 */
export interface InlineCompletionRequest {
  comment: string;
  context: string;
  language: string;
  model?: string;
}

/**
 * Response from inline completion endpoint
 */
export interface InlineCompletionResponse {
  completion: string;
  model: string;
}

/**
 * Chat message structure
 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Code change proposal from AI
 */
export interface CodeChangeProposal {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  diff: string;
  description: string;
}

/**
 * Ollama model information
 */
export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

/**
 * Streaming chat message chunk
 */
export interface StreamChunk {
  type: "token" | "proposal" | "complete" | "error";
  content?: string;
  proposal?: CodeChangeProposal;
  error?: string;
}

/**
 * Centralized API client for backend and Ollama communication
 * Handles REST calls, WebSocket streaming, and error management
 */
export class APIClient {
  private backendUrl: string;
  private ollamaUrl: string;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 2000;

  constructor() {
    const config = vscode.workspace.getConfiguration("aiAgent");
    this.backendUrl = config.get<string>("backendUrl", "http://localhost:8000");
    this.ollamaUrl = config.get<string>("ollamaUrl", "http://localhost:11434");

    // Update URLs when configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aiAgent.backendUrl")) {
        this.backendUrl = vscode.workspace
          .getConfiguration("aiAgent")
          .get<string>("backendUrl", "http://localhost:8000");
      }
      if (e.affectsConfiguration("aiAgent.ollamaUrl")) {
        this.ollamaUrl = vscode.workspace
          .getConfiguration("aiAgent")
          .get<string>("ollamaUrl", "http://localhost:11434");
      }
    });
  }

  /**
   * Get currently selected model from configuration
   */
  private getSelectedModel(): string {
    return vscode.workspace
      .getConfiguration("aiAgent")
      .get<string>("selectedModel", "");
  }

  /**
   * Fetch inline code completion for a comment
   */
  async getInlineCompletion(
    comment: string,
    context: string,
    language: string,
  ): Promise<string> {
    try {
      const model = this.getSelectedModel();
      const payload: InlineCompletionRequest = {
        comment,
        context,
        language,
        model: model || undefined,
      };

      const response = await this.fetchWithTimeout(
        `${this.backendUrl}/inline`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Backend returned ${response.status}: ${response.statusText}`,
        );
      }

      const data = (await response.json()) as InlineCompletionResponse;
      return data.completion;
    } catch (error) {
      this.handleError("Inline completion failed", error);
      return "";
    }
  }

  /**
   * Send chat message and receive streaming response
   */
  async sendChatMessage(
    message: string,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.backendUrl.replace("http", "ws") + "/chat";
        this.ws = new WebSocket(wsUrl);

        this.ws.on("open", () => {
          console.log("WebSocket connected");
          this.reconnectAttempts = 0;

          const model = this.getSelectedModel();
          const payload = {
            message,
            model: model || undefined,
          };

          this.ws?.send(JSON.stringify(payload));
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          try {
            const chunk: StreamChunk = JSON.parse(data.toString());
            onChunk(chunk);

            if (chunk.type === "complete" || chunk.type === "error") {
              this.closeWebSocket();
              resolve();
            }
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
          }
        });

        this.ws.on("error", (error) => {
          console.error("WebSocket error:", error);
          onChunk({
            type: "error",
            error: "Connection error. Is the backend running?",
          });
          this.closeWebSocket();
          reject(error);
        });

        this.ws.on("close", () => {
          console.log("WebSocket closed");
          this.ws = null;
        });
      } catch (error) {
        this.handleError("Chat connection failed", error);
        reject(error);
      }
    });
  }

  /**
   * List available Ollama models
   */
  async listOllamaModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.ollamaUrl}/api/tags`,
        {
          method: "GET",
        },
      );

      if (!response.ok) {
        throw new Error(`Ollama API returned ${response.status}`);
      }

      const data = (await response.json()) as OllamaTagsResponse;
      return data.models || [];
    } catch (error) {
      this.handleError("Failed to fetch Ollama models", error);
      return [];
    }
  }

  /**
   * Check if backend is reachable
   */
  async checkBackendHealth(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.backendUrl}/health`,
        {
          method: "GET",
        },
        3000,
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch with timeout protection
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout = 30000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Close WebSocket connection gracefully
   */
  private closeWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Handle errors with user-friendly messages
   */
  private handleError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${context}:`, error);

    if (message.includes("fetch") || message.includes("ECONNREFUSED")) {
      vscode.window.showErrorMessage(
        `${context}: Backend not reachable. Ensure it's running on ${this.backendUrl}`,
      );
    } else if (message.includes("timeout") || message.includes("aborted")) {
      vscode.window.showErrorMessage(`${context}: Request timed out`);
    } else {
      vscode.window.showErrorMessage(`${context}: ${message}`);
    }
  }

  /**
   * Cleanup on disposal
   */
  dispose(): void {
    this.closeWebSocket();
  }
}
