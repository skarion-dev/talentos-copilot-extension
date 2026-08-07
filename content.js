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
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // Build a selector that will still resolve this exact element later
  // (for applyFillPlan / captureCurrentValues), preferring stable attributes
  // over structural position.
  function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `[name="${CSS.escape(el.name)}"]`;
    // Structural fallback: nth-of-type chain from a nearby ancestor with an id,
    // capped at 4 levels so it doesn't get absurdly long.
    const parts = [];
    let node = el;
    for (let i = 0; i < 4 && node && node !== document.body; i++) {
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      const parent = node.parentElement;
      if (!parent) break;
      const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
      const idx = siblings.indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${idx})`);
      node = parent;
    }
    return parts.join(' > ');
  }

  function labelFor(el) {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return clean(lbl.innerText);
    }
    const wrapLabel = el.closest('label');
    if (wrapLabel) return clean(wrapLabel.innerText);
    // Common pattern: label/legend sibling above the field's container.
    const container = el.closest('div,fieldset,td,li');
    if (container) {
      const legend = container.querySelector('legend');
      if (legend) return clean(legend.innerText);
      const prior = container.previousElementSibling;
      if (prior && /label|legend|span|div/i.test(prior.tagName)) {
        const t = clean(prior.innerText);
        if (t && t.length < 200) return t;
      }
    }
    // Component-library ATS forms (Zoho Recruit confirmed live, likely others
    // built on similar wrapper-heavy patterns) nest the input several levels
    // below its label, with the label as a sibling of an ANCESTOR wrapper,
    // not the input's own immediate container. e.g. Zoho:
    //   div.crc-form-row > label.crm-from-label + div.crc-form-field > ... > input
    // Walk up to 6 ancestor levels; at each step check if the level we just
    // left has a previous sibling that IS or CONTAINS a <label>, or is a
    // short-text element whose class name mentions "label".
    let node = el;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      const parent = node.parentElement;
      if (!parent) break;
      const sib = node.previousElementSibling;
      if (sib) {
        const labelEl = sib.matches('label') ? sib : sib.querySelector('label');
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

  function optionsFor(el) {
    if (el.tagName === 'SELECT') {
      return [...el.options].map((o) => clean(o.textContent)).filter(Boolean);
    }
    if (el.type === 'radio' && el.name) {
      return [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)]
        .map((r) => labelFor(r)).filter(Boolean);
    }
    return undefined;
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false; // hidden via layout
    return true;
  }

  function scanForm() {
    const els = [...document.querySelectorAll('input, select, textarea')].filter(isFillable);
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
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyOne(instr) {
    if (instr.fieldType === 'skip' || instr.fieldType === 'ai_answer' || instr.fieldType === 'file') {
      return { selector: instr.selector, applied: false, reason: instr.fieldType };
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
        const l = labelFor(r).toLowerCase();
        return l === String(instr.value).toLowerCase() || l.includes(String(instr.value).toLowerCase());
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
