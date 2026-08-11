# TalentOS Application Copilot

TalentOS Application Copilot is a Chrome extension that helps candidates analyze and complete online job application forms. It uses a Manifest V3 service worker, a content script for page interaction, a side-panel interface, and a TalentOS API backend for candidate data and AI-assisted fill plans.

The extension is designed to work with common Applicant Tracking System layouts, including Greenhouse, Lever, Workday, Ashby, SmartRecruiters, and Zoho.

## Features

- Scan application forms and collect field labels, names, types, options, required state, and selectors.
- Analyze scanned fields through the TalentOS API and preview the proposed fill plan before applying it.
- Fill text inputs, selects, radio buttons, and checkboxes while dispatching the relevant browser events.
- Detect and attach resume and cover-letter files when supported by the page.
- Generate resume and cover-letter PDFs locally in the browser using the vendored jsPDF library.
- Capture final field values and submit outcome data for learning workflows.
- Provide context-aware application assistance through the side-panel chat interface.
- Detect application submission controls and synchronize application status with the backend.
- Support form content distributed across frames and form elements within shadow roots during scanning.

## Architecture

```
talentos-copilot-extension/
├── manifest.json              # Chrome Manifest V3 configuration
├── background.js              # Service worker and submission-status handling
├── content.js                 # Form scanning, filling, file handling, and submission detection
├── popup.html                 # Side-panel markup and styles
├── popup.js                   # Side-panel state, API integration, and workflow orchestration
├── pdfGen.js                  # Client-side resume and cover-letter PDF generation
├── vendor/                    # Vendored third-party browser dependencies
├── fixtures/                  # HTML fixtures representing ATS form layouts
├── tests/                     # Playwright tests
└── .github/workflows/ci.yml   # Continuous integration workflow
```

### Runtime Flow

1. Chrome loads the extension from `manifest.json`.
2. The service worker manages extension-level events and pending submission signals.
3. `content.js` is injected into pages and scans the active form, including supported frames and shadow roots.
4. `popup.js` requests candidate data and sends the form snapshot to the TalentOS API.
5. The side panel displays the returned fill plan and its confidence levels.
6. Approved instructions are sent back to the content script for application to the page.
7. The extension can capture user corrections, generate or attach documents, and report application outcomes.

## Requirements

- Google Chrome with Manifest V3 support.
- Node.js and npm for running the test suite.
- Access to a configured TalentOS API backend.
- A TalentOS API key for authenticated API requests.

## Installation

Clone the repository and install the development dependencies:

```bash
git clone https://github.com/skarion-dev/talentos-copilot-extension.git
cd talentos-copilot-extension
npm install
```

To load the extension locally:

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the project directory.
5. Pin the extension if you want quick access from the browser toolbar.

## Configuration

The side panel provides fields for the API URL and API key. These settings are stored in `chrome.storage.local` and are used for subsequent requests.

The default API URL is defined in `popup.js`. Configure the API URL when using a local, staging, or self-hosted backend.

## API Integration

The extension sends authenticated requests to the configured backend using the following routes:

- `GET /api/extension/v1/copilot/init` retrieves candidate and application initialization data.
- `POST /api/extension/v1/copilot/fill-plan` generates field-fill instructions from a form snapshot.
- `POST /api/extension/v1/copilot/record-outcome` records AI values and final user-confirmed values.
- `POST /api/extension/v1/copilot/chat` provides contextual application assistance.
- `POST /api/extension/v1/copilot/application-status` records application status updates.
- `POST /api/extension/v1/copilot/resume-export` requests resume export data.
- `POST /api/extension/v1/copilot/cover-letter` requests cover-letter content or export data.
- `GET /api/extension/v1/resume-download` downloads a resume when a backend document is available.

The backend is not included in this repository. Its request and response schemas must remain compatible with the implementation in `popup.js`.

## Testing

Install the Playwright browser binaries:

```bash
npx playwright install --with-deps chromium
```

Run the test suite:

```bash
npm test
```

The tests exercise the content-script behavior against six local ATS-style fixtures: Ashby, Greenhouse, Lever, SmartRecruiters, Workday, and Zoho. Continuous integration also validates the manifest and JavaScript syntax.

## Security and Privacy Considerations

The extension has broad page access because it must inspect and interact with application forms. Form data, candidate information, API keys, and application-related content should be treated as sensitive.

- API keys are stored in Chrome local storage.
- Form snapshots and application data may be sent to the configured backend.
- The extension requests permissions for scripting, tabs, downloads, storage, the side panel, and all page URLs.
- Only install and configure the extension with a trusted backend.

Review the permissions and backend configuration before deploying the extension to end users.

## Known Limitations

- The backend service is external to this repository and is required for AI-assisted workflows.
- Automated tests focus on content-script behavior rather than full extension, side-panel, backend, or service-worker integration.
- Browser security restrictions can limit interaction with cross-origin frames.
- Complex shadow DOM and dynamically rendered forms may require additional site-specific handling.

## License

See the licensing files included in the repository, including `vendor/LICENSE-jspdf` for the vendored jsPDF dependency.
