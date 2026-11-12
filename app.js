'use strict';

// ---------- state ----------
const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
const BUCKET = 'photos';
const URL_TTL = 3600; // photo links last 1 hour, then we ask for fresh ones
const REACT = { up: '👍', meh: '😐', down: '👎' };
let sb = null; // Supabase client
let user = null;
let ideas = [];
let recipes = [];
let feedback = {}; // idea id -> list of feedback rows
let featuresReady = true; // false until supabase-update.sql has been run
let loaded = false;
let loadFailed = false;
let lastLoad = 0;
let urlMap = {}; // photo path -> temporary link
let view = 'ideas'; // 'ideas' or 'recipes'
let tab = 'todo';
let query = '';
let filters = { cost: '', duration: '', distance: '', season: '', tag: '', sort: '' };
let actions = {}; // button handlers for whichever panel is open

// ---------- small helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const fmtCost = (c) => (c == null ? '' : c === 0 ? 'Free' : '$' + (Number.isInteger(c) ? c : c.toFixed(2)));
const fmtDur = (h) => (h == null ? '' : h < 1 ? Math.round(h * 60) + ' min' : Math.round(h * 100) / 100 + ' hr');
const fmtDist = (m) => (m == null ? '' : Math.round(m * 10) / 10 + ' mi');
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtNum = (n) => String(Math.round(n * 100) / 100);
const photoUrl = (p) => (p && urlMap[p]) || '';
const niceName = (a) => {
  const n = String(a || '').split('@')[0];
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Partner';
};

function currentSeason() {
  const m = new Date().getMonth(); // 0 = Jan
  if (m >= 2 && m <= 4) return 'Spring';
  if (m >= 5 && m <= 7) return 'Summer';
  if (m >= 8 && m <= 10) return 'Fall';
  return 'Winter';
}

// ---------- surprises ----------
// A surprise idea is hidden from the other person until its reveal date (in this app).
// It's hidden by the app, not locked away: it's still stored in the shared database.
function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function hiddenSurprise(i) {
  return !!(i.surprise && i.surprise.by && user && i.surprise.by !== user.id && todayStr() < i.surprise.date);
}
function myIdeas() {
  return ideas.filter((i) => !hiddenSurprise(i));
}

function normalize(i) {
  return {
    title: '', image: '', address: '', cost: null, duration: null, distance: null,
    seasons: [], tags: [], description: '', notes: '', checklist: [],
    done: false, doneDate: null, donePhoto: '', createdAt: Date.now(), surprise: null,
    ...i,
  };
}
function normalizeRecipe(r) {
  return { title: '', servings: null, ingredients: '', instructions: '', notes: '', source: '', createdAt: Date.now(), ...r };
}

// Shrinks a photo so it uploads fast. Gives back a JPEG file.
function resizeImage(file, max = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process that photo.'))), 'image/jpeg', 0.8);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo.'));
    };
    img.src = url;
  });
}

// ---------- recipes: turn amounts into grams ----------
// Grams per US cup for common ingredients. These are estimates from common baking charts.
// [what to look for, grams per cup, words that mean it is something else]
const DENS = [
  [/brown sugar/, 213],
  [/(powdered|confectioners?'?s?|icing) sugar/, 120],
  [/sugar/, 200, /snap|coconut|substitute/],
  [/bread flour/, 127],
  [/whole.?wheat flour/, 113],
  [/flour/, 120, /almond|coconut|rice|corn|oat|chickpea|buckwheat|spelt|rye|potato|tapioca/],
  [/butter/, 227, /peanut|almond|nut|cocoa|butter ?milk|shea/],
  [/honey/, 340],
  [/water/, 237, /coconut|rose|orange/],
  [/milk/, 244, /condensed|evaporated|powder|butter ?milk/],
  [/(heavy|whipping|double) cream/, 238],
  [/\boil\b/, 218, /coconut|sesame|truffle|spray/],
  [/cocoa/, 85, /butter|nibs/],
  [/\boats\b/, 90, /steel/],
  [/\brice\b/, 185, /cooked|flour|vinegar|noodle|krispies|cereal/],
  [/chocolate chips?/, 170],
  [/\bsalt\b/, 288, /kosher|flaky|sea|pepper/], // table salt: 6 g per teaspoon
];
function density(name) {
  for (const [re, g, ex] of DENS) if (re.test(name) && !(ex && ex.test(name))) return g;
  return null;
}

const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
function parseNum(s) {
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)/)) && +m[3] > 0) return { n: +m[1] + +m[2] / +m[3], len: m[0].length };
  if ((m = s.match(/^(\d+)\s*([½¼¾⅓⅔⅛])/))) return { n: +m[1] + FRAC[m[2]], len: m[0].length };
  if ((m = s.match(/^(\d+)\/(\d+)/)) && +m[2] > 0) return { n: +m[1] / +m[2], len: m[0].length };
  if ((m = s.match(/^([½¼¾⅓⅔⅛])/))) return { n: FRAC[m[1]], len: 1 };
  if ((m = s.match(/^(\d+\.\d+|\d+|\.\d+)/))) return { n: parseFloat(m[1]), len: m[0].length };
  return null;
}
const UNITS = [
  [/^(fl\.?\s*oz|fluid ounces?)\b\.?/i, 'floz'],
  [/^(cups?)\b\.?/i, 'cup'],
  [/^(tablespoons?|tbsps?|tbs|tbl)\b\.?/i, 'tbsp'],
  [/^(teaspoons?|tsps?)\b\.?/i, 'tsp'],
  [/^(ounces?|oz)\b\.?/i, 'oz'],
  [/^(pounds?|lbs?)\b\.?/i, 'lb'],
  [/^(kilograms?|kg)\b\.?/i, 'kg'],
  [/^(grams?|g)\b\.?/i, 'g'],
  [/^(milliliters?|millilitres?|ml)\b\.?/i, 'ml'],
  [/^(liters?|litres?|l)\b\.?/i, 'l'],
  [/^(sticks?)\b\.?/i, 'stick'],
];
function parseIngredient(line) {
  const s = line.replace(/^[-•*]\s*/, '').trim();
  const num = parseNum(s);
  if (!num) return null;
  const restAll = s.slice(num.len).trim();
  if (/^[-–]\s*\d/.test(restAll)) return null; // ranges like "2-3 cups" are left alone
  let rest = restAll;
  let unit = null;
  for (const [re, key] of UNITS) {
    const m = rest.match(re);
    if (m) {
      unit = key;
      rest = rest.slice(m[0].length).trim();
      break;
    }
  }
  return { qty: num.n, unit, restAll, name: rest.replace(/^of\s+/i, '') };
}
function toGrams(qty, unit, name) {
  let g = null;
  if (unit === 'oz') g = qty * 28.3495;
  else if (unit === 'lb') g = qty * 453.592;
  else if (unit === 'g' || unit === 'kg') g = null; // already metric
  else if (unit) {
    const cups = { cup: 1, tbsp: 1 / 16, tsp: 1 / 48, floz: 1 / 8, ml: 1 / 236.588, l: 1000 / 236.588, stick: 0.5 }[unit];
    const d = density(name);
    if (d && cups) g = qty * cups * d;
  } else if (/^(large |medium |small )?eggs?\b/.test(name) && !/yolk|white/.test(name)) {
    g = qty * 50;
  }
  if (g == null || !isFinite(g)) return null;
  return g >= 10 ? Math.round(g) : Math.round(g * 10) / 10;
}
// Gives back the line to show (scaled if needed) and its estimated grams (or null).
function convertLine(line, scale = 1) {
  const p = parseIngredient(line);
  if (!p) return { text: line, grams: null };
  const qty = p.qty * scale;
  const text = scale === 1 ? line : `${fmtNum(qty)} ${p.restAll}`;
  return { text, grams: toGrams(qty, p.unit, p.name.toLowerCase()) };
}

// ---------- messages ----------
function errText(action, e) {
  const m = (e && e.message) || String(e || '');
  if (!navigator.onLine || /failed to fetch|network|load failed/i.test(m)) return `Could not ${action}. Check your internet and try again.`;
  if (/row-level security|permission denied/i.test(m)) return `Could not ${action}: this account isn't allowed. Try signing out and back in.`;
  if (/jwt|expired|not authenticated/i.test(m)) return `Could not ${action}: your sign-in expired. Sign out and back in.`;
  return `Could not ${action}: ${m}`;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), bad ? 7000 : 2500);
}

let bannerRetry = null;
function setBanner(msg, retry) {
  const b = $('#banner');
  bannerRetry = retry || null;
  if (!msg) {
    b.classList.add('hidden');
    b.innerHTML = '';
    return;
  }
  b.innerHTML = `<span>${esc(msg)}</span>${retry ? '<button data-retry>Try again</button>' : ''}`;
  b.classList.remove('hidden');
}
$('#banner').addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]') && bannerRetry) bannerRetry();
});

// Disables a button and shows a label while something is saving.
async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// ---------- online storage (Supabase) ----------
async function loadIdeas() {
  const { data, error } = await sb.from('ideas').select('id,data');
  if (error) throw error;
  const list = (data || []).map((r) => normalize({ ...r.data, id: r.id }));
  const paths = [...new Set(list.flatMap((i) => [i.image, i.donePhoto]).filter(Boolean))];
  if (paths.length) {
    const { data: signed, error: e2 } = await sb.storage.from(BUCKET).createSignedUrls(paths, URL_TTL);
    if (e2) throw e2;
    (signed || []).forEach((s) => {
      if (s.signedUrl) urlMap[s.path] = s.signedUrl;
    });
  }

  // Recipes and feedback come from tables added later. If they are missing, the rest still works.
  const [rc, fb] = await Promise.all([
    sb.from('recipes').select('id,data'),
    sb.from('feedback').select('idea_id,user_id,author,reaction,comment,updated_at'),
  ]);
  // Only a missing table means "setup not done". Any other error (no permission, server trouble,
  // no internet) is a real problem, so it goes to the normal error banner.
  const problems = [rc.error, fb.error].filter(Boolean);
  const realProblem = problems.find((e) => !isMissingTable(e));
  if (realProblem) throw realProblem;
  featuresReady = problems.length === 0;
  recipes = featuresReady ? (rc.data || []).map((r) => normalizeRecipe({ ...r.data, id: r.id })) : [];
  feedback = {};
  if (featuresReady) (fb.data || []).forEach((r) => (feedback[r.idea_id] = feedback[r.idea_id] || []).push(r));

  ideas = list;
  loaded = true;
  loadFailed = false;
  lastLoad = Date.now();
}

async function saveRow(table, obj) {
  const { id, ...rest } = obj;
  const { error } = await sb.from(table).upsert({ id, data: rest, updated_at: new Date().toISOString() });
  if (error) throw error;
}
const saveIdea = (i) => saveRow('ideas', i);
const saveRecipe = (r) => saveRow('recipes', r);

// True when the error means "this table doesn't exist yet" (supabase-update.sql not run).
function isMissingTable(e) {
  const m = (e && e.message) || '';
  return (e && (e.code === 'PGRST205' || e.code === '42P01')) || /could not find the table|relation .* does not exist/i.test(m);
}

// Saves my reaction and/or comment on an idea. Saves for the same idea wait in line, one at a time,
// and each one builds its row from the latest saved values. That way a comment save can never
// write an old reaction back over a newer one. `patch` is an object, or a function that gets my
// latest row and returns the object (used for the toggle-a-reaction click).
const feedbackQueue = {};
function saveFeedback(ideaId, patch) {
  const run = async () => {
    const mine = (feedback[ideaId] || []).find((r) => r.user_id === user.id) || { reaction: null, comment: '' };
    const change = typeof patch === 'function' ? patch(mine) : patch;
    const row = {
      idea_id: ideaId,
      user_id: user.id,
      author: user.email,
      reaction: mine.reaction,
      comment: mine.comment,
      ...change,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from('feedback').upsert(row, { onConflict: 'idea_id,user_id' });
    if (error) throw error;
    feedback[ideaId] = (feedback[ideaId] || []).filter((r) => r.user_id !== user.id).concat(row);
  };
  // A failed save must not block the ones behind it.
  const next = (feedbackQueue[ideaId] || Promise.resolve()).catch(() => {}).then(run);
  feedbackQueue[ideaId] = next;
  return next;
}

async function uploadPhoto(ideaId, blob) {
  const path = `${ideaId}/${uid()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw error;
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, URL_TTL);
  if (data && data.signedUrl) urlMap[path] = data.signedUrl;
  return path;
}

// Clean-up of old photos. If it fails, nothing visible breaks, so errors are ignored.
function removePhotos(paths) {
  const p = paths.filter(Boolean);
  if (p.length) sb.storage.from(BUCKET).remove(p).catch(() => {});
}

// Changes something and saves it. If saving fails, the change is undone.
async function update(obj, change, saver = saveIdea) {
  const snap = JSON.parse(JSON.stringify(obj));
  change();
  try {
    await saver(obj);
  } catch (e) {
    Object.keys(obj).forEach((k) => delete obj[k]);
    Object.assign(obj, snap);
    throw e;
  }
}

async function refresh() {
  const btn = $('#refreshBtn');
  btn.disabled = true;
  try {
    await loadIdeas();
    setBanner('');
    renderList();
    return true;
  } catch (e) {
    if (!loaded) loadFailed = true;
    setBanner(errText('load your ideas', e), refresh);
    renderList();
    return false;
  } finally {
    btn.disabled = false;
  }
}

// ---------- ideas saved only on this device (from the first version) ----------
function openLocal() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    const req = indexedDB.open('dateideas', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('ideas', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
async function localIdeas() {
  const l = await openLocal();
  if (!l) return [];
  return new Promise((resolve) => {
    const r = l.transaction('ideas').objectStore('ideas').getAll();
    r.onsuccess = () => {
      l.close();
      resolve(r.result || []);
    };
    r.onerror = () => {
      l.close();
      resolve([]);
    };
  });
}
async function deleteLocal(id) {
  const l = await openLocal();
  if (!l) return;
  await new Promise((resolve) => {
    const t = l.transaction('ideas', 'readwrite');
    t.objectStore('ideas').delete(id);
    t.oncomplete = resolve;
    t.onerror = resolve;
  });
  l.close();
}

async function checkLocal() {
  const local = await localIdeas();
  const el = $('#migrate');
  el._local = local;
  if (!local.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div>Found <b>${local.length}</b> idea${local.length === 1 ? '' : 's'} saved only on this device.</div>
    <button class="btn" data-up>Upload to our shared list</button>`;
  el.classList.remove('hidden');
}

// Adds an idea (from this device or a backup file). Photos given as data: links get uploaded.
async function importIdea(old) {
  if (ideas.some((x) => x.id === old.id)) return; // already online
  const item = normalize({ ...old });
  const made = [];
  try {
    for (const key of ['image', 'donePhoto']) {
      if (item[key] && String(item[key]).startsWith('data:')) {
        const blob = await (await fetch(item[key])).blob();
        const p = await uploadPhoto(item.id, blob);
        made.push(p);
        item[key] = p;
      }
    }
    await saveIdea(item);
  } catch (e) {
    removePhotos(made);
    throw e;
  }
}

$('#migrate').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-up]');
  if (!btn) return;
  const local = $('#migrate')._local || [];
  let ok = 0;
  let fail = 0;
  let lastErr = null;
  btn.disabled = true;
  for (let n = 0; n < local.length; n++) {
    btn.textContent = `Uploading ${n + 1} of ${local.length}…`;
    try {
      await importIdea(local[n]);
      await deleteLocal(local[n].id);
      ok++;
    } catch (err) {
      fail++;
      lastErr = err;
    }
  }
  await refresh();
  await checkLocal();
  toast(fail ? `${ok} uploaded, ${fail} failed. ${errText('upload', lastErr)}` : `Uploaded ${ok} idea${ok === 1 ? '' : 's'}.`, fail > 0);
});

// ---------- backup and restore ----------
async function urlToDataUrl(url) {
  if (!url) throw new Error('A photo could not be loaded. Tap refresh and try again.');
  const r = await fetch(url);
  if (!r.ok) throw new Error('A photo could not be downloaded.');
  const blob = await r.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function exportBackup() {
  const out = { app: 'date-ideas', version: 1, exportedAt: new Date().toISOString(), ideas: [], recipes, feedback: Object.values(feedback).flat() };
  for (const i of myIdeas()) {
    const c = JSON.parse(JSON.stringify(i));
    for (const key of ['image', 'donePhoto']) {
      if (c[key]) c[key] = await urlToDataUrl(photoUrl(c[key]));
    }
    out.ideas.push(c);
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const name = `date-ideas-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  // On an iPhone this opens the share sheet, where "Save to Files" works.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Date Ideas backup' });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function showBackup() {
  const say = (t, bad = false) => {
    const el = $('#backupMsg');
    el.textContent = t;
    el.style.color = bad ? '#c0392b' : 'var(--muted)';
  };
  openSheet(
    `<div class="sheet-head">
       <button class="link" data-act="close">‹ Back</button>
       <strong>Backup &amp; restore</strong>
       <span style="width:50px"></span>
     </div>
     <div class="sheet-body">
       <p class="hint" style="margin-top:0">Saves all your ideas (with photos) and recipes in one file. Keep it somewhere safe, like Files or your computer.</p>
       <button class="btn" data-act="export">Download backup</button>
       <div class="sec">Restore</div>
       <p class="hint" style="margin-top:0">Adds ideas, recipes and your own feedback from a backup file. Anything already here is left alone.</p>
       <div class="field"><input type="file" id="restoreFile" accept=".json,application/json"></div>
       <button class="btn ghost" data-act="restore">Restore from file</button>
       <p class="hint" id="backupMsg"></p>
     </div>`,
    {
      close: closeSheet,
      export: (b) =>
        busy(b, 'Preparing…', async () => {
          try {
            await exportBackup();
            say('Backup file created.');
          } catch (e) {
            say(errText('make the backup', e), true);
          }
        }),
      restore: (b) =>
        busy(b, 'Restoring…', async () => {
          const f = $('#restoreFile').files[0];
          if (!f) return say('Choose a backup file first.', true);
          let data;
          try {
            data = JSON.parse(await f.text());
          } catch (e) {
            return say("That file isn't a valid backup.", true);
          }
          if (!data || data.app !== 'date-ideas' || !Array.isArray(data.ideas)) return say("That file isn't a Date Ideas backup.", true);
          const backupRecipes = Array.isArray(data.recipes) ? data.recipes.filter(Boolean) : [];
          // The database lets each person change only their own feedback, so I can only
          // bring back my own. Other people's entries stay in the file but are not restored here.
          const backupFeedback = Array.isArray(data.feedback) ? data.feedback.filter(Boolean) : [];
          const myFeedback = backupFeedback.filter((r) => r.user_id === user.id);
          const othersFeedback = backupFeedback.length - myFeedback.length;
          let added = 0;
          let skipped = 0;
          let failed = 0;
          let lastErr = null;
          let needRecipes = 0; // not restored because supabase-update.sql has not been run
          let needFeedback = 0;
          for (const old of data.ideas) {
            if (ideas.some((x) => x.id === old.id)) {
              skipped++;
              continue;
            }
            try {
              await importIdea(old);
              added++;
            } catch (e) {
              failed++;
              lastErr = e;
            }
          }
          if (featuresReady) {
            for (const r of backupRecipes) {
              if (recipes.some((x) => x.id === r.id)) {
                skipped++;
                continue;
              }
              try {
                await saveRecipe(normalizeRecipe(r));
                added++;
              } catch (e) {
                failed++;
                lastErr = e;
              }
            }
          } else {
            needRecipes = backupRecipes.length;
          }
          // Reload first, so feedback is matched against the ideas and feedback that really exist now.
          const fresh = await refresh();
          if (myFeedback.length && !featuresReady) {
            needFeedback = myFeedback.length;
          } else if (myFeedback.length && !fresh) {
            failed += myFeedback.length;
            lastErr = lastErr || new Error('Could not reload your ideas.');
          } else {
            for (const r of myFeedback) {
              if (!ideas.some((x) => x.id === r.idea_id)) {
                failed++;
                lastErr = new Error("an idea that some feedback belongs to isn't here");
                continue;
              }
              if ((feedback[r.idea_id] || []).some((x) => x.user_id === user.id)) {
                skipped++;
                continue;
              }
              try {
                await saveFeedback(r.idea_id, { reaction: REACT[r.reaction] ? r.reaction : null, comment: typeof r.comment === 'string' ? r.comment : '' });
                added++;
              } catch (e) {
                failed++;
                lastErr = e;
              }
            }
            renderList();
          }

          const end = (s) => (/[.!?]$/.test(s) ? s : s + '.');
          const notes = [];
          if (othersFeedback) notes.push(`${othersFeedback} feedback ${othersFeedback === 1 ? 'entry' : 'entries'} from other people can't be restored here, because each person can only restore their own`);
          if (needRecipes || needFeedback) {
            const what = [];
            if (needRecipes) what.push(`${needRecipes} recipe${needRecipes === 1 ? '' : 's'}`);
            if (needFeedback) what.push(`${needFeedback} feedback ${needFeedback === 1 ? 'entry' : 'entries'}`);
            notes.push(`${what.join(' and ')} not restored, because recipes and feedback need one more setup step. Run supabase-update.sql in Supabase, then restore this file again`);
          }
          if (failed) notes.push(`${failed} failed. ${errText('restore', lastErr)}`);
          say([`Added ${added}, skipped ${skipped} already here`, ...notes].map(end).join(' '), failed > 0 || needRecipes > 0 || needFeedback > 0);
        }),
    }
  );
}

// ---------- list screen ----------
const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
const orBig = (v) => (v == null ? Infinity : v);
const SORTERS = {
  cost: (a, b) => cmp(orBig(a.cost), orBig(b.cost)),
  duration: (a, b) => cmp(orBig(a.duration), orBig(b.duration)),
  distance: (a, b) => cmp(orBig(a.distance), orBig(b.distance)),
  title: (a, b) => a.title.localeCompare(b.title),
};

function visibleIdeas() {
  const f = filters;
  const season = f.season === 'now' ? currentSeason() : f.season;
  return myIdeas()
    .filter((i) => {
      if (tab === 'todo' && i.done) return false;
      if (tab === 'done' && !i.done) return false;
      // Blank values always pass, so ideas never disappear just because a field is empty.
      if (f.cost !== '' && i.cost != null && i.cost > Number(f.cost)) return false;
      if (f.duration !== '' && i.duration != null && i.duration > Number(f.duration)) return false;
      if (f.distance !== '' && i.distance != null && i.distance > Number(f.distance)) return false;
      if (season && i.seasons.length && !i.seasons.includes(season)) return false;
      if (f.tag && !i.tags.includes(f.tag)) return false;
      if (query) {
        const hay = [i.title, i.address, i.description, i.notes, ...i.tags, ...i.checklist.map((c) => c.text)].join(' ').toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    })
    .sort(SORTERS[f.sort] || ((a, b) => (tab === 'done' ? (b.doneDate || 0) - (a.doneDate || 0) : b.createdAt - a.createdAt)));
}

function visibleRecipes() {
  return recipes
    .filter((r) => !query || [r.title, r.ingredients, r.instructions, r.notes].join(' ').toLowerCase().includes(query))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function giftChip(i) {
  if (!i.surprise) return '';
  const mineIt = user && i.surprise.by === user.id;
  if (todayStr() < i.surprise.date) return mineIt ? `<span class="chip gift">🎁 Surprise · reveals ${esc(fmtDate(new Date(i.surprise.date + 'T12:00:00').getTime()))}</span>` : '';
  return '<span class="chip gift">🎁 Surprise!</span>';
}

function chipsHtml(i) {
  const bits = [fmtCost(i.cost), fmtDur(i.duration), fmtDist(i.distance), ...i.seasons, ...i.tags.map((t) => '#' + t)].filter(Boolean);
  return bits.map((t) => `<span class="chip">${esc(t)}</span>`).join('');
}

function reactionChip(id) {
  const e = (feedback[id] || []).map((r) => REACT[r.reaction]).filter(Boolean);
  return e.length ? `<span class="chip">${e.join(' ')}</span>` : '';
}

// Gives each card one of five colours. It comes from the id, so a card keeps its colour.
function colorOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 'c' + (h % 5);
}

function emptyBox(pose, title, text) {
  return `<div class="empty">${mascot(pose, 120)}<b>${title}</b>${text}</div>`;
}

function cardHtml(i) {
  const u = photoUrl(i.image);
  const thumb = u ? `<img class="thumb" src="${esc(u)}" alt="">` : `<div class="thumb">${miniHeart()}</div>`;
  const done = i.done ? `<span class="chip ok">✓ Done ${esc(fmtDate(i.doneDate))}</span>` : '';
  return `<div class="card ${colorOf(i.id)} ${i.done ? 'done' : ''}" data-id="${esc(i.id)}">
    <div class="card-top">
      <div class="card-body">
        <div class="card-title">${esc(i.title)}</div>
        ${i.address ? `<div class="card-sub">${esc(i.address)}</div>` : ''}
      </div>
      ${thumb}
    </div>
    <div>${giftChip(i)}${done}${reactionChip(i.id)}${chipsHtml(i)}</div>
  </div>`;
}

function recipeCardHtml(r) {
  const n = r.ingredients.split('\n').filter((l) => l.trim()).length;
  return `<div class="card ${colorOf(r.id)}" data-rid="${esc(r.id)}">
    <div class="card-top">
      <div class="card-body"><div class="card-title">${esc(r.title)}</div></div>
      <div class="thumb">🍳</div>
    </div>
    <div>${r.servings ? `<span class="chip">Serves ${esc(fmtNum(r.servings))}</span>` : ''}<span class="chip">${n} ingredient${n === 1 ? '' : 's'}</span></div>
  </div>`;
}

const SETUP_HINT = `Recipes and feedback need one more setup step.<br>Run <b>supabase-update.sql</b> in Supabase.`;

let animateNext = true; // cards slide in after a tab, a view change, or the first load
let wasLoaded = false;
function renderList() {
  if (loaded && !wasLoaded) { wasLoaded = true; animateNext = true; }
  const isRecipes = view === 'recipes';
  $('#tabs').classList.toggle('hidden', isRecipes);
  $('#filterBtn').classList.toggle('hidden', isRecipes);
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $('#search').placeholder = isRecipes ? 'Search recipes…' : 'Search ideas…';

  let html;
  if (!loaded) {
    html = loadFailed ? emptyBox('oops', 'Oops', "Your ideas didn't load.") : emptyBox('loading', 'Loading…', 'Fetching your ideas');
  } else if (isRecipes) {
    const list = visibleRecipes();
    if (!featuresReady) html = emptyBox('oops', 'One more step', SETUP_HINT);
    else if (list.length) html = list.map(recipeCardHtml).join('');
    else if (recipes.length) html = emptyBox('empty', 'Nothing found', 'No recipes match your search.');
    else html = emptyBox('empty', 'No recipes yet', 'Tap the + button to add one.');
  } else {
    const list = visibleIdeas();
    const mine = myIdeas();
    const todo = mine.filter((x) => !x.done).length;
    const doneN = mine.filter((x) => x.done).length;
    const hour = new Date().getHours();
    let mood = 'wave', hello = mine.length ? 'Pick one and go!' : 'Let’s plan something fun.';
    if (hour >= 22 || hour < 5) { mood = 'sleepy'; hello = 'Late-night planning? Sweet dreams soon.'; }
    else if (doneN > 0 && doneN % 10 === 0) { mood = 'party'; hello = `${doneN} dates done together! 🎉`; }
    const welcome = `<div class="welcome">${mascot(mood, 84)}<div><b>${mine.length ? `${todo} date${todo === 1 ? '' : 's'} to try` : 'Hi, you two!'}</b><span>${hello}</span>${todo ? '<button class="pick" data-pick>🎲 Pick one for us</button>' : ''}</div></div>`;
    if (list.length) html = welcome + list.map(cardHtml).join('');
    else if (mine.length === 0) html = emptyBox('empty', 'No ideas yet', 'Tap the + button to add your first one.');
    else html = welcome + emptyBox('empty', 'Nothing matches here', 'Try another tab, search, or reset your filters.');
  }
  $('#list').innerHTML = html;
  $('#list').classList.toggle('enter', animateNext);
  animateNext = false;
  const n = Object.values(filters).filter((v) => v !== '').length;
  $('#filterBtn').textContent = n ? `Filter (${n})` : 'Filter';
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
}

// ---------- dark mode ----------
const THEME_NAMES = { auto: 'Auto', light: 'Light', dark: 'Dark' };
function themePref() {
  try { return localStorage.getItem('theme') || 'auto'; } catch (e) { return 'auto'; }
}
function applyTheme() {
  const t = themePref();
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = dark ? '#231815' : '#FBF1E8';
}
function cycleTheme() {
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[themePref()];
  try { localStorage.setItem('theme', next); } catch (e) { /* just not remembered */ }
  applyTheme();
  renderFoot();
}
applyTheme();

// The anniversary is saved on this device only (so set it on each phone).
function showAnniversary() {
  let cur = '';
  try { cur = localStorage.getItem('anniv') || ''; } catch (e) { /* none */ }
  openSheet(
    `<div class="sheet-head"><button class="link" data-act="close">Cancel</button><strong>Our anniversary</strong><button class="link strong" data-act="saveanniv">Save</button></div>
     <div class="sheet-body">
       <div style="text-align:center">${mascot('wave', 110, 'crown')}</div>
       <div class="field"><label>The day you got together</label><input type="date" id="anniv" value="${esc(cur)}"></div>
       <p class="hint">On this day each year, the heart wears a crown. It's saved on this phone only, so set it on both phones.</p>
       <button class="btn ghost" data-act="clearanniv">Clear it</button>
     </div>`,
    {
      close: closeSheet,
      saveanniv: () => {
        const v = $('#anniv').value;
        try { v ? localStorage.setItem('anniv', v) : localStorage.removeItem('anniv'); } catch (e) { /* not saved */ }
        closeSheet();
        renderList();
        toast(v ? 'Saved.' : 'Cleared.');
      },
      clearanniv: () => {
        try { localStorage.removeItem('anniv'); } catch (e) { /* none */ }
        closeSheet();
        renderList();
        toast('Cleared.');
      },
    }
  );
}

function renderFoot() {
  $('#foot').innerHTML = user
    ? `Signed in as ${esc(user.email)}<br><button class="link" data-look>Look: ${THEME_NAMES[themePref()]}</button> · <button class="link" data-anniv>Anniversary</button><br><button class="link" data-backup>Backup &amp; restore</button> · <button class="link" data-signout>Sign out</button>`
    : '';
}

// ---------- panel (full-screen sheet) ----------
// Changes every time the open panel changes. A slow save checks it when it finishes, so it
// never draws over a different screen (like an edit form) that you opened while it was saving.
let sheetToken = 0;
function openSheet(html, acts, keepScroll = false) {
  sheetToken++;
  const inner = $('#sheetInner');
  const prev = $('.sheet-body', inner);
  const top = keepScroll && prev ? prev.scrollTop : 0;
  inner.innerHTML = html;
  actions = acts || {};
  $('#sheet').classList.remove('hidden');
  document.body.classList.add('lock');
  const body = $('.sheet-body', inner);
  if (body) body.scrollTop = top;
}
function closeSheet() {
  sheetToken++;
  $('#sheet').classList.add('hidden');
  $('#sheetInner').innerHTML = '';
  document.body.classList.remove('lock');
  actions = {};
}
$('#sheet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) actions[b.dataset.act](b, e);
});

// ---------- idea detail screen ----------
// Shown when two different people both gave this idea a 👍.
function bothLoveHtml(id) {
  const ups = new Set((feedback[id] || []).filter((r) => r.reaction === 'up').map((r) => r.user_id));
  return ups.size >= 2 ? `<div class="love-banner">${mascot('love', 64)}<span>You both love this one!</span></div>` : '';
}

function feedbackHtml(i) {
  if (!featuresReady) return `<div class="sec">How we feel</div><p class="hint">${SETUP_HINT}</p>`;
  const rows = feedback[i.id] || [];
  const mine = rows.find((r) => r.user_id === user.id) || { reaction: null, comment: '' };
  const others = rows
    .filter((r) => r.user_id !== user.id && (r.reaction || r.comment))
    .map((r) => `<div class="fb"><b>${esc(niceName(r.author))}</b> ${REACT[r.reaction] || ''}${r.comment ? `<p class="pre">${esc(r.comment)}</p>` : ''}</div>`)
    .join('');
  return `<div class="sec">How we feel</div>
    <div id="bothLove">${bothLoveHtml(i.id)}</div>
    ${others}
    <div class="react">${['up', 'meh', 'down'].map((k) => `<button type="button" class="rbtn ${mine.reaction === k ? 'on' : ''}" data-act="react" data-r="${k}" aria-label="${k}">${REACT[k]}</button>`).join('')}</div>
    <div class="field" style="margin-top:10px"><textarea id="fbComment" placeholder="Add a comment (optional)">${esc(mine.comment)}</textarea></div>
    <button class="btn ghost" style="margin-top:0" data-act="savecomment">Save comment</button>`;
}

// Shows my reaction as selected, without redrawing the screen (so nothing typed is lost).
function syncReactions(id) {
  const mine = (feedback[id] || []).find((r) => r.user_id === user.id);
  $$('.rbtn', $('#sheetInner')).forEach((b) => b.classList.toggle('on', !!mine && mine.reaction === b.dataset.r));
  const bl = $('#bothLove');
  if (bl) bl.innerHTML = bothLoveHtml(id);
}

function showDetail(id) {
  const i = ideas.find((x) => x.id === id);
  if (!i || hiddenSurprise(i)) return closeSheet();

  const checklist = i.checklist.length
    ? `<div class="sec">Checklist</div>` +
      i.checklist
        .map((c, n) => `<label class="check ${c.done ? 'on' : ''}"><input type="checkbox" data-n="${n}" ${c.done ? 'checked' : ''}><span>${esc(c.text)}</span></label>`)
        .join('')
    : '';

  const doneImg = photoUrl(i.donePhoto);
  const finish = i.done
    ? `<div class="sec">Completed</div>
       <p class="pre">✓ Done on ${esc(fmtDate(i.doneDate))}</p>
       ${doneImg ? `<img class="hero" style="margin-top:10px" src="${esc(doneImg)}" alt="Our photo">` : ''}
       <div class="field" style="margin-top:10px"><label>${i.donePhoto ? 'Replace photo' : 'Add a photo (optional)'}</label>
         <input type="file" id="donePhoto" accept="image/*"></div>
       <button class="btn ghost" data-act="undo">Move back to To do</button>`
    : `<div class="sec">Did you do this one?</div>
       <div class="field"><label>Add a photo (optional)</label>
         <input type="file" id="donePhoto" accept="image/*"></div>
       <button class="btn" data-act="complete">✓ Mark as completed</button>`;

  const heroUrl = photoUrl(i.image);
  openSheet(
    `<div class="sheet-head">
       <button class="link" data-act="close">‹ Back</button>
       <button class="link strong" data-act="edit">Edit</button>
     </div>
     <div class="sheet-body">
       ${heroUrl ? `<img class="hero" src="${esc(heroUrl)}" alt="">` : ''}
       <h2 class="detail-title">${esc(i.title)}</h2>
       <div>${giftChip(i)}${chipsHtml(i)}</div>
       ${i.address ? `<div class="sec">Where</div><p class="pre">${esc(i.address)}</p>` : ''}
       ${i.description ? `<div class="sec">About</div><p class="pre">${esc(i.description)}</p>` : ''}
       ${i.notes ? `<div class="sec">Notes</div><p class="pre">${esc(i.notes)}</p>` : ''}
       ${safeUrl(i.sourceLink) ? `<div class="sec">Source link</div><p class="pre"><a href="${esc(safeUrl(i.sourceLink))}" target="_blank" rel="noopener noreferrer" style="word-break:break-all">${esc(i.sourceLink)}</a></p><p class="hint">${esc(LINK_WARNING)}</p>` : ''}
       ${checklist}
       ${feedbackHtml(i)}
       ${finish}
       <button class="btn danger" style="margin-top:28px" data-act="del">Delete idea</button>
     </div>`,
    {
      close: closeSheet,
      edit: () => showForm(id),
      react: async (b) => {
        const k = b.dataset.r;
        const token = sheetToken;
        try {
          // Only the reaction changes here. The comment has its own Save comment button.
          await saveFeedback(id, (mine) => ({ reaction: mine.reaction === k ? null : k }));
        } catch (e) {
          return toast(errText('save', e), true);
        }
        renderList();
        if (sheetToken === token) {
          syncReactions(id); // only if this same screen is still open
          const on = $(`.rbtn[data-r="${k}"].on`, $('#sheetInner'));
          if (on) { on.classList.remove('pop'); void on.offsetWidth; on.classList.add('pop'); }
        }
      },
      savecomment: (b) =>
        busy(b, 'Saving…', async () => {
          try {
            await saveFeedback(id, { comment: $('#fbComment').value.trim() });
          } catch (e) {
            return toast(errText('save', e), true);
          }
          toast('Saved.');
        }),
      complete: (b) =>
        busy(b, 'Saving…', async () => {
          const token = sheetToken;
          let path = null;
          try {
            const f = $('#donePhoto').files[0];
            if (f) path = await uploadPhoto(i.id, await resizeImage(f));
            const oldPhoto = i.donePhoto;
            await update(i, () => {
              i.done = true;
              i.doneDate = Date.now();
              if (path) i.donePhoto = path;
            });
            if (path && oldPhoto) removePhotos([oldPhoto]);
          } catch (e) {
            if (path) removePhotos([path]);
            return toast(errText('save', e), true);
          }
          renderList();
          celebrate();
          if (sheetToken === token) showDetail(id);
        }),
      undo: (b) =>
        busy(b, 'Saving…', async () => {
          const token = sheetToken;
          try {
            await update(i, () => {
              i.done = false;
            });
          } catch (e) {
            return toast(errText('save', e), true);
          }
          renderList();
          if (sheetToken === token) showDetail(id);
        }),
      del: async (b) => {
        if (!confirm('Delete this idea?')) return;
        try {
          await busy(b, 'Deleting…', async () => {
            const { error } = await sb.from('ideas').delete().eq('id', id);
            if (error) throw error;
          });
        } catch (e) {
          return toast(errText('delete', e), true);
        }
        removePhotos([i.image, i.donePhoto]);
        ideas = ideas.filter((x) => x.id !== id);
        delete feedback[id];
        renderList();
        closeSheet();
      },
    }
  );
  const detailToken = sheetToken; // identifies this screen, for the slow saves below

  // tick checklist items
  $$('.check input', $('#sheetInner')).forEach((cb) =>
    cb.addEventListener('change', async () => {
      const n = Number(cb.dataset.n);
      const want = cb.checked;
      try {
        await update(i, () => {
          i.checklist[n].done = want;
        });
        cb.closest('.check').classList.toggle('on', want);
      } catch (e) {
        cb.checked = !want;
        toast(errText('save', e), true);
      }
    })
  );

  // change the "we did it" photo for an idea that is already done
  if (i.done) {
    $('#donePhoto').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      let path = null;
      try {
        path = await uploadPhoto(i.id, await resizeImage(f));
        const old = i.donePhoto;
        await update(i, () => {
          i.donePhoto = path;
        });
        removePhotos([old]);
        if (sheetToken === detailToken) showDetail(id);
      } catch (err) {
        if (path) removePhotos([path]);
        toast(errText('save the photo', err), true);
      }
    });
  }
}

// ---------- add / edit idea screen ----------
function clRow(text = '', done = false) {
  return `<div class="cl-row" data-done="${done ? 1 : 0}">
    <input type="text" value="${esc(text)}" placeholder="e.g. Bring a blanket">
    <button type="button" class="x" data-act="rmrow" aria-label="Remove">✕</button>
  </div>`;
}

function showForm(id, prefill) {
  const idea = id ? ideas.find((x) => x.id === id) : null;
  const pf = !idea && prefill ? prefill : null; // first guess from an import, nothing is saved until Save
  const src = idea ? idea.sourceLink || '' : pf ? pf.sourceLink || '' : '';
  const pv = (k, d = '') => (pf && pf[k] != null ? pf[k] : d);
  let image = idea ? idea.image : ''; // saved photo path
  let newBlob = null; // a photo picked just now, not uploaded yet
  let previewUrl = null;
  const initSrc = photoUrl(image);
  const val = (v) => (v == null ? '' : v);

  openSheet(
    `<div class="sheet-head">
       <button class="link" data-act="cancel">Cancel</button>
       <strong>${idea ? 'Edit idea' : 'New idea'}</strong>
       <button class="link strong" data-act="save">Save</button>
     </div>
     <div class="sheet-body">
       ${idea ? '' : pf ? `<p class="hint" style="margin:0 0 12px">Filled in from your import. Check it and fix anything. Only what is below gets saved.</p>` : `<button type="button" class="btn ghost" style="margin:0 0 14px" data-act="import">✨ Import from a link, screenshot or notes</button>`}
       <div class="field"><label>Title *</label>
         <input type="text" id="f-title" value="${esc(idea ? idea.title : pv('title'))}" placeholder="Sunset picnic at the park"></div>

       <div class="field"><label>Photo</label>
         <img id="preview" class="hero ${initSrc ? '' : 'hidden'}" ${initSrc ? `src="${esc(initSrc)}"` : ''} alt="">
         <input type="file" id="photoInput" accept="image/*">
         <button type="button" class="link ${image ? '' : 'hidden'}" id="rmPhoto" data-act="rmphoto">Remove photo</button></div>

       <div class="field"><label>Location / address</label>
         <input type="text" id="f-address" value="${esc(idea ? idea.address : pv('address'))}" placeholder="123 Main St, or just a place name"></div>

       <div class="row3 field">
         <div><label style="font-size:14px;color:var(--muted)">Cost ($)</label>
           <input type="number" id="f-cost" inputmode="decimal" min="0" step="any" value="${val(idea ? idea.cost : pv('cost', null))}" placeholder="0"></div>
         <div><label style="font-size:14px;color:var(--muted)">Hours</label>
           <input type="number" id="f-duration" inputmode="decimal" min="0" step="any" value="${val(idea ? idea.duration : pv('duration', null))}" placeholder="2"></div>
         <div><label style="font-size:14px;color:var(--muted)">Miles away</label>
           <input type="number" id="f-distance" inputmode="decimal" min="0" step="any" value="${val(idea && idea.distance)}" placeholder="10"></div>
       </div>

       <div class="field seasons"><label>Best seasons (leave empty for any time)</label>
         ${SEASONS.map((s) => `<label><input type="checkbox" name="season" value="${s}" ${(idea ? idea.seasons : pv('seasons', [])).includes(s) ? 'checked' : ''}>${s}</label>`).join('')}
       </div>

       <div class="field"><label>Tags (separate with commas)</label>
         <input type="text" id="f-tags" value="${esc(idea ? idea.tags.join(', ') : pv('tags', []).join(', '))}" placeholder="rainy day, outdoors, cozy" autocapitalize="none"></div>

       <div class="field"><label>Description</label>
         <textarea id="f-description">${esc(idea ? idea.description : pv('description'))}</textarea></div>

       <div class="field"><label>Notes</label>
         <textarea id="f-notes">${esc(idea ? idea.notes : '')}</textarea></div>

       ${!idea || !idea.surprise || idea.surprise.by === (user && user.id) ? `<div class="surprise-box">
         <label style="display:flex;align-items:center;gap:10px;color:var(--text);font-size:16px;margin:0"><input type="checkbox" id="f-surprise" ${idea && idea.surprise ? 'checked' : ''}> <span><b>🎁 Make it a surprise</b><br><span class="hint" style="margin:0">Hidden from your partner in the app until the day you pick.</span></span></label>
         <div id="surpriseDate" class="${idea && idea.surprise ? '' : 'hidden'}" style="margin-top:10px"><label style="font-size:14px;color:var(--muted)">Reveal on</label>
           <input type="date" id="f-sdate" value="${esc(idea && idea.surprise ? idea.surprise.date : '')}" min="${todayStr()}"></div>
       </div>` : ''}

       <div class="field"><label>Checklist</label>
         <div id="clList">${(idea ? idea.checklist : []).map((c) => clRow(c.text, c.done)).join('')}</div>
         <button type="button" class="btn ghost" style="margin-top:0" data-act="addrow">+ Add item</button></div>

       ${src ? `<label class="keep"><input type="checkbox" id="f-keeplink" ${idea ? 'checked' : ''}> <span><b>Keep source link</b><br><span class="hint" style="margin:0;word-break:break-all">${esc(src)}<br>${esc(LINK_WARNING)}</span></span></label>` : ''}

       <div class="error" id="formError"></div>
     </div>`,
    {
      import: () => showImport(),
      cancel: () => {
        if (pf) Object.keys(pf).forEach((k) => delete pf[k]); // forget the import guess
        idea ? showDetail(id) : closeSheet();
      },
      rmphoto: () => {
        image = '';
        newBlob = null;
        $('#preview').classList.add('hidden');
        $('#preview').removeAttribute('src');
        $('#rmPhoto').classList.add('hidden');
        $('#photoInput').value = '';
      },
      addrow: () => {
        $('#clList').insertAdjacentHTML('beforeend', clRow());
        const inputs = $$('#clList input');
        inputs[inputs.length - 1].focus();
      },
      rmrow: (b) => b.closest('.cl-row').remove(),
      save: (b) =>
        busy(b, 'Saving…', async () => {
          const err = $('#formError');
          err.textContent = '';
          const title = $('#f-title').value.trim();
          const num = (sel) => {
            const v = $(sel).value.trim();
            if (v === '') return null;
            const n = Number(v);
            return Number.isNaN(n) || n < 0 ? undefined : n;
          };
          const cost = num('#f-cost');
          const duration = num('#f-duration');
          const distance = num('#f-distance');
          if (!title) return (err.textContent = 'Please add a title.');
          if (cost === undefined || duration === undefined || distance === undefined) return (err.textContent = 'Cost, hours and miles must be numbers (0 or more).');

          const data = {
            title,
            address: $('#f-address').value.trim(),
            cost,
            duration,
            distance,
            seasons: $$('input[name=season]:checked').map((c) => c.value),
            tags: [...new Set($('#f-tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))],
            description: $('#f-description').value.trim(),
            notes: $('#f-notes').value.trim(),
            checklist: $$('.cl-row')
              .map((r) => ({ text: $('input', r).value.trim(), done: r.dataset.done === '1' }))
              .filter((c) => c.text),
          };
          const sBox = $('#f-surprise');
          if (sBox) {
            const sd = $('#f-sdate').value;
            if (sBox.checked && !sd) return (err.textContent = 'Pick the day to reveal your surprise.');
            if (sBox.checked && !idea && sd < todayStr()) return (err.textContent = 'The reveal day should be today or later.');
            data.surprise = sBox.checked ? { by: idea && idea.surprise ? idea.surprise.by : user.id, date: sd } : null;
          }
          // The link is kept only if "Keep source link" is ticked.
          const keepBox = $('#f-keeplink');
          if (keepBox) data.sourceLink = keepBox.checked ? src : '';
          const item = idea || { id: uid(), createdAt: Date.now(), done: false, doneDate: null, donePhoto: '' };
          const oldImage = idea ? idea.image : '';
          const snap = JSON.parse(JSON.stringify(item));
          let uploaded = null;
          try {
            let imagePath = image;
            if (newBlob) {
              uploaded = await uploadPhoto(item.id, newBlob);
              imagePath = uploaded;
            }
            Object.assign(item, data, { image: imagePath });
            await saveIdea(item);
          } catch (e) {
            if (idea) {
              Object.keys(item).forEach((k) => delete item[k]);
              Object.assign(item, snap);
            }
            if (uploaded) removePhotos([uploaded]);
            return (err.textContent = errText('save', e) + ' Your changes are still here.');
          }
          if (oldImage && oldImage !== item.image) removePhotos([oldImage]);
          if (!idea) ideas.push(item);
          if (pf) Object.keys(pf).forEach((k) => delete pf[k]); // forget the import guess
          renderList();
          idea ? showDetail(item.id) : closeSheet();
        }),
    }
  );

  const sb0 = $('#f-surprise');
  if (sb0) sb0.addEventListener('change', () => $('#surpriseDate').classList.toggle('hidden', !sb0.checked));

  $('#photoInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      newBlob = await resizeImage(f);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(newBlob);
      $('#preview').src = previewUrl;
      $('#preview').classList.remove('hidden');
      $('#rmPhoto').classList.remove('hidden');
    } catch (err) {
      $('#formError').textContent = err.message;
    }
  });
}

// ---------- recipes ----------
function showRecipe(id, servings, keepScroll = false) {
  const r = recipes.find((x) => x.id === id);
  if (!r) return closeSheet();
  const base = r.servings || null;
  const want = servings || base;
  const scale = base && want ? want / base : 1;
  const lines = r.ingredients
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => convertLine(l, scale));

  openSheet(
    `<div class="sheet-head">
       <button class="link" data-act="close">‹ Back</button>
       <button class="link strong" data-act="edit">Edit</button>
     </div>
     <div class="sheet-body">
       <h2 class="detail-title">${esc(r.title)}</h2>
       ${base ? `<div class="field" style="margin-top:12px"><label>Servings</label><input type="number" id="rcServ" inputmode="decimal" min="1" step="any" value="${esc(fmtNum(want))}"></div>` : ''}
       <div class="sec">Ingredients</div>
       ${lines.map((x) => `<div class="ing"><span>${esc(x.text)}</span>${x.grams != null ? `<span class="chip">≈ ${x.grams} g</span>` : ''}</div>`).join('') || '<p class="hint">No ingredients yet.</p>'}
       <p class="hint">Grams are estimates for common ingredients (for example, a cup of all-purpose flour is about 120 g). Lines without a gram amount are left as written.</p>
       ${r.instructions ? `<div class="sec">Steps</div><p class="pre">${esc(r.instructions)}</p>` : ''}
       ${r.notes ? `<div class="sec">Notes</div><p class="pre">${esc(r.notes)}</p>` : ''}
       ${r.source ? `<div class="sec">Source</div><p class="pre">${esc(r.source)}</p>` : ''}
       <button class="btn danger" style="margin-top:28px" data-act="del">Delete recipe</button>
     </div>`,
    {
      close: closeSheet,
      edit: () => showRecipeForm(id),
      del: async (b) => {
        if (!confirm('Delete this recipe?')) return;
        try {
          await busy(b, 'Deleting…', async () => {
            const { error } = await sb.from('recipes').delete().eq('id', id);
            if (error) throw error;
          });
        } catch (e) {
          return toast(errText('delete', e), true);
        }
        recipes = recipes.filter((x) => x.id !== id);
        renderList();
        closeSheet();
      },
    },
    keepScroll
  );

  const serv = $('#rcServ');
  if (serv) {
    serv.addEventListener('change', () => {
      const v = Number(serv.value);
      if (v > 0) showRecipe(id, v, true);
    });
  }
}

function showRecipeForm(id) {
  const rec = id ? recipes.find((x) => x.id === id) : null;
  openSheet(
    `<div class="sheet-head">
       <button class="link" data-act="cancel">Cancel</button>
       <strong>${rec ? 'Edit recipe' : 'New recipe'}</strong>
       <button class="link strong" data-act="save">Save</button>
     </div>
     <div class="sheet-body">
       <div class="field"><label>Title *</label>
         <input type="text" id="r-title" value="${esc(rec ? rec.title : '')}" placeholder="Homemade pizza"></div>
       <div class="field"><label>Servings</label>
         <input type="number" id="r-serv" inputmode="decimal" min="1" step="any" value="${rec && rec.servings ? esc(rec.servings) : ''}" placeholder="2"></div>
       <div class="field"><label>Ingredients (one per line)</label>
         <textarea id="r-ing" style="min-height:150px" placeholder="2 cups all-purpose flour&#10;1 1/2 tsp salt&#10;3 large eggs">${esc(rec ? rec.ingredients : '')}</textarea>
         <p class="hint">Write the amount first, like "1/2 cup sugar". The app shows estimated grams where it can.</p></div>
       <div class="field"><label>Steps</label>
         <textarea id="r-steps" style="min-height:120px">${esc(rec ? rec.instructions : '')}</textarea></div>
       <div class="field"><label>Notes</label>
         <textarea id="r-notes">${esc(rec ? rec.notes : '')}</textarea></div>
       <div class="field"><label>Source (optional)</label>
         <input type="text" id="r-src" value="${esc(rec ? rec.source : '')}" placeholder="Website, video, or person" autocapitalize="none"></div>
       <div class="error" id="formError"></div>
     </div>`,
    {
      cancel: () => (rec ? showRecipe(id) : closeSheet()),
      save: (b) =>
        busy(b, 'Saving…', async () => {
          const err = $('#formError');
          err.textContent = '';
          const title = $('#r-title').value.trim();
          if (!title) return (err.textContent = 'Please add a title.');
          const sv = $('#r-serv').value.trim();
          const servings = sv === '' ? null : Number(sv);
          if (servings !== null && !(servings > 0)) return (err.textContent = 'Servings must be a number above 0.');
          const item = rec || { id: uid(), createdAt: Date.now() };
          const snap = JSON.parse(JSON.stringify(item));
          Object.assign(item, {
            title,
            servings,
            ingredients: $('#r-ing').value.trim(),
            instructions: $('#r-steps').value.trim(),
            notes: $('#r-notes').value.trim(),
            source: $('#r-src').value.trim(),
          });
          try {
            await saveRecipe(item);
          } catch (e) {
            if (rec) {
              Object.keys(item).forEach((k) => delete item[k]);
              Object.assign(item, snap);
            }
            return (err.textContent = errText('save', e) + ' Your changes are still here.');
          }
          if (!rec) recipes.push(item);
          renderList();
          showRecipe(item.id);
        }),
    }
  );
}

// ---------- filter screen ----------
function showFilters() {
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  const f = filters;
  const allTags = [...new Set(myIdeas().flatMap((i) => i.tags))].sort();
  const countText = () => `Show ${visibleIdeas().length} idea${visibleIdeas().length === 1 ? '' : 's'}`;

  openSheet(
    `<div class="sheet-head">
       <button class="link" data-act="reset">Reset</button>
       <strong>Filter</strong>
       <button class="link strong" data-act="close">Done</button>
     </div>
     <div class="sheet-body">
       <div id="filterForm">
         <div class="field"><label>Cost</label>
           <select data-key="cost">
             ${opt('', 'Any', f.cost)}${opt(0, 'Free', f.cost)}${opt(25, 'Up to $25', f.cost)}${opt(50, 'Up to $50', f.cost)}${opt(100, 'Up to $100', f.cost)}
           </select></div>
         <div class="field"><label>How long it takes</label>
           <select data-key="duration">
             ${opt('', 'Any', f.duration)}${opt(1, 'Up to 1 hour', f.duration)}${opt(2, 'Up to 2 hours', f.duration)}${opt(4, 'Up to 4 hours', f.duration)}${opt(8, 'Up to 8 hours', f.duration)}
           </select></div>
         <div class="field"><label>Distance from home</label>
           <select data-key="distance">
             ${opt('', 'Any', f.distance)}${opt(5, 'Within 5 miles', f.distance)}${opt(15, 'Within 15 miles', f.distance)}${opt(30, 'Within 30 miles', f.distance)}${opt(60, 'Within 60 miles', f.distance)}
           </select></div>
         <div class="field"><label>Season</label>
           <select data-key="season">
             ${opt('', 'Any', f.season)}${opt('now', `Right now (${currentSeason()})`, f.season)}${SEASONS.map((s) => opt(s, s, f.season)).join('')}
           </select></div>
         ${allTags.length ? `<div class="field"><label>Tag</label><select data-key="tag">${opt('', 'Any', f.tag)}${allTags.map((t) => opt(t, '#' + t, f.tag)).join('')}</select></div>` : ''}
         <div class="field"><label>Sort by</label>
           <select data-key="sort">
             ${opt('', 'Newest first', f.sort)}${opt('cost', 'Cheapest first', f.sort)}${opt('duration', 'Shortest first', f.sort)}${opt('distance', 'Closest first', f.sort)}${opt('title', 'Name A–Z', f.sort)}
           </select></div>
       </div>
       <p class="hint">Ideas with a blank value for something still show up. Distance uses the "Miles away" number you type in on each idea.</p>
       <button class="btn" data-act="close" id="showBtn">${countText()}</button>
     </div>`,
    {
      close: closeSheet,
      reset: () => {
        filters = { cost: '', duration: '', distance: '', season: '', tag: '', sort: '' };
        renderList();
        showFilters();
      },
    }
  );

  $('#filterForm').addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    filters[key] = e.target.value;
    renderList();
    $('#showBtn').textContent = countText();
  });
}

// ---------- "Pick one for us" ----------
let lastPick = null;
function pickPool() {
  // Looks at ideas still to do, using your Filter choices. Search words and tabs don't matter here.
  const saveTab = tab, saveQ = query;
  tab = 'todo';
  query = '';
  const pool = visibleIdeas();
  tab = saveTab;
  query = saveQ;
  return pool;
}
function showPick(again) {
  const pool = pickPool();
  const choices = pool.length > 1 ? pool.filter((i) => i.id !== lastPick) : pool;
  const i = choices[Math.floor(Math.random() * choices.length)];
  lastPick = i ? i.id : null;
  const u = i && photoUrl(i.image);
  openSheet(
    `<div class="sheet-head">
       <button class="link" data-act="close">Close</button>
       <strong>Pick one for us</strong>
       <span></span>
     </div>
     <div class="sheet-body">
       ${
         i
           ? `<div class="card ${colorOf(i.id)} pickcard" data-id="${esc(i.id)}">
                <div class="card-top"><div class="card-body">
                  <div class="card-title" style="font-size:28px">${esc(i.title)}</div>
                  ${i.address ? `<div class="card-sub">${esc(i.address)}</div>` : ''}</div>
                  ${u ? `<img class="thumb" src="${esc(u)}" alt="">` : `<div class="thumb">${miniHeart()}</div>`}</div>
                <div>${chipsHtml(i)}</div></div>
              <button class="btn" data-act="pickopen">Open this date</button>
              <button class="btn ghost" data-act="pickagain">🎲 Pick another</button>
              <p class="hint">${pool.length} idea${pool.length === 1 ? '' : 's'} to choose from${Object.values(filters).some((v) => v !== '') ? ' with your filters' : ''}.</p>`
           : `<div class="empty">${mascot('empty', 120)}<b>Nothing to pick</b>${myIdeas().some((x) => !x.done) ? 'Your filters hide every idea. Change or reset them.' : 'Add an idea first, or move one back to To do.'}</div>`
       }
     </div>`,
    {
      close: closeSheet,
      pickopen: () => showDetail(i.id),
      pickagain: () => showPick(true),
    }
  );
}
$('#list').addEventListener('click', (e) => {
  if (e.target.closest('[data-pick]')) {
    e.stopPropagation();
    showPick();
  }
}, true);

// A short "yay!" screen when a date is marked done. Tap it or wait to close it.
function celebrate() {
  const old = $('.celebrate');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.innerHTML = `${mascot('cheer', 160)}<b>Date done!</b><span>Another memory made 💕</span>`;
  document.body.appendChild(el);
  const stop = () => el.remove();
  el.addEventListener('click', stop);
  setTimeout(stop, 2200);
}

// ---------- sign in ----------
function showLogin(msg = '') {
  openSheet(
    `<div class="sheet-body">
       <div class="login-mascot">${mascot('wave', 130)}</div>
       <h1 style="margin-top:6px;text-align:center">Date Ideas</h1>
       <p class="hint" style="margin:6px 0 20px;text-align:center">Sign in to see your ideas on every device.</p>
       <form id="loginForm">
         <div class="field"><label>Email</label>
           <input type="email" id="l-email" autocomplete="username" autocapitalize="none" autocorrect="off" inputmode="email" required></div>
         <div class="field"><label>Password</label>
           <input type="password" id="l-pass" autocomplete="current-password" autocapitalize="none" autocorrect="off" required></div>
         <label style="display:flex;align-items:center;gap:8px;margin:-4px 0 14px;font-size:15px;color:var(--muted)"><input type="checkbox" id="l-show"> Show password</label>
         <div class="error" id="loginError">${esc(msg)}</div>
         <button class="btn" type="submit" id="loginBtn">Sign in</button>
       </form>
     </div>`,
    {}
  );
  $('#l-show').addEventListener('change', (e) => {
    $('#l-pass').type = e.target.checked ? 'text' : 'password';
  });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    const errEl = $('#loginError');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pass').value });
      if (error) throw error;
      user = data.user;
      closeSheet();
      await startApp();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign in';
      errEl.textContent = /invalid login/i.test(err.message || '') ? 'Wrong email or password.' : errText('sign in', err);
    }
  });
}

$('#foot').addEventListener('click', async (e) => {
  if (e.target.closest("[data-look]")) return cycleTheme();
  if (e.target.closest('[data-anniv]')) return showAnniversary();
  if (e.target.closest('[data-backup]')) return showBackup();
  if (!e.target.closest('[data-signout]')) return;
  try {
    await sb.auth.signOut();
  } catch (err) {
    /* the sign-in is cleared on this device either way */
  }
  user = null;
  ideas = [];
  recipes = [];
  feedback = {};
  loaded = false;
  loadFailed = false;
  urlMap = {};
  setBanner('');
  $('#migrate').classList.add('hidden');
  renderList();
  renderFoot();
  showLogin();
});

// ---------- wire up the main screen ----------
$('#addBtn').addEventListener('click', () => {
  if (!loaded) return toast('Your ideas are still loading.', true);
  if (view === 'recipes') {
    if (!featuresReady) return toast('Recipes need one more setup step: run supabase-update.sql in Supabase.', true);
    return showRecipeForm(null);
  }
  showForm(null);
});
$('#filterBtn').addEventListener('click', showFilters);
$('#refreshBtn').addEventListener('click', refresh);
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  tab = b.dataset.tab;
  animateNext = true;
  renderList();
});
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  view = b.dataset.view;
  animateNext = true;
  renderList();
  window.scrollTo(0, 0);
});
$('#search').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  renderList();
});
$('#list').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  if (card.dataset.rid) showRecipe(card.dataset.rid);
  else showDetail(card.dataset.id);
});
// Pick up changes from your other device whenever the app comes back to the front.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && user && loaded && $('#sheet').classList.contains('hidden') && Date.now() - lastLoad > 20000) refresh();
});

// ---------- start ----------
async function startApp() {
  renderList();
  renderFoot();
  try {
    const { data: ok, error } = await sb.rpc('is_member');
    if (error) throw error;
    if (!ok) {
      await sb.auth.signOut();
      user = null;
      renderFoot();
      return showLogin("This account hasn't been added to the app yet.");
    }
    await loadIdeas();
  } catch (e) {
    if (!loaded) loadFailed = true;
    renderList();
    return setBanner(errText('load your ideas', e), startApp);
  }
  setBanner('');
  renderList();
  checkLocal();
}

(async function init() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY || /YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_KEY)) {
    $('#list').innerHTML = emptyBox('oops', 'Setup needed', 'Open <b>config.js</b> and paste in your Supabase URL and key.');
    return;
  }
  if (!window.supabase) {
    $('#list').innerHTML = emptyBox('oops', "Couldn't load the sync code", 'Check your internet and reload.');
    return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  let session = null;
  try {
    const r = await sb.auth.getSession();
    session = r.data.session;
  } catch (e) {
    /* treated as signed out */
  }
  renderList();
  if (!session) return showLogin();
  user = session.user;
  await startApp();
})();
