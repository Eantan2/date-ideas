'use strict';

// More features, kept in one file: tag icons, settings, tour, bulk add, address lookup,
// share picture, pull-down refresh, and offline mode.
// (These use helpers from app.js like $, openSheet, toast. They run later, after app.js has loaded.)

// ---------- small saved choices on this phone ----------
function pref(k, d) {
  try { return localStorage.getItem(k) || d; } catch (e) { return d; }
}
function setPref(k, v) {
  try { localStorage.setItem(k, v); } catch (e) { /* just not remembered */ }
}
function applyPrefs() {
  const h = document.documentElement;
  h.dataset.size = pref('size', 'normal');
  h.dataset.font = pref('font', 'rounded');
}
applyPrefs();

// ---------- tag icons ----------
const TAG_ICONS = [
  [/coffee|cafe|café|tea|boba|latte/i, '☕'],
  [/cook|bake|baking|recipe|kitchen/i, '🍳'],
  [/food|dinner|lunch|brunch|breakfast|restaurant|eat|pizza|sushi|taco|bbq|ramen|burger|dessert|ice cream/i, '🍝'],
  [/drink|bar\b|wine|beer|cocktail|brewery|winery/i, '🍷'],
  [/beach|ocean|sea\b|swim|surf|lake|kayak|boat|pool/i, '🌊'],
  [/outdoor|hike|hiking|trail|park|nature|camp|picnic|garden|walk/i, '🌲'],
  [/movie|film|cinema|theat(er|re)|show|netflix/i, '🎬'],
  [/concert|music|live|band|karaoke|dance/i, '🎵'],
  [/museum|art\b|gallery|history|exhibit|craft|paint|pottery/i, '🎨'],
  [/game|arcade|bowling|board|trivia|escape/i, '🎮'],
  [/cozy|home|stay.?in|indoor|rainy|movie night|blanket/i, '🛋️'],
  [/sunset|sunrise|stargaz|stars|romantic|anniversary|date night/i, '🌅'],
  [/travel|trip|road|drive|weekend|getaway|hotel|flight/i, '🚗'],
  [/sport|bike|biking|run|gym|yoga|climb|ski|skate|tennis|golf/i, '🚴'],
  [/shop|market|farmers|thrift|mall/i, '🛍️'],
  [/winter|snow|christmas|holiday/i, '❄️'],
  [/summer|sun\b|sunny/i, '☀️'],
  [/fall|autumn|pumpkin|halloween/i, '🍂'],
  [/spring|flower|bloom/i, '🌸'],
  [/surprise|gift/i, '🎁'],
  [/free|cheap/i, '💸'],
];
function tagIcon(t) {
  for (const [re, ic] of TAG_ICONS) if (re.test(t)) return ic;
  return '';
}
function tagLabel(t) {
  const ic = tagIcon(t);
  return ic ? `${ic} ${t}` : '#' + t;
}
// The picture on a card that has no photo: the icon of its first tag that has one.
function ideaIcon(i) {
  for (const t of i.tags || []) {
    const ic = tagIcon(t);
    if (ic) return ic;
  }
  return '';
}

// ---------- settings ----------
function showSettings(keep) {
  const seg = (k, opts, cur) =>
    `<div class="seg">${opts.map(([v, l]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
  openSheet(
    `<div class="sheet-head"><button class="link" data-act="close">‹ Back</button><strong>Settings</strong><span></span></div>
     <div class="sheet-body">
       <div class="sec" style="margin-top:0">Look</div>
       ${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], themePref())}
       <div class="sec">Text size</div>
       ${seg('size', [['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']], pref('size', 'normal'))}
       <div class="sec">Font</div>
       ${seg('font', [['rounded', 'Rounded'], ['standard', 'Standard']], pref('font', 'rounded'))}
       <p class="hint">These choices are saved on this phone only.</p>
       <div class="sec">More</div>
       <button class="btn ghost" style="margin-top:0" data-act="anniv">👑 Our anniversary</button>
       <button class="btn ghost" data-act="tour">🧭 Replay the welcome tour</button>
     </div>`,
    {
      close: closeSheet,
      set: (b) => {
        const { k, v } = b.dataset;
        if (k === 'theme') {
          setPref('theme', v);
          applyTheme();
        } else {
          setPref(k, v);
          applyPrefs();
        }
        showSettings(true);
        renderList();
      },
      anniv: showAnniversary,
      tour: () => {
        closeSheet();
        startTour();
      },
    },
    keep
  );
}

// ---------- welcome tour ----------
function startTour() {
  const steps = [
    { pose: 'wave', title: 'Hi, I’m your date helper!', text: 'Want a quick look around? It takes 20 seconds.' },
    { pose: 'empty', title: 'Add ideas your way', text: 'Tap the + button. You can type an idea, import it from a screenshot, or paste a whole list at once.' },
    { pose: 'cheer', title: 'Can’t decide?', text: 'Tap 🎲 Pick one for us at the top, and I’ll choose a date for you.' },
    { pose: 'love', title: 'After your date', text: 'Open the idea and tap Mark as completed. Dark mode, text size and more are in Settings at the bottom.' },
  ];
  let n = 0;
  const old = $('.tour');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'tour';
  document.body.appendChild(el);
  const finish = () => {
    setPref('tour', '1');
    el.remove();
  };
  const draw = () => {
    const s = steps[n];
    const last = n === steps.length - 1;
    el.innerHTML = `<div class="tour-card">
      ${mascot(s.pose, 130)}
      <b>${esc(s.title)}</b><p>${esc(s.text)}</p>
      <div class="dots">${steps.map((_, k) => `<i class="${k === n ? 'on' : ''}"></i>`).join('')}</div>
      <button class="btn" data-t="next">${last ? 'Let’s go!' : 'Next'}</button>
      ${last ? '' : '<button class="link" data-t="skip">Skip</button>'}
    </div>`;
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    if (b.dataset.t === 'skip') return finish();
    if (n >= steps.length - 1) return finish();
    n++;
    draw();
  });
  draw();
}
function maybeTour() {
  if (!pref('tour', '')) startTour();
}

// ---------- add many ideas at once ----------
// One idea per line. Bullets, numbers and checkboxes are removed. "Title - details" splits into a title and a description.
function parseBulk(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = raw.trim().replace(/^(?:[-*•·▪◦–—]+|\d+[.)]|\[[ xX]?\]|[☐☑✓✔✅])\s*/u, '').trim();
    if (line.length < 2) continue;
    let title = line, description = '';
    const m = line.match(/^(.+?)(?:\s+[-–—]\s+|:\s+)(.+)$/);
    if (m) { title = m[1].trim(); description = m[2].trim(); }
    title = title.slice(0, 100);
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, description: description.slice(0, 400) });
  }
  return out.slice(0, 200);
}

function showBulk() {
  const existing = () => new Set(myIdeas().map((i) => i.title.trim().toLowerCase()));
  openSheet(
    `<div class="sheet-head"><button class="link" data-act="bulkcancel">Cancel</button><strong>Add many ideas</strong><span></span></div>
     <div class="sheet-body">
       <p class="hint" style="margin:0 0 12px">Paste your list from Notes, one idea per line. Bullets and numbers are removed. Add details after a dash, like “Pottery class - downtown”.</p>
       <div class="field"><textarea id="bulk-text" style="min-height:220px" placeholder="Sunset picnic&#10;Pottery class - downtown&#10;Board game cafe"></textarea></div>
       <div class="hint" id="bulk-count">Nothing yet.</div>
       <div class="error" id="bulk-error"></div>
       <button class="btn" data-act="bulkadd" id="bulk-go">Add them</button>
     </div>`,
    {
      bulkcancel: closeSheet,
      bulkadd: (b) =>
        busy(b, 'Adding…', async () => {
          const have = existing();
          const items = parseBulk($('#bulk-text').value).filter((x) => !have.has(x.title.toLowerCase()));
          const err = $('#bulk-error');
          err.textContent = '';
          if (!items.length) return (err.textContent = 'Nothing new to add.');
          const made = items.map((x, n) => normalize({ id: uid(), title: x.title, description: x.description, createdAt: Date.now() + n }));
          try {
            await saveRows('ideas', made);
          } catch (e) {
            return (err.textContent = errText('save', e) + ' Your list is still here.');
          }
          ideas.push(...made);
          renderList();
          closeSheet();
          toast(`Added ${made.length} idea${made.length === 1 ? '' : 's'}.`);
        }),
    }
  );
  $('#bulk-text').addEventListener('input', () => {
    const have = existing();
    const all = parseBulk($('#bulk-text').value);
    const fresh = all.filter((x) => !have.has(x.title.toLowerCase()));
    const dup = all.length - fresh.length;
    $('#bulk-count').textContent = all.length ? `${fresh.length} new idea${fresh.length === 1 ? '' : 's'}${dup ? `, ${dup} already in your list` : ''}.` : 'Nothing yet.';
  });
}

// ---------- address lookup (OpenStreetMap) ----------
// Only runs when you tap the button. It sends the words you typed to OpenStreetMap.
async function lookupPlaces(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('lookup failed');
  const list = await r.json();
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((p) => {
      const a = p.address || {};
      const street = [a.house_number, a.road].filter(Boolean).join(' ');
      const city = a.city || a.town || a.village || a.suburb || a.county || '';
      const name = p.name && p.name !== a.road && p.name !== street ? p.name : '';
      return [name, street, city, a.state].filter(Boolean).join(', ') || String(p.display_name || '').split(', ').slice(0, 4).join(', ');
    })
    .filter((l) => l && !seen.has(l) && seen.add(l));
}

async function runLookup(btn) {
  const box = $('#lookupBox');
  const q = ($('#f-address').value.trim() || $('#f-title').value.trim());
  if (q.length < 3) return (box.innerHTML = '<p class="hint">Type a place name in the title or address first.</p>');
  if (isOffline()) return (box.innerHTML = '<p class="hint">Looking up an address needs internet.</p>');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Looking…';
  box.innerHTML = '';
  try {
    const res = await lookupPlaces(q);
    box.innerHTML = res.length
      ? res.map((l) => `<button type="button" class="pickaddr" data-act="pickaddr" data-a="${esc(l)}">📍 ${esc(l)}</button>`).join('') + '<p class="hint">Tap one to use it. Check it’s the right place.</p>'
      : '<p class="hint">Couldn’t find that place. Try adding the city.</p>';
  } catch (e) {
    box.innerHTML = '<p class="hint">Couldn’t look that up right now. Try again later.</p>';
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// ---------- share an idea as a picture ----------
const CARD_COLORS = { c0: ['#C65D3B', '#ffffff'], c1: ['#F2B8A0', '#3A2A24'], c2: ['#EBB95A', '#3A2A24'], c3: ['#A9C9B1', '#3A2A24'], c4: ['#8C4A33', '#ffffff'] };

function wrapText(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function renderShareCard(i) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const [bg, ink] = CARD_COLORS[colorOf(i.id)] || CARD_COLORS.c0;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ink;
  ctx.textBaseline = 'top';
  const font = (px, w = 800) => `${w} ${px}px ui-rounded, -apple-system, "Segoe UI", Roboto, sans-serif`;

  ctx.font = font(34, 700);
  ctx.globalAlpha = 0.75;
  ctx.fillText('A DATE IDEA FOR US', 90, 110);
  ctx.globalAlpha = 1;

  let size = 118;
  let lines;
  do {
    ctx.font = font(size);
    lines = wrapText(ctx, i.title, W - 180);
    size -= 6;
  } while (lines.length > 4 && size > 56);
  let y = 190;
  for (const l of lines) { ctx.fillText(l, 90, y); y += size * 1.2 + 6; }

  y += 20;
  ctx.font = font(44, 600);
  if (i.address) {
    for (const l of wrapText(ctx, '📍 ' + i.address, W - 180).slice(0, 2)) { ctx.fillText(l, 90, y); y += 60; }
    y += 10;
  }
  const bits = [fmtCost(i.cost), fmtDur(i.duration), fmtDist(i.distance), ...i.seasons, ...i.tags.slice(0, 3).map(tagLabel)].filter(Boolean);
  let x = 90;
  ctx.font = font(38, 700);
  for (const b of bits) {
    const w = ctx.measureText(b).width + 56;
    if (x + w > W - 90) { x = 90; y += 90; }
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = ink === '#ffffff' ? '#ffffff' : '#ffffff';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, 70, 35) : ctx.rect(x, y, w, 70);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.fillText(b, x + 28, y + 14);
    x += w + 16;
  }

  // the heart
  try {
    const svg = mascot('love', 440, 'none').replace(/currentColor/g, ink);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
    });
    ctx.drawImage(img, W - 540, H - 560, 440, Math.round((440 * 150) / 140));
  } catch (e) { /* the card still works without the heart */ }
  ctx.fillStyle = ink;
  ctx.font = font(34, 700);
  ctx.globalAlpha = 0.7;
  ctx.fillText('Date Ideas 💕', 90, H - 110);
  ctx.globalAlpha = 1;
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('card'))), 'image/png'));
}

async function shareIdeaCard(i) {
  const blob = await renderShareCard(i);
  const name = (i.title || 'date-idea').replace(/[^\w -]+/g, '').trim().slice(0, 40) + '.png';
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: i.title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}

// ---------- pull down to refresh ----------
function initPull() {
  const el = document.createElement('div');
  el.id = 'pull';
  el.innerHTML = miniHeart();
  document.body.appendChild(el);
  let startY = null, dy = 0, busyNow = false;
  const canPull = () => window.scrollY <= 0 && $('#sheet').classList.contains('hidden') && !busyNow && user && loaded;
  const show = (d) => {
    const k = Math.min(d / 90, 1);
    el.style.opacity = String(Math.min(k * 1.2, 1));
    el.style.transform = `translate(-50%, ${Math.min(d * 0.55, 60)}px) scale(${0.5 + k * 0.7}) rotate(${k * 20 - 10}deg)`;
    el.classList.toggle('ready', d >= 80);
  };
  window.addEventListener('touchstart', (e) => {
    startY = canPull() && e.touches.length === 1 ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy > 0 && window.scrollY <= 0) show(dy);
    else { dy = 0; show(0); }
  }, { passive: true });
  window.addEventListener('touchend', async () => {
    if (startY == null) return;
    const go = dy >= 80;
    startY = null;
    if (!go) { el.style.opacity = '0'; return; }
    busyNow = true;
    el.classList.add('spin');
    el.style.transform = 'translate(-50%, 50px) scale(1.1)';
    el.style.opacity = '1';
    await refresh();
    await new Promise((r) => setTimeout(r, 250));
    el.classList.remove('spin', 'ready');
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, 0) scale(.5)';
    busyNow = false;
  }, { passive: true });
}

// ---------- offline mode ----------
// While offline the app shows your last saved copy and keeps your changes in a waiting list on this phone.
// When the internet is back they are sent. If both of you changed the same idea, the later save wins.
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const qKey = () => `date-ideas-queue-${user ? user.id : 'x'}`;
const cKey = () => `date-ideas-cache-${user ? user.id : 'x'}`;
function readQueue() {
  try { return JSON.parse(localStorage.getItem(qKey()) || '[]'); } catch (e) { return []; }
}
function writeQueue(q) {
  try { localStorage.setItem(qKey(), JSON.stringify(q)); } catch (e) { /* storage full */ }
}
function queueOp(op) {
  let q = readQueue();
  if (op.op === 'save') q = q.filter((x) => !(x.op === 'save' && x.table === op.table && x.obj.id === op.obj.id));
  if (op.op === 'del') q = q.filter((x) => !(x.table === op.table && ((x.obj && x.obj.id) === op.id || x.id === op.id)));
  q.push({ ...op, t: new Date().toISOString() });
  writeQueue(q);
  cacheNow();
  offlineBanner();
}
function cacheNow() {
  if (!user || !loaded) return;
  try {
    localStorage.setItem(cKey(), JSON.stringify({ user: { id: user.id, email: user.email }, ideas, recipes, feedback, featuresReady, t: Date.now() }));
  } catch (e) { /* too big or blocked: offline start just won't work */ }
}
let cacheTimer;
function cacheSoon() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(cacheNow, 400);
}
function readCache(uid) {
  try {
    const c = JSON.parse(localStorage.getItem(`date-ideas-cache-${uid}`) || 'null');
    return c && Array.isArray(c.ideas) ? c : null;
  } catch (e) { return null; }
}
function lastCachedUser() {
  try {
    const id = localStorage.getItem('date-ideas-last-user');
    const c = id && readCache(id);
    return c ? c.user : null;
  } catch (e) { return null; }
}
function useCache(c) {
  ideas = c.ideas.map(normalize);
  recipes = (c.recipes || []).map(normalizeRecipe);
  feedback = c.feedback || {};
  featuresReady = !!c.featuresReady;
  loaded = true;
  loadFailed = false;
  offlineMode = true;
}
let offlineMode = false;

// Sends the waiting changes. Returns how many are still waiting.
async function flushQueue() {
  if (!user || isOffline()) return readQueue().length;
  const q = readQueue();
  if (!q.length) return 0;
  const rest = [];
  let stop = false;
  for (const op of q) {
    if (stop) { rest.push(op); continue; }
    try {
      if (op.op === 'save') {
        const { id, ...data } = op.obj;
        const { error } = await sb.from(op.table).upsert({ id, data, updated_at: op.t });
        if (error) throw error;
      } else {
        const { error } = await sb.from(op.table).delete().eq('id', op.id);
        if (error) throw error;
      }
    } catch (e) {
      stop = true;
      rest.push(op);
    }
  }
  writeQueue(rest);
  return rest.length;
}

function offlineBanner() {
  const n = user ? readQueue().length : 0;
  if (isOffline()) setBanner(`You’re offline. Your changes are saved on this phone${n ? ` (${n} waiting)` : ''} and will sync when you’re back online.`);
  else if (n) setBanner(`${n} change${n === 1 ? '' : 's'} waiting to sync.`, syncNow);
}
async function syncNow() {
  const left = await flushQueue();
  if (left) return offlineBanner();
  offlineMode = false;
  await refresh();
}
function initOffline() {
  window.addEventListener('offline', offlineBanner);
  window.addEventListener('online', async () => {
    if (!user) return;
    setBanner('Back online. Syncing…');
    await syncNow();
  });
}
