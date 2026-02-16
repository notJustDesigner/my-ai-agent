// file: src/utils/diffParser.ts

/**
 * Line change information
 */
export interface LineChange {
    lineNumber: number;
    type: 'added' | 'removed' | 'modified';
    content: string;
}

/**
 * Parsed diff result
 */
export interface ParsedDiff {
    addedLines: LineChange[];
    removedLines: LineChange[];
    modifiedLines: LineChange[];
    stats: {
        additions: number;
        deletions: number;
        changes: number;
    };
}

/**
 * Unified diff hunk
 */
interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
}

/**
 * Utility for parsing and analyzing diffs
 * Supports unified diff format and line-by-line comparison
 */
export class DiffParser {
    /**
     * Parse unified diff format
     */
    static parseUnifiedDiff(diffText: string): ParsedDiff {
        const lines = diffText.split('\n');
        const hunks = this.extractHunks(lines);

        const addedLines: LineChange[] = [];
        const removedLines: LineChange[] = [];
        const modifiedLines: LineChange[] = [];

        for (const hunk of hunks) {
            let oldLineNum = hunk.oldStart;
            let newLineNum = hunk.newStart;

            for (const line of hunk.lines) {
                if (line.startsWith('+')) {
                    addedLines.push({
                        lineNumber: newLineNum,
                        type: 'added',
                        content: line.substring(1)
                    });
                    newLineNum++;
                } else if (line.startsWith('-')) {
                    removedLines.push({
                        lineNumber: oldLineNum,
                        type: 'removed',
                        content: line.substring(1)
                    });
                    oldLineNum++;
                } else {
                    // Context line
                    oldLineNum++;
                    newLineNum++;
                }
            }
        }

        return {
            addedLines,
            removedLines,
            modifiedLines,
            stats: {
                additions: addedLines.length,
                deletions: removedLines.length,
                changes: modifiedLines.length
            }
        };
    }

    /**
     * Compare two strings line by line
     */
    static compareLineByLine(original: string, modified: string): ParsedDiff {
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');

        const addedLines: LineChange[] = [];
        const removedLines: LineChange[] = [];
        const modifiedLineChanges: LineChange[] = [];

        const maxLength = Math.max(originalLines.length, modifiedLines.length);

        for (let i = 0; i < maxLength; i++) {
            const origLine = originalLines[i];
            const modLine = modifiedLines[i];

            if (origLine === undefined && modLine !== undefined) {
                addedLines.push({
                    lineNumber: i,
                    type: 'added',
                    content: modLine
                });
            } else if (origLine !== undefined && modLine === undefined) {
                removedLines.push({
                    lineNumber: i,
                    type: 'removed',
                    content: origLine
                });
            } else if (origLine !== modLine) {
                modifiedLineChanges.push({
                    lineNumber: i,
                    type: 'modified',
                    content: modLine
                });
            }
        }

        return {
            addedLines,
            removedLines,
            modifiedLines: modifiedLineChanges,
            stats: {
                additions: addedLines.length,
                deletions: removedLines.length,
                changes: modifiedLineChanges.length
            }
        };
    }

    /**
     * Generate unified diff from two strings
     */
    static generateUnifiedDiff(
        original: string,
        modified: string,
        filePath: string = 'file'
    ): string {
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');

        const diff: string[] = [];
        diff.push(`--- a/${filePath}`);
        diff.push(`+++ b/${filePath}`);

        if (originalLines.length > 0 || modifiedLines.length > 0) {
            diff.push(`@@ -1,${originalLines.length} +1,${modifiedLines.length} @@`);

            const maxLength = Math.max(originalLines.length, modifiedLines.length);
            for (let i = 0; i < maxLength; i++) {
                const origLine = originalLines[i];
                const modLine = modifiedLines[i];

                if (origLine === modLine) {
                    diff.push(` ${origLine}`);
                } else {
                    if (origLine !== undefined) {
                        diff.push(`-${origLine}`);
                    }
                    if (modLine !== undefined) {
                        diff.push(`+${modLine}`);
                    }
                }
            }
        }

        return diff.join('\n');
    }

    /**
     * Extract hunks from unified diff lines
     */
    private static extractHunks(lines: string[]): DiffHunk[] {
        const hunks: DiffHunk[] = [];
        let currentHunk: DiffHunk | null = null;

        for (const line of lines) {
            const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
            if (hunkMatch) {
                if (currentHunk) {
                    hunks.push(currentHunk);
                }

                currentHunk = {
                    oldStart: parseInt(hunkMatch[1]),
                    oldLines: parseInt(hunkMatch[2] || '1'),
                    newStart: parseInt(hunkMatch[3]),
                    newLines: parseInt(hunkMatch[4] || '1'),
                    lines: []
                };
            } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
                currentHunk.lines.push(line);
            }
        }

        if (currentHunk) {
            hunks.push(currentHunk);
        }

        return hunks;
    }

    /**
     * Calculate diff statistics
     */
    static calculateStats(original: string, modified: string): {
        additions: number;
        deletions: number;
        unchanged: number;
    } {
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');

        let additions = 0;
        let deletions = 0;
        let unchanged = 0;

        const maxLength = Math.max(originalLines.length, modifiedLines.length);

        for (let i = 0; i < maxLength; i++) {
            const origLine = originalLines[i];
            const modLine = modifiedLines[i];

            if (origLine === modLine) {
                unchanged++;
            } else if (origLine === undefined) {
                additions++;
            } else if (modLine === undefined) {
                deletions++;
            } else {
                additions++;
                deletions++;
            }
        }

        return { additions, deletions, unchanged };
    }

    /**
     * Format diff stats as human-readable string
     */
    static formatStats(stats: { additions: number; deletions: number; unchanged: number }): string {
        const parts: string[] = [];

        if (stats.additions > 0) {
            parts.push(`+${stats.additions} addition${stats.additions !== 1 ? 's' : ''}`);
        }
        if (stats.deletions > 0) {
            parts.push(`-${stats.deletions} deletion${stats.deletions !== 1 ? 's' : ''}`);
        }

        return parts.length > 0 ? parts.join(', ') : 'No changes';
    }
}