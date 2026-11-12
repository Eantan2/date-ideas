'use strict';

// ---------- Import: link / notes / screenshot -> pre-filled "New idea" form ----------
// Privacy rules for this file:
//  * The screenshot, the pasted notes and the text read from the screenshot only live in
//    variables inside showImport(). They are cleared when you tap "Fill in the form" or Cancel.
//  * Nothing here is sent anywhere. The screenshot is read on the phone.
//  * Post images are never downloaded. Links are never opened or fetched.
//  * The only thing that can be saved is what is in the New idea form when you tap Save.
//    The link is saved only if "Keep source link" is ticked.

const LINK_WARNING = 'A saved link may stop working if the post is removed or made private.';
const OCR_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

// Only normal web links are accepted. Anything else returns ''.
function safeUrl(v) {
  try {
    const u = new URL(String(v || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (e) {
    return '';
  }
}

// Turns pasted text into a first guess for the form fields. You always review it before saving.
function parseImport(text) {
  const out = { title: '', address: '', cost: null, duration: null, seasons: [], tags: [], description: '' };
  const raw = String(text || '').replace(/\r/g, '');
  const low = raw.toLowerCase();

  out.tags = [...new Set((raw.match(/#[a-z0-9_]{2,30}/gi) || []).map((t) => t.slice(1).toLowerCase()))].slice(0, 5);

  if (/\bfree\b/.test(low)) out.cost = 0;
  const m = raw.match(/\$\s?(\d{1,4}(?:\.\d{1,2})?)/);
  if (m) out.cost = Number(m[1]);

  const h = low.match(/(\d{1,2}(?:\.\d)?)\s*(?:hours?|hrs?)\b/);
  if (h) out.duration = Number(h[1]);

  if (/\bspring\b/.test(low)) out.seasons.push('Spring');
  if (/\bsummer\b/.test(low)) out.seasons.push('Summer');
  if (/\b(fall|autumn)\b/.test(low)) out.seasons.push('Fall');
  if (/\bwinter\b/.test(low)) out.seasons.push('Winter');
  out.seasons = out.seasons.filter((s) => (typeof SEASONS !== 'undefined' ? SEASONS.includes(s) : true));

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const pin = lines.find((l) => /^📍/.test(l));
  const street = lines.find((l) => /\b\d{1,5}\s+[\w .'-]+\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|pkwy|hwy)\b/i.test(l));
  if (pin) out.address = pin.replace(/^📍\s*/, '').slice(0, 120);
  else if (street) out.address = street.slice(0, 120);

  const plain = lines.filter((l) => !/^https?:\/\//i.test(l) && !/^@/.test(l) && !/^(#[\w]+\s*)+$/.test(l) && !/^📍/.test(l));
  const first = plain.find((l) => /[a-z]/i.test(l));
  if (first) out.title = first.replace(/#[\w]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const rest = plain.filter((l) => l !== first).join(' ').replace(/#[\w]+/g, '').replace(/\s+/g, ' ').trim();
  out.description = rest.slice(0, 400);
  return out;
}

function loadOcr() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OCR_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('ocr-download'));
    document.head.appendChild(s);
  });
}

function showImport() {
  let notes = '';
  let ocrText = '';
  let file = null;
  let worker = null;
  let reading = false;

  // Throws away everything temporary: the picture, the text read from it, the pasted notes.
  const discard = async () => {
    notes = '';
    ocrText = '';
    file = null;
    const w = worker;
    worker = null;
    if (w) {
      try { await w.terminate(); } catch (e) { /* already gone */ }
    }
    const ta = $('#imp-notes'); if (ta) ta.value = '';
    const fi = $('#imp-file'); if (fi) fi.value = '';
    const li = $('#imp-link'); if (li) li.value = '';
  };

  openSheet(
    `<div class="sheet-head">
       <button class="link" data-act="impcancel">Cancel</button>
       <strong>Import an idea</strong>
       <span></span>
     </div>
     <div class="sheet-body">
       <p class="hint" style="margin:0 0 14px">This only helps fill in the form. You check it before anything is saved.</p>

       <div class="field"><label>Link (optional)</label>
         <input type="url" id="imp-link" placeholder="https://…" autocapitalize="none" autocorrect="off" inputmode="url">
         <p class="hint">The app never opens or downloads links or pictures from a post. Instagram and TikTok don't let phones read a post from its link, so paste the caption below.</p></div>

       <div class="field"><label>Paste the caption or your notes</label>
         <textarea id="imp-notes" placeholder="Sunset kayaking, $40, 2 hours, #outdoors"></textarea></div>

       <div class="field"><label>Or read a screenshot</label>
         <input type="file" id="imp-file" accept="image/*">
         <p class="hint">The screenshot is read on your phone and is never uploaded or saved. The first time, a small reading tool (a few MB) downloads from the internet.</p>
         <div class="error" id="imp-status"></div></div>

       <label class="keep"><input type="checkbox" id="imp-keep"> <span><b>Keep source link</b><br><span class="hint" style="margin:0">${esc(LINK_WARNING)} If this is off, the link is not saved.</span></span></label>

       <div class="error" id="imp-error"></div>
       <button class="btn" data-act="impfill" id="imp-go">Fill in the form</button>
       <p class="hint">After you save, only the details in the form are kept. The screenshot, pasted notes and text read from it are thrown away, whether you save or cancel.</p>
     </div>`,
    {
      impcancel: async () => {
        await discard();
        showForm(null);
      },
      impfill: async (b) => {
        if (reading) return;
        const err = $('#imp-error');
        err.textContent = '';
        notes = $('#imp-notes').value;
        const rawLink = $('#imp-link').value.trim();
        const link = rawLink ? safeUrl(rawLink) : '';
        if (rawLink && !link) return (err.textContent = 'That link doesn’t look right. It should start with http:// or https://');
        const keep = $('#imp-keep').checked;
        if (keep && !link) return (err.textContent = 'Paste a link first, or untick "Keep source link".');

        file = $('#imp-file').files[0] || null;
        if (!notes.trim() && !file && !link) return (err.textContent = 'Paste a caption, add a screenshot, or paste a link.');

        reading = true;
        const old = b.textContent;
        b.disabled = true;
        try {
          if (file) {
            b.textContent = 'Reading screenshot…';
            const status = $('#imp-status');
            status.textContent = '';
            try {
              await loadOcr();
              worker = await window.Tesseract.createWorker('eng');
              const res = await worker.recognize(file);
              ocrText = (res && res.data && res.data.text) || '';
            } catch (e) {
              if (worker) { try { await worker.terminate(); } catch (x) { /* ignore */ } worker = null; }
              reading = false;
              b.disabled = false;
              b.textContent = old;
              status.textContent = 'Couldn’t read the screenshot. Check your internet and choose it again, or paste the text above and tap Fill in the form.';
              file = null;
              ocrText = '';
              $('#imp-file').value = ''; // forget the picture so you can go on with typed notes
              return;
            }
          }
          const guess = parseImport([notes, ocrText].filter(Boolean).join('\n'));
          if (link && keep) guess.sourceLink = link;
          await discard();
          reading = false;
          showForm(null, guess);
        } finally {
          reading = false;
        }
      },
    }
  );
}
