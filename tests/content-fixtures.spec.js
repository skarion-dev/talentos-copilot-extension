const { test, expect } = require('@playwright/test');
const path = require('path');

const fixtures = [
  'greenhouse.html', 'lever.html', 'workday.html',
  'ashby.html', 'smartrecruiters.html', 'zoho.html',
  'workable.html', 'bamboohr.html',
];

async function setupMockChrome(page) {
  await page.addInitScript(() => {
    window.__messages = {};
    window.chrome = {
      runtime: {
        onMessage: {
          addListener(fn) { window.__messages.handler = fn; },
        },
        sendMessage() {},
      },
    };
  });
}

async function injectContentScript(page) {
  await page.addScriptTag({ path: path.join(__dirname, '..', 'content.js') });
}

async function message(page, action, payload = {}) {
  return page.evaluate(({ action, payload }) => new Promise((resolve) => {
    if (!window.__messages?.handler) {
      throw new Error('Content script message handler not ready');
    }
    window.__messages.handler({ action, ...payload }, {}, resolve);
  }), { action, payload });
}

for (const fixture of fixtures) {
  test(`${fixture} scans fields and applies safe values`, async ({ page }) => {
    await setupMockChrome(page);
    await page.goto('file://' + path.join(__dirname, '..', 'fixtures', fixture));
    await injectContentScript(page);

    const scan = await message(page, 'scanForm');
    expect(scan.ok).toBeTruthy();
    expect(scan.fields.length).toBeGreaterThanOrEqual(5);
    expect(scan.fields.some((field) => field.inputType === 'radio')).toBeTruthy();
    expect(scan.fields.some((field) => field.inputType === 'file')).toBeTruthy();

    const byName = Object.fromEntries(scan.fields.map((field) => [field.name, field]));
    const plan = [
      { selector: byName.firstName.selector, fieldType: 'text', value: 'Avirup', confidence: 'high' },
      { selector: byName.email.selector, fieldType: 'text', value: 'avirup@example.com', confidence: 'high' },
      { selector: byName.workAuth.selector, fieldType: 'select', value: 'Authorized', confidence: 'medium' },
      { selector: byName.veteran.selector, fieldType: 'radio', value: 'No', confidence: 'high' },
      { selector: byName.uncertain.selector, fieldType: 'text', value: 'must-not-fill', confidence: 'low' },
    ];
    const result = await message(page, 'applyFillPlan', { instructions: plan });
    expect(result.results.filter((item) => item.applied)).toHaveLength(4);
    expect(result.results.find((item) => item.selector === byName.uncertain.selector).reason).toBe('low_confidence_review');
    await expect(page.locator('[name="firstName"]')).toHaveValue('Avirup');
    await expect(page.locator('[name="email"]')).toHaveValue('avirup@example.com');
    await expect(page.locator('[name="uncertain"]')).toHaveValue('');
  });
}
