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

// Screenshots of posts come out of the reader with a lot of junk (buttons, counts, random
// symbols). This keeps only lines that look like real words.
const JUNK_LINE = /^(like|likes|liked by|reply|replies|comments?|view (all|more)|follow(ing)?|share|save|send|more|see (more|translation)|suggested|sponsored|add a comment|original audio|\d+\s*(k|m|likes?|comments?|views?|shares?)|\d+\s*(s|m|h|d|w|min|hr|hrs|sec)s?( ago)?)\b/i;
function isReadable(line) {
  const t = line.trim();
  if (t.length < 4) return false;
  if (JUNK_LINE.test(t)) return false;
  const letters = (t.match(/[a-z]/gi) || []).length;
  if (letters / t.length < 0.6) return false;
  const words = t.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (!words.length) return false;
  const real = words.filter((w) => {
    const core = w.replace(/[^a-z]/gi, '');
    if (core.length === 1) return /^(a|i)$/i.test(core);
    if (core.length < 2) return false;
    if (!/[aeiouy]/i.test(core)) return core.length <= 3 && /^[A-Z]+$/.test(core); // "BBQ" ok, "xkzq" not
    if (/(.)\1\1/.test(core)) return false; // "aaa", "lll"
    if (core.length >= 3 && core === core.toUpperCase()) return true; // posters shout: "SUNSET JAZZ NIGHT"
    return /^[a-z]+$/i.test(core) ? !/^[A-Z]{1,}[a-z]*[A-Z]{2,}/.test(core) : true;
  });
  return real.length >= Math.max(1, Math.ceil(words.length * 0.6));
}
// Removes strange symbols the reader makes up, then tidies the spaces.
function tidyLine(line) {
  return line.replace(/[^A-Za-z0-9\s$.,'’!?&#@:;\/%()+-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- finding the name and the address ----------
// App buttons, menus and other text that is on a screenshot but is not part of the idea.
const UI_WORDS = new Set(['instagram', 'tiktok', 'facebook', 'youtube', 'pinterest', 'google', 'maps', 'yelp', 'tripadvisor', 'notes', 'safari', 'reel', 'reels', 'post', 'posts', 'story', 'stories', 'following', 'follow', 'followers', 'for', 'you', 'explore', 'search', 'home', 'profile', 'message', 'messages', 'inbox', 'review', 'reviews', 'photo', 'photos', 'menu', 'overview', 'about', 'directions', 'call', 'website', 'save', 'saved', 'share', 'send', 'like', 'likes', 'comment', 'comments', 'more', 'back', 'done', 'edit', 'open', 'in', 'app', 'get', 'learn', 'see', 'all', 'show', 'sponsored', 'suggested', 'add', 'a', 'and', '&', 'reply', 'view', 'translation', 'original', 'audio', 'sound', 'details', 'order', 'book', 'reserve', 'nearby', 'route', 'start', 'copy', 'report', 'mute', 'close', 'cancel', 'next', 'or']);
// Words that usually belong in the name of a place.
const PLACE_WORDS = /\b(cafe|café|coffee|restaurant|bar|grill|bistro|kitchen|bakery|pizzeria|taqueria|tavern|pub|brewery|winery|diner|eatery|lounge|park|garden|gardens|trail|beach|lake|museum|gallery|studio|theat(?:er|re)|amphitheat(?:er|re)|cinema|hall|center|centre|market|hotel|inn|resort|spa|club|house|farm|orchard|vineyard|zoo|aquarium|arena|stadium|library|pier|marina|falls|canyon|bowl|lanes|arcade|plaza|square|room|shop|store|bookstore|creamery|donuts?|sushi|ramen|tacos?|burgers?|bbq|steakhouse|cantina|roastery)\b/i;
const STATE_ABBR = 'A[KLRZ]|C[AOT]|DE|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]|DC';
const STATE_NAMES = 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming';
const STREET_WORD = 'St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Pkwy|Parkway|Hwy|Highway|Ct|Court|Pl|Place|Ter|Terrace|Cir|Circle|Trl|Trail|Sq|Square|Plz|Plaza|Loop|Pike|Row|Alley|Path|Broadway|ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|DR|DRIVE|LN|LANE|CT|HWY';
const CITY = "[A-Z][A-Za-z.'’-]*(?: [A-Z][A-Za-z.'’-]*){0,3}";
// "482 Maple Street, Springfield, IL 62704": number, street, then the city, state and zip if they are there.
const ADDRESS_RE = new RegExp(
  String.raw`\b\d{1,6}[A-Za-z]?\s+(?:(?:(?:N|S|E|W|NE|NW|SE|SW)\.?|North|South|East|West)\s+)?(?:(?:[A-Z][A-Za-z'’.-]*|\d{1,3}(?:st|nd|rd|th))\s+){0,4}?(?:${STREET_WORD})\b\.?` +
    String.raw`(?:\s*,?\s*(?:#|Suite|Ste\.?|Unit|Apt\.?|Floor|Fl\.?)\s*[A-Za-z0-9-]+)?` +
    String.raw`(?:\s*,\s*${CITY}(?:\s*,\s*(?:${STATE_NAMES})|,?\s+(?:${STATE_ABBR})\b)?(?:\s+\d{5}(?:-\d{4})?)?|\s+${CITY},?\s+(?:${STATE_ABBR})\b(?:\s+\d{5}(?:-\d{4})?)?)?`
);
// "Springfield, Illinois" or "Springfield, IL": a place with no street.
const CITY_ONLY_RE = new RegExp(`^(?:[A-Z][\\w'’&.-]*(?: [A-Z][\\w'’&.-]*){0,4},\\s*)?${CITY},\\s*(?:${STATE_NAMES}|${STATE_ABBR})$`);

// What kind of line this is: 'chrome' (buttons, counts, status bar: ignore it), 'meta' (opening hours,
// phone, website, price level: not a name), 'when' (a date or time), 'place' (just a city) or 'none'.
function lineRole(t) {
  const s = t.trim();
  if (!s) return 'chrome';
  if (/^\d{1,2}:\d{2}\b(?!\s*[ap]\.?m)/i.test(s) && (s.length < 8 || /%|\b(5g|4g|lte|wi-?fi)\b/i.test(s))) return 'chrome'; // phone status bar
  if (/^\[[^\]]*\]$/.test(s)) return 'chrome';
  if (/^[\d.,]+\s*[kmb]?$/i.test(s)) return 'chrome';
  if (/^[\d.,]+\s*[kmb]?\s*(likes?|comments?|views?|shares?|saves?|followers?|following|reviews?|plays?)\b/i.test(s)) return 'chrome';
  if (JUNK_LINE.test(s)) return 'chrome';
  if (/\b\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i.test(s)) return 'chrome';
  if (/^(view|see)\s+(all|more)\b/i.test(s)) return 'chrome';
  if (/^(original (sound|audio)|[♬♪])/i.test(s)) return 'chrome';
  const words = s.toLowerCase().replace(/[^a-z&\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length || words.every((w) => UI_WORDS.has(w))) return 'chrome';
  if (/^@?[a-z0-9]+(?:[._][a-z0-9]+)+$/i.test(s) || /^@\w+$/.test(s)) return 'chrome'; // a user name by itself
  if (/\(\d[\d,.]*[km]?\)\s*$/.test(s)) return 'chrome'; // a star rating like "4.6 ★★★★★ (1,203)"
  if (/\${2,}/.test(s)) return 'meta';
  if (/\b(open|opens|closed|closes|closing)\b.*\d|^(open|closed)\b/i.test(s)) return 'meta';
  if (/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(s)) return 'meta';
  if (/\bwww\.|\b[a-z0-9-]+\.(com|net|org|co|io|app|ly|us)\b/i.test(s)) return 'meta';
  if (/\b(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)s?\b[\s,.-]*(\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}(:\d{2})?\s*[ap]\.?m\b/i.test(s)) return 'when';
  if (CITY_ONLY_RE.test(s)) return 'place';
  return 'none';
}
// Removes a user name at the start of a line ("foodie_dates_la Blue Door Cafe …") and @mentions.
function stripHandle(t) {
  return t.replace(/^@?[a-z0-9]+(?:[._][a-z0-9]+)+(?=\s)\s*/i, '').replace(/@[\w.]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const SMALL_WORDS = new Set(['the', 'of', 'and', 'at', 'in', 'on', 'a', 'an', 'for', 'to', 'by']);
// "SUNSET JAZZ NIGHT" -> "Sunset Jazz Night" (short words like BBQ stay as they are)
function fixShouting(t) {
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4 || letters !== letters.toUpperCase()) return t;
  return t
    .split(/\s+/)
    .map((w, n) => {
      const core = w.replace(/[^A-Za-z]/g, '');
      if (core.length <= 3 && !SMALL_WORDS.has(core.toLowerCase())) return w;
      const lw = w.toLowerCase();
      return n > 0 && SMALL_WORDS.has(lw) ? lw : lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(' ');
}
const trimEdges = (t) => t.replace(/^[\s\-–—:,;|•·]+|[\s\-–—:,;|•·]+$/g, '').trim();
// A typical letter height: a bit below the middle, so a few big title lines don't pull it up.
function medianOf(a) {
  const x = a.filter((v) => v > 0).sort((p, q) => p - q);
  return x.length ? x[Math.floor(x.length * 0.35)] : 0;
}

// A short, capitalised line with a place word in it, like "Riverside Park Amphitheater".
function looksLikeName(t) {
  const words = t.split(/\s+/).filter(Boolean);
  if (!PLACE_WORDS.test(t) || /\d|[,.!?]/.test(t) || words.length > 6) return false;
  return words.filter((w) => /^[A-Z]/.test(w)).length / words.length >= 0.6;
}

// Looks for a place name right before the address, like "Taqueria El Sol, 77 Oak Ave".
function nameBefore(text) {
  let before = text.replace(/[\s,;:|@•·\-–—]+$/, '').replace(/\b(at|in|on)$/i, '').replace(/[\s,;:|@•·\-–—]+$/, '');
  const tokens = before.split(/\s+/).filter(Boolean);
  const picked = [];
  for (let k = tokens.length - 1; k >= 0 && picked.length < 6; k--) {
    const tk = tokens[k];
    const bare = tk.replace(/[,;:]+$/, '');
    if (/[.!?]$/.test(tk) && picked.length) break; // that word ends the sentence before
    if (/^[A-Z0-9&][\w'’&.-]*$/.test(bare)) picked.unshift(bare);
    else if (/^(of|the|and|de|del|la|le|el|di|&)$/i.test(bare) && picked.length) picked.unshift(bare);
    else break;
    if (/[,;:]$/.test(tk) && picked.length > 1) break;
  }
  while (picked.length && /^(of|the|and|de|del|la|le|el|di|&)$/i.test(picked[0])) picked.shift();
  const name = picked.join(' ');
  return picked.length >= 2 || PLACE_WORDS.test(name) ? name : '';
}

// Turns pasted text, or the lines read from a screenshot, into a first guess for the form fields.
// You always review it before saving. `ocrLines` is optional: [{ text, h }] where h is how tall the
// letters are (a bigger line is more likely to be the name).
function parseImport(text, ocrLines) {
  const out = { title: '', address: '', cost: null, duration: null, seasons: [], tags: [], description: '' };
  const entries = [];
  String(text || '').replace(/\r/g, '').split('\n').forEach((l) => { if (l.trim()) entries.push({ raw: l.trim(), h: null }); });
  (ocrLines || []).forEach((l) => { const t = String((l && l.text) || '').trim(); if (t) entries.push({ raw: t, h: Number(l.h) || null }); });
  const raw = entries.map((e) => e.raw).join('\n');
  const low = raw.toLowerCase();

  out.tags = [...new Set((raw.match(/#[a-z0-9_]{2,30}/gi) || []).map((t) => t.slice(1).toLowerCase()))].slice(0, 5);

  if (/\bfree\b(?!\s+(parking|wifi|wi-fi|shipping|delivery|samples?|refills?))/.test(low)) out.cost = 0;
  const m = raw.match(/\$\s?(\d{1,4}(?:\.\d{1,2})?)/);
  if (m) out.cost = Number(m[1]);

  const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const hw = low.match(/\b(one|two|three|four|five|six)\s*(?:hours?|hrs?)\b/);
  const h = hw ? [0, NUMW[hw[1]]] : low.match(/(\d{1,2}(?:\.\d)?)(?:\s*(?:-|–|to)\s*\d{1,2}(?:\.\d)?)?\s*(?:hours?|hrs?)\b/);
  if (h) out.duration = Number(h[1]);
  else {
    const mins = low.match(/\b(\d{2,3})\s*(?:minutes?|mins?)\b/);
    if (mins) out.duration = Math.round((Number(mins[1]) / 60) * 2) / 2 || null;
  }

  if (/\bspring\b/.test(low)) out.seasons.push('Spring');
  if (/\bsummer\b/.test(low)) out.seasons.push('Summer');
  if (/\b(fall|autumn)\b/.test(low)) out.seasons.push('Fall');
  if (/\bwinter\b/.test(low)) out.seasons.push('Winter');
  out.seasons = out.seasons.filter((s) => (typeof SEASONS !== 'undefined' ? SEASONS.includes(s) : true));

  // Sort every line into what it is, then keep the ones that can be part of the idea.
  const kept = [];
  let cityLine = '';
  let pinText = '';
  entries.forEach((e) => {
    if (/^📍/.test(e.raw)) pinText = pinText || e.raw.replace(/^📍\s*/, '');
    const labeled = e.raw.match(/^(?:address|location|where|venue|find us)\s*[:\-–]\s*(.+)$/i);
    if (labeled) pinText = pinText || labeled[1];
    const stripped = stripHandle(e.raw.replace(/^📍\s*/, ''));
    const role = lineRole(stripped);
    if (role === 'chrome') return;
    if (role === 'place') { cityLine = cityLine || stripped; return; }
    const clean = tidyLine(stripped.replace(/#[\w]+/g, ' ').replace(/https?:\/\/\S+/gi, ' '));
    if (!clean || /^(https?:|www\.)/i.test(clean)) return;
    if (role === 'none' && !isReadable(clean) && !ADDRESS_RE.test(clean)) return;
    kept.push({ text: clean, h: e.h, role });
  });
  const median = medianOf(kept.filter((k) => k.role === 'none').map((k) => k.h));

  // Address: first look for a street address (it can run over two lines), then a labelled or pinned line.
  const flat = [];
  let flatText = '';
  kept.forEach((k, idx) => {
    if (k.role === 'meta') return; // opening hours, phone and web lines can't be part of the address
    if (flatText) flatText += ' ';
    flat.push({ start: flatText.length, end: flatText.length + k.text.length, idx });
    flatText += k.text;
  });
  let addrMatch = ADDRESS_RE.exec(flatText);
  let addrEntry = -1;
  let nameInText = '';
  if (addrMatch) {
    out.address = addrMatch[0].replace(/[\s,.;]+$/, '').slice(0, 100);
    const where = flat.find((f) => addrMatch.index >= f.start && addrMatch.index <= f.end);
    if (where) {
      addrEntry = where.idx;
      nameInText = nameBefore(flatText.slice(where.start, addrMatch.index));
    }
  } else if (pinText) {
    const t = tidyLine(pinText).replace(/[\s,.;]+$/, '');
    if (t.length >= 3 && /[A-Za-z]{3}/.test(t)) out.address = t.slice(0, 100);
  }
  if (!out.address && cityLine) out.address = cityLine.slice(0, 100);
  // A location tag like "Lakeside Bowl, Austin, Texas": the part before the city is the place name.
  if (!nameInText && cityLine && cityLine.split(',').length >= 3 && looksLikeName(cityLine.split(',')[0])) nameInText = cityLine.split(',')[0].trim();

  // Name: score each line. Big letters, a name-like look, and place words score high.
  const cands = [];
  kept.forEach((k, idx) => {
    if (k.role !== 'none' || idx === addrEntry && !nameInText && ADDRESS_RE.test(k.text) && k.text.replace(ADDRESS_RE, '').trim().length < 3) return;
    let t = k.text;
    if (idx === addrEntry && addrMatch) t = t.replace(ADDRESS_RE, ' ').replace(nameInText, ' ');
    const seg = t.split(/\s+[-–—|]\s+/)[0]; // "Blue Door Cafe - the coziest spot" -> "Blue Door Cafe"
    t = trimEdges(seg.length >= 3 ? seg : t);
    if (t.length < 3 || !/[A-Za-z]{2}/.test(t)) return;
    cands.push({ text: t, h: k.h, idx });
  });
  // Two big lines in a row with letters of the same size are one name ("SUNSET JAZZ" + "NIGHT").
  for (let i = 0; i + 1 < cands.length; i++) {
    const a = cands[i];
    const b = cands[i + 1];
    if (a.h && b.h && median && b.idx === a.idx + 1 && a.h >= median * 1.3 && b.h >= median * 1.3 && Math.abs(a.h - b.h) <= Math.max(a.h, b.h) * 0.12 && a.text.split(/\s+/).length <= 4 && b.text.split(/\s+/).length <= 4) {
      a.text += ' ' + b.text;
      cands.splice(i + 1, 1);
    }
  }
  const scoreOf = (c, order) => {
    const words = c.text.split(/\s+/).filter(Boolean);
    const n = words.length;
    const letters = c.text.replace(/[^A-Za-z]/g, '');
    const caps = letters.length >= 4 && letters === letters.toUpperCase();
    const upper = words.filter((w) => /^[A-Z]/.test(w)).length;
    let s = n <= 6 ? 1.5 : n > 9 ? -3 : -1;
    if (caps || upper / n >= 0.6) s += 2;
    if (/^[a-z]/.test(c.text)) s -= 1.5;
    if (/[.!?]$/.test(c.text) || (n > 6 && /,\s/.test(c.text))) s -= 2;
    if (PLACE_WORDS.test(c.text)) s += 2.5;
    if (/\d/.test(c.text)) s -= 1.5;
    if (c.h && median) s += Math.max(-1, Math.min(7, (c.h / median - 1) * 5));
    return s + Math.max(0, 1.2 - order * 0.3);
  };
  let best = null;
  cands.forEach((c, order) => { c.score = scoreOf(c, order); if (!best || c.score > best.score) best = c; });
  if (nameInText) {
    const nameCand = { text: nameInText, score: scoreOf({ text: nameInText, h: null }, 0) + 6 };
    if (!best || nameCand.score >= best.score) best = nameCand;
  }
  let venue = '';
  if (best) {
    out.title = fixShouting(best.text).slice(0, 80);
    // A place name that is not the title (like a venue on a poster) goes in front of the address.
    if (nameInText && best.text !== nameInText) venue = nameInText;
    const before = cands.find((c) => c.idx === addrEntry - 1);
    if (!venue && before && before !== best && out.address && addrMatch && looksLikeName(before.text)) venue = before.text;
  }
  if (venue && out.address && !out.address.toLowerCase().includes(venue.toLowerCase())) out.address = `${fixShouting(venue)}, ${out.address}`.slice(0, 100);

  // Description: what is left of the caption, without the name, the address and the extras.
  let desc = kept.filter((k) => k.role === 'none' || k.role === 'when').map((k) => k.text).join(' ');
  [best && best.text, venue, addrMatch && addrMatch[0]].forEach((piece) => {
    if (piece) desc = desc.replace(piece, ' ');
  });
  desc = desc.replace(/\s+([,.;!?])/g, '$1').replace(/([.!?])\s*[.,;]\s*/g, '$1 ').replace(/^[\s,.;\-–—:]+/, '').replace(/\s+/g, ' ').trim();
  out.description = desc.slice(0, 400);
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
  let ocrLines = []; // lines read from the picture: { text, h } (h = how tall the letters are)
  let files = [];
  let worker = null;
  let reading = false;

  // Throws away everything temporary: the picture, the text read from it, the pasted notes.
  const discard = async () => {
    notes = '';
    ocrLines = [];
    files = [];
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

       <div class="field"><label>Or read screenshots (add as many as you need)</label>
         <input type="file" id="imp-file" accept="image/*" multiple>
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

        files = [...$('#imp-file').files];
        if (!notes.trim() && !files.length && !link) return (err.textContent = 'Paste a caption, add a screenshot, or paste a link.');

        reading = true;
        const old = b.textContent;
        b.disabled = true;
        try {
          if (files.length) {
            b.textContent = 'Reading screenshot…';
            const status = $('#imp-status');
            status.textContent = '';
            try {
              await loadOcr();
              worker = await window.Tesseract.createWorker('eng');
              ocrLines = [];
              for (let n = 0; n < files.length; n++) {
                b.textContent = files.length > 1 ? `Reading screenshot ${n + 1} of ${files.length}…` : 'Reading screenshot…';
                const res = await worker.recognize(files[n]);
                const d = (res && res.data) || {};
                // Collect the lines with their letter height. Skip only the ones the reader is really unsure about.
                let ls = [];
                if (Array.isArray(d.blocks)) d.blocks.forEach((bl) => (bl.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => ls.push(l))));
                if (!ls.length && Array.isArray(d.lines)) ls = d.lines;
                if (ls.length) {
                  ls.forEach((l) => {
                    if ((l.confidence == null ? 100 : l.confidence) < 45) return;
                    const bb = l.bbox || {};
                    ocrLines.push({ text: l.text || '', h: bb.y1 != null && bb.y0 != null ? bb.y1 - bb.y0 : null });
                  });
                } else (d.text || '').split('\n').forEach((t) => ocrLines.push({ text: t, h: null }));
              }
            } catch (e) {
              if (worker) { try { await worker.terminate(); } catch (x) { /* ignore */ } worker = null; }
              reading = false;
              b.disabled = false;
              b.textContent = old;
              status.textContent = 'Couldn’t read the screenshot. Check your internet and choose it again, or paste the text above and tap Fill in the form.';
              files = [];
              ocrLines = [];
              $('#imp-file').value = ''; // forget the picture so you can go on with typed notes
              return;
            }
          }
          const guess = parseImport(notes, ocrLines);
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
