# CommitAJ

CommitAJ is a premium, AI-powered interactive Command Line Interface (CLI) tool that stage-analyzes Git changes to generate high-quality commit messages conforming to the Conventional Commits specification.

Featuring a rich, React/Ink-powered Terminal User Interface (TUI), CommitAJ simplifies Git commits by suggesting technical, context-aware commit messages using advanced LLM reasoning, with support for local context analysis, fallback model routing, and direct integration with your favorite command-line text editors.

---

## ✨ Features

*   **Conventional Commits**: Automatically generates message suggestions matching the Conventional Commits format (Option 1: Short & Punchy; Option 2: Detailed with a subject line and description body).
*   **OpenRouter LLMs**: Connects to [OpenRouter](https://openrouter.ai/) for state-of-the-art models, including free models like `GPT OSS 120B` and `GLM 4.5 Air`.
*   **Robust Failover**: Transparently retries completions using fallback models if the primary model fails or experiences rate limits.
*   **Smart Diff Formatting**: Prioritizes source code files, ignores lockfiles and build artifacts, strips redundant context lines, and chunks diffs by relevance to fit token budgets.
*   **Local Repository Context**: Detects your framework (e.g. Next.js, Remix, Hono, React, Astro), active branch name, test inclusion, change intent (e.g., UI, testing, configuration), and affected directories to enrich the generation prompt.
*   **Git Editor Integration**: Allows editing commit suggestions in your preferred terminal editor (`git var GIT_EDITOR`, `$VISUAL`, `$EDITOR`, or fallbacks like VS Code, Vim, Nano, and Notepad).
*   **Graceful TUI Handling**: Supports dynamic resizing, responsive terminal borders, clean unmounting on `Ctrl+C` interrupt signals, and TTY checks for automated scripts.

---

## 🚀 Installation

Install CommitAJ globally via npm:

```bash
npm install -g commitaj
```

*Note: Requires Node.js >= 18.0.0 and Git installed on the system path.*

---

## ⚙️ Initial Setup

Initialize the global configuration using the interactive setup wizard:

```bash
commitaj init
```

The setup wizard will guide you through:
1.  **OpenRouter API Key**: Enter your key (obtained for free at [openrouter.ai/keys](https://openrouter.ai/keys)). You can skip this step by pressing Enter if you prefer to use the `OPENROUTER_API_KEY` environment variable.
2.  **Model Preset Selection**: Choose from recommended presets or input a custom OpenRouter model string (e.g., `openai/gpt-4o-mini`).

---

## 💻 Usage

Run `commitaj` inside any active Git repository with staged changes:

```bash
# Analyze staged changes and open the interactive selector
commitaj

# Perform a dry run (preview suggestions without committing)
commitaj --dry

# Run context analysis on a specific project directory path
commitaj /path/to/project

# Temporarily override the configured AI model
commitaj --model meta-llama/llama-3-8b-instruct:free
```

### ⌨️ TUI Keyboard Controls
*   **Arrow Keys (Up/Down)**: Navigate the menus and preview message descriptions.
*   **Enter**: Confirm the selected suggestion or action.
*   **Escape**: Return to the confirmation screen from the in-terminal editing prompt.
*   **Ctrl+C**: Gracefully exit the application and restore terminal configurations.

---

## 🔧 Manual Configuration

You can manage configuration settings directly via the command line:

```bash
# Set configuration keys
commitaj config set apiKey <your-key>
commitaj config set model <model-id>

# Get the value of a configuration key
commitaj config get model

# List all current configuration settings
commitaj config list

# Reset settings to default presets
commitaj config reset
```

---

## 📁 Configuration Options

| Option Key | Default Value | Description |
| :--- | :--- | :--- |
| `model` | `openai/gpt-oss-120b:free` | The primary AI model used to generate suggestions. |
| `fallbackModel` | `z-ai/glm-4.5-air:free` | The secondary model used as a fallback if the primary fails. |
| `apiKey` | *None* | Your OpenRouter API key. Can also be set via the `OPENROUTER_API_KEY` environment variable. |

---

## 📄 License

CommitAJ is open-source software licensed under the [MIT License](LICENSE).
