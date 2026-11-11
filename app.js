'use strict';

// ---------- state ----------
const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
let db;
let ideas = [];
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

function currentSeason() {
  const m = new Date().getMonth(); // 0 = Jan
  if (m >= 2 && m <= 4) return 'Spring';
  if (m >= 5 && m <= 7) return 'Summer';
  if (m >= 8 && m <= 10) return 'Fall';
  return 'Winter';
}

// Shrinks a photo so it is small enough to store on the phone.
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
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo.'));
    };
    img.src = url;
  });
}

// ---------- storage (IndexedDB, lives on this device) ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dateideas', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('ideas', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function loadAll() {
  return new Promise((resolve, reject) => {
    const r = db.transaction('ideas').objectStore('ideas').getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function save(idea) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('ideas', 'readwrite');
    t.objectStore('ideas').put(idea);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
function remove(id) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('ideas', 'readwrite');
    t.objectStore('ideas').delete(id);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

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
  const thumb = i.image ? `<img class="thumb" src="${i.image}" alt="">` : `<div class="thumb">💕</div>`;
  const done = i.done ? `<span class="chip ok">✓ Done ${esc(fmtDate(i.doneDate))}</span>` : '';
  return `<div class="card ${i.done ? 'done' : ''}" data-id="${i.id}">
    ${thumb}
    <div class="card-body">
      <div class="card-title">${esc(i.title)}</div>
      ${i.address ? `<div class="card-sub">${esc(i.address)}</div>` : ''}
      ${done}${chipsHtml(i)}
    </div>
  </div>`;
}

function renderList() {
  const list = visibleIdeas();
  let html;
  if (list.length) {
    html = list.map(cardHtml).join('');
  } else if (ideas.length === 0) {
    html = `<div class="empty">No ideas yet.<br>Tap the + button to add your first one.</div>`;
  } else {
    html = `<div class="empty">Nothing matches here.<br>Try another tab or reset your filters.</div>`;
  }
  $('#list').innerHTML = html;
  const n = Object.values(filters).filter((v) => v !== '').length;
  $('#filterBtn').textContent = n ? `Filter (${n})` : 'Filter';
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
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

  const finish = i.done
    ? `<div class="sec">Completed</div>
       <p class="pre">✓ Done on ${esc(fmtDate(i.doneDate))}</p>
       ${i.donePhoto ? `<img class="hero" style="margin-top:10px" src="${i.donePhoto}" alt="Our photo">` : ''}
       <div class="field" style="margin-top:10px"><label>${i.donePhoto ? 'Replace photo' : 'Add a photo (optional)'}</label>
         <input type="file" id="donePhoto" accept="image/*"></div>
       <button class="btn ghost" data-act="undo">Move back to To do</button>`
    : `<div class="sec">Did you do this one?</div>
       <div class="field"><label>Add a photo (optional)</label>
         <input type="file" id="donePhoto" accept="image/*"></div>
       <button class="btn" data-act="complete">✓ Mark as completed</button>`;

  openSheet(
    `<div class="sheet-head">
       <button class="link" data-act="close">‹ Back</button>
       <button class="link strong" data-act="edit">Edit</button>
     </div>
     <div class="sheet-body">
       ${i.image ? `<img class="hero" src="${i.image}" alt="">` : ''}
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
      complete: async () => {
        try {
          const f = $('#donePhoto').files[0];
          const photo = f ? await resizeImage(f) : null;
          i.done = true;
          i.doneDate = Date.now();
          if (photo) i.donePhoto = photo;
          await save(i);
        } catch (err) {
          return alert('Could not save: ' + err.message);
        }
        renderList();
        showDetail(id);
      },
      undo: async () => {
        i.done = false;
        await save(i);
        renderList();
        showDetail(id);
      },
      del: async () => {
        if (!confirm('Delete this idea?')) return;
        await remove(id);
        ideas = ideas.filter((x) => x.id !== id);
        renderList();
        closeSheet();
      },
    }
  );

  // tick checklist items
  $$('.check input', $('#sheetInner')).forEach((cb) =>
    cb.addEventListener('change', async () => {
      i.checklist[Number(cb.dataset.n)].done = cb.checked;
      cb.closest('.check').classList.toggle('on', cb.checked);
      await save(i);
    })
  );

  // change the "we did it" photo for an idea that is already done
  if (i.done) {
    $('#donePhoto').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        i.donePhoto = await resizeImage(f);
        await save(i);
        showDetail(id);
      } catch (err) {
        alert('Could not save: ' + err.message);
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
  let image = idea ? idea.image : '';
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
         <img id="preview" class="hero ${image ? '' : 'hidden'}" ${image ? `src="${image}"` : ''} alt="">
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
      save: async () => {
        const err = $('#formError');
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
          image,
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
        Object.assign(item, data);
        try {
          await save(item);
        } catch (e) {
          return (err.textContent = 'Could not save: ' + e.message);
        }
        if (!idea) ideas.push(item);
        renderList();
        idea ? showDetail(item.id) : closeSheet();
      },
    }
  );

  $('#photoInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      image = await resizeImage(f);
      $('#preview').src = image;
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

// ---------- wire up the main screen ----------
$('#addBtn').addEventListener('click', () => showForm(null));
$('#filterBtn').addEventListener('click', showFilters);
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

// ---------- start ----------
(async function init() {
  try {
    db = await openDB();
    ideas = await loadAll();
    ideas.forEach((i) => {
      i.seasons = i.seasons || [];
      i.checklist = i.checklist || [];
    });
  } catch (e) {
    $('#list').innerHTML = `<div class="empty">Sorry, this browser can't save data here.<br>(${esc(e.message || e)})</div>`;
    return;
  }
  renderList();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
