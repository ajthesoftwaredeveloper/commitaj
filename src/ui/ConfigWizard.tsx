import React, { useState, useEffect } from 'react';
import { Text, Box, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { setConfig } from '../config/index.js';
import { MODEL_PRESETS } from '../config/models.js';

const SelectInputDefault = (SelectInput as any).default || SelectInput;
const TextInputDefault = (TextInput as any).default || TextInput;

// ─────────────────────────────────────────────────────────────────────────────
// ConfigWizard
// ─────────────────────────────────────────────────────────────────────────────
const ConfigWizard: React.FC = () => {
  const { exit } = useApp();
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('openai/gpt-oss-120b:free');
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModelValue, setCustomModelValue] = useState('');

  // ── Exit schedule on complete step ──
  useEffect(() => {
    if (step === 2) {
      const timer = setTimeout(() => exit(), 3000);
      return () => clearTimeout(timer);
    }
  }, [step, exit]);

  const saveAndComplete = (finalModel: string) => {
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length > 0) {
      setConfig('apiKey', trimmedKey);
    }
    setConfig('model', finalModel.trim());
    setStep(2);
  };

  const handleModelSelect = (item: { value: string }) => {
    if (item.value === '__custom__') {
      setIsCustomModel(true);
    } else {
      setModel(item.value);
      saveAndComplete(item.value);
    }
  };

  const handleCustomSubmit = () => {
    if (customModelValue.trim()) {
      setModel(customModelValue.trim());
      saveAndComplete(customModelValue.trim());
    }
  };

  // ── Step renderer ─────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      // ── Step 0: API Key ───────────────────────────────────────────────────
      case 0:
        return (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Text color="white">Get your free API key at <Text color="cyan" bold>openrouter.ai/keys</Text></Text>
              <Text color="gray" dimColor>It's free — no credit card needed for free models. Leave empty to use env variables.</Text>
            </Box>
            <Box borderStyle="single" borderColor="cyan" paddingX={1}>
              <TextInputDefault
                value={apiKey}
                onChange={setApiKey}
                onSubmit={() => {
                  const trimmed = apiKey.trim();
                  if (trimmed.length === 0 || trimmed.length > 8) {
                    setStep(1);
                  }
                }}
                placeholder="sk-or-v1-... (or press Enter to skip if using env var)"
                mask="*"
              />
            </Box>
            {apiKey.length > 0 && apiKey.trim().length <= 8 && (
              <Text color="yellow">⚠ Key looks too short — double-check it</Text>
            )}
            <Text color="gray" dimColor>Press Enter when done</Text>
          </Box>
        );

      // ── Step 1: AI Model ──────────────────────────────────────────────────
      case 1:
        return (
          <Box flexDirection="column" gap={1}>
            {isCustomModel ? (
              <>
                <Text color="gray">Enter the OpenRouter model ID (e.g. <Text color="cyan">openai/gpt-4o-mini</Text>):</Text>
                <Box borderStyle="single" borderColor="yellow" paddingX={1}>
                  <TextInputDefault
                    value={customModelValue}
                    onChange={setCustomModelValue}
                    onSubmit={handleCustomSubmit}
                    placeholder="author/model-id"
                  />
                </Box>
                <Text color="gray" dimColor>Browse models at <Text color="cyan">openrouter.ai/models</Text></Text>
              </>
            ) : (
              <>
                <SelectInputDefault
                  items={[
                    ...MODEL_PRESETS.map(p => ({ label: p.label, value: p.id })),
                    { label: '🔧 Enter custom model ID...', value: '__custom__' },
                  ]}
                  onSelect={handleModelSelect}
                />
                <Text color="gray" dimColor>All listed models are free. Thinking models give better quality.</Text>
              </>
            )}
          </Box>
        );

      // ── Step 2: Done ──────────────────────────────────────────────────────
      case 2:
        return (
          <Box flexDirection="column" gap={1}>
            <Text color="green" bold>✔ Configuration saved!</Text>
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
              <Text color="gray">
                API Key: <Text color="white">{apiKey.trim() ? '*'.repeat(8) + apiKey.trim().slice(-4) : 'Not configured (using environment)'}</Text>
              </Text>
              <Text color="gray">
                Model:   <Text color="cyan">{model}</Text>
              </Text>
            </Box>
            <Box gap={1}>
              <Text color="gray">Run</Text>
              <Text color="cyan" bold>commitaj</Text>
              <Text color="gray">in any git repo to generate your first commit.</Text>
            </Box>
            <Text color="gray" dimColor>Closing in 3 seconds...</Text>
          </Box>
        );

      default:
        return null;
    }
  };

  const stepTitles = [
    'OpenRouter API Key',
    'AI Model',
    'Setup Complete!',
  ];

  const stepDescriptions = [
    'CommitAJ uses OpenRouter to access free AI models.',
    'Choose the AI model to generate your commit messages.',
    '',
  ];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      {/* Header */}
      <Box borderStyle="double" borderColor="cyan" paddingX={2} paddingY={0}>
        <Text bold color="cyan">CommitAJ Setup</Text>
        <Text color="gray">  ·  Step {step + 1} of 3</Text>
        <Text color="gray">  ·  {['●○○', '○●○', '○○●'][step]}</Text>
      </Box>

      {/* Step title + description */}
      <Box flexDirection="column">
        <Text bold color="white">{stepTitles[step]}</Text>
        {stepDescriptions[step] && (
          <Text color="gray">{stepDescriptions[step]}</Text>
        )}
      </Box>

      {/* Step content */}
      {renderStep()}

      {/* Footer */}
      {step < 2 && (
        <Text color="gray" dimColor>Ctrl+C to exit</Text>
      )}
    </Box>
  );
};

export default ConfigWizard;
