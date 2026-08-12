<div align="center">
  <h1>TalentOS Application Copilot</h1>
  <p><strong>AI-powered job application form fill and context-aware copilot for candidates.</strong></p>
  <p>
    <a href="https://github.com/skarion-dev/talentos-copilot-extension/actions/workflows/ci.yml"><img src="https://github.com/skarion-dev/talentos-copilot-extension/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
    <a href="https://developer.chrome.com/docs/extensions/mv3/intro/"><img src="https://img.shields.io/badge/Manifest_V3-Chrome-4285F4?style=flat-square" alt="Manifest V3" /></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20%2B-315e72?style=flat-square" alt="Node.js 20 or newer" /></a>
    <a href="https://playwright.dev/"><img src="https://img.shields.io/badge/Playwright-Tested-45BA4B?style=flat-square" alt="Playwright Tested" /></a>
  </p>
</div>

## Overview

This repository contains the Chrome Extension for **TalentOS Application Copilot**. It helps job candidates scan, analyze, and fill out job application forms across major Applicant Tracking Systems (ATS) including **Lever**, **Ashby**, **Greenhouse**, **Workday**, **SmartRecruiters**, **Zoho Recruit**, **Workable**, and **BambooHR**.

The experience is built around multi-frame DOM scanning, AI-powered field reasoning, automated candidate preference rules (e.g. US Work Authorization defaults), fail-safe PDF resume generation, context-aware Copilot Chat, and token-optimized API integration.

## Highlights

- Multi-frame `<iframe>` scanning and Shadow DOM traversal for complex ATS forms
- Instant AI field analysis with color-coded confidence levels (`🟢 High`, `🟡 Review`, `🔴 Low`)
- Candidate rule automation for US Work Authorization and key eligibility preferences
- Fail-safe client-side PDF resume attachment generation when server CRM export is missing
- Natural language Copilot Chat for field reasoning and fill decisions
- 40% to 75% LLM API token cost reduction through compact JSON payload formatting
- Responsive glassmorphic Side Panel UI built with Inter typography and loading spinners
- Playwright integration test suite covering 6 major ATS layouts

## Technology

| Area | Tools |
| --- | --- |
| Extension Platform | Chrome Manifest V3 (Service Worker, Side Panel, Scripting) |
| UI & Logic | HTML5, Vanilla CSS, JavaScript (ES2022) |
| PDF Engine | jsPDF (Client-side compilation) |
| Testing & QA | Playwright fixture runner |
| Automation & CI | GitHub Actions |

## Getting started

### Requirements

- Node.js **20.0.0 or newer**
- npm **10 or newer**
- Google Chrome browser with Manifest V3 support

### Install and run

```bash
git clone https://github.com/skarion-dev/talentos-copilot-extension.git
cd talentos-copilot-extension
npm install
```

### Load Extension in Google Chrome

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `talentos-copilot-extension` project folder.
4. Pin **TalentOS Application Copilot** to your browser toolbar.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run Playwright fixture test suite across 6 ATS layouts |
| `node --check popup.js` | Validate syntax for popup/side panel script |
| `node --check content.js` | Validate syntax for DOM content script |
| `node --check background.js` | Validate syntax for service worker script |

Install Playwright's browser once before running tests:

```bash
npx playwright install --with-deps chromium
npm test
```

## Configuration

The extension connects to the TalentOS API backend for candidate data and AI fill-plan generation.

Configure your API URL and API key in the extension side panel under **Settings**. Settings are persisted in `chrome.storage.local`.

## Project structure

```text
manifest.json              Chrome Manifest V3 configuration
background.js              Service worker and submission-status handling
content.js                 Form scanning, filling, file handling, and submission detection
popup.html                 Side-panel markup and styles
popup.js                   Side-panel state, API integration, and workflow orchestration
pdfGen.js                  Client-side resume and cover-letter PDF generation
vendor/                    Vendored third-party browser dependencies (jsPDF)
fixtures/                  HTML fixtures representing ATS form layouts
tests/                     Playwright integration test suite
.github/workflows/
  ci.yml                   Pull-request and push validation pipeline
```

## API Integration

The extension connects to the configured backend using the following routes:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/extension/v1/copilot/init` | Retrieves candidate and application initialization data |
| `POST /api/extension/v1/copilot/fill-plan` | Generates field-fill instructions from form snapshot |
| `POST /api/extension/v1/copilot/record-outcome` | Records AI values and final user-confirmed values |
| `POST /api/extension/v1/copilot/chat` | Provides contextual application assistance |
| `POST /api/extension/v1/copilot/application-status` | Records application submission updates |
| `POST /api/extension/v1/copilot/resume-export` | Requests resume export data |
| `POST /api/extension/v1/copilot/cover-letter` | Requests cover-letter content or export data |
| `GET /api/extension/v1/resume-download` | Downloads resume when backend document is available |

## Quality and security

Every push and pull request runs the GitHub Actions CI pipeline:

1. Clean dependency installation (`npm install`)
2. Chromium browser binaries provisioning
3. Manifest JSON validation
4. Syntax check for JavaScript files
5. Playwright fixture tests across Greenhouse, Lever, Workday, Ashby, SmartRecruiters, and Zoho

Form snapshots, candidate information, and API keys are treated as sensitive data. API keys are stored in `chrome.storage.local`.

## Contributing

1. Create a focused branch from `main`.
2. Ensure changes follow Manifest V3 standards and do not break ATS form scanning.
3. Run `npm test` before opening a pull request.

## License

Distributed under the MIT License. Copyright © 2026 TalentOS. All rights reserved.
