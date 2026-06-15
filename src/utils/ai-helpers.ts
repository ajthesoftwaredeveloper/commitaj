import parse from 'parse-diff';
import path from 'path';

function getFileImportance(filePath: string): number {
  const lower = filePath.toLowerCase();
  if (/\.(test|spec)\.|\/tests\/|\/test\/|__tests__/.test(lower)) return 3; // Tests: lower priority
  if (/\.md$|readme/i.test(lower)) return 4; // Docs: lowest priority
  if (/package\.json|tsconfig|\.config\.|eslint|prettier/i.test(lower)) return 2; // Config: medium priority
  return 1; // Core source files: highest priority
}

export function formatSmartDiff(parsedDiff: parse.File[], maxChars: number = 20000): string {
  if (parsedDiff.length === 0) return '';

  // 1. Gather stats and sort files
  const fileStats = parsedDiff.map(file => {
    const filePath = file.to || file.from || 'unknown';
    let additions = 0;
    let deletions = 0;
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type === 'add') additions++;
        else if (change.type === 'del') deletions++;
      }
    }
    return {
      file,
      filePath,
      additions,
      deletions,
      totalChanges: additions + deletions,
      importance: getFileImportance(filePath),
    };
  });

  // Sort: most important category first, then by total changes descending
  fileStats.sort((a, b) => {
    if (a.importance !== b.importance) {
      return a.importance - b.importance;
    }
    return b.totalChanges - a.totalChanges;
  });

  // 2. Build detailed diff with a character budget
  const footerBuffer = 1000; // Leave characters for omitted summary
  const budget = Math.max(2000, maxChars - footerBuffer);
  let result = '';
  const omittedFiles: typeof fileStats = [];

  for (const { file, filePath, additions, deletions, totalChanges } of fileStats) {
    if (result.length >= budget) {
      omittedFiles.push({ file, filePath, additions, deletions, totalChanges, importance: getFileImportance(filePath) });
      continue;
    }

    let fileStr = `=== ${filePath} ===\n`;
    let fileChunksFormatted = 0;
    const fileChunksTotal = file.chunks.length;

    for (const chunk of file.chunks) {
      let chunkStr = `@@ ${chunk.content.trim()} @@\n`;
      for (const change of chunk.changes) {
        let content = change.content;
        if (content.length > 1000) {
          content = content.slice(0, 1000) + '... [line truncated to 1000 chars]';
        }
        if (change.type === 'add') chunkStr += `+${content}\n`;
        else if (change.type === 'del') chunkStr += `-${content}\n`;
      }

      // Check budget. Caps any single file diff at 8000 characters to prevent starvation.
      const wouldBeLength = result.length + fileStr.length + chunkStr.length;
      const isFileTooLarge = (fileStr.length + chunkStr.length) > 8000;

      if (wouldBeLength > budget || isFileTooLarge) {
        fileStr += `... [${fileChunksTotal - fileChunksFormatted} chunks omitted for this file to save token budget] ...\n`;
        break;
      }

      fileStr += chunkStr;
      fileChunksFormatted++;
    }

    // If we didn't write any chunks but chunks existed, we count it as omitted
    if (fileChunksTotal > 0 && fileChunksFormatted === 0) {
      omittedFiles.push({ file, filePath, additions, deletions, totalChanges, importance: getFileImportance(filePath) });
    } else {
      result += fileStr + '\n';
    }
  }

  // 3. Append omitted files summary if any
  if (omittedFiles.length > 0) {
    result += `\n... [Detailed diff truncated. The following files were changed but their detailed diffs were omitted to fit token budget:\n`;
    for (const f of omittedFiles) {
      result += `  - ${f.filePath} (+${f.additions}, -${f.deletions})\n`;
    }
    result += `] ...\n`;
  }

  return result.trim();
}
