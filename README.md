# 🚀 TalentOS Application Copilot — Chrome Extension (Manifest V3)

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Playwright Tested](https://img.shields.io/badge/Tested_with-Playwright-45BA4B?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Node Version](https://img.shields.io/badge/Node.js-v20+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![CI Status](https://img.shields.io/badge/CI-Passing-brightgreen?logo=github-actions&logoColor=white)](https://github.com/skarion-dev/talentos-copilot-extension/actions)

**TalentOS Application Copilot** is a high-performance Chrome Extension designed to automate, streamline, and intelligently fill out job application forms across major Applicant Tracking Systems (ATS) including **Lever**, **Ashby**, **Greenhouse**, **Workday**, **SmartRecruiters**, and **Zoho Recruit**.

Powered by AI field reasoning, multi-frame DOM scanning, on-the-fly PDF generation, and automated candidate preference rules, TalentOS Copilot delivers an effortless application experience.

---

## ✨ Key Features

- **🌐 Universal ATS Multi-Frame Support**: Pierces embedded `<iframe>` containers and complex **Shadow DOM** roots to reliably scan and fill out forms on Ashby, Lever, Greenhouse, Workday, SmartRecruiters, and custom job boards.
- **🤖 Intelligent Form Analysis & Plan Preview**: Scans form inputs in real time, categorizes confidence levels (`🟢 High`, `🟡 Review`, `🔴 Low`), and presents an interactive plan preview before taking action.
- **⚡ Automated Candidate Preference Rules**: Automatically enforces key candidate rules — such as defaulting **US Work Authorization** questions (*"Are you legally authorized to work in the US?"*) to `"Yes"` with high confidence.
- **📄 Fail-Safe PDF Resume Attachment**: Automatically compiles a clean, professional PDF resume client-side and attaches it to the form input even if no server-side CRM export exists yet.
- **💬 Context-Aware Copilot Chat**: Candidates can ask questions in natural language about how or why specific fields were filled, backed by exact DOM question prompts and AI reasoning.
- **💰 Token Cost Optimization**: Compacted JSON payloads and chat context reduce LLM API token consumption by **40% to 75%** per application.
- **🎨 Glassmorphic Modern UI**: Styled with Google Fonts **Inter**, color-coded match status badges, real-time CSS loading spinners, and hover elevation states.

---

## 🛠️ Architecture Overview

```
talentos-copilot-extension/
├── manifest.json              # Manifest V3 setup (Permissions, SidePanel, Scripting)
├── background.js              # Service Worker managing side panel states & submit signals
├── content.js                 # DOM scanner, Shadow DOM piercer & form execution engine
├── popup.html                 # Glassmorphic Side Panel UI (Inter font, badges, spinners)
├── popup.js                   # Extension orchestrator, API communications & Chat agent
├── pdfGen.js                  # Client-side PDF compilation utility (Resume & Cover Letter)
├── fixtures/                  # HTML test fixtures for major ATS platforms
│   ├── ashby.html
│   ├── greenhouse.html
│   ├── lever.html
│   ├── smartrecruiters.html
│   ├── workday.html
│   └── zoho.html
├── tests/                     # Playwright integration test suite
│   └── content-fixtures.spec.js
└── .github/workflows/ci.yml   # Continuous Integration pipeline (Automated testing)
```

---

## 🚀 Quick Start & Installation

### 1. Developer Setup
Clone the repository to your local machine:
```bash
git clone https://github.com/skarion-dev/talentos-copilot-extension.git
cd talentos-copilot-extension
```

### 2. Load Extension in Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `talentos-copilot-extension` project folder.
4. Pin **TalentOS Application Copilot** to your browser toolbar.

---

## 🧪 Running Automated Tests

The extension includes a Playwright browser fixture test suite covering 6 major ATS layouts.

### Install Dependencies
```bash
npm install
npx playwright install --with-deps chromium
```

### Run Fixture Tests
```bash
npm test
```

---

## ⚙️ Configuration & API Integration

The extension connects to the TalentOS API backend via the endpoints:
- `GET /api/extension/v1/candidates` — Retrieves candidate profiles & resumes.
- `POST /api/extension/v1/copilot/fill-plan` — Generates AI field-fill instructions.
- `POST /api/extension/v1/copilot/chat` — Context-aware Q&A for application decisions.
- `POST /api/extension/v1/copilot/record-outcome` — Captures candidate edits for feedback learning loops.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
