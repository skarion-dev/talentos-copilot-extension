// TalentOS Application Copilot — content script
// scanForm(): builds a formSnapshot the fill-plan AI agent can reason about.
// applyFillPlan(): writes AI-chosen values into the DOM.
// captureCurrentValues(): re-reads the same fields after manual review, for
// the record-outcome learning loop.

if (!window.__tosCopilotReady) {
  window.__tosCopilotReady = true;
  initCopilot();
}

function initCopilot() {
  let submissionReported = false;
  function reportSubmission() {
    if (submissionReported) return;
    submissionReported = true;
    chrome.runtime.sendMessage({ action: 'applicationSubmittedDetected' }).catch(() => {});
  }

  // ATS forms vary widely: some submit a form, others use a button that
  // performs an async request. Only react to strong submit/apply wording so
  // Next/Save/Continue controls do not flip the TalentOS application.
  document.addEventListener('submit', (event) => {
    const submitter = event.submitter;
    const text = `${submitter?.innerText || ''} ${submitter?.value || ''}`.toLowerCase();
    if (/\b(apply|submit application|submit your application|send application)\b/.test(text)) reportSubmission();
  }, true);
  document.addEventListener('click', (event) => {
    const el = event.target?.closest?.('button, input[type="submit"], [role="button"]');
    if (!el) return;
    const text = `${el.innerText || ''} ${el.value || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase().replace(/\s+/g, ' ');
    if (/\b(apply now|apply|submit application|submit your application|send application)\b/.test(text)) {
      window.setTimeout(reportSubmission, 800);
    }
  }, true);
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // Build a selector that will still resolve this exact element later
  // (for applyFillPlan / captureCurrentValues), preferring stable attributes
  // over structural position.
  function selectorFor(el) {
    if (el.id) {
      const sel = `#${CSS.escape(el.id)}`;
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
    }
    if (el.name && el.type !== 'radio') {
      const sel = `[name="${CSS.escape(el.name)}"]`;
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
    }
    if (el.name && el.type === 'radio') {
      return `input[type="radio"][name="${CSS.escape(el.name)}"]`;
    }
    for (const attr of ['data-automation-id', 'data-testid', 'data-qa', 'data-field', 'data-cy']) {
      const v = el.getAttribute(attr);
      if (v) {
        const sel = `[${attr}="${CSS.escape(v)}"]`;
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
      }
    }

    const pathParts = [];
    let curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.id) {
        const parentSel = `#${CSS.escape(curr.id)}`;
        try {
          if (document.querySelectorAll(parentSel).length === 1) {
            pathParts.unshift(parentSel);
            break;
          }
        } catch {}
      }
      const parent = curr.parentElement;
      if (!parent) {
        pathParts.unshift(curr.tagName.toLowerCase());
        break;
      }
      const siblings = [...parent.children].filter((c) => c.tagName === curr.tagName);
      const idx = siblings.indexOf(curr) + 1;
      pathParts.unshift(`${curr.tagName.toLowerCase()}:nth-of-type(${idx})`);
      curr = parent;
    }
    return pathParts.join(' > ');
  }

  function labelFor(el) {
    const ariaBy = el.getAttribute('aria-labelledby');
    if (ariaBy) {
      const texts = ariaBy.split(/\s+/).map((id) => {
        let target;
        try { target = document.getElementById(id); } catch { target = null; }
        return target ? clean(target.innerText) : '';
      }).filter(Boolean);
      if (texts.length) return texts.join(' ');
    }

    // For radios/checkboxes: The parent group container (fieldset, .application-question, .form-group)
    // contains the actual question prompt (e.g. "Are you legally authorized to work..."),
    // whereas el.closest('label') is just the option choice text ("Yes" / "No").
    if (el.type === 'radio' || el.type === 'checkbox') {
      const group = el.closest('fieldset, [role="group"], .application-question, .form-group, .field, .crc-form-row');
      if (group) {
        const candidateLabels = [...group.querySelectorAll('legend, .application-label, .field-label, .question-label, .crm-from-label, .crm-form-label, label, span')];
        const groupLabel = candidateLabels.find((lbl) => !lbl.querySelector('input') && clean(lbl.innerText).length > 2);
        if (groupLabel) {
          const t = clean(groupLabel.innerText);
          if (t) return t;
        }
        const prior = group.querySelector('.application-label, legend') || group.previousElementSibling;
        if (prior && prior.innerText) {
          const t = clean(prior.innerText);
          if (t && t.length < 250) return t;
        }
      }
    }

    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return clean(lbl.innerText);
    }

    // Wrap label check (for non-radios, or if group label wasn't found)
    const wrapLabel = el.closest('label');
    if (wrapLabel && el.type !== 'radio' && el.type !== 'checkbox') {
      return clean(wrapLabel.innerText);
    }

    // Common pattern: label/legend sibling above the field's container.
    const container = el.closest('div,fieldset,td,li');
    if (container) {
      const legend = container.querySelector('legend, .application-label, .field-label');
      if (legend) return clean(legend.innerText);
      const prior = container.previousElementSibling;
      if (prior && /label|legend|span|div/i.test(prior.tagName)) {
        const t = clean(prior.innerText);
        if (t && t.length < 200) return t;
      }
    }

    // Component-library ATS forms (Zoho Recruit, Lever, Ashby, Workday)
    let node = el;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      const parent = node.parentElement;
      if (!parent) break;
      const sib = node.previousElementSibling;
      if (sib) {
        const labelEl = sib.matches('label') ? sib : sib.querySelector('label, .application-label');
        if (labelEl) { const t = clean(labelEl.innerText); if (t) return t; }
        if (/label/i.test(sib.className || '')) {
          const t = clean(sib.innerText);
          if (t && t.length < 100) return t;
        }
      }
      node = parent;
    }
    return clean(el.getAttribute('aria-label') || el.placeholder || '');
  }

  function radioChoiceLabel(r) {
    const wrapLabel = r.closest('label');
    if (wrapLabel) return clean(wrapLabel.innerText);
    if (r.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(r.id)}"]`);
      if (lbl) return clean(lbl.innerText);
    }
    const sib = r.nextElementSibling || r.previousElementSibling;
    if (sib) return clean(sib.innerText);
    return clean(r.value || '');
  }

  function optionsFor(el) {
    if (el.tagName === 'SELECT') {
      return [...el.options].map((o) => clean(o.textContent)).filter(Boolean);
    }
    if (el.type === 'radio' && el.name) {
      return [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)]
        .map((r) => radioChoiceLabel(r)).filter(Boolean);
    }
    return undefined;
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
    if (el.type !== 'file' && el.type !== 'radio' && el.type !== 'checkbox') {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false; // hidden via layout
    }
    return true;
  }

  function getAllFormElements(root = document) {
    const elements = [];
    const nodes = root.querySelectorAll('input, select, textarea, *');
    for (const node of nodes) {
      if (/^(input|select|textarea)$/i.test(node.tagName)) {
        elements.push(node);
      }
      if (node.shadowRoot) {
        elements.push(...getAllFormElements(node.shadowRoot));
      }
    }
    return elements;
  }

  function scanForm() {
    const els = getAllFormElements(document).filter(isFillable);
    const fields = els.map((el) => ({
      selector: selectorFor(el),
      type: el.tagName.toLowerCase(),
      inputType: el.type || undefined,
      label: labelFor(el),
      name: el.name || '',
      placeholder: el.placeholder || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      options: optionsFor(el),
      required: !!el.required,
    }));
    // Dedup radios: one entry per name (the AI answers once, applyFillPlan
    // picks the matching radio in the group).
    const seenRadio = new Set();
    return fields.filter((f) => {
      if (f.inputType !== 'radio') return true;
      if (seenRadio.has(f.name)) return false;
      seenRadio.add(f.name);
      return true;
    });
  }

  function setNativeValue(el, value) {
    try { el.focus(); } catch {}
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('keydown', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('keyup', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function applyOne(instr) {
    if (instr.fieldType === 'skip' || instr.fieldType === 'ai_answer' || instr.fieldType === 'file') {
      return { selector: instr.selector, applied: false, reason: instr.fieldType };
    }
    if (instr.confidence === 'low') {
      return { selector: instr.selector, applied: false, reason: 'low_confidence_review' };
    }
    let el;
    try { el = document.querySelector(instr.selector); } catch { el = null; }
    if (!el) return { selector: instr.selector, applied: false, reason: 'not_found' };

    if (instr.fieldType === 'checkbox') {
      const want = instr.value === true || instr.value === 'true';
      if (el.checked !== want) el.click();
      return { selector: instr.selector, applied: true };
    }
    if (instr.fieldType === 'radio') {
      const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
      const target = group.find((r) => {
        const choiceText = radioChoiceLabel(r).toLowerCase();
        const want = String(instr.value).toLowerCase();
        return choiceText === want || choiceText.includes(want) || want.includes(choiceText);
      });
      if (target) { target.click(); return { selector: instr.selector, applied: true }; }
      return { selector: instr.selector, applied: false, reason: 'no_matching_option' };
    }
    if (instr.fieldType === 'select') {
      const opt = [...el.options].find((o) =>
        o.textContent.trim().toLowerCase() === String(instr.value).toLowerCase()
        || o.textContent.trim().toLowerCase().includes(String(instr.value).toLowerCase()));
      if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); return { selector: instr.selector, applied: true }; }
      return { selector: instr.selector, applied: false, reason: 'no_matching_option' };
    }
    // text / email / tel / url / date
    setNativeValue(el, String(instr.value ?? ''));
    return { selector: instr.selector, applied: true };
  }

  function applyFillPlan(instructions) {
    return instructions.map(applyOne);
  }

  // Re-reads current DOM values for a previously-applied plan so corrections
  // (AE edits after Fill) can be captured and sent to record-outcome.
  function captureCurrentValues(instructions) {
    return instructions.map((instr) => {
      let el;
      try { el = document.querySelector(instr.selector); } catch { el = null; }
      if (!el) return { selector: instr.selector, finalValue: null };
      if (instr.fieldType === 'checkbox') return { selector: instr.selector, finalValue: String(el.checked) };
      if (instr.fieldType === 'radio') {
        const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
        const checked = group.find((r) => r.checked);
        return { selector: instr.selector, finalValue: checked ? labelFor(checked) : null };
      }
      if (instr.fieldType === 'select') {
        const opt = el.options[el.selectedIndex];
        return { selector: instr.selector, finalValue: opt ? opt.textContent.trim() : null };
      }
      return { selector: instr.selector, finalValue: el.value ?? null };
    });
  }

  // Sets a real File on a file input via DataTransfer — the standard way to
  // do this from a content script since a real OS file-picker dialog isn't
  // scriptable. base64 arrives via chrome.runtime messaging (Blobs don't
  // survive structured-clone across that boundary reliably).
  function attachFile(selector, base64, fileName, mimeType) {
    let el;
    try { el = document.querySelector(selector); } catch { el = null; }
    if (!el) return { applied: false, reason: 'not_found' };
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], fileName, { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { applied: true };
  }

  window.__tosScanForm = scanForm;
  window.__tosApplyFillPlan = applyFillPlan;
  window.__tosCaptureCurrentValues = captureCurrentValues;
  window.__tosAttachFile = attachFile;

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.action === 'scanForm') {
      sendResponse({ ok: true, fields: scanForm() });
      return true;
    }
    if (msg.action === 'applyFillPlan') {
      sendResponse({ ok: true, results: applyFillPlan(msg.instructions) });
      return true;
    }
    if (msg.action === 'captureCurrentValues') {
      sendResponse({ ok: true, values: captureCurrentValues(msg.instructions) });
      return true;
    }
    if (msg.action === 'attachFile') {
      sendResponse({ ok: true, ...attachFile(msg.selector, msg.base64, msg.fileName, msg.mimeType) });
      return true;
    }
    return false;
  });

  console.log('[TalentOS Copilot] content script ready');
}
