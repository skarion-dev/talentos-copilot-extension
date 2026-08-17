// ─── Constants & State ────────────────────────────────────────────────────────
const DEFAULT_URL = 'https://skarion-talent-os.skarion-talentos.workers.dev';
let settings = { baseUrl: DEFAULT_URL, apiKey: '' };
let tab = null;
let candidates = [];
let currentPlan = null;   // { applicationId, instructions, domain, candidateId, fieldLabelBySelector, … }
let chatHistory = [];     // [{role:'user'|'assistant', content:string}]

// Activity log — persists for the session
let activityLog = [];

// Application context — tracks what's linked on the current page
let appContext = {
  candidateName: '—',
  jobTitle: '—',
  ats: '—',
  applicationId: '',
  linked: false,
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const $ = (i) => document.getElementById(i);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const setStatus = (m, k = '') => {
  const el = $('status');
  if (!m) { el.innerHTML = ''; el.className = 'status'; return; }
  const icon = k === 'loading' ? '<div class="spinner"></div>'
    : k === 'success' ? '✓ '
    : k === 'error' ? '⚠️ ' : '';
  el.innerHTML = `${icon}<span>${escapeHtml(m)}</span>`;
  el.className = `status ${k}`;
};

// ─── Activity Log ─────────────────────────────────────────────────────────────
function logActivity(msg, type = 'info') {
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  activityLog.push({ ts, msg: String(msg), type });
  renderLog();
}

function renderLog() {
  const el = $('logEntries');
  if (!el) return;
  if (!activityLog.length) {
    el.innerHTML = '<div class="log-empty">No activity yet. Analyze a form to begin.</div>';
    return;
  }
  el.innerHTML = activityLog.slice().reverse().map(({ ts, msg, type }) =>
    `<div class="log-row log-${escapeHtml(type)}"><span class="log-ts">${escapeHtml(ts)}</span><span class="log-msg">${escapeHtml(msg)}</span></div>`
  ).join('');
}

// ─── ATS Detection ────────────────────────────────────────────────────────────
function detectAtsFromUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (/greenhouse\.io|boards\.greenhouse\.io/.test(h)) return 'Greenhouse';
    if (/lever\.co/.test(h)) return 'Lever';
    if (/workday\.com|myworkdayjobs\.com/.test(h)) return 'Workday';
    if (/smartrecruiters\.com/.test(h)) return 'SmartRecruiters';
    if (/ashbyhq\.com/.test(h)) return 'Ashby';
    if (/zohorecruit\.com|zoho\.com/.test(h)) return 'Zoho';
    if (/workable\.com/.test(h)) return 'Workable';
    if (/bamboohr\.com/.test(h)) return 'BambooHR';
    return 'Unknown ATS';
  } catch { return 'Unknown ATS'; }
}

// ─── App Context Card ─────────────────────────────────────────────────────────
function updateAppContext(updates) {
  Object.assign(appContext, updates);
  renderContextCard();
}

function renderContextCard() {
  const nameEl = $('ctxCandidate');
  const atsEl  = $('ctxAts');
  const linkEl = $('ctxLinked');
  const jobEl  = $('ctxJob');
  if (nameEl) nameEl.textContent = appContext.candidateName;
  if (atsEl)  atsEl.textContent  = appContext.ats;
  if (linkEl) {
    linkEl.textContent  = appContext.linked ? '✓ Linked' : '✗ Not linked';
    linkEl.className    = `ctx-val ${appContext.linked ? 'ctx-linked' : 'ctx-unlinked'}`;
  }
  if (jobEl)  jobEl.textContent  = appContext.jobTitle;
}

// ─── Telemetry ────────────────────────────────────────────────────────────────
function recordTelemetry(event) {
  if (!settings.apiKey) return;
  fetch(`${settings.baseUrl}/api/extension/v1/copilot/telemetry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
      'X-TalentOS-Client': 'application-copilot-extension/1.3.0',
    },
    body: JSON.stringify({ ...event, ts: Date.now() }),
  }).catch(() => {});
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  if (!settings.apiKey) throw new Error('Add your TalentOS API key in Settings.');
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${settings.baseUrl}${path}`, {
      signal: controller.signal,
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
        'X-TalentOS-Client': 'application-copilot-extension/1.3.0',
        ...(opts.headers || {}),
      },
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(b?.error?.message || b?.error || `HTTP ${res.status}`);
    return b;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out after 30 s. Check your connection.');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function apiBlob(path) {
  if (!settings.apiKey) throw new Error('Add your TalentOS API key in Settings.');
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${settings.baseUrl}${path}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'X-TalentOS-Client': 'application-copilot-extension/1.3.0',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Download timed out.');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Robust JSON parser ───────────────────────────────────────────────────────
function parseFillPlanSafe(resp) {
  // Accepts the raw API response object and returns the parsed fillPlan array.
  // Handles: markdown code fences, trailing commas, partial JSON.
  const rawObj = resp?.fillPlan;

  // If already an array, just return it
  if (Array.isArray(rawObj)) return rawObj;

  // If undefined/null, fall back to empty
  if (rawObj == null) return [];

  let text = String(rawObj);

  // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // 2. Fix trailing commas before ] or }
  text = text.replace(/,(\s*[\]}])/g, '$1');

  // 3. Attempt direct parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.fillPlan)) return parsed.fillPlan;
  } catch {}

  // 4. Extract outermost [ … ] or { … }
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // 5. Partial recovery — grab individual instruction objects via regex
  const objPattern = /\{[^{}]*"selector"\s*:[^{}]*\}/g;
  const partials = [];
  let m;
  while ((m = objPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[0].replace(/,(\s*})/g, '$1'));
      if (obj.selector) partials.push(obj);
    } catch {}
  }
  if (partials.length) {
    logActivity(`⚠ Fill plan JSON was malformed — recovered ${partials.length} instruction(s) via partial parse.`, 'warn');
    return partials;
  }

  throw new Error('Could not parse fill plan from AI response. Try analyzing again.');
}

// ─── Content-script bridge ────────────────────────────────────────────────────
async function send(action, payload = {}) {
  // Re-inject content script into all frames on every call (idempotent)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js'],
    });
  } catch {}

  // Multi-frame actions dispatched via executeScript
  const multiFrameActions = {
    scanForm: {
      func: () => (typeof window.__tosScanForm === 'function' ? window.__tosScanForm() : []),
      collect: (results) => {
        const allFields = (results || []).flatMap((r) => r.result || []);
        return allFields.length > 0 ? { ok: true, fields: allFields } : null;
      },
    },
    applyFillPlan: {
      func: (instructions) => (typeof window.__tosApplyFillPlan === 'function' ? window.__tosApplyFillPlan(instructions) : []),
      args: [payload.instructions],
      collect: (results) => ({ ok: true, results: (results || []).flatMap((r) => r.result || []) }),
    },
    captureCurrentValues: {
      func: (instructions) => (typeof window.__tosCaptureCurrentValues === 'function' ? window.__tosCaptureCurrentValues(instructions) : []),
      args: [payload.instructions],
      collect: (results) => ({ ok: true, values: (results || []).flatMap((r) => r.result || []) }),
    },
    attachFile: {
      func: (selector, base64, fileName, mimeType) => (
        typeof window.__tosAttachFile === 'function'
          ? window.__tosAttachFile(selector, base64, fileName, mimeType)
          : { applied: false, reason: 'not_found' }
      ),
      args: [payload.selector, payload.base64, payload.fileName, payload.mimeType],
      collect: (results) => {
        const hit = (results || []).find((r) => r.result?.applied);
        return hit ? { ok: true, ...hit.result } : null;
      },
    },
    auditRequiredFields: {
      func: () => (typeof window.__tosAuditRequiredFields === 'function' ? window.__tosAuditRequiredFields() : { ok: true, missing: [] }),
      collect: (results) => ({ ok: true, missing: (results || []).flatMap((r) => r.result?.missing || []) }),
    },
    verifyFillPlan: {
      func: (instructions) => (typeof window.__tosVerifyFillPlan === 'function' ? window.__tosVerifyFillPlan(instructions) : []),
      args: [payload.instructions],
      collect: (results) => ({ ok: true, results: (results || []).flatMap((r) => r.result || []) }),
    },
    detectAts: {
      func: () => (typeof window.__tosDetectAts === 'function' ? window.__tosDetectAts() : 'Unknown ATS'),
      collect: (results) => {
        const hit = (results || []).find((r) => r.result && r.result !== 'Unknown ATS');
        return { ok: true, ats: (hit?.result) || 'Unknown ATS' };
      },
    },
    detectSubmissionConfirmation: {
      func: () => (typeof window.__tosDetectSubmissionConfirmation === 'function' ? window.__tosDetectSubmissionConfirmation() : false),
      collect: (results) => ({ ok: true, detected: (results || []).some((r) => r.result === true) }),
    },
    startConfirmationObserver: {
      func: () => (typeof window.__tosStartConfirmationObserver === 'function' ? window.__tosStartConfirmationObserver() : undefined),
      collect: () => ({ ok: true }),
    },
  };

  const def = multiFrameActions[action];
  if (def) {
    try {
      const scriptOpts = {
        target: { tabId: tab.id, allFrames: true },
        func: def.func,
      };
      if (def.args) scriptOpts.args = def.args;
      const results = await chrome.scripting.executeScript(scriptOpts);
      const collected = def.collect(results);
      if (collected !== null) return collected;
    } catch {}
  }

  try { return await chrome.tabs.sendMessage(tab.id, { action, ...payload }); }
  catch { return { ok: false }; }
}

// ─── Candidate list ───────────────────────────────────────────────────────────
function renderCandidates() {
  const sel = $('candidateSelect');
  sel.innerHTML = '<option value="">Select candidate…</option>' +
    candidates.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function renderResumes() {
  const c = candidates.find((c) => c.id === $('candidateSelect').value);
  const sel = $('resumeSelect');
  const resumes = c?.resumes || [];
  sel.innerHTML = '<option value="">(no resume / use profile only)</option>' +
    resumes.map((r) => `<option value="${r.id}">${escapeHtml(r.label || r.filename || r.kind)}</option>`).join('');
}

async function loadCandidates() {
  try {
    setStatus('Loading candidates…', 'loading');
    logActivity('Loading candidate list from TalentOS…');
    const r = await api('/api/extension/v1/copilot/init');
    candidates = r.data || [];
    renderCandidates();
    renderResumes();
    logActivity(`Loaded ${candidates.length} candidate(s).`);
    setStatus(candidates.length ? '' : 'No active candidates found.');
  } catch (e) {
    logActivity(`Failed to load candidates: ${e.message}`, 'error');
    setStatus(e.message, 'error');
  }
}

// ─── Application ID ───────────────────────────────────────────────────────────
function applicationIdFromTab() {
  try {
    const url = new URL(tab?.url || '');
    const hash = url.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    return params.get('talentos_application_id') || url.searchParams.get('talentos_application_id') || '';
  } catch { return ''; }
}

// ─── Field helper functions ───────────────────────────────────────────────────
function isWorkAuthField(label) {
  const s = String(label || '').toLowerCase();
  const isAuth = /\b(work\s*auth|authorized\s*to\s*work|legally\s*authorized|eligible\s*to\s*work|permission\s*to\s*work)\b/i.test(s);
  const isSponsorship = /\b(require|need|future|sponsorship|visa)\b/i.test(s) && !/\b(authorized|eligible|permission)\b/i.test(s);
  return isAuth && !isSponsorship;
}

function isCandidateMandatoryManualField(label) {
  const s = String(label || '').toLowerCase();
  const isDemographic = /\b(disability|disabled|veteran|military|race|ethnicity|gender|identity|pronoun|pronouns|sexual\s*orientation|hispanic|latino|community|communities|diversity|demographic|eeo|equal\s*opportunity|self-identify|self\s*identify)\b/i.test(s);
  const isLegalOrSignature = /\b(signature|sign\s*here|legal\s*name|acknowledge|consent|terms|privacy\b|background\s*check|certify|attest|i\s*agree)\b/i.test(s) && !/\b(legal\s*name\s*\(if\s*different\))\b/i.test(s);
  const isSalary = /\b(salary|compensation|pay|rate|desired\s*pay|expected\s*pay|hourly\s*rate|remuneration)\b/i.test(s);
  const isSecurity = /\b(ssn|social\s*security|password|pin|security\s*code|captcha)\b/i.test(s);
  return isDemographic || isLegalOrSignature || isSalary || isSecurity;
}

function isEssayQuestionField(label, fieldType) {
  if (fieldType === 'ai_answer') return true;
  const s = String(label || '').toLowerCase();
  if (isCandidateMandatoryManualField(label)) return false;
  return /\b(describe|tell\s*us|explain|why\b|share\s*an?\b|give\s*an?\b|how\s*did\s*you|what\s*made\s*you|what\s*steps|outline|essay|background)\b/i.test(s);
}

// ─── Fallback AI answer ───────────────────────────────────────────────────────
function generateTailoredFallbackAnswer(fieldLabel, candidateName, jobTitle) {
  const lbl = String(fieldLabel || '').toLowerCase();
  const title = jobTitle ? jobTitle.split('-')[0].trim() : 'this position';

  if (/\b(region|regional|apac|emea|latam|global|adapted|specify\s*region)\b/i.test(lbl)) {
    return `When adapting support processes for regional teams across APAC and global territories, I prioritized balancing central governance standards with regional language and timezone requirements. I facilitated cross-functional alignment sessions to establish clear escalation matrices and follow-the-sun coverage models.\n\nThis approach ensured seamless regional coverage, reduced resolution latency for global customers, and fostered strong collaboration between localized support pods and central engineering teams.`;
  }
  if (/\b(improvement|operational|efficiency|bottleneck|workflow|sla)\b/i.test(lbl)) {
    return `In my previous role, I led a major operational improvement initiative by analyzing ticket escalation queues and workflow bottlenecks. We identified recurring friction points in cross-team handoffs and implemented standardized resolution SLAs.\n\nAs a result of these process changes, team response times improved by 35%, escalation resolution rates increased, and customer satisfaction scores rose consistently across accounts.`;
  }
  if (/\b(mistake|hiring|team|lesson|learned|building|hire)\b/i.test(lbl)) {
    return `Early in my leadership journey, I made the mistake of focusing heavily on technical competence during hiring while underestimating cultural and communication alignment. Shortly after onboarding, alignment gaps emerged within cross-functional project deliverables.\n\nI resolved this by establishing clear weekly 1-on-1 mentorship sessions, introducing transparent objective key results (OKRs), and refining our hiring rubric to evaluate adaptability, collaboration, and communication alongside technical skills.`;
  }
  if (/\b(why|interest|apply|join|company|role|position)\b/i.test(lbl)) {
    return `I am deeply interested in joining as a ${title}. Throughout my career, I have focused on solving complex technical challenges, optimizing operational processes, and delivering exceptional experiences for customers and teams.\n\nThis opportunity aligns strongly with my background in scaling support operations and technical problem-solving. I am excited to bring my experience, leadership, and passion for excellence to your team.`;
  }
  return `Regarding "${fieldLabel}", I bring extensive technical background and practical experience in problem-solving, process optimization, and cross-functional team collaboration.\n\nIn my previous projects, I focused on establishing data-driven workflows and clear communication standards to achieve measurable outcomes. I am eager to apply these proven skills to drive impact in the ${title} role.`;
}

// ─── Draft AI answer ──────────────────────────────────────────────────────────
async function draftAiAnswer(selector, fieldLabel) {
  const btn = document.querySelector(`button[data-draft-selector="${CSS.escape(selector)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Drafting…'; }
  setStatus(`Drafting response for "${fieldLabel}"…`, 'loading');
  logActivity(`Drafting AI answer for field: "${fieldLabel}"`);

  try {
    const candidate = candidates.find((c) => c.id === (currentPlan?.candidateId || $('candidateSelect').value));
    const promptMessage = `Draft a compelling 2-paragraph response for the job application field "${fieldLabel}". Job title: ${tab?.title || 'Position'}. Candidate name: ${candidate?.name || 'Applicant'}. Highlight relevant technical skills and problem solving. Clean text only without markdown.`;

    let cleanAnswer = null;
    try {
      const resp = await api('/api/extension/v1/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: promptMessage,
          history: [],
          sessionContext: { candidateName: candidate?.name, jobTitle: tab?.title },
        }),
      });
      cleanAnswer = extractCleanReply(resp);
    } catch {}

    if (!cleanAnswer || cleanAnswer.includes('error') || cleanAnswer.length < 20) {
      cleanAnswer = generateTailoredFallbackAnswer(fieldLabel, candidate?.name, tab?.title);
      logActivity(`Used fallback answer for "${fieldLabel}" (AI unavailable)`, 'warn');
    } else {
      logActivity(`AI answer drafted for "${fieldLabel}"`);
    }

    const fillRes = await send('applyFillPlan', {
      instructions: [{ selector, fieldType: 'text', value: cleanAnswer, confidence: 'high' }],
    });

    const instr = currentPlan?.instructions?.find((i) => i.selector === selector);
    if (instr) {
      instr.value = cleanAnswer;
      instr.fieldType = 'text';
      instr.confidence = 'high';
      instr.reasoning = 'AI-drafted response';
    }
    renderPlanPreview(currentPlan?.instructions);
    if (fillRes?.results?.[0]?.applied) {
      setStatus(`Drafted and filled response into "${fieldLabel}".`, 'success');
    } else {
      setStatus(`Drafted response for "${fieldLabel}". Click Fill Form to apply.`, 'success');
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Auto-Draft Answer'; }
    logActivity(`Draft failed for "${fieldLabel}": ${e.message}`, 'error');
    setStatus(`Could not draft response: ${e.message}`, 'error');
  }
}

// ─── Per-field approval ───────────────────────────────────────────────────────
function getApprovedInstructions() {
  if (!currentPlan?.instructions) return [];
  return currentPlan.instructions.filter((instr) => {
    if (instr.fieldType === 'skip' || instr.fieldType === 'file') return false;
    if (instr.confidence === 'high') return true;  // always included
    // Medium/low: check the per-row checkbox
    const chk = document.querySelector(`.approveCheck[data-selector="${CSS.escape(instr.selector)}"]`);
    return chk ? chk.checked : instr.confidence === 'medium';
  });
}

// ─── Plan preview ─────────────────────────────────────────────────────────────
function renderPlanPreview(instructions) {
  if (!instructions || !instructions.length) {
    $('planPreview').innerHTML = '<div class="meta" style="padding: 12px; text-align: center;">No fields matched.</div>';
    return;
  }

  const high = instructions.filter((i) => i.confidence === 'high' && i.fieldType !== 'skip' && i.fieldType !== 'file').length;
  const med  = instructions.filter((i) => i.confidence === 'medium').length;
  const low  = instructions.filter((i) => i.confidence === 'low').length;

  const headerHtml = `<div class="planHeader">
    <span>Matched ${instructions.length} Field(s)</span>
    <span>High: ${high} • Review: ${med} • Low: ${low}</span>
  </div>`;

  const rows = instructions.map((instr) => {
    let badgeClass = 'high', badgeText = 'High';
    if (instr.fieldType === 'skip')     { badgeClass = 'skip';      badgeText = 'Skip'; }
    else if (instr.fieldType === 'file'){ badgeClass = 'file';      badgeText = 'File'; }
    else if (instr.fieldType === 'ai_answer') { badgeClass = 'ai_answer'; badgeText = 'Write-up'; }
    else if (instr.confidence === 'medium') { badgeClass = 'medium'; badgeText = 'Review'; }
    else if (instr.confidence === 'low')    { badgeClass = 'low';    badgeText = 'Low'; }

    const labelStr = currentPlan?.fieldLabelBySelector?.get(instr.selector) || instr.reasoning || instr.selector;
    const valStr   = typeof instr.value === 'boolean'
      ? (instr.value ? 'Yes / Checked' : 'No / Unchecked')
      : String(instr.value || '—');

    const isDraftable    = isEssayQuestionField(labelStr, instr.fieldType);
    const needsApproval  = instr.confidence === 'medium' || instr.confidence === 'low';
    const isSkipOrFile   = instr.fieldType === 'skip' || instr.fieldType === 'file';

    const draftBtnHtml = isDraftable
      ? `<button class="btnDraft" data-draft-selector="${escapeHtml(instr.selector)}" data-label="${escapeHtml(labelStr)}">Auto-Draft Answer</button>`
      : '';

    const skipNoteHtml = isSkipOrFile
      ? `<div class="skipNote">${instr.fieldType === 'file' ? 'PDF will be attached automatically during Fill.' : 'Left for manual completion — not auto-filled.'}</div>`
      : '';

    const approveHtml = needsApproval && !isSkipOrFile
      ? `<label class="approveLabel"><input type="checkbox" class="approveCheck" data-selector="${escapeHtml(instr.selector)}" ${instr.confidence === 'medium' ? 'checked' : ''}/> Include in fill</label>`
      : '';

    return `<div class="planRow ${instr.confidence === 'low' ? 'low' : ''}">
      <div class="planRowTop">
        <span class="planLabel" title="${escapeHtml(instr.selector)}">${escapeHtml(labelStr)}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="planVal">${escapeHtml(valStr.length > 50 ? valStr.slice(0, 50) + '…' : valStr)}</div>
      ${approveHtml}${draftBtnHtml}${skipNoteHtml}
    </div>`;
  }).join('');

  $('planPreview').innerHTML = headerHtml + rows;

  document.querySelectorAll('#planPreview .btnDraft').forEach((btn) => {
    btn.addEventListener('click', async (evt) => {
      evt.preventDefault();
      const sel   = btn.getAttribute('data-draft-selector');
      const label = btn.getAttribute('data-label');
      if (sel) await draftAiAnswer(sel, label);
    });
  });
}

// ─── Field verification ───────────────────────────────────────────────────────
async function verifyAfterFill() {
  try {
    const r = await send('verifyFillPlan', { instructions: currentPlan.instructions });
    const results    = r?.results || [];
    const mismatched = results.filter((x) => x.status === 'framework_mismatch');
    const notFound   = results.filter((x) => x.status === 'not_found');
    const ok         = results.filter((x) => x.status === 'ok').length;

    if (mismatched.length) {
      const labels = mismatched
        .map((x) => currentPlan.fieldLabelBySelector?.get(x.selector) || x.selector)
        .slice(0, 3).join(', ');
      logActivity(`⚠ Framework mismatch on ${mismatched.length} field(s): ${labels} — React/Vue may have overridden the value.`, 'warn');
    }
    if (notFound.length) {
      logActivity(`⚠ ${notFound.length} field(s) not found in DOM after fill — page may have changed.`, 'warn');
    }
    if (ok > 0) {
      logActivity(`Verified ${ok} field(s) filled correctly.`);
    }
    return { ok, mismatch: mismatched.length, notFound: notFound.length };
  } catch (e) {
    logActivity(`Field verification skipped: ${e.message}`, 'warn');
    return { ok: 0, mismatch: 0, notFound: 0 };
  }
}

// ─── Secondary actions visibility ────────────────────────────────────────────
function showSecondaryActions(visible) {
  const el = $('secondaryActions');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

// ─── Analyze ──────────────────────────────────────────────────────────────────
async function analyze() {
  const candidateId       = $('candidateSelect').value;
  const linkedApplicationId = applicationIdFromTab();

  if (!candidateId && !linkedApplicationId) {
    setStatus('Pick a candidate first, or open this page from an application record.', 'error');
    return;
  }

  setStatus('Scanning form…', 'loading');
  logActivity('Starting form analysis…');

  try {
    // Step 1 — ATS detection
    const atsResult = await send('detectAts');
    const atsName   = atsResult?.ats || detectAtsFromUrl(tab?.url || '');
    updateAppContext({
      ats: atsName,
      linked: !!linkedApplicationId,
      applicationId: linkedApplicationId,
      jobTitle: tab?.title || '—',
    });
    logActivity(`Detected ATS: ${atsName}`);

    // Step 2 — Scan form
    const scan = await send('scanForm');
    if (!scan?.ok) throw new Error('Could not read this page. Check that the job application form is open.');
    if (!scan.fields.length) { setStatus('No form fields found on this page.', 'error'); return; }
    logActivity(`Found ${scan.fields.length} form field(s).`);

    // Step 3 — AI fill plan
    setStatus(`Found ${scan.fields.length} fields. Asking AI for a fill plan…`, 'loading');
    const domain = new URL(tab.url).hostname;
    let resp;
    try {
      resp = await api('/api/extension/v1/copilot/fill-plan', {
        method: 'POST',
        body: JSON.stringify({
          applicationId:   linkedApplicationId || undefined,
          candidateId:     candidateId || undefined,
          selectedResumeId: $('resumeSelect').value || undefined,
          formSnapshot:    scan.fields,
          pageContext:     { domain, title: tab.title, url: tab.url },
        }),
      });
    } catch (apiErr) {
      logActivity(`AI fill-plan API error: ${apiErr.message}`, 'error');
      throw apiErr;
    }

    // Step 4 — Parse (robust)
    let rawPlan;
    try {
      rawPlan = Array.isArray(resp.fillPlan) ? resp.fillPlan : parseFillPlanSafe(resp);
    } catch (parseErr) {
      logActivity(`Fill plan parse error: ${parseErr.message}`, 'error');
      throw parseErr;
    }
    logActivity(`AI returned ${rawPlan.length} instruction(s).`);

    const fieldLabelBySelector = new Map(scan.fields.map((f) => [f.selector, f.label || f.ariaLabel || f.placeholder || f.name || '']));

    // Step 5 — Apply mandatory field overrides
    rawPlan.forEach((instr) => {
      const fieldLabel = fieldLabelBySelector.get(instr.selector) || instr.reasoning || instr.selector;
      if (isCandidateMandatoryManualField(fieldLabel)) {
        instr.value = null; instr.fieldType = 'skip'; instr.confidence = 'low';
        instr.reasoning = 'Candidate-only field: Left for manual candidate completion.';
      }
    });

    rawPlan.forEach((instr) => {
      const fieldLabel = fieldLabelBySelector.get(instr.selector) || instr.reasoning || instr.selector;
      if (isWorkAuthField(fieldLabel)) {
        instr.value = instr.fieldType === 'checkbox' ? true : 'Yes';
        instr.confidence = 'high';
        instr.reasoning = 'Candidate preference rule: Always answer Yes for US work authorization.';
      }
    });

    // Step 6 — Profile baseline auto-fill
    const activeCandidate = candidates.find((c) => c.id === (resp.candidateId || candidateId));
    if (activeCandidate) {
      updateAppContext({ candidateName: activeCandidate.name || '—' });
      const parts     = (activeCandidate.name || '').trim().split(/\s+/);
      const firstName = parts[0] || '';
      const lastName  = parts.slice(1).join(' ') || '';

      scan.fields.forEach((f) => {
        const lbl = `${f.label} ${f.name} ${f.ariaLabel} ${f.placeholder}`.toLowerCase();
        let targetValue = null;

        if (/\b(first\s*name|given\s*name)\b/i.test(lbl))           targetValue = firstName;
        else if (/\b(last\s*name|surname|family\s*name)\b/i.test(lbl)) targetValue = lastName;
        else if (/\b(full\s*name|^name\*?|your\s*name)\b/i.test(lbl) && !/\b(company|employer|manager|reference|school|university|degree|city|location|country)\b/i.test(lbl))
          targetValue = activeCandidate.name;
        else if (/\b(email|e-mail)\b/i.test(lbl))
          targetValue = activeCandidate.email || null;
        else if (/\b(phone|mobile|cell|telephone)\b/i.test(lbl))
          targetValue = activeCandidate.phone;
        else if (/\b(linkedin|linked\s*in)\b/i.test(lbl))
          targetValue = activeCandidate.linkedinUrl || activeCandidate.linkedin;
        else if (/\b(country|city\s*and\s*country|location|city|work\s*from|intend\s*to\s*work)\b/i.test(lbl))
          targetValue = activeCandidate.location || activeCandidate.city || activeCandidate.country || 'United States';

        if (targetValue) {
          let existingInstr = rawPlan.find((i) => i.selector === f.selector);
          if (existingInstr) {
            existingInstr.value = targetValue;
            if (existingInstr.fieldType === 'skip' || existingInstr.fieldType === 'ai_answer')
              existingInstr.fieldType = f.type === 'select' ? 'select' : 'text';
            existingInstr.confidence = 'high';
            existingInstr.reasoning  = 'Candidate profile verified detail';
          } else {
            rawPlan.push({ selector: f.selector, fieldType: f.type === 'select' ? 'select' : 'text', value: targetValue, confidence: 'high', reasoning: 'Candidate profile verified detail' });
          }
        }
      });
    }

    // Step 7 — File fields
    const scanFileFields = scan.fields.filter((f) => f.inputType === 'file');
    const detectedResumeField = scanFileFields.find((f) => /\b(resume|cv|upload)\b/i.test(`${f.label} ${f.name} ${f.ariaLabel} ${f.placeholder}`)) || scanFileFields[0];
    const detectedCoverField  = scanFileFields.find((f) => /\b(cover\s*letter|cover|letter)\b/i.test(`${f.label} ${f.name} ${f.ariaLabel} ${f.placeholder}`)) || (scanFileFields.length > 1 ? scanFileFields[1] : undefined);
    const resumeFileSelector  = resp.resumeFileSelector || detectedResumeField?.selector;
    const coverLetterFileSelector = resp.coverLetterFileSelector || detectedCoverField?.selector;

    if (resumeFileSelector) {
      const fileName = window.TosPdfGen.professionalFileName(activeCandidate?.name || 'Candidate', 'Resume');
      const existing = rawPlan.find((i) => i.selector === resumeFileSelector);
      if (existing) {
        existing.value = fileName; existing.fieldType = 'file'; existing.confidence = 'high';
        existing.reasoning = 'Candidate resume PDF attachment';
      } else {
        rawPlan.push({ selector: resumeFileSelector, fieldType: 'file', value: fileName, confidence: 'high', reasoning: 'Candidate resume PDF attachment' });
      }
    }

    if (resp.candidateId && candidates.some((c) => c.id === resp.candidateId)) {
      $('candidateSelect').value = resp.candidateId;
      renderResumes();
    }

    currentPlan = {
      applicationId: resp.applicationId,
      candidateId: resp.candidateId || candidateId,
      domain,
      instructions: rawPlan,
      fieldLabelBySelector,
      coverLetterFileSelector,
      coverLetterTextSelector: resp.coverLetterTextSelector,
      resumeFileSelector,
      matchedApplication: resp.matchedApplication || null,
    };

    renderPlanPreview(rawPlan);
    $('fillBtn').disabled       = false;
    $('saveBtn').disabled       = true;
    $('resumeFileBtn').disabled = false;
    $('coverLetterBtn').disabled = false;
    showSecondaryActions(true);

    if (resp.matchedApplication) {
      $('resumeSelect').disabled = true;
      const msg = `Matched: "${resp.matchedApplication.title}" @ ${resp.matchedApplication.company}. ${rawPlan.length} fields — review, then Fill.`;
      setStatus(msg, 'success');
      logActivity(msg);
    } else {
      const msg = `Plan ready — ${rawPlan.length} fields. Review, then Fill.`;
      setStatus(msg, 'success');
      logActivity(msg);
    }

    recordTelemetry({ event: 'analyze', ats: atsName, fieldCount: rawPlan.length, domain });

  } catch (e) {
    logActivity(`Analysis failed: ${e.message}`, 'error');
    setStatus(e.message, 'error');
  }
}

// ─── Fill ─────────────────────────────────────────────────────────────────────
async function fill() {
  if (!currentPlan) return;
  const approved = getApprovedInstructions();
  if (!approved.length) {
    setStatus('No fields selected to fill — check the "Include in fill" checkboxes.', 'error');
    return;
  }

  setStatus('Filling form…', 'loading');
  logActivity(`Filling ${approved.length} approved field(s)…`);

  try {
    const r = await send('applyFillPlan', { instructions: approved });
    const applied = (r.results || []).filter((x) => x.applied).length;
    logActivity(`Applied ${applied} of ${approved.length} field(s).`);

    // Attach resume PDF
    if (currentPlan.resumeFileSelector) {
      try {
        await attachResumeFile(true);
      } catch (attachErr) {
        logActivity(`Resume auto-attach failed: ${attachErr.message}`, 'warn');
      }
    }

    // Start SPA submission observer
    try { await send('startConfirmationObserver'); } catch {}

    // Field verification
    const verif = await verifyAfterFill();

    // Audit required fields
    const audit = await send('auditRequiredFields');
    const missingCount = audit?.missing?.length || 0;

    if (verif.mismatch > 0 && missingCount > 0) {
      setStatus(`Filled ${applied} field(s). ⚠ ${verif.mismatch} framework mismatch(es), ${missingCount} missing field(s). Review manually.`, 'warning');
    } else if (verif.mismatch > 0) {
      setStatus(`Filled ${applied} field(s). ⚠ ${verif.mismatch} field(s) may not have updated (React/Vue). Check highlighted fields.`, 'warning');
    } else if (missingCount > 0) {
      const labels = (audit.missing || []).map((m) => `"${m.label}"`).slice(0, 3).join(', ');
      setStatus(`Filled ${applied} field(s). ${missingCount} required field(s) need manual attention: ${labels}.`, 'warning');
    } else {
      setStatus(`Filled ${applied} field(s) cleanly. Review the form before submitting.`, 'success');
    }
    $('saveBtn').disabled = false;
    recordTelemetry({ event: 'fill', applied, mismatch: verif.mismatch, domain: currentPlan.domain });

  } catch (e) {
    logActivity(`Fill failed: ${e.message}`, 'error');
    setStatus(e.message, 'error');
  }
}

// ─── Save & Learn ─────────────────────────────────────────────────────────────
async function saveAndLearn() {
  if (!currentPlan) return;
  setStatus('Recording corrections…', 'loading');
  logActivity('Recording field corrections for learning…');

  try {
    const cap = await send('captureCurrentValues', { instructions: currentPlan.instructions });
    const finalBySelector = new Map((cap.values || []).map((v) => [v.selector, v.finalValue]));
    const fields = currentPlan.instructions
      .filter((i) => i.fieldType !== 'skip' && i.fieldType !== 'file')
      .map((i) => ({
        selector:    i.selector,
        label:       currentPlan.fieldLabelBySelector?.get(i.selector) || i.selector,
        fieldType:   i.fieldType,
        aiValue:     i.value,
        aiConfidence: i.confidence,
        aiReasoning: i.reasoning,
        finalValue:  finalBySelector.get(i.selector) ?? null,
      }));

    const r = await api('/api/extension/v1/copilot/record-outcome', {
      method: 'POST',
      body: JSON.stringify({
        applicationId: currentPlan.applicationId,
        candidateId:   currentPlan.candidateId,
        domain:        currentPlan.domain,
        fields,
      }),
    });
    const msg = `Saved ${r.recorded} field outcome(s). The AI will use corrections next time.`;
    logActivity(msg);
    setStatus(msg, 'success');
    $('saveBtn').disabled = true;
    recordTelemetry({ event: 'save_and_learn', recorded: r.recorded });
  } catch (e) {
    logActivity(`Save failed: ${e.message}`, 'error');
    setStatus(e.message, 'error');
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function extractCleanReply(res) {
  let text = res?.reply || res?.response || res?.message || (typeof res === 'string' ? res : '');
  if (typeof text === 'string') {
    text = text.trim();
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const parsed = JSON.parse(text);
        text = parsed.reply || parsed.response || parsed.message || text;
      } catch {}
    }
  }
  return typeof text === 'string' ? text : JSON.stringify(text);
}

function renderChat() {
  $('chatLog').innerHTML = chatHistory.map((m) =>
    `<div class="chatMsg ${m.role}"><div class="who">${m.role === 'user' ? 'You' : 'Copilot'}</div><div class="bubble">${escapeHtml(m.content)}</div></div>`
  ).join('') || '<div class="meta" style="padding: 10px; text-align: center;">No messages yet. Ask Copilot anything about this form!</div>';
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
}

async function sendChat() {
  const input   = $('chatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  chatHistory.push({ role: 'user', content: message });
  renderChat();

  const candidate = candidates.find((c) => c.id === (currentPlan?.candidateId || $('candidateSelect').value));
  const fieldSummary = currentPlan?.instructions?.map((i) => ({
    label:     currentPlan.fieldLabelBySelector?.get(i.selector) || i.selector,
    value:     typeof i.value === 'boolean' ? (i.value ? 'Yes' : 'No') : i.value,
    fieldType: i.fieldType,
    confidence: i.confidence,
    reasoning:  i.reasoning,
  }));

  const sessionContext = {
    candidateName: candidate?.name,
    jobTitle:      tab?.title,
    domain:        tab ? (() => { try { return new URL(tab.url).hostname; } catch { return undefined; } })() : undefined,
    lastFillPlan:  currentPlan?.instructions,
    fieldSummary,
    formSnapshot:  fieldSummary,
  };

  try {
    const r = await api('/api/extension/v1/copilot/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history: chatHistory.slice(-7, -1), sessionContext }),
    });
    const replyText = extractCleanReply(r);
    chatHistory.push({ role: 'assistant', content: replyText });
  } catch (e) {
    chatHistory.push({ role: 'assistant', content: `(error) ${e.message}` });
  }
  renderChat();
}

// ─── File attachment helpers ──────────────────────────────────────────────────
function downloadBlob(blob, fileName) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: fileName, saveAs: false }, (downloadId) => {
      URL.revokeObjectURL(url);
      if (chrome.runtime.lastError || !downloadId)
        reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
      else resolve(downloadId);
    });
  });
}

async function attachBlobToField(selector, blob, fileName, mimeType) {
  const base64 = await blobToBase64(blob);
  const res = await send('attachFile', { selector, base64, fileName, mimeType });
  if (!res?.applied) throw new Error(res?.reason || 'File input element not found');
  return res;
}

async function attachOrDownload(selector, blob, fileName, mimeType, kindLabel) {
  if (selector) {
    try {
      await attachBlobToField(selector, blob, fileName, mimeType);
      return { attached: true, message: `${kindLabel} generated and attached as "${fileName}".` };
    } catch (e) {
      logActivity(`Auto-attach failed for ${kindLabel}: ${e.message} — downloading instead.`, 'warn');
    }
  }
  await downloadBlob(blob, fileName);
  return { attached: false, message: `${kindLabel} downloaded as "${fileName}" — please attach it to the form.` };
}

// silent = true suppresses status updates (called from fill())
async function attachResumeFile(silent = false) {
  if (!currentPlan) return;
  if (!silent) setStatus('Looking up resume PDF…', 'loading');

  try {
    let blob = null;
    const candidate     = candidates.find((c) => c.id === currentPlan.candidateId);
    const selectedResumeId = $('resumeSelect').value;
    const selectedResume   = candidate?.resumes?.find((r) => r.id === selectedResumeId);

    if (currentPlan.applicationId) {
      const lookup = await api(`/api/extension/v1/copilot/resume-export?applicationId=${encodeURIComponent(currentPlan.applicationId)}`).catch(() => ({ found: false }));
      if (lookup?.found) {
        blob = lookup.inlineText
          ? window.TosPdfGen.buildResumePdf(candidate?.name, lookup.inlineText)
          : await apiBlob(`/api/extension/v1/resume-download?url=${encodeURIComponent(lookup.url)}`);
      }
    }

    if (!blob) {
      const resumeText = selectedResume?.content || selectedResume?.summary || candidate?.summary || candidate?.headline || `${candidate?.name || 'Candidate'}\n\nExperience & Qualifications`;
      blob = window.TosPdfGen.buildResumePdf(candidate?.name || 'Candidate', resumeText);
    }

    const fileName = window.TosPdfGen.professionalFileName(candidate?.name, 'Resume');
    const result   = await attachOrDownload(currentPlan.resumeFileSelector, blob, fileName, 'application/pdf', 'Resume');
    logActivity(result.message);
    if (!silent) setStatus(result.message, result.attached ? 'success' : 'error');
  } catch (e) {
    logActivity(`Resume attach failed: ${e.message}`, 'error');
    if (!silent) setStatus(e.message, 'error');
    throw e;
  }
}

async function generateAndAttachCoverLetter() {
  if (!currentPlan) return;
  setStatus('Drafting cover letter…', 'loading');
  logActivity('Generating cover letter…');

  try {
    const candidate      = candidates.find((c) => c.id === (currentPlan.candidateId || $('candidateSelect').value));
    const selectedResumeId = $('resumeSelect').value;
    const selectedResume   = candidate?.resumes?.find((r) => r.id === selectedResumeId);
    let letterText = null;

    if (currentPlan.applicationId) {
      try {
        const resp = await api('/api/extension/v1/copilot/cover-letter', {
          method: 'POST',
          body: JSON.stringify({
            applicationId:  currentPlan.applicationId,
            candidateId:    candidate?.id || undefined,
            jobTitle:       tab?.title || undefined,
            selectedResumeId: selectedResumeId || undefined,
          }),
        });
        letterText = resp?.letterText || resp?.text || resp?.coverLetter;
      } catch (apiErr) {
        logActivity(`Cover letter API fallback: ${apiErr.message}`, 'warn');
      }
    }

    if (!letterText) {
      const companyOrTitle  = tab?.title ? tab.title.split('-')[0].trim() : 'the Position';
      const candidateSummary = selectedResume?.summary || candidate?.summary || candidate?.headline || 'experienced professional';
      letterText = `Dear Hiring Team,\n\nI am writing to express my strong interest in the ${companyOrTitle} role. As an ${candidateSummary}, I bring relevant technical experience, strong problem-solving skills, and a proven track record of delivering results.\n\nThank you for considering my application. I look forward to discussing how my background aligns with your team's goals.\n\nSincerely,\n${candidate?.name || 'Applicant'}`;
    }

    const fileName = window.TosPdfGen.professionalFileName(candidate?.name, 'CoverLetter');

    if (currentPlan.coverLetterTextSelector && !currentPlan.coverLetterFileSelector) {
      await send('applyFillPlan', { instructions: [{ selector: currentPlan.coverLetterTextSelector, fieldType: 'text', value: letterText }] });
      const msg = 'Cover letter drafted and filled into the text field. Review before submitting.';
      logActivity(msg);
      setStatus(msg, 'success');
      return;
    }

    const blob   = window.TosPdfGen.buildCoverLetterPdf(candidate?.name || 'Candidate', letterText);
    const result = await attachOrDownload(currentPlan.coverLetterFileSelector, blob, fileName, 'application/pdf', 'Cover letter');
    logActivity(result.message);
    setStatus(result.message, result.attached ? 'success' : 'error');
  } catch (e) {
    logActivity(`Cover letter failed: ${e.message}`, 'error');
    setStatus(e.message, 'error');
  }
}

// ─── Refresh ──────────────────────────────────────────────────────────────────
async function refresh() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('pageTitle').textContent = tab?.title || '—';
  const okPage = tab && /^https?:/.test(tab.url || '');
  $('analyzeBtn').disabled = !okPage;
  currentPlan = null;
  $('fillBtn').disabled        = true;
  $('saveBtn').disabled        = true;
  $('resumeFileBtn').disabled  = true;
  $('coverLetterBtn').disabled = true;
  $('planPreview').innerHTML   = '';
  showSecondaryActions(false);

  const linkedApplicationId = applicationIdFromTab();
  const atsName = detectAtsFromUrl(tab?.url || '');
  updateAppContext({
    candidateName: '—',
    jobTitle: tab?.title || '—',
    ats: atsName,
    applicationId: linkedApplicationId,
    linked: !!linkedApplicationId,
  });
  $('pageTitle').title = linkedApplicationId ? `Linked application: ${linkedApplicationId}` : '';
}

// ─── Pending submission status ────────────────────────────────────────────────
async function consumePendingApplicationStatus() {
  const pending = (await chrome.storage.local.get(['pendingApplicationStatus'])).pendingApplicationStatus;
  if (!pending?.applicationId || !settings.apiKey) return;
  try {
    await api('/api/extension/v1/copilot/application-status', {
      method: 'POST',
      body: JSON.stringify({ applicationId: decodeURIComponent(pending.applicationId), source: 'extension' }),
    });
    await chrome.storage.local.remove('pendingApplicationStatus');
    const msg = 'Application marked Applied in TalentOS.';
    logActivity(msg);
    setStatus(msg, 'success');
  } catch (e) {
    setStatus(`Form submitted, but TalentOS status was not updated: ${e.message}`, 'error');
  }
}

// ─── Tab wiring ───────────────────────────────────────────────────────────────
$('tabFill').onclick = () => {
  ['tabFill','tabChat','tabLog'].forEach((id) => $(id).classList.remove('active'));
  ['panelFill','panelChat','panelLog'].forEach((id) => $(id).classList.remove('active'));
  $('tabFill').classList.add('active');
  $('panelFill').classList.add('active');
};
$('tabChat').onclick = () => {
  ['tabFill','tabChat','tabLog'].forEach((id) => $(id).classList.remove('active'));
  ['panelFill','panelChat','panelLog'].forEach((id) => $(id).classList.remove('active'));
  $('tabChat').classList.add('active');
  $('panelChat').classList.add('active');
  renderChat();
};
$('tabLog').onclick = () => {
  ['tabFill','tabChat','tabLog'].forEach((id) => $(id).classList.remove('active'));
  ['panelFill','panelChat','panelLog'].forEach((id) => $(id).classList.remove('active'));
  $('tabLog').classList.add('active');
  $('panelLog').classList.add('active');
  renderLog();
};

$('clearLogBtn').onclick = () => {
  activityLog = [];
  renderLog();
};

$('chatSendBtn').onclick = sendChat;
$('chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
$('resumeFileBtn').onclick = () => attachResumeFile(false);
$('coverLetterBtn').onclick = generateAndAttachCoverLetter;
$('candidateSelect').onchange = renderResumes;
$('analyzeBtn').onclick = analyze;
$('fillBtn').onclick = fill;
$('saveBtn').onclick = saveAndLearn;
$('toggleSettings').onclick = () => $('settings').classList.toggle('open');

// ─── Submission detection ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action !== 'applicationSubmittedDetected' || !sender.tab || sender.tab.id !== tab?.id) return;
  const applicationId = applicationIdFromTab();
  if (!applicationId) return;
  logActivity('Submission confirmed on page — updating TalentOS status…');
  api('/api/extension/v1/copilot/application-status', {
    method: 'POST',
    body: JSON.stringify({ applicationId, source: 'extension' }),
  }).then(() => {
    const msg2 = 'Application marked Applied in TalentOS.';
    logActivity(msg2);
    setStatus(msg2, 'success');
  }).catch((e) => {
    logActivity(`Submission detected but TalentOS update failed: ${e.message}`, 'error');
    setStatus(`Form submitted, but TalentOS status was not updated: ${e.message}`, 'error');
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
$('saveSettings').onclick = async () => {
  settings = {
    baseUrl: ($('baseUrl').value || DEFAULT_URL).replace(/\/+$/, ''),
    apiKey:  $('apiKey').value.trim(),
  };
  await chrome.storage.local.set({ settings });
  $('settings').classList.remove('open');
  logActivity('Settings saved.');
  setStatus('Settings saved.', 'success');
  loadCandidates();
};

// ─── Tab/page change listeners ────────────────────────────────────────────────
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((_i, c, t) => { if (t.active && (c.url || c.status === 'complete')) refresh(); });

// ─── Bootstrap ────────────────────────────────────────────────────────────────
chrome.storage.local.get(['settings']).then((s) => {
  settings = { baseUrl: s.settings?.baseUrl || DEFAULT_URL, apiKey: s.settings?.apiKey || '' };
  $('baseUrl').value = settings.baseUrl;
  $('apiKey').value  = settings.apiKey;
  refresh();
  renderLog();
  if (settings.apiKey) {
    loadCandidates();
    consumePendingApplicationStatus();
  } else {
    $('settings').classList.add('open');
    setStatus('Add your API key to get started.');
  }
});
