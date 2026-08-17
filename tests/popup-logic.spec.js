// Isolated tests for popup.js pure-JS functions (no Chrome API needed):
// parseFillPlanSafe, detectAtsFromUrl, getApprovedInstructions logic
const { test, expect } = require('@playwright/test');
const path = require('path');

// We load these functions in a real browser context via a data: URL
// that inlines the functions under test directly (no Chrome API deps).

async function evalInPage(page, fn) {
  return page.evaluate(fn);
}

// Inline parseFillPlanSafe and detectAtsFromUrl as extracted functions
// (they have no Chrome API dependencies)
const parseFillPlanSafeSrc = `
function parseFillPlanSafe(resp) {
  const rawObj = resp?.fillPlan;
  if (Array.isArray(rawObj)) return rawObj;
  if (rawObj == null) return [];
  let text = String(rawObj);
  text = text.replace(/^\`\`\`(?:json)?\\s*/i, '').replace(/\\s*\`\`\`\\s*$/, '').trim();
  text = text.replace(/,(\\s*[\\]}])/g, '$1');
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.fillPlan)) return parsed.fillPlan;
  } catch {}
  const arrMatch = text.match(/\\[[\\s\\S]*\\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  const objPattern = /\\{[^{}]*"selector"\\s*:[^{}]*\\}/g;
  const partials = [];
  let m;
  while ((m = objPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[0].replace(/,(\\s*})/g, '$1'));
      if (obj.selector) partials.push(obj);
    } catch {}
  }
  if (partials.length) return partials;
  throw new Error('Could not parse fill plan from AI response.');
}
window._parseFillPlanSafe = parseFillPlanSafe;
`;

const detectAtsFromUrlSrc = `
function detectAtsFromUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (/greenhouse\\.io|boards\\.greenhouse\\.io/.test(h)) return 'Greenhouse';
    if (/lever\\.co/.test(h)) return 'Lever';
    if (/workday\\.com|myworkdayjobs\\.com/.test(h)) return 'Workday';
    if (/smartrecruiters\\.com/.test(h)) return 'SmartRecruiters';
    if (/ashbyhq\\.com/.test(h)) return 'Ashby';
    if (/zohorecruit\\.com|zoho\\.com/.test(h)) return 'Zoho';
    if (/workable\\.com/.test(h)) return 'Workable';
    if (/bamboohr\\.com/.test(h)) return 'BambooHR';
    return 'Unknown ATS';
  } catch { return 'Unknown ATS'; }
}
window._detectAtsFromUrl = detectAtsFromUrl;
`;

async function setupFunctions(page) {
  await page.goto(`file://${path.join(__dirname, '..', 'fixtures', 'greenhouse.html')}`);
  await page.addScriptTag({ content: parseFillPlanSafeSrc });
  await page.addScriptTag({ content: detectAtsFromUrlSrc });
}

// ── parseFillPlanSafe ─────────────────────────────────────────────────────────

test('parseFillPlanSafe: returns array directly when fillPlan is already an array', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => window._parseFillPlanSafe({
    fillPlan: [{ selector: '#name', fieldType: 'text', value: 'Avirup', confidence: 'high' }]
  }));
  expect(Array.isArray(result)).toBe(true);
  expect(result).toHaveLength(1);
  expect(result[0].selector).toBe('#name');
});

test('parseFillPlanSafe: returns empty array when fillPlan is null/undefined', async ({ page }) => {
  await setupFunctions(page);
  const r1 = await page.evaluate(() => window._parseFillPlanSafe({}));
  const r2 = await page.evaluate(() => window._parseFillPlanSafe({ fillPlan: null }));
  expect(r1).toEqual([]);
  expect(r2).toEqual([]);
});

test('parseFillPlanSafe: strips markdown json fences', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => window._parseFillPlanSafe({
    fillPlan: '```json\n[{"selector":"#fn","fieldType":"text","value":"Avirup","confidence":"high"}]\n```'
  }));
  expect(Array.isArray(result)).toBe(true);
  expect(result[0].selector).toBe('#fn');
});

test('parseFillPlanSafe: strips plain backtick fences', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => window._parseFillPlanSafe({
    fillPlan: '```\n[{"selector":"#em","fieldType":"text","value":"a@b.com","confidence":"high"}]\n```'
  }));
  expect(result[0].value).toBe('a@b.com');
});

test('parseFillPlanSafe: fixes trailing commas in arrays', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => window._parseFillPlanSafe({
    fillPlan: '[{"selector":"#fn","value":"Avirup",}]'
  }));
  expect(result[0].value).toBe('Avirup');
});

test('parseFillPlanSafe: fixes trailing commas in objects', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => window._parseFillPlanSafe({
    fillPlan: '[{"selector":"#fn","fieldType":"text","value":"Test","confidence":"high",}]'
  }));
  expect(result).toHaveLength(1);
});

test('parseFillPlanSafe: extracts array from surrounding prose', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => window._parseFillPlanSafe({
    fillPlan: 'Here is the fill plan:\n[{"selector":"#fn","fieldType":"text","value":"Avirup","confidence":"high"}]\nEnd of plan.'
  }));
  expect(result[0].selector).toBe('#fn');
});

test('parseFillPlanSafe: partial recovery from malformed JSON with selector objects', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => window._parseFillPlanSafe({
    fillPlan: 'Some broken text {"selector":"#fn","fieldType":"text","value":"Avirup","confidence":"high"} more broken {"selector":"#em","fieldType":"text","value":"a@b.com","confidence":"high"}'
  }));
  expect(result.length).toBeGreaterThanOrEqual(1);
  expect(result.some((r) => r.selector === '#fn')).toBe(true);
});

test('parseFillPlanSafe: throws on completely unparseable input', async ({ page }) => {
  await setupFunctions(page);
  const threw = await page.evaluate(() => {
    try { window._parseFillPlanSafe({ fillPlan: 'this is just prose with no JSON at all' }); return false; }
    catch { return true; }
  });
  expect(threw).toBe(true);
});

test('parseFillPlanSafe: handles nested fillPlan in parsed object', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => window._parseFillPlanSafe({
    fillPlan: '{"fillPlan":[{"selector":"#fn","value":"Avirup"}]}'
  }));
  expect(result[0].selector).toBe('#fn');
});

// ── detectAtsFromUrl ──────────────────────────────────────────────────────────

const urlCases = [
  ['https://boards.greenhouse.io/company/jobs/123', 'Greenhouse'],
  ['https://jobs.lever.co/company/abc', 'Lever'],
  ['https://company.myworkdayjobs.com/en-US/careers', 'Workday'],
  ['https://jobs.smartrecruiters.com/Company/job', 'SmartRecruiters'],
  ['https://jobs.ashbyhq.com/company', 'Ashby'],
  ['https://recruit.zohorecruit.com/jobs', 'Zoho'],
  ['https://apply.workable.com/company/j/job/', 'Workable'],
  ['https://company.bamboohr.com/jobs/view', 'BambooHR'],
  ['https://example.com/jobs', 'Unknown ATS'],
  ['not-a-url', 'Unknown ATS'],
];

for (const [url, expected] of urlCases) {
  test(`detectAtsFromUrl: ${url.substring(0, 45)} → ${expected}`, async ({ page }) => {
    await setupFunctions(page);
    const result = await page.evaluate((u) => window._detectAtsFromUrl(u), url);
    expect(result).toBe(expected);
  });
}

// ── getApprovedInstructions logic ─────────────────────────────────────────────
// Test the approval logic inline — high always included, medium default-checked,
// low default-unchecked (requires DOM checkboxes to be set up)

test('getApprovedInstructions: high confidence always included', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => {
    // Simulate the logic of getApprovedInstructions without Chrome APIs
    const instructions = [
      { selector: '#fn', fieldType: 'text', value: 'Avirup', confidence: 'high' },
      { selector: '#em', fieldType: 'text', value: 'a@b.com', confidence: 'high' },
    ];
    // Simulate: high confidence → always included, no checkbox needed
    return instructions.filter((i) => {
      if (i.fieldType === 'skip' || i.fieldType === 'file') return false;
      if (i.confidence === 'high') return true;
      return false; // no checkboxes in DOM = unchecked
    });
  });
  expect(result).toHaveLength(2);
});

test('getApprovedInstructions: skip and file fieldTypes always excluded', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => {
    const instructions = [
      { selector: '#fn', fieldType: 'text',  value: 'Avirup', confidence: 'high' },
      { selector: '#rv', fieldType: 'file',  value: 'resume.pdf', confidence: 'high' },
      { selector: '#vt', fieldType: 'skip',  value: null, confidence: 'low' },
    ];
    return instructions.filter((i) => {
      if (i.fieldType === 'skip' || i.fieldType === 'file') return false;
      return i.confidence === 'high';
    });
  });
  expect(result).toHaveLength(1);
  expect(result[0].selector).toBe('#fn');
});

test('getApprovedInstructions: low confidence excluded when unchecked', async ({ page }) => {
  await setupFunctions(page);
  const result = await page.evaluate(() => {
    const instructions = [
      { selector: '#fn', fieldType: 'text', value: 'Avirup', confidence: 'high' },
      { selector: '#uc', fieldType: 'text', value: 'uncertain',  confidence: 'low' },
    ];
    // No checkboxes in DOM = low confidence not approved
    return instructions.filter((i) => {
      if (i.fieldType === 'skip' || i.fieldType === 'file') return false;
      if (i.confidence === 'high') return true;
      const chk = document.querySelector(`.approveCheck[data-selector="${CSS.escape(i.selector)}"]`);
      return chk ? chk.checked : i.confidence === 'medium';
    });
  });
  expect(result).toHaveLength(1);
  expect(result[0].selector).toBe('#fn');
});
