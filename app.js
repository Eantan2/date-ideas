'use strict';

// ---------- state ----------
const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
const BUCKET = 'photos';
const URL_TTL = 3600; // photo links last 1 hour, then we ask for fresh ones
let sb = null; // Supabase client
let user = null;
let ideas = [];
let loaded = false;
let loadFailed = false;
let lastLoad = 0;
let urlMap = {}; // photo path -> temporary link
let tab = 'todo';
let filters = { cost: '', duration: '', distance: '', season: '' };
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
const photoUrl = (p) => (p && urlMap[p]) || '';

function currentSeason() {
  const m = new Date().getMonth(); // 0 = Jan
  if (m >= 2 && m <= 4) return 'Spring';
  if (m >= 5 && m <= 7) return 'Summer';
  if (m >= 8 && m <= 10) return 'Fall';
  return 'Winter';
}

function normalize(i) {
  return {
    title: '', image: '', address: '', cost: null, duration: null, distance: null,
    seasons: [], description: '', notes: '', checklist: [],
    done: false, doneDate: null, donePhoto: '', createdAt: Date.now(),
    ...i,
  };
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
  ideas = list;
  loaded = true;
  loadFailed = false;
  lastLoad = Date.now();
}

async function saveIdea(i) {
  const { id, ...rest } = i;
  const { error } = await sb.from('ideas').upsert({ id, data: rest, updated_at: new Date().toISOString() });
  if (error) throw error;
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

// Changes an idea and saves it. If saving fails, the change is undone.
async function update(i, change) {
  const snap = JSON.parse(JSON.stringify(i));
  change();
  try {
    await saveIdea(i);
  } catch (e) {
    Object.keys(i).forEach((k) => delete i[k]);
    Object.assign(i, snap);
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
  } catch (e) {
    if (!loaded) loadFailed = true;
    setBanner(errText('load your ideas', e), refresh);
    renderList();
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

async function uploadLocalIdea(old) {
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
      await uploadLocalIdea(local[n]);
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

// ---------- list screen ----------
function visibleIdeas() {
  const f = filters;
  const season = f.season === 'now' ? currentSeason() : f.season;
  return ideas
    .filter((i) => {
      if (tab === 'todo' && i.done) return false;
      if (tab === 'done' && !i.done) return false;
      // Blank values always pass, so ideas never disappear just because a field is empty.
      if (f.cost !== '' && i.cost != null && i.cost > Number(f.cost)) return false;
      if (f.duration !== '' && i.duration != null && i.duration > Number(f.duration)) return false;
      if (f.distance !== '' && i.distance != null && i.distance > Number(f.distance)) return false;
      if (season && i.seasons.length && !i.seasons.includes(season)) return false;
      return true;
    })
    .sort((a, b) => (tab === 'done' ? (b.doneDate || 0) - (a.doneDate || 0) : b.createdAt - a.createdAt));
}

function chipsHtml(i) {
  const bits = [fmtCost(i.cost), fmtDur(i.duration), fmtDist(i.distance), ...i.seasons].filter(Boolean);
  return bits.map((t) => `<span class="chip">${esc(t)}</span>`).join('');
}

function cardHtml(i) {
  const u = photoUrl(i.image);
  const thumb = u ? `<img class="thumb" src="${esc(u)}" alt="">` : `<div class="thumb">💕</div>`;
  const done = i.done ? `<span class="chip ok">✓ Done ${esc(fmtDate(i.doneDate))}</span>` : '';
  return `<div class="card ${i.done ? 'done' : ''}" data-id="${esc(i.id)}">
    ${thumb}
    <div class="card-body">
      <div class="card-title">${esc(i.title)}</div>
      ${i.address ? `<div class="card-sub">${esc(i.address)}</div>` : ''}
      ${done}${chipsHtml(i)}
    </div>
  </div>`;
}

function renderList() {
  let html;
  if (!loaded) {
    html = `<div class="empty">${loadFailed ? "Your ideas didn't load." : 'Loading…'}</div>`;
  } else {
    const list = visibleIdeas();
    if (list.length) {
      html = list.map(cardHtml).join('');
    } else if (ideas.length === 0) {
      html = `<div class="empty">No ideas yet.<br>Tap the + button to add your first one.</div>`;
    } else {
      html = `<div class="empty">Nothing matches here.<br>Try another tab or reset your filters.</div>`;
    }
  }
  $('#list').innerHTML = html;
  const n = Object.values(filters).filter((v) => v !== '').length;
  $('#filterBtn').textContent = n ? `Filter (${n})` : 'Filter';
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
}

function renderFoot() {
  $('#foot').innerHTML = user ? `Signed in as ${esc(user.email)} · <button class="link" data-signout>Sign out</button>` : '';
}

// ---------- panel (full-screen sheet) ----------
function openSheet(html, acts) {
  const inner = $('#sheetInner');
  inner.innerHTML = html;
  actions = acts || {};
  $('#sheet').classList.remove('hidden');
  document.body.classList.add('lock');
  const body = $('.sheet-body', inner);
  if (body) body.scrollTop = 0;
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#sheetInner').innerHTML = '';
  document.body.classList.remove('lock');
  actions = {};
}
$('#sheet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) actions[b.dataset.act](b, e);
});

// ---------- detail screen ----------
function showDetail(id) {
  const i = ideas.find((x) => x.id === id);
  if (!i) return closeSheet();

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
       <div>${chipsHtml(i)}</div>
       ${i.address ? `<div class="sec">Where</div><p class="pre">${esc(i.address)}</p>` : ''}
       ${i.description ? `<div class="sec">About</div><p class="pre">${esc(i.description)}</p>` : ''}
       ${i.notes ? `<div class="sec">Notes</div><p class="pre">${esc(i.notes)}</p>` : ''}
       ${checklist}
       ${finish}
       <button class="btn danger" style="margin-top:28px" data-act="del">Delete idea</button>
     </div>`,
    {
      close: closeSheet,
      edit: () => showForm(id),
      complete: (b) =>
        busy(b, 'Saving…', async () => {
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
          showDetail(id);
        }),
      undo: (b) =>
        busy(b, 'Saving…', async () => {
          try {
            await update(i, () => {
              i.done = false;
            });
          } catch (e) {
            return toast(errText('save', e), true);
          }
          renderList();
          showDetail(id);
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
        renderList();
        closeSheet();
      },
    }
  );

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
        showDetail(id);
      } catch (err) {
        if (path) removePhotos([path]);
        toast(errText('save the photo', err), true);
      }
    });
  }
}

// ---------- add / edit screen ----------
function clRow(text = '', done = false) {
  return `<div class="cl-row" data-done="${done ? 1 : 0}">
    <input type="text" value="${esc(text)}" placeholder="e.g. Bring a blanket">
    <button type="button" class="x" data-act="rmrow" aria-label="Remove">✕</button>
  </div>`;
}

function showForm(id) {
  const idea = id ? ideas.find((x) => x.id === id) : null;
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
       <div class="field"><label>Title *</label>
         <input type="text" id="f-title" value="${esc(idea ? idea.title : '')}" placeholder="Sunset picnic at the park"></div>

       <div class="field"><label>Photo</label>
         <img id="preview" class="hero ${initSrc ? '' : 'hidden'}" ${initSrc ? `src="${esc(initSrc)}"` : ''} alt="">
         <input type="file" id="photoInput" accept="image/*">
         <button type="button" class="link ${image ? '' : 'hidden'}" id="rmPhoto" data-act="rmphoto">Remove photo</button></div>

       <div class="field"><label>Location / address</label>
         <input type="text" id="f-address" value="${esc(idea ? idea.address : '')}" placeholder="123 Main St, or just a place name"></div>

       <div class="row3 field">
         <div><label style="font-size:14px;color:var(--muted)">Cost ($)</label>
           <input type="number" id="f-cost" inputmode="decimal" min="0" step="any" value="${val(idea && idea.cost)}" placeholder="0"></div>
         <div><label style="font-size:14px;color:var(--muted)">Hours</label>
           <input type="number" id="f-duration" inputmode="decimal" min="0" step="any" value="${val(idea && idea.duration)}" placeholder="2"></div>
         <div><label style="font-size:14px;color:var(--muted)">Miles away</label>
           <input type="number" id="f-distance" inputmode="decimal" min="0" step="any" value="${val(idea && idea.distance)}" placeholder="10"></div>
       </div>

       <div class="field seasons"><label>Best seasons (leave empty for any time)</label>
         ${SEASONS.map((s) => `<label><input type="checkbox" name="season" value="${s}" ${idea && idea.seasons.includes(s) ? 'checked' : ''}>${s}</label>`).join('')}
       </div>

       <div class="field"><label>Description</label>
         <textarea id="f-description">${esc(idea ? idea.description : '')}</textarea></div>

       <div class="field"><label>Notes</label>
         <textarea id="f-notes">${esc(idea ? idea.notes : '')}</textarea></div>

       <div class="field"><label>Checklist</label>
         <div id="clList">${(idea ? idea.checklist : []).map((c) => clRow(c.text, c.done)).join('')}</div>
         <button type="button" class="btn ghost" style="margin-top:0" data-act="addrow">+ Add item</button></div>

       <div class="error" id="formError"></div>
     </div>`,
    {
      cancel: () => (idea ? showDetail(id) : closeSheet()),
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
            description: $('#f-description').value.trim(),
            notes: $('#f-notes').value.trim(),
            checklist: $$('.cl-row')
              .map((r) => ({ text: $('input', r).value.trim(), done: r.dataset.done === '1' }))
              .filter((c) => c.text),
          };
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
          renderList();
          idea ? showDetail(item.id) : closeSheet();
        }),
    }
  );

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

// ---------- filter screen ----------
function showFilters() {
  const opt = (v, label, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  const f = filters;
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
       </div>
       <p class="hint">Ideas with a blank value for something still show up. Distance uses the "Miles away" number you type in on each idea.</p>
       <button class="btn" data-act="close" id="showBtn">${countText()}</button>
     </div>`,
    {
      close: closeSheet,
      reset: () => {
        filters = { cost: '', duration: '', distance: '', season: '' };
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

// ---------- sign in ----------
function showLogin(msg = '') {
  openSheet(
    `<div class="sheet-body">
       <h1 style="margin-top:60px">Date Ideas 💕</h1>
       <p class="hint" style="margin:6px 0 20px">Sign in to see your ideas on every device.</p>
       <form id="loginForm">
         <div class="field"><label>Email</label>
           <input type="email" id="l-email" autocomplete="username" autocapitalize="none" autocorrect="off" inputmode="email" required></div>
         <div class="field"><label>Password</label>
           <input type="password" id="l-pass" autocomplete="current-password" required></div>
         <div class="error" id="loginError">${esc(msg)}</div>
         <button class="btn" type="submit" id="loginBtn">Sign in</button>
       </form>
     </div>`,
    {}
  );
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
  if (!e.target.closest('[data-signout]')) return;
  try {
    await sb.auth.signOut();
  } catch (err) {
    /* the sign-in is cleared on this device either way */
  }
  user = null;
  ideas = [];
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
  showForm(null);
});
$('#filterBtn').addEventListener('click', showFilters);
$('#refreshBtn').addEventListener('click', refresh);
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  tab = b.dataset.tab;
  renderList();
});
$('#list').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) showDetail(card.dataset.id);
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
    $('#list').innerHTML = `<div class="empty">Setup needed.<br>Open <b>config.js</b> and paste in your Supabase URL and key.</div>`;
    return;
  }
  if (!window.supabase) {
    $('#list').innerHTML = `<div class="empty">Couldn't load the sync code.<br>Check your internet and reload.</div>`;
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
