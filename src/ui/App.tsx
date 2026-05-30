import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Text, Box, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { AIService, CommitSuggestion } from '../ai/index.js';
import { RepoContext } from '../analyzers/index.js';
import { GitService } from '../git/index.js';
import parse from 'parse-diff';

const SelectInputDefault = (SelectInput as any).default || SelectInput;
const TextInputDefault = (TextInput as any).default || TextInput;
const SpinnerDefault = (Spinner as any).default || Spinner;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  parsedDiff: parse.File[];
  ai: AIService;
  context: RepoContext;
  git: GitService;
  dry?: boolean;
  history: string[];
  summary: { additions: number; deletions: number; files: number };
  onEditExternal: (message: string) => Promise<void>;
}

type Step = 'generating' | 'select-suggestion' | 'confirm' | 'editing';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Truncate a string to maxLen chars for display */
const trunc = (s: string, maxLen = 65) =>
  s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;

/** Format multiline message: first line bold, rest dimmed */
const formatMessagePreview = (msg: string) => {
  const [subject, ...body] = msg.split('\n');
  return { subject, body: body.filter(l => l.trim()).join('\n') };
};

// ─────────────────────────────────────────────────────────────────────────────
// App Component
// ─────────────────────────────────────────────────────────────────────────────

const App: React.FC<Props> = ({
  parsedDiff,
  ai,
  context,
  git,
  dry,
  history,
  summary,
  onEditExternal,
}) => {
  const { exit } = useApp();

  const [suggestions, setSuggestions] = useState<CommitSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<CommitSuggestion | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedMessage, setSelectedMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(true);
  const [step, setStep] = useState<Step>('generating');
  const [editedMessage, setEditedMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [columns, setColumns] = useState(process.stdout.columns || 80);

  // ── Resize handler ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleResize = () => {
      setColumns(process.stdout.columns || 80);
    };
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  // ── Esc key: go back from editing to confirm ────────────────────────────
  useInput((_, key) => {
    if (step === 'editing' && key.escape) {
      setStep('confirm');
    }
  });

  // ── Core generation function (extracted to avoid duplication) ───────────
  const generate = useCallback(async () => {
    setIsGenerating(true);
    setStep('generating');
    setSuggestions([]);
    setSelectedSuggestion(null);
    setError(null);
    try {
      const results = await ai.generateSuggestions(parsedDiff, context, history);
      setSuggestions(results);
      setIsGenerating(false);
      setHighlightedIndex(0);
      setStep('select-suggestion');
    } catch (err: any) {
      setError(err.message ?? 'Unknown error');
      setIsGenerating(false);
    }
  }, [parsedDiff, ai, context, history]);

  useEffect(() => {
    generate();
  }, [generate]);

  // ── Commit action ────────────────────────────────────────────────────────
  const handleCommit = async (messageToCommit: string) => {
    if (dry) {
      setStatusMsg(`⚡ Dry run — message:\n  ${messageToCommit}`);
      setTimeout(() => exit(), 1500);
      return;
    }
    try {
      await git.commit(messageToCommit);
      setStatusMsg(`✅ Committed:\n  ${messageToCommit.split('\n')[0]}`);
      setTimeout(() => exit(), 1500);
    } catch (err: any) {
      setStatusMsg(`✖ Commit failed: ${err.message}`);
      setTimeout(() => exit(err), 2000);
    }
  };

  // ── Action menu handler ──────────────────────────────────────────────────
  const handleAction = async (item: { value: string }) => {
    switch (item.value) {
      case 'commit-full':
        await handleCommit(selectedMessage);
        break;
      case 'commit-subject':
        await handleCommit(selectedMessage.split('\n')[0]);
        break;
      case 'edit':
        setEditedMessage(selectedMessage.replace(/\n/g, '\\n'));
        setStep('editing');
        break;
      case 'edit-external':
        await onEditExternal(selectedMessage);
        break;
      case 'back':
        setStep('select-suggestion');
        break;
      case 'retry':
        await generate();
        break;
      case 'cancel':
        exit();
        break;
    }
  };

  // ── Suggestions items memoization ────────────────────────────────────────
  const selectItems = useMemo(() => {
    const limit = Math.max(30, columns - 20);
    return suggestions.map((s, idx) => ({
      label: `Option ${idx + 1} — ${trunc(s.message.split('\n')[0], limit)}`,
      value: String(idx),
    }));
  }, [suggestions, columns]);

  // ── Status flash ─────────────────────────────────────────────────────────
  if (statusMsg) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} minHeight={12}>
        {statusMsg.split('\n').map((line, i) => (
          <Text key={i} color={statusMsg.startsWith('✅') ? 'green' : statusMsg.startsWith('⚡') ? 'yellow' : 'red'}>
            {line}
          </Text>
        ))}
      </Box>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <Box paddingX={2} paddingY={1} flexDirection="column" minHeight={12}>
        <Box borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
          <Text color="red" bold>✖ Error</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color="white">{error}</Text>
          <Box marginTop={1}>
            <Text color="gray">Press </Text>
            <Text color="cyan">Ctrl+C</Text>
            <Text color="gray"> to exit or run </Text>
            <Text color="cyan">commitaj</Text>
            <Text color="gray"> again to retry.</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Header ───────────────────────────────────────────────────────────────
  const Header = () => {
    const divider = '─'.repeat(Math.max(10, columns - 4));
    return (
      <Box marginBottom={1} flexDirection="column" gap={0}>
        <Box gap={1}>
          <Text key="title" bold color="cyan">commitaj</Text>
          <Text key="sep1" color="gray">|</Text>
          <Text key="framework" color="white">{context.framework}</Text>
          <Text key="sep2" color="gray">|</Text>
          <Text key="style" color="blue">[conventional]</Text>
          {context.category !== 'unknown' && <Text key="sep3" color="gray">|</Text>}
          {context.category !== 'unknown' && <Text key="category" color="yellow">[{context.category}]</Text>}
          <Text key="sep4" color="gray">|</Text>
          <Text key="branch" color="magenta">{context.branch}</Text>
        </Box>
        <Box gap={2}>
          <Text color="white">{summary.files} file{summary.files !== 1 ? 's' : ''} changed</Text>
          <Text color="green">+{summary.additions}</Text>
          <Text color="red">-{summary.deletions}</Text>
          {context.affectedModules.length > 0 && (
            <Text color="gray" dimColor>
              ({context.affectedModules.slice(0, 4).join(', ')})
            </Text>
          )}
        </Box>
        <Text color="gray">{divider}</Text>
      </Box>
    );
  };

  // ── Dry run badge ─────────────────────────────────────────────────────────
  const DryBadge = dry ? (
    <Box marginBottom={1}>
      <Text color="yellow" bold>⚡ DRY RUN — no commit will be made</Text>
    </Box>
  ) : null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render steps
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} minHeight={12}>
      {DryBadge}
      <Header />

      {/* GENERATING */}
      {isGenerating && (
        <Box paddingX={1} flexDirection="column" gap={1}>
          <Box gap={1}>
            <Text color="cyan"><SpinnerDefault type="dots" /></Text>
            <Text color="gray" italic>
              Analyzing{context.affectedModules.length > 0
                ? ` ${context.affectedModules.slice(0, 3).join(', ')}`
                : ' changes'}
              {' '}and crafting commit suggestions...
            </Text>
          </Box>
          <Text color="gray" dimColor>Model: {ai.getModelName()}</Text>
        </Box>
      )}

      {/* SUGGESTION SELECT SCREEN */}
      {!isGenerating && step === 'select-suggestion' && suggestions.length > 0 && (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">✨ Select a commit message suggestion (arrow keys to preview):</Text>
          
          <SelectInputDefault
            items={selectItems}
            onHighlight={(item: { value: string }) => {
              const idx = parseInt(item.value, 10);
              if (!isNaN(idx)) setHighlightedIndex(idx);
            }}
            onSelect={(item: { value: string }) => {
              const idx = parseInt(item.value, 10);
              if (!isNaN(idx)) {
                const suggestion = suggestions[idx];
                setSelectedSuggestion(suggestion);
                setSelectedMessage(suggestion.message);
                setStep('confirm');
              }
            }}
          />

          {/* Live Preview Panel */}
          {suggestions[highlightedIndex] && (
            <Box marginTop={1} flexDirection="column" paddingLeft={2} borderStyle="round" borderColor="gray">
              <Text color="gray" bold>Preview Suggestion {highlightedIndex + 1}:</Text>
              <Box marginTop={0} flexDirection="column" paddingLeft={2}>
                {(() => {
                  const { subject, body } = formatMessagePreview(suggestions[highlightedIndex].message);
                  return (
                    <>
                      <Text bold color="green">{subject}</Text>
                      {body && (
                        <Box marginTop={1} flexDirection="column">
                          {body.split('\n').map((line, i) => (
                            <Text key={i} color="gray">  {line}</Text>
                          ))}
                        </Box>
                      )}
                    </>
                  );
                })()}
              </Box>
            </Box>
          )}
          <Text color="gray" dimColor>↑↓ navigate · Enter select · Ctrl+C exit</Text>
        </Box>
      )}

      {/* CONFIRM / ACTIONS */}
      {step === 'confirm' && selectedSuggestion && (
        <Box flexDirection="column" gap={1}>
          {/* Selected Message Preview */}
          <Box flexDirection="column" paddingLeft={2} marginBottom={1} borderStyle="round" borderColor="cyan">
            <Text color="gray" bold>Selected commit message:</Text>
            <Box marginTop={0} flexDirection="column" paddingLeft={2}>
              {(() => {
                const { subject, body } = formatMessagePreview(selectedMessage);
                return (
                  <>
                    <Text bold color="green">{subject}</Text>
                    {body && (
                      <Box marginTop={1} flexDirection="column">
                        {body.split('\n').map((line, i) => (
                          <Text key={i} color="gray">  {line}</Text>
                        ))}
                      </Box>
                    )}
                  </>
                );
              })()}
            </Box>
          </Box>

          <Text bold color="cyan">What would you like to do?</Text>
          <SelectInputDefault
            items={[
              ...(selectedMessage.includes('\n')
                ? [
                    {
                      label: dry ? '📋  Preview full message' : '🚀  Commit with full message (subject + body)',
                      value: 'commit-full',
                    },
                    {
                      label: dry ? '📋  Preview subject line only' : '🚀  Commit with subject line only',
                      value: 'commit-subject',
                    },
                  ]
                : [
                    {
                      label: dry ? '📋  Preview message' : '🚀  Commit with this message',
                      value: 'commit-full',
                    },
                  ]),
              { label: '✏️   Edit message manually (in terminal)', value: 'edit' },
              { label: '📝  Edit in external editor', value: 'edit-external' },
              { label: '⬅️   Choose different suggestion', value: 'back' },
              { label: '🔄  Regenerate all suggestions', value: 'retry' },
              { label: '❌  Cancel', value: 'cancel' },
            ]}
            onSelect={handleAction}
          />
        </Box>
      )}

      {/* EDITING SCREEN */}
      {step === 'editing' && (
        <Box flexDirection="column" gap={0} paddingLeft={2}>
          <Text color="yellow" bold>✏️  Edit commit message (Use literal \n for new lines):</Text>
          <Box marginY={1} paddingLeft={2}>
            <TextInputDefault
              value={editedMessage}
              onChange={setEditedMessage}
              onSubmit={() => {
                setSelectedMessage(editedMessage.replace(/\\n/g, '\n'));
                setStep('confirm');
              }}
              placeholder="Enter commit message..."
            />
          </Box>
          <Text color="gray" dimColor>Enter to confirm · Esc to return to confirm screen</Text>
        </Box>
      )}
    </Box>
  );
};

export default App;
