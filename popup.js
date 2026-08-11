const DEFAULT_URL = 'https://skarion-talent-os.skarion-talentos.workers.dev';
let settings = { baseUrl: DEFAULT_URL, apiKey: '' };
let tab = null;
let candidates = [];
let currentPlan = null;   // { applicationId, instructions, domain, candidateId }
let chatHistory = [];     // [{role: 'user'|'assistant', content: string}]
const $ = (i) => document.getElementById(i);
const setStatus = (m, k = '') => {
  const el = $('status');
  if (!m) { el.innerHTML = ''; el.className = 'status'; return; }
  const icon = k === 'loading' ? '<div class="spinner"></div>' : k === 'success' ? '✓ ' : k === 'error' ? '⚠️ ' : '';
  el.innerHTML = `${icon}<span>${escapeHtml(m)}</span>`;
  el.className = `status ${k}`;
};

async function api(path, opts = {}) {
  if (!settings.apiKey) throw new Error('Add your TalentOS API key in Settings.');
  const res = await fetch(`${settings.baseUrl}${path}`, { ...opts, headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}`,
    'X-TalentOS-Client': 'application-copilot-extension/1.0.0', ...(opts.headers || {}) } });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b?.error?.message || b?.error || `HTTP ${res.status}`);
  return b;
}

// For binary responses (resume-download proxy) — same auth, but returns a
// Blob instead of parsing JSON.
async function apiBlob(path) {
  if (!settings.apiKey) throw new Error('Add your TalentOS API key in Settings.');
  const res = await fetch(`${settings.baseUrl}${path}`, { headers: {
    Authorization: `Bearer ${settings.apiKey}`, 'X-TalentOS-Client': 'application-copilot-extension/1.0.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function attachBlobToField(selector, blob, fileName, mimeType) {
  const base64 = await blobToBase64(blob);
  const r = await send('attachFile', { selector, base64, fileName, mimeType });
  if (!r?.ok || !r.applied) throw new Error(r?.reason === 'not_found' ? 'Could not find that field on the page.' : 'Failed to attach file.');
}

async function send(action, payload = {}) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
  } catch {}

  if (action === 'scanForm') {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => (typeof window.__tosScanForm === 'function' ? window.__tosScanForm() : []),
      });
      const allFields = (results || []).flatMap((r) => r.result || []);
      if (allFields.length > 0) return { ok: true, fields: allFields };
    } catch {}
  }

  if (action === 'applyFillPlan') {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (instructions) => (typeof window.__tosApplyFillPlan === 'function' ? window.__tosApplyFillPlan(instructions) : []),
        args: [payload.instructions],
      });
      const allResults = (results || []).flatMap((r) => r.result || []);
      return { ok: true, results: allResults };
    } catch {}
  }

  if (action === 'captureCurrentValues') {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (instructions) => (typeof window.__tosCaptureCurrentValues === 'function' ? window.__tosCaptureCurrentValues(instructions) : []),
        args: [payload.instructions],
      });
      const allValues = (results || []).flatMap((r) => r.result || []);
      return { ok: true, values: allValues };
    } catch {}
  }

  if (action === 'attachFile') {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (selector, base64, fileName, mimeType) => (typeof window.__tosAttachFile === 'function' ? window.__tosAttachFile(selector, base64, fileName, mimeType) : { applied: false, reason: 'not_found' }),
        args: [payload.selector, payload.base64, payload.fileName, payload.mimeType],
      });
      const hit = (results || []).find((r) => r.result?.applied);
      if (hit) return { ok: true, ...hit.result };
    } catch {}
  }

  try { return await chrome.tabs.sendMessage(tab.id, { action, ...payload }); }
  catch { return { ok: false }; }
}

function renderCandidates() {
  const sel = $('candidateSelect');
  sel.innerHTML = '<option value="">Select candidate…</option>' +
    candidates.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
}

function renderResumes() {
  const c = candidates.find((c) => c.id === $('candidateSelect').value);
  const sel = $('resumeSelect');
  const resumes = c?.resumes || [];
  sel.innerHTML = '<option value="">(no resume / use profile only)</option>' +
    resumes.map((r) => `<option value="${r.id}">${r.label || r.filename || r.kind}</option>`).join('');
}

async function loadCandidates() {
  try {
    setStatus('Loading candidates…', 'loading');
    const r = await api('/api/extension/v1/copilot/init');
    candidates = r.data || [];
    renderCandidates();
    renderResumes();
    setStatus(candidates.length ? '' : 'No active candidates found.');
  } catch (e) { setStatus(e.message, 'error'); }
}

function renderPlanPreview(instructions) {
  if (!instructions || !instructions.length) {
    $('planPreview').innerHTML = '<div class="meta" style="padding: 12px; text-align: center;">No fields matched.</div>';
    return;
  }

  const high = instructions.filter((i) => i.confidence === 'high' && i.fieldType !== 'skip' && i.fieldType !== 'file').length;
  const med = instructions.filter((i) => i.confidence === 'medium').length;
  const low = instructions.filter((i) => i.confidence === 'low').length;

  const headerHtml = `<div class="planHeader">
    <span>Matched ${instructions.length} Field(s)</span>
    <span>🟢 ${high} • 🟡 ${med} • 🔴 ${low}</span>
  </div>`;

  const rows = instructions.map((i) => {
    let badgeClass = 'high';
    let badgeText = '🟢 High';
    if (i.fieldType === 'skip') {
      badgeClass = 'skip'; badgeText = '⏩ Skip';
    } else if (i.fieldType === 'file') {
      badgeClass = 'file'; badgeText = '📁 File';
    } else if (i.fieldType === 'ai_answer') {
      badgeClass = 'ai_answer'; badgeText = '📝 Write-up';
    } else if (i.confidence === 'medium') {
      badgeClass = 'medium'; badgeText = '🟡 Review';
    } else if (i.confidence === 'low') {
      badgeClass = 'low'; badgeText = '🔴 Low';
    }

    const labelStr = currentPlan?.fieldLabelBySelector?.get(i.selector) || i.reasoning || i.selector;
    const valStr = typeof i.value === 'boolean' ? (i.value ? 'Yes / Checked' : 'No / Unchecked') : String(i.value || '—');

    return `<div class="planRow ${i.confidence === 'low' ? 'low' : ''}">
      <div class="planRowTop">
        <span class="planLabel" title="${escapeHtml(i.selector)}">${escapeHtml(labelStr)}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="planVal">${escapeHtml(valStr.length > 50 ? valStr.slice(0, 50) + '…' : valStr)}</div>
    </div>`;
  }).join('');

  $('planPreview').innerHTML = headerHtml + rows;
}

function isWorkAuthField(label) {
  const s = String(label || '').toLowerCase();
  const isAuth = /\b(work\s*auth|authorized\s*to\s*work|legally\s*authorized|eligible\s*to\s*work|permission\s*to\s*work)\b/i.test(s);
  const isSponsorship = /\b(require|need|future|sponsorship|visa)\b/i.test(s) && !/\b(authorized|eligible|permission)\b/i.test(s);
  return isAuth && !isSponsorship;
}

async function analyze() {
  const candidateId = $('candidateSelect').value;
  const linkedApplicationId = applicationIdFromTab();
  if (!candidateId && !linkedApplicationId) { setStatus('Pick a candidate first, or open this page from an application record.', 'error'); return; }
  setStatus('Scanning form…', 'loading');
  try {
    const scan = await send('scanForm');
    if (!scan?.ok) throw new Error('Could not read this page.');
    if (scan.fields.length === 0) { setStatus('No form fields found on this page.', 'error'); return; }

    setStatus(`Found ${scan.fields.length} fields. Asking AI for a fill plan…`, 'loading');
    const domain = new URL(tab.url).hostname;
    const resp = await api('/api/extension/v1/copilot/fill-plan', {
      method: 'POST',
      body: JSON.stringify({
        applicationId: linkedApplicationId || undefined,
        candidateId: candidateId || undefined,
        selectedResumeId: $('resumeSelect').value || undefined,
        formSnapshot: scan.fields,
        pageContext: { domain, title: tab.title, url: tab.url },
      }),
    });

    const fieldLabelBySelector = new Map(scan.fields.map((f) => [f.selector, f.label || f.ariaLabel || f.placeholder || f.name || '']));
    
    // Candidate Rule Override: US Work Authorization always defaults to "Yes" / High Confidence
    (resp.fillPlan || []).forEach((instr) => {
      const fieldLabel = fieldLabelBySelector.get(instr.selector) || instr.reasoning || instr.selector;
      if (isWorkAuthField(fieldLabel)) {
        instr.value = instr.fieldType === 'checkbox' ? true : 'Yes';
        instr.confidence = 'high';
        instr.reasoning = 'Candidate preference rule: Always answer Yes for US work authorization.';
      }
    });

    if (resp.candidateId && candidates.some((c) => c.id === resp.candidateId)) {
      $('candidateSelect').value = resp.candidateId;
      renderResumes();
    }
    currentPlan = {
      applicationId: resp.applicationId, candidateId: resp.candidateId || candidateId, domain, instructions: resp.fillPlan, fieldLabelBySelector,
      coverLetterFileSelector: resp.coverLetterFileSelector, coverLetterTextSelector: resp.coverLetterTextSelector,
      resumeFileSelector: resp.resumeFileSelector, matchedApplication: resp.matchedApplication || null,
    };
    renderPlanPreview(resp.fillPlan);
    $('fillBtn').disabled = false;
    $('saveBtn').disabled = true;
    // Buttons are always enabled once a plan exists — detection informs how
    // the click behaves (auto-attach vs. download-and-tell-the-AE), it
    // doesn't gate whether the AE can try. Detection can miss a field the
    // form genuinely has.
    $('resumeFileBtn').disabled = false;
    $('coverLetterBtn').disabled = false;
    // When TalentOS already recognizes this exact job, it uses the ONE
    // resume tailored for it — the manual dropdown pick is ignored server
    // side in that case, so disable it here to avoid a misleading no-op.
    const resumeSelectEl = $('resumeSelect');
    if (resp.matchedApplication) {
      resumeSelectEl.disabled = true;
      setStatus(`Matched existing application: ${resp.matchedApplication.title} @ ${resp.matchedApplication.company}. Using its tailored resume — ${resp.fillPlan.length} fields. Review, then Fill.`, 'success');
    } else {
      resumeSelectEl.disabled = false;
      setStatus(`Plan ready — ${resp.fillPlan.length} fields. Review, then Fill.`, 'success');
    }
  } catch (e) { setStatus(e.message, 'error'); }
}

function applicationIdFromTab() {
  try {
    const url = new URL(tab?.url || '');
    const hash = url.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    return params.get('talentos_application_id') || url.searchParams.get('talentos_application_id') || '';
  } catch {
    return '';
  }
}

async function fill() {
  if (!currentPlan) return;
  setStatus('Filling form…', 'loading');
  try {
    const r = await send('applyFillPlan', { instructions: currentPlan.instructions });
    const applied = r.results.filter((x) => x.applied).length;
    const skipped = r.results.length - applied;
    setStatus(`Filled ${applied} field(s), ${skipped} need your manual input (essay answers, files, low-confidence, or not found). Review the form, fix anything wrong, then click "Save & Learn".`, 'success');
    $('saveBtn').disabled = false;
  } catch (e) { setStatus(e.message, 'error'); }
}

async function saveAndLearn() {
  if (!currentPlan) return;
  setStatus('Recording corrections…', 'loading');
  try {
    const cap = await send('captureCurrentValues', { instructions: currentPlan.instructions });
    const finalBySelector = new Map(cap.values.map((v) => [v.selector, v.finalValue]));
    const fields = currentPlan.instructions
      .filter((i) => i.fieldType !== 'skip' && i.fieldType !== 'file')
      .map((i) => ({
        selector: i.selector,
        label: currentPlan.fieldLabelBySelector?.get(i.selector) || i.selector,
        fieldType: i.fieldType,
        aiValue: i.value,
        aiConfidence: i.confidence,
        aiReasoning: i.reasoning,
        finalValue: finalBySelector.get(i.selector) ?? null,
      }));
    const r = await api('/api/extension/v1/copilot/record-outcome', {
      method: 'POST',
      body: JSON.stringify({
        applicationId: currentPlan.applicationId,
        candidateId: currentPlan.candidateId,
        domain: currentPlan.domain,
        fields,
      }),
    });
    setStatus(`Saved ${r.recorded} field outcome(s). The AI will use any corrections next time on this site.`, 'success');
    $('saveBtn').disabled = true;
  } catch (e) { setStatus(e.message, 'error'); }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderChat() {
  $('chatLog').innerHTML = chatHistory.map((m) =>
    `<div class="chatMsg ${m.role}"><div class="who">${m.role === 'user' ? 'You' : 'Copilot'}</div><div class="bubble">${escapeHtml(m.content)}</div></div>`
  ).join('') || '<div class="meta" style="padding: 10px; text-align: center;">No messages yet. Ask Copilot anything about this form!</div>';
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
}

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

async function sendChat() {
  const input = $('chatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  chatHistory.push({ role: 'user', content: message });
  renderChat();

  const candidate = candidates.find((c) => c.id === (currentPlan?.candidateId || $('candidateSelect').value));
  const fieldSummary = currentPlan?.instructions?.map((i) => ({
    label: currentPlan.fieldLabelBySelector?.get(i.selector) || i.selector,
    value: typeof i.value === 'boolean' ? (i.value ? 'Yes' : 'No') : i.value,
    fieldType: i.fieldType,
    confidence: i.confidence,
    reasoning: i.reasoning,
  }));

  const sessionContext = {
    candidateName: candidate?.name,
    jobTitle: tab?.title,
    domain: tab ? (() => { try { return new URL(tab.url).hostname; } catch { return undefined; } })() : undefined,
    lastFillPlan: currentPlan?.instructions,
    fieldSummary: fieldSummary,
    formSnapshot: fieldSummary,
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

$('tabFill').onclick = () => {
  $('tabFill').classList.add('active'); $('tabChat').classList.remove('active');
  $('panelFill').classList.add('active'); $('panelChat').classList.remove('active');
};
$('tabChat').onclick = () => {
  $('tabChat').classList.add('active'); $('tabFill').classList.remove('active');
  $('panelChat').classList.add('active'); $('panelFill').classList.remove('active');
  renderChat();
};
$('chatSendBtn').onclick = sendChat;
$('chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };

// Triggers a real OS-level download via chrome.downloads (not a synthetic
// <a> click) so it reliably lands in the user's Downloads folder — used as
// the fallback whenever we can't confidently find where to attach a file.
function downloadBlob(blob, fileName) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: fileName, saveAs: false }, (downloadId) => {
      URL.revokeObjectURL(url);
      if (chrome.runtime.lastError || !downloadId) reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
      else resolve(downloadId);
    });
  });
}

// Tries to attach directly to a detected field; if that selector is missing,
// wrong, or the attach otherwise fails, falls back to downloading the file
// and telling the AE exactly what to do — never silently does nothing.
async function attachOrDownload(selector, blob, fileName, mimeType, kindLabel) {
  if (selector) {
    try {
      await attachBlobToField(selector, blob, fileName, mimeType);
      return { attached: true, message: `Attached ${kindLabel} as "${fileName}".` };
    } catch (e) {
      console.warn(`Auto-attach failed for ${kindLabel}, falling back to download:`, e.message);
    }
  }
  await downloadBlob(blob, fileName);
  return {
    attached: false,
    message: selector
      ? `Couldn't auto-attach the ${kindLabel} to the field I found — downloaded "${fileName}" to your Downloads folder instead. Drag it onto the upload field yourself.`
      : `I couldn't find a ${kindLabel} upload field on this page — downloaded "${fileName}" to your Downloads folder. Drag it onto wherever this form wants it.`,
  };
}

async function attachResumeFile() {
  if (!currentPlan) return;
  setStatus('Looking up resume PDF…', 'loading');
  try {
    let blob = null;
    const candidate = candidates.find((c) => c.id === currentPlan.candidateId);
    const selectedResumeId = $('resumeSelect').value;
    const selectedResume = candidate?.resumes?.find((r) => r.id === selectedResumeId);

    if (currentPlan.applicationId) {
      const lookup = await api(`/api/extension/v1/copilot/resume-export?applicationId=${encodeURIComponent(currentPlan.applicationId)}`).catch(() => ({ found: false }));
      if (lookup?.found) {
        blob = lookup.inlineText
          ? window.TosPdfGen.buildResumePdf(candidate?.name, lookup.inlineText)
          : await apiBlob(`/api/extension/v1/resume-download?url=${encodeURIComponent(lookup.url)}`);
      }
    }

    // Fallback: Generate PDF client-side if no application export exists
    if (!blob) {
      const resumeText = selectedResume?.content || selectedResume?.summary || candidate?.summary || candidate?.headline || `${candidate?.name || 'Candidate'}\n\nExperience & Qualifications`;
      blob = window.TosPdfGen.buildResumePdf(candidate?.name || 'Candidate', resumeText);
    }

    const fileName = window.TosPdfGen.professionalFileName(candidate?.name, 'Resume');
    const result = await attachOrDownload(currentPlan.resumeFileSelector, blob, fileName, 'application/pdf', 'resume');
    setStatus(result.message, result.attached ? 'success' : 'error');
  } catch (e) { setStatus(e.message, 'error'); }
}

async function generateAndAttachCoverLetter() {
  if (!currentPlan) return;
  setStatus('Drafting cover letter…', 'loading');
  try {
    const resp = await api('/api/extension/v1/copilot/cover-letter', {
      method: 'POST',
      body: JSON.stringify({ applicationId: currentPlan.applicationId }),
    });
    const candidate = candidates.find((c) => c.id === currentPlan.candidateId);
    const fileName = window.TosPdfGen.professionalFileName(candidate?.name, 'CoverLetter');

    if (currentPlan.coverLetterTextSelector && !currentPlan.coverLetterFileSelector) {
      await send('applyFillPlan', { instructions: [{ selector: currentPlan.coverLetterTextSelector, fieldType: 'text', value: resp.letterText }] });
      setStatus('Cover letter drafted and filled into the text field. Review it before submitting.', 'success');
      return;
    }

    const blob = window.TosPdfGen.buildCoverLetterPdf(candidate?.name, resp.letterText);
    const result = await attachOrDownload(currentPlan.coverLetterFileSelector, blob, fileName, 'application/pdf', 'cover letter');
    setStatus(result.message, result.attached ? 'success' : 'error');
  } catch (e) { setStatus(e.message, 'error'); }
}

$('resumeFileBtn').onclick = attachResumeFile;
$('coverLetterBtn').onclick = generateAndAttachCoverLetter;

$('candidateSelect').onchange = renderResumes;
$('analyzeBtn').onclick = analyze;
$('fillBtn').onclick = fill;
$('saveBtn').onclick = saveAndLearn;
$('toggleSettings').onclick = () => $('settings').classList.toggle('open');
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action !== 'applicationSubmittedDetected' || !sender.tab || sender.tab.id !== tab?.id) return;
  const applicationId = applicationIdFromTab();
  if (!applicationId) return;
  api('/api/extension/v1/copilot/application-status', {
    method: 'POST',
    body: JSON.stringify({ applicationId, source: 'extension' }),
  }).then(() => setStatus('Application marked Applied in TalentOS.', 'success'))
    .catch((e) => setStatus(`Form submitted, but TalentOS status was not updated: ${e.message}`, 'error'));
});
$('saveSettings').onclick = async () => {
  settings = { baseUrl: ($('baseUrl').value || DEFAULT_URL).replace(/\/+$/, ''), apiKey: $('apiKey').value.trim() };
  await chrome.storage.local.set({ settings });
  $('settings').classList.remove('open');
  setStatus('Settings saved.', 'success');
  loadCandidates();
};

async function refresh() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('pageTitle').textContent = tab?.title || '—';
  const okPage = tab && /^https?:/.test(tab.url || '');
  $('analyzeBtn').disabled = !okPage;
  currentPlan = null;
  $('fillBtn').disabled = true;
  $('saveBtn').disabled = true;
  $('resumeFileBtn').disabled = true;
  $('coverLetterBtn').disabled = true;
  $('planPreview').innerHTML = '';
  const linkedApplicationId = applicationIdFromTab();
  $('pageTitle').title = linkedApplicationId ? `Linked application: ${linkedApplicationId}` : '';
}

async function consumePendingApplicationStatus() {
  const pending = (await chrome.storage.local.get(['pendingApplicationStatus'])).pendingApplicationStatus;
  if (!pending?.applicationId || !settings.apiKey) return;
  try {
    await api('/api/extension/v1/copilot/application-status', { method: 'POST', body: JSON.stringify({ applicationId: decodeURIComponent(pending.applicationId), source: 'extension' }) });
    await chrome.storage.local.remove('pendingApplicationStatus');
    setStatus('Application marked Applied in TalentOS.', 'success');
  } catch (e) { setStatus(`Form submitted, but TalentOS status was not updated: ${e.message}`, 'error'); }
}
chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((_i, c, t) => { if (t.active && (c.url || c.status === 'complete')) refresh(); });

chrome.storage.local.get(['settings']).then((s) => {
  settings = { baseUrl: s.settings?.baseUrl || DEFAULT_URL, apiKey: s.settings?.apiKey || '' };
  $('baseUrl').value = settings.baseUrl; $('apiKey').value = settings.apiKey;
  refresh();
  if (settings.apiKey) { loadCandidates(); consumePendingApplicationStatus(); }
  else { $('settings').classList.add('open'); setStatus('Add your API key to get started.'); }
});
