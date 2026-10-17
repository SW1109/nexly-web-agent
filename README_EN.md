# QuizMate · Smart Practice Assistant

[English](README_EN.md) | [中文](README.md)

> A Chrome / Edge browser extension for web-based exercises and coding practice, supporting both **Direct API** and **Local CLI** modes.

[User Guide](docs/USER_GUIDE.md) · [Privacy Policy](docs/PRIVACY.md) · [Permissions Directory](docs/PERMISSIONS.md) · [Edge Store Listing](docs/edge-store/SUBMISSION.md) · [Report Bug](https://github.com/SW1109/nexly-web-agent/issues/new?template=bug_report.yml) · [Contributing](CONTRIBUTING.md)

QuizMate is designed for learning and practice environments where assistive tools are permitted. The extension automatically detects questions, options, and code editors on the current web page, requests solution proposals from your chosen LLM or local CLI, and supports verified readback, automatic filling, and code sample validation. Final submissions are strictly manual—QuizMate never submits answers or evades platform rules automatically.

---

## Key Features

- **Dual Connection Modes**
  - **Direct API Mode**: Zero Node.js and no local bridge required. Directly connect to official or OpenAI-compatible APIs (e.g., DeepSeek, Qwen, Kimi, GLM, Doubao, OpenAI, etc.).
  - **Local CLI Mode**: Integrates with local command-line tools (Codex CLI, Claude Code, Gemini CLI, Qwen Code, Kimi CLI) via Chrome Native Messaging, reusing your existing terminal logins and configurations.
- **Comprehensive Question Type Support**
  - Supports single-choice, multiple-choice, true/false, fill-in-the-blank, short answer, and programming questions.
  - Deeply compatible with web-based code editors including Monaco Editor, Ace Editor, and CodeMirror.
- **Automated Code Sample Self-Repair**
  - Executes in-page sample test cases after code insertion. If errors occur, the failure logs and problematic code can be analyzed by the AI for up to 2 automated repair attempts.
  - Code remains on the current problem after execution, whether passed or failed. Never clicks final submission.
- **In-Page Floating Widget**
  - Injects a lightweight floating control widget directly into the problem area. Expands on hover, supports dragging, and provides keyboard shortcuts for fine-tuning positioning to prevent frequent tab/window switching.
- **Strict Security & Privacy**
  - API keys are stored in Session Storage by default, with optional local AES-GCM-256 password-encrypted persistent storage.
  - Zero data collection, no telemetry, and no external tracking services.

---

## Quick Installation & Setup

### Option 1: Direct API Mode (Recommended, Zero Environment Dependencies)

Best for users who do not want to set up local CLI tools or Node.js.

1. **Build or Download the Extension**:
   - Run `npm run build` to generate the `dist/extension/` directory (or extract a pre-built extension release archive).
2. **Load into Browser**:
   - Open Chrome or Edge and navigate to `chrome://extensions` (or `edge://extensions`).
   - Enable **"Developer mode"** in the top right corner.
   - Click **"Load unpacked"** and select the project's `dist/extension` folder.
3. **Configure API Service**:
   - Click the extension icon to open the side panel and acknowledge the initial data usage notice.
   - Click **"Settings"** (top right gear icon) and switch Connection Mode to **"API Mode"**.
   - Select a provider preset or enter a custom compatible endpoint URL, fill in the API Key, and select/enter the model ID.
   - Click **"Test Connection"** to verify service accessibility, then click Save.

### Option 2: Local CLI Mode (Leverage Existing Terminal CLI Tools)

Best for users who already have configured CLI tools such as Codex, Claude Code, Gemini CLI, Qwen Code, or Kimi CLI.

**Requirements**: Node.js 22+, Chrome or Edge browser.

1. **Install the Native Messaging Bridge**:
   ```bash
   # Chrome development build: run in the project root
   node scripts/setup.mjs

   # Edge: replace YOUR_EDGE_EXTENSION_ID with this extension's actual 32-character ID from edge://extensions
   node scripts/setup.mjs --browser edge --extension-id YOUR_EDGE_EXTENSION_ID
   ```
   *Note: On Windows, run the command in PowerShell; on macOS/Linux, `bash scripts/setup.sh` is also available.*
   The default command registers Chrome and authorizes the development ID. The Edge store build has a store-assigned ID and needs its own Edge registration. Installing the extension from the store does not install the local CLI bridge. If your local environment is already set up, update registration directly with `node scripts/install-native.mjs --browser edge --extension-id YOUR_EDGE_EXTENSION_ID`.
2. **Load the Extension**:
   - For development builds, enable Developer mode in `chrome://extensions` or `edge://extensions` and load `dist/extension`. If you already installed the store version, use that installation.
3. **Verify Connection**:
   - Open Extension Settings, choose **"Local Mode"**, select your installed CLI, and click **"Refresh Connection"** until status shows connected.
   - If the bridge is unavailable, open **"Set up local bridge"** to detect the browser and extension ID, copy the installation command, or download a repair script. Updates to the same store listing keep the same ID.

---

## Usage Guide

1. **Reading Questions**:
   - Navigate to an exercise page where assistance is permitted, then click **"Re-read"** in the side panel (or trigger it from the in-page floating widget).
   - The extension automatically parses problem descriptions, types, options, and code editors. For cross-origin iframes, click "Authorize this site" once.
2. **Preview vs. Answer**:
   - **Preview Only**: Queries the model to display explanations and recommended answers without modifying web page content.
   - **Start Answering**: When confidence exceeds threshold, the extension automatically fills options/inputs and verifies the written result.
3. **Continuous Practice**:
   - Supports batch practice from 1 to 20 questions. Choice and fill-in-the-blank questions automatically advance to the next problem upon verification; programming questions always pause and wait for manual user review and submission.
4. **Shortcuts & Floating Controls**:
   - Default hotkey: `Alt + Shift + N` (Start / Pause / Resume).
   - Floating Widget: Expands on hover and collapses on leave. Drag to relocate, or use `Alt + Arrow keys` to nudge position.

---

## Pacing & Timing Settings

Fine-tune operation rhythm in Settings to maintain human-like interaction and respect platform constraints:

| Parameter | Default | Description |
| --- | --- | --- |
| Delay after answer | 1500 ms | Waiting period before filling once the model returns an answer |
| Action interval | 800 ms | Pause between sequential clicks or multi-step operations |
| Typing interval | 40 ms | Character typing delay for blanks and code editors |
| Typewriter simulation | Enabled | Simulates keystrokes when enabled; fills instantly when disabled |

---

## Local Development & Testing

Developed with vanilla modern JavaScript without runtime npm dependencies.

```bash
# Lint syntax and verify manifest references
npm run check

# Run full test suite
npm test

# Build extension into dist/
npm run build

# Inspect local CLI and native host configuration
npm run doctor
```

- `extension/`: Source code for the Manifest V3 browser extension.
- `bridge/`: Native Messaging host communication scripts and adapters.
- `scripts/`: Project build, environment setup, and platform registration tools.
- `tests/`: Comprehensive regression test suite covering API protocol, CLI contracts, DOM parsing, and runtime behavior.

---

## Boundaries & Disclaimers

1. **Manual Submission Policy**: This tool is an educational and practice assistant. It **never clicks "Submit", "Turn In", or "Finish Exam"**. All final submissions must be inspected and performed by the user.
2. **Compliance**: Use only in educational, practice, and self-assessment environments where AI assistance is explicitly authorized. Do not use for accredited exams or in violation of academic integrity policies.
3. **Model Accuracy**: Large language models may produce hallucinations or inaccuracies. Confidence ratings reflect internal model heuristics and do not guarantee correctness.
4. **Privacy**: All settings and keys are stored locally. Direct API requests go exclusively to your configured service endpoint without passing through any intermediate proxy servers.

---

## Voluntary Sponsorship

If QuizMate has been helpful for your studies or coding practice, you are welcome to voluntarily support its ongoing maintenance!
- All features are fully open and **never locked behind any paywall**.
- Sponsorship does not guarantee model output accuracy or specific exam scores.
- Payments are handled directly by WeChat Pay. Please verify recipient and amount before completing payment. The extension does not record or process any personal financial transactions.

<p align="left">
  <img src="extension/assets/wechat-support.jpg" width="280" alt="WeChat Pay Sponsorship QR Code">
</p>

