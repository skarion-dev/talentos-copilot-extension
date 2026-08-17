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

  // ─── Selector builder ────────────────────────────────────────────────────────
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
      if (!parent) { pathParts.unshift(curr.tagName.toLowerCase()); break; }
      const siblings = [...parent.children].filter((c) => c.tagName === curr.tagName);
      const idx = siblings.indexOf(curr) + 1;
      pathParts.unshift(`${curr.tagName.toLowerCase()}:nth-of-type(${idx})`);
      curr = parent;
    }
    return pathParts.join(' > ');
  }

  // ─── Label resolution ────────────────────────────────────────────────────────
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
    if (el.type === 'radio' || el.type === 'checkbox' || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox') {
      const group = el.closest('fieldset, [role="group"], .application-question, .form-group, .field, .crc-form-row');
      if (group) {
        const candidateLabels = [...group.querySelectorAll('legend, .application-label, .field-label, .question-label, .crm-from-label, .crm-form-label, label, span')];
        const groupLabel = candidateLabels.find((lbl) => !lbl.querySelector('input') && clean(lbl.innerText).length > 2);
        if (groupLabel) { const t = clean(groupLabel.innerText); if (t) return t; }
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
    const wrapLabel = el.closest('label');
    if (wrapLabel && el.type !== 'radio' && el.type !== 'checkbox') return clean(wrapLabel.innerText);
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
    // Walk up — catches Ashby / Lever / Workday component-library patterns
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
    return clean(el.getAttribute('aria-label') || el.getAttribute('aria-placeholder') || el.placeholder || '');
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

  // Returns available options for selects, radios, and ARIA listboxes/comboboxes.
  function optionsFor(el) {
    if (el.tagName === 'SELECT') {
      return [...el.options].map((o) => clean(o.textContent)).filter(Boolean);
    }
    if (el.type === 'radio' && el.name) {
      return [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)]
        .map((r) => radioChoiceLabel(r)).filter(Boolean);
    }
    // Hidden checkbox backed by Yes/No toggle buttons (Ashby, Lever, Workday custom toggles)
    if (el.type === 'checkbox') {
      const container = el.closest('fieldset, [role="group"], li, td, div');
      if (container) {
        const toggleBtns = [...container.querySelectorAll('button')]
          .filter((b) => /^\s*(yes|no|true|false)\s*$/i.test(b.innerText.trim()));
        if (toggleBtns.length >= 2) return toggleBtns.map((b) => b.innerText.trim());
      }
    }
    // ARIA combobox: look for a sibling/child listbox or an aria-controls listbox
    const role = el.getAttribute('role');
    if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') {
      const controlsId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      const listbox = controlsId
        ? document.getElementById(controlsId)
        : el.closest('[role="combobox"]')?.querySelector('[role="listbox"]') ||
          document.querySelector(`[role="listbox"]`);
      if (listbox) {
        return [...listbox.querySelectorAll('[role="option"]')].map((o) => clean(o.textContent)).filter(Boolean);
      }
    }
    return undefined;
  }

  // ─── Element collection ──────────────────────────────────────────────────────
  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    const role = el.getAttribute('role');
    const isNativeInput = /^(input|select|textarea)$/i.test(el.tagName);
    const isAriaWidget = role && /^(textbox|combobox|spinbutton|searchbox)$/.test(role);
    const isContentEditable = el.contentEditable === 'true';

    if (isNativeInput) {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
      if (el.type !== 'file' && el.type !== 'radio' && el.type !== 'checkbox') {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
      }
      return true;
    }
    if (isAriaWidget || isContentEditable) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return true;
    }
    return false;
  }

  function getAllFormElements(root = document) {
    const elements = [];
    // Native form controls
    const natives = root.querySelectorAll('input, select, textarea');
    elements.push(...natives);
    // ARIA widgets not wrapped in a native element
    const ariaWidgets = root.querySelectorAll(
      '[role="textbox"]:not(input):not(textarea), [role="combobox"]:not(input):not(select), [role="spinbutton"]:not(input), [role="searchbox"]:not(input)'
    );
    for (const w of ariaWidgets) {
      // Skip if this widget is just a wrapper that contains a native input
      if (!w.querySelector('input, select, textarea')) elements.push(w);
    }
    // Contenteditable divs/spans (Ashby essay boxes, Quill, ProseMirror, etc.)
    // Exclude ones that are inside a known rich-text editor toolbar
    const contentEditables = root.querySelectorAll('[contenteditable="true"]');
    for (const ce of contentEditables) {
      if (ce.closest('[role="toolbar"]')) continue;
      if (/^(html|body|head)$/i.test(ce.tagName)) continue;
      if (!ce.querySelector('input, select, textarea')) elements.push(ce);
    }
    // Shadow DOM traversal
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot) elements.push(...getAllFormElements(node.shadowRoot));
    }
    return elements;
  }

  // ─── Classify element for scanForm ──────────────────────────────────────────
  function elementInputType(el) {
    if (el.contentEditable === 'true') return 'contenteditable';
    const role = el.getAttribute('role');
    if (role === 'combobox') return 'combobox';
    if (role === 'textbox') return 'textbox';
    if (role === 'spinbutton') return 'number';
    return el.type || undefined;
  }

  function scanForm() {
    const els = getAllFormElements(document).filter(isFillable);
    const fields = els.map((el) => {
      const inputType = elementInputType(el);
      const field = {
        selector: selectorFor(el),
        type: el.tagName.toLowerCase(),
        inputType,
        label: labelFor(el),
        name: el.name || el.getAttribute('name') || '',
        placeholder: el.placeholder || el.getAttribute('aria-placeholder') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        options: optionsFor(el),
        required: !!(el.required || el.getAttribute('aria-required') === 'true'),
      };
      // Hint for AI: date inputs need YYYY-MM-DD format
      if (inputType === 'date') field.dateFormat = 'YYYY-MM-DD';
      return field;
    });
    // Dedup radios (one entry per name group)
    const seenRadio = new Set();
    // Dedup contenteditable/combobox by selector (shadow DOM can double-register)
    const seenSel = new Set();
    return fields.filter((f) => {
      if (seenSel.has(f.selector)) return false;
      seenSel.add(f.selector);
      if (f.inputType !== 'radio') return true;
      if (seenRadio.has(f.name)) return false;
      seenRadio.add(f.name);
      return true;
    });
  }

  // ─── React-compatible value setter ──────────────────────────────────────────
  // Uses the native prototype setter to bypass React's synthetic event tracking,
  // then fires the full event chain React needs to register the change.
  function setNativeValue(el, value) {
    try { el.focus(); } catch {}
    const isTextarea = el.tagName.toUpperCase() === 'TEXTAREA';
    const proto = isTextarea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('keydown', { bubbles: true }));
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('keyup', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // React-compatible select setter — uses native prototype to bypass React's
  // internal value tracking, then fires input + change so React state updates.
  function setNativeSelectValue(el, optionValue) {
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    if (nativeSet) nativeSet.call(el, optionValue); else el.value = optionValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Normalize an AI-generated date string to the YYYY-MM-DD format required
  // by native <input type="date"> elements.
  function normalizeDateValue(raw) {
    const s = String(raw || '').trim();
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // MM/DD/YYYY or DD/MM/YYYY → try both
    const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
      const [, a, b, y] = slash;
      // Heuristic: if first part > 12 it must be day-first
      const [m, d] = Number(a) > 12 ? [b, a] : [a, b];
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // "January 15, 2024" / "15 January 2024"
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return s; // return as-is, let browser validate
  }

  // ─── Contenteditable filler ──────────────────────────────────────────────────
  function fillContentEditable(el, value) {
    try { el.focus(); } catch {}
    // Use execCommand for broad browser + framework compatibility
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, String(value));
    } catch {
      // Fallback: direct innerText assignment (works in most cases)
      el.innerText = String(value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ─── ARIA combobox filler ────────────────────────────────────────────────────
  // Tries to open a custom dropdown and click the matching option.
  // Returns a Promise so applyFillPlan can await it for async interactions.
  function fillCombobox(el, value) {
    return new Promise((resolve) => {
      const want = String(value).toLowerCase().trim();

      // Step 1: If the combobox is actually backed by a native <select>, fill that.
      const nativeSel = el.closest('[role="combobox"]')?.querySelector('select') ||
                        el.querySelector('select');
      if (nativeSel) {
        const opt = [...nativeSel.options].find((o) =>
          o.textContent.trim().toLowerCase() === want ||
          o.textContent.trim().toLowerCase().includes(want) ||
          want.includes(o.textContent.trim().toLowerCase())
        );
        if (opt) { setNativeSelectValue(nativeSel, opt.value); resolve(true); return; }
      }

      // Step 2: If this element is an <input> inside a combobox, type into it.
      const textInput = el.matches('input') ? el : el.querySelector('input[type="text"], input:not([type="hidden"])');
      if (textInput) {
        setNativeValue(textInput, String(value));
      } else {
        // Click to open the dropdown
        try { el.click(); } catch {}
      }

      // Step 3: Wait a tick for the dropdown to render, then click the matching option.
      setTimeout(() => {
        // Check for an aria-expanded listbox
        const controlsId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
        const listbox = controlsId
          ? document.getElementById(controlsId)
          : document.querySelector('[role="listbox"]:not([hidden])') ||
            document.querySelector('[role="option"]')?.closest('[role="listbox"]');

        if (listbox) {
          const options = [...listbox.querySelectorAll('[role="option"]')];
          const match = options.find((o) => {
            const t = clean(o.textContent).toLowerCase();
            return t === want || t.includes(want) || want.includes(t);
          });
          if (match) {
            match.click();
            resolve(true);
            return;
          }
        }

        // Step 4: If no listbox found, try pressing ArrowDown + Enter to select first match.
        const target = textInput || el;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, keyCode: 40 }));
        setTimeout(() => {
          target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, keyCode: 13 }));
          resolve(false); // partial — let verify catch any mismatch
        }, 80);
      }, 120);
    });
  }

  // ─── applyOne ────────────────────────────────────────────────────────────────
  async function applyOne(instr) {
    if (instr.fieldType === 'skip' || instr.fieldType === 'ai_answer' || instr.fieldType === 'file') {
      return { selector: instr.selector, applied: false, reason: instr.fieldType };
    }
    if (instr.confidence === 'low') {
      return { selector: instr.selector, applied: false, reason: 'low_confidence_review' };
    }
    let el;
    try { el = document.querySelector(instr.selector); } catch { el = null; }
    if (!el) return { selector: instr.selector, applied: false, reason: 'not_found' };

    // ── checkbox ──
    if (instr.fieldType === 'checkbox') {
      const valStr = String(instr.value ?? '').toLowerCase();
      const want = instr.value === true || valStr === 'true' || valStr === 'yes';

      // Handle ATS-style Yes/No toggle buttons backed by a hidden checkbox (Ashby, Lever, etc.)
      const container = el.closest('fieldset, [role="group"], li, td, div');
      if (container) {
        const toggleBtns = [...container.querySelectorAll('button')]
          .filter((b) => /^\s*(yes|no|true|false)\s*$/i.test(b.innerText.trim()));
        if (toggleBtns.length >= 2) {
          const targetLabel = want ? 'yes' : 'no';
          const btn = toggleBtns.find((b) => b.innerText.trim().toLowerCase() === targetLabel);
          if (btn) { btn.click(); return { selector: instr.selector, applied: true }; }
        }
      }

      if (el.checked !== want) el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { selector: instr.selector, applied: true };
    }

    // ── radio ──
    if (instr.fieldType === 'radio') {
      const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
      const want = String(instr.value).toLowerCase();
      const target = group.find((r) => {
        const t = radioChoiceLabel(r).toLowerCase();
        return t === want || t.includes(want) || want.includes(t);
      });
      if (target) {
        target.click();
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { selector: instr.selector, applied: true };
      }
      return { selector: instr.selector, applied: false, reason: 'no_matching_option' };
    }

    // ── native <select> — use native setter so React state updates ──
    if (instr.fieldType === 'select' || el.tagName === 'SELECT') {
      const want = String(instr.value).toLowerCase();
      const opt = [...el.options].find((o) => {
        const t = o.textContent.trim().toLowerCase();
        return t === want || t.includes(want) || want.includes(t);
      });
      if (opt) {
        setNativeSelectValue(el, opt.value);
        return { selector: instr.selector, applied: true };
      }
      return { selector: instr.selector, applied: false, reason: 'no_matching_option' };
    }

    // ── ARIA combobox / custom dropdown ──
    if (instr.fieldType === 'combobox' || el.getAttribute('role') === 'combobox' ||
        el.getAttribute('aria-haspopup') === 'listbox') {
      const applied = await fillCombobox(el, instr.value);
      return { selector: instr.selector, applied };
    }

    // ── contenteditable (essay boxes, rich-text editors) ──
    if (instr.fieldType === 'contenteditable' || el.contentEditable === 'true') {
      fillContentEditable(el, String(instr.value ?? ''));
      return { selector: instr.selector, applied: true };
    }

    // ── date input — normalize to YYYY-MM-DD ──
    if (el.type === 'date') {
      setNativeValue(el, normalizeDateValue(String(instr.value ?? '')));
      return { selector: instr.selector, applied: true };
    }

    // ── text / email / tel / url / textarea / number / search ──
    setNativeValue(el, String(instr.value ?? ''));
    return { selector: instr.selector, applied: true };
  }

  async function applyFillPlan(instructions) {
    const results = [];
    for (const instr of instructions) {
      results.push(await applyOne(instr));
    }
    return results;
  }

  // ─── captureCurrentValues ────────────────────────────────────────────────────
  // Re-reads the DOM after manual AE review. Handles all field types so the
  // record-outcome payload always reflects the human's final intent.
  function captureCurrentValues(instructions) {
    return instructions.map((instr) => {
      let el;
      try { el = document.querySelector(instr.selector); } catch { el = null; }
      if (!el) return { selector: instr.selector, finalValue: null };

      // checkbox — return boolean to match the type of aiValue (boolean true/false).
      // Returning string "true"/"false" caused a type mismatch: the backend's strict
      // equality check would always treat every checkbox as "corrected" even when the
      // user accepted the AI's choice, poisoning the learning data.
      if (instr.fieldType === 'checkbox' || el.type === 'checkbox') {
        return { selector: instr.selector, finalValue: el.checked };
      }
      // radio
      if (instr.fieldType === 'radio' || el.type === 'radio') {
        const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
        const checked = group.find((r) => r.checked);
        return { selector: instr.selector, finalValue: checked ? radioChoiceLabel(checked) : null };
      }
      // native select
      if (instr.fieldType === 'select' || el.tagName === 'SELECT') {
        const opt = el.options[el.selectedIndex];
        return { selector: instr.selector, finalValue: opt ? opt.textContent.trim() : null };
      }
      // ARIA combobox — read aria-activedescendant text or input value
      if (instr.fieldType === 'combobox' || el.getAttribute('role') === 'combobox') {
        const activeId = el.getAttribute('aria-activedescendant');
        if (activeId) {
          const active = document.getElementById(activeId);
          if (active) return { selector: instr.selector, finalValue: clean(active.textContent) };
        }
        const textInput = el.matches('input') ? el : el.querySelector('input');
        if (textInput) return { selector: instr.selector, finalValue: textInput.value || null };
        // Fallback: read displayed value from the combobox button/trigger text
        const trigger = el.querySelector('[data-value], .selected-value, .value, [aria-selected="true"]');
        if (trigger) return { selector: instr.selector, finalValue: clean(trigger.textContent) };
        return { selector: instr.selector, finalValue: clean(el.textContent) || null };
      }
      // contenteditable
      if (instr.fieldType === 'contenteditable' || el.contentEditable === 'true') {
        return { selector: instr.selector, finalValue: el.innerText || el.textContent || null };
      }
      // everything else (text / email / tel / url / date / textarea / number)
      return { selector: instr.selector, finalValue: el.value ?? null };
    });
  }

  // ─── attachFile ──────────────────────────────────────────────────────────────
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

  // ─── auditRequiredFields ─────────────────────────────────────────────────────
  function auditRequiredFields() {
    const els = getAllFormElements(document).filter(isFillable);
    const missing = [];
    for (const el of els) {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') continue;
      const isReq = el.required ||
                    el.getAttribute('aria-required') === 'true' ||
                    !!el.closest('.required, [data-required="true"]');
      if (!isReq) continue;

      let isEmpty = false;
      if (el.type === 'checkbox') {
        isEmpty = !el.checked;
      } else if (el.type === 'radio' && el.name) {
        const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
        isEmpty = !group.some((r) => r.checked);
      } else if (el.type === 'file') {
        isEmpty = !el.files || el.files.length === 0;
      } else if (el.contentEditable === 'true') {
        isEmpty = !String(el.innerText || el.textContent || '').trim();
      } else if (el.getAttribute('role') === 'combobox') {
        const textInput = el.matches('input') ? el : el.querySelector('input');
        const displayed = el.getAttribute('aria-activedescendant') || (textInput ? textInput.value : '');
        isEmpty = !String(displayed || '').trim() && !String(el.textContent || '').trim();
      } else {
        isEmpty = !String(el.value || '').trim();
      }

      if (isEmpty) {
        missing.push({ selector: selectorFor(el), label: labelFor(el) || el.name || 'Required Field' });
      }
    }
    const seenSelectors = new Set();
    return {
      ok: true,
      missing: missing.filter((m) => {
        if (seenSelectors.has(m.selector)) return false;
        seenSelectors.add(m.selector);
        return true;
      }),
    };
  }

  // ─── verifyFillPlan ──────────────────────────────────────────────────────────
  function verifyFillPlan(instructions) {
    return instructions.map((instr) => {
      if (instr.fieldType === 'skip' || instr.fieldType === 'file' || instr.fieldType === 'ai_answer') {
        return { selector: instr.selector, status: 'skipped', reason: instr.fieldType };
      }
      let el;
      try { el = document.querySelector(instr.selector); } catch { el = null; }
      if (!el) return { selector: instr.selector, status: 'not_found' };
      if (!el.offsetParent && el.type !== 'radio' && el.type !== 'checkbox' &&
          el.getAttribute('role') !== 'combobox' && el.contentEditable !== 'true') {
        return { selector: instr.selector, status: 'not_visible' };
      }

      if (instr.fieldType === 'checkbox' || el.type === 'checkbox') {
        const want = instr.value === true || instr.value === 'true';
        return { selector: instr.selector, status: el.checked === want ? 'ok' : 'mismatch',
                 actual: String(el.checked), expected: String(want) };
      }
      if (instr.fieldType === 'radio' || el.type === 'radio') {
        const group = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
        const checked = group.find((r) => r.checked);
        const actual = checked ? radioChoiceLabel(checked) : null;
        const want = String(instr.value || '').toLowerCase();
        const match = actual && (actual.toLowerCase() === want || actual.toLowerCase().includes(want) || want.includes(actual.toLowerCase()));
        return { selector: instr.selector, status: match ? 'ok' : (actual ? 'mismatch' : 'not_selected'),
                 actual, expected: String(instr.value) };
      }
      if (instr.fieldType === 'select' || el.tagName === 'SELECT') {
        const opt = el.options[el.selectedIndex];
        const actual = opt ? opt.textContent.trim() : '';
        const want = String(instr.value || '').toLowerCase();
        const match = actual.toLowerCase() === want || actual.toLowerCase().includes(want) || want.includes(actual.toLowerCase());
        return { selector: instr.selector, status: match ? 'ok' : 'mismatch', actual, expected: String(instr.value) };
      }
      if (instr.fieldType === 'combobox' || el.getAttribute('role') === 'combobox') {
        const textInput = el.matches('input') ? el : el.querySelector('input');
        const actual = textInput ? textInput.value : clean(el.textContent);
        const want = String(instr.value || '').toLowerCase();
        const match = actual && (actual.toLowerCase() === want || actual.toLowerCase().includes(want) || want.includes(actual.toLowerCase()));
        return { selector: instr.selector, status: match ? 'ok' : (actual ? 'mismatch' : 'not_selected'),
                 actual, expected: String(instr.value) };
      }
      if (instr.fieldType === 'contenteditable' || el.contentEditable === 'true') {
        const actual = String(el.innerText || el.textContent || '').trim();
        const expected = String(instr.value ?? '').trim();
        if (!actual && expected) return { selector: instr.selector, status: 'framework_mismatch', actual, expected };
        return { selector: instr.selector, status: actual.includes(expected) || expected.includes(actual) ? 'ok' : 'mismatch',
                 actual, expected };
      }
      // text / email / tel / url / date / textarea / number
      const actual = el.value ?? '';
      const expected = String(instr.value ?? '');
      if (actual === expected) return { selector: instr.selector, status: 'ok', actual };
      if (actual === '' && expected !== '') return { selector: instr.selector, status: 'framework_mismatch', actual, expected };
      return { selector: instr.selector, status: 'mismatch', actual, expected };
    });
  }

  // ─── ATS detection ───────────────────────────────────────────────────────────
  function detectAts() {
    const h = location.hostname;
    if (/greenhouse\.io|boards\.greenhouse\.io/.test(h)) return 'Greenhouse';
    if (/lever\.co/.test(h)) return 'Lever';
    if (/workday\.com|myworkdayjobs\.com/.test(h)) return 'Workday';
    if (/smartrecruiters\.com/.test(h)) return 'SmartRecruiters';
    if (/ashbyhq\.com/.test(h)) return 'Ashby';
    if (/zohorecruit\.com|zoho\.com/.test(h)) return 'Zoho';
    if (/workable\.com/.test(h)) return 'Workable';
    if (/bamboohr\.com/.test(h)) return 'BambooHR';
    return 'Unknown';
  }

  // ─── Submission confirmation detection ───────────────────────────────────────
  function detectSubmissionConfirmation() {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
    return /application\s+(has\s+been\s+)?(submitted|received|sent|complete|successful)|thank\s+you\s+for\s+(applying|your\s+application|submitting)|we\s+(have\s+)?received\s+your\s+application|successfully\s+(applied|submitted)|your\s+application\s+(is\s+)?(on\s+file|complete)|submission\s+(was\s+)?successful/i.test(text);
  }

  // ─── Confirmation observer ────────────────────────────────────────────────────
  let confirmationObserver = null;
  function startConfirmationObserver() {
    if (confirmationObserver) return;
    confirmationObserver = new MutationObserver(() => {
      if (detectSubmissionConfirmation()) {
        reportSubmission();
        confirmationObserver.disconnect();
        confirmationObserver = null;
      }
    });
    confirmationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  window.addEventListener('popstate', () => {
    setTimeout(() => { if (detectSubmissionConfirmation()) reportSubmission(); }, 500);
  });

  window.__tosScanForm = scanForm;
  window.__tosApplyFillPlan = applyFillPlan;
  window.__tosCaptureCurrentValues = captureCurrentValues;
  window.__tosAttachFile = attachFile;
  window.__tosAuditRequiredFields = auditRequiredFields;
  window.__tosVerifyFillPlan = verifyFillPlan;
  window.__tosDetectAts = detectAts;
  window.__tosDetectSubmissionConfirmation = detectSubmissionConfirmation;
  window.__tosStartConfirmationObserver = startConfirmationObserver;

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.action === 'scanForm') {
      sendResponse({ ok: true, fields: scanForm() });
      return true;
    }
    if (msg.action === 'applyFillPlan') {
      applyFillPlan(msg.instructions).then((results) => sendResponse({ ok: true, results }));
      return true; // keep channel open for async response
    }
    if (msg.action === 'captureCurrentValues') {
      sendResponse({ ok: true, values: captureCurrentValues(msg.instructions) });
      return true;
    }
    if (msg.action === 'attachFile') {
      sendResponse({ ok: true, ...attachFile(msg.selector, msg.base64, msg.fileName, msg.mimeType) });
      return true;
    }
    if (msg.action === 'auditRequiredFields') {
      sendResponse(auditRequiredFields());
      return true;
    }
    if (msg.action === 'verifyFillPlan') {
      sendResponse({ ok: true, results: verifyFillPlan(msg.instructions) });
      return true;
    }
    if (msg.action === 'detectAts') {
      sendResponse({ ok: true, ats: detectAts() });
      return true;
    }
    if (msg.action === 'detectSubmissionConfirmation') {
      sendResponse({ ok: true, detected: detectSubmissionConfirmation() });
      return true;
    }
    if (msg.action === 'startConfirmationObserver') {
      startConfirmationObserver();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  console.log('[TalentOS Copilot] content script ready');
}
