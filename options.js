// options page script for OpenWhen (concise)
const SCHEDULES_KEY = 'schedules';
const $ = sel => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
async function getSchedules(){ return new Promise(resolve => chrome.storage.local.get([SCHEDULES_KEY], res => resolve(res[SCHEDULES_KEY] || []))); }
async function setSchedules(schedules){ return new Promise(resolve => { const o={}; o[SCHEDULES_KEY]=schedules; chrome.storage.local.set(o, resolve); }); }

let currentEditingId = null;
let formEl = null;
let submitBtnEl = null;
let cancelBtnEl = null;
let updateModeFn = null;

function setFormMode(mode){
  const isEdit = mode === 'edit';
  if(submitBtnEl){ submitBtnEl.textContent = isEdit ? 'edit schedule' : 'add schedule'; }
  if(cancelBtnEl){ cancelBtnEl.hidden = !isEdit; }
  if(formEl){
    if(isEdit){ formEl.dataset.mode = 'edit'; }
    else { formEl.dataset.mode = 'add'; }
  }
}

function resetFormFields(){
  if(!formEl) return;
  formEl.reset();
  if(typeof updateModeFn === 'function'){
    try{ updateModeFn(); }catch(e){}
  }
}

function enterEditMode(scheduleId){
  currentEditingId = scheduleId != null ? String(scheduleId) : null;
  setFormMode(currentEditingId ? 'edit' : 'add');
  if(formEl){
    if(currentEditingId){
      formEl.dataset.editingId = currentEditingId;
      try{ formEl.scrollIntoView({behavior:'smooth', block:'start'}); }catch(e){}
    } else {
      delete formEl.dataset.editingId;
    }
  }
}

function exitEditMode({resetForm = false} = {}){
  currentEditingId = null;
  setFormMode('add');
  if(formEl){ delete formEl.dataset.editingId; }
  if(resetForm) resetFormFields();
}

function isEditing(){ return currentEditingId !== null; }

function computeNextForScheduleLocal(s){
  try{
    const now = new Date(); if(!s) return null;
    if(s.type === 'once'){ const t = s.when ? new Date(s.when).getTime() : null; return t && t > now.getTime() ? t : null; }
    const [hour, minute] = (s.time || '00:00').split(':').map(Number);
    if(s.type === 'daily'){ const next = new Date(now); next.setHours(hour, minute, 0, 0); if(next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1); return next.getTime(); }
    if(s.type === 'weekly'){ if(!Array.isArray(s.days) || s.days.length === 0) return null; const candidates = s.days.map(d => { const candidate = new Date(now); const currentDow = candidate.getDay(); let delta = (d - currentDow + 7) % 7; candidate.setDate(candidate.getDate() + delta); candidate.setHours(hour, minute, 0, 0); if(candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 7); return candidate.getTime(); }); return Math.min(...candidates); }
    if(s.type === 'monthly'){ const day = Number(s.day); if(!day || day < 1) return null; const year = now.getFullYear(), month = now.getMonth(); const dim = new Date(year, month+1, 0).getDate(); const useDay = Math.min(day, dim); const next = new Date(now); next.setDate(useDay); next.setHours(hour, minute, 0, 0); if(next.getTime() <= now.getTime()){ const nextMonth = new Date(now); nextMonth.setMonth(nextMonth.getMonth()+1,1); const y2 = nextMonth.getFullYear(), m2 = nextMonth.getMonth(); const dim2 = new Date(y2,m2+1,0).getDate(); nextMonth.setDate(Math.min(day,dim2)); nextMonth.setHours(hour, minute, 0,0); return nextMonth.getTime(); } return next.getTime(); }
    return null;
  }catch(e){ return null; }
}

function populateFormFromSchedule(s){
  try{
    const inputUrl = $('#url'); if(inputUrl) inputUrl.value = s.url || '';
    const openIn = $('#openIn'); if(openIn) openIn.value = s.openIn || 'tab';
    const openInBackground = $('#openInBackground'); if(openInBackground) openInBackground.checked = !!s.openInBackground;
    const mode = $('#mode'); if(mode) mode.value = s.type || 'once';
    const when = $('#when');
    if(when){
      if(!s.when) when.value = '';
  else if(typeof s.when === 'string' && /^\d{4}-\d{2}-\d{2}[T \t]\d{2}:\d{2}/.test(s.when) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s.when)){
        when.value = s.when.replace(/\s+/, 'T').slice(0,16);
      } else {
        try{ const d = typeof s.when === 'number' ? new Date(Number(s.when)) : new Date(String(s.when)); if(!isNaN(d.getTime())){ const pad = n => String(n).padStart(2,'0'); when.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; } else when.value = String(s.when || ''); }catch(e){ when.value = String(s.when || ''); }
      }
    }
    const time = $('#time'); if(time) time.value = s.time || '00:00';
  const monthDay = $('#monthDay'); if(monthDay) monthDay.value = s.day || '';
    const stopAfter = $('#stopAfter'); if(stopAfter) stopAfter.value = s.stopAfter ? String(s.stopAfter) : '';
    const message = $('#message'); if(message) message.value = s.message || '';
    const weeklyDays = $('#weeklyDays'); if(weeklyDays && Array.isArray(s.days)){ Array.from(weeklyDays.querySelectorAll('input[type=checkbox]')).forEach(cb => cb.checked = s.days.map(String).includes(String(cb.value))); }
  // Ensure the mode UI updates even when mode.value is set programmatically
  try{ if(mode && typeof mode.dispatchEvent === 'function'){ mode.dispatchEvent(new Event('change', { bubbles: true })); } }catch(e){}
  }catch(e){}
}
function getFaviconUrl(url){
  try{
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  }catch(e){
    return null;
  }
}

function renderSchedules(list){
  const ul = $('#schedulesList'); ul.innerHTML = '';
  list.forEach(s => {
    // defensive coercions
    const runc = Number(s && s.runCount) || 0; const lrun = s && s.lastRun ? Number(s.lastRun) : null; s.runCount = runc; if(lrun) s.lastRun = lrun;
  // For recurring schedules, expired when runCount >= stopAfter.
  // For once schedules, consider expired if it has run at least once.
  const isExpired = (s.type === 'once') ? (Number(s.runCount) >= 1) : (s.stopAfter && Number(s.runCount) >= Number(s.stopAfter));
  const li = document.createElement('li');
  li.className = 'schedule-item';
  const scheduleIdStr = String(s.id);
  const isEditingThis = currentEditingId && scheduleIdStr === currentEditingId;
  if(isEditingThis) li.classList.add('editing-schedule');
  const left = document.createElement('div');
  left.className = 'schedule-left';
    const title = document.createElement('div');
    title.className = 'schedule-title';
    
    // Add favicon
    const faviconUrl = getFaviconUrl(s.url);
    if(faviconUrl){
      const favicon = document.createElement('img');
      favicon.src = faviconUrl;
      favicon.className = 'schedule-favicon';
      favicon.alt = '';
      favicon.onerror = () => { favicon.style.display = 'none'; };
      title.appendChild(favicon);
    }
    
    const urlText = document.createElement('span');
    urlText.textContent = s.url.toLowerCase();
    title.appendChild(urlText);
    const meta = document.createElement('div');
    meta.className = 'schedule-meta';
  let whenText = '';
  if(s.type === 'once') whenText = `once @ ${new Date(s.when).toLocaleString()}`;
  else if(s.type === 'daily') whenText = `daily @ ${s.time}`;
  else if(s.type === 'weekly') whenText = `weekly @ ${s.time} on ${ (s.days||[]).map(d => ['sun','mon','tue','wed','thu','fri','sat'][d]).join(', ') }`;
  else if(s.type === 'monthly') whenText = `monthly @ ${s.time} on day ${s.day || '?'} of month`;
    meta.textContent = whenText;
    const small = document.createElement('div'); small.className = 'small'; small.textContent = s.message ? s.message.toLowerCase() : '';
    // append title first
    left.appendChild(title);
    // show how this will open right under the url
    const openLine = document.createElement('div'); openLine.className = 'small';
    if(s.openIn === 'window'){
      openLine.textContent = 'opens in window';
    } else if(s.openIn === 'tab'){
      if(s.openInBackground){
        openLine.textContent = 'opens in tab (background)';
      } else {
        openLine.textContent = 'opens in tab';
      }
    } else {
      // fallback for unexpected values
      openLine.textContent = `opens in ${String(s.openIn || 'tab')}`;
    }
    left.appendChild(openLine);
    left.appendChild(meta);
    left.appendChild(small);
    // show run counts for all schedules (including 'once')
    {
      const progress = document.createElement('div'); progress.className = 'small';
      const ran = Number(s.runCount) || 0;
      const limit = s.stopAfter ? Number(s.stopAfter) : null;
      if(limit){ progress.textContent = `${ran}/${limit} runs`; }
      else {
        progress.textContent = ran === 1 ? '1 run' : `${ran} runs`;
      }
      left.appendChild(progress);
    }
    // last run display (always show 'never' when absent)
    const last = document.createElement('div'); last.className = 'small';
    if(s.lastRun){ last.textContent = `last time opened ${new Date(Number(s.lastRun)).toLocaleString()}`; }
    else { last.textContent = 'last time opened never'; }
    left.appendChild(last);
    // next occurrence display (never if expired)
    const nextLine = document.createElement('div'); nextLine.className = 'small';
    if(isExpired){
      nextLine.textContent = 'next time will open never';
    } else {
      const nextTs = computeNextForScheduleLocal(s);
      if(nextTs){ nextLine.textContent = `next time will open ${new Date(nextTs).toLocaleString()}`; }
      else { nextLine.textContent = 'next time will open never'; }
    }
    left.appendChild(nextLine);
  // gray out expired schedules (do not remove by default)
    if(isExpired) li.classList.add('expired-schedule');

    const right = document.createElement('div');
    // Edit button - removes the schedule and populates the form for editing
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit-btn'; edit.textContent = isEditingThis ? 'editing…' : 'edit';
  if(isEditingThis) edit.disabled = true;
    edit.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      try{
        populateFormFromSchedule(s);
        enterEditMode(scheduleIdStr);
        try{ refresh(); }catch(e){}
  }catch(e){}
    });
    right.appendChild(edit);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete-btn'; del.textContent = 'delete';
    if(isEditingThis) del.disabled = true;
    del.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      try{
        del.disabled = true;
        li.classList.add('ow-fade');
            const finish = async () => {
          try{
            const schedules = await getSchedules();
            const remaining = schedules.filter(x => String(x.id) !== String(s.id));
            await setSchedules(remaining);
            if(currentEditingId && String(s.id) === currentEditingId){ exitEditMode({resetForm:true}); }
            chrome.runtime.sendMessage({type:'rebuild', suppressLate:true}, () => {
              try{ chrome.runtime && chrome.runtime.lastError; }catch(e){}
              try{ refresh(); }catch(e){}
            });
                // NOTE: do not show a 'Schedule removed' toast here. Removal confirmation should be shown
                // only when the schedule is cancelled from the in-page banner (handled by the banner cancel toast).
          }catch(e){}
        };
        li.addEventListener('transitionend', () => { finish(); }, {once:true});
        // fallback in case transitionend doesn't fire
        setTimeout(() => { finish(); }, 420);
      }catch(e){}
    });
    right.appendChild(del);

    li.appendChild(left); li.appendChild(right);
    ul.appendChild(li);
  });
}

async function refresh(){
  const schedules = await getSchedules();
  // order by setting
  const order = ($('#orderBy') && $('#orderBy').value) || 'created-desc';
  const copy = (schedules || []).slice(0);
  // precompute a heuristic next timestamp for each schedule so 'next' ordering works
  copy.forEach(s => {
    try{
      const ts = computeNextForScheduleLocal(s);
      s.__next = (ts !== null && typeof ts !== 'undefined') ? Number(ts) : Number.POSITIVE_INFINITY;
    }catch(e){ s.__next = Number.POSITIVE_INFINITY; }
  });
  
  // Parse order type and direction
  if(order === 'created-desc'){
    copy.sort((a,b) => (b.id || '').localeCompare(a.id || ''));
  } else if(order === 'created-asc'){
    copy.sort((a,b) => (a.id || '').localeCompare(b.id || ''));
  } else if(order === 'times-desc'){
    copy.sort((a,b) => (Number(b.runCount)||0) - (Number(a.runCount)||0));
  } else if(order === 'times-asc'){
    copy.sort((a,b) => (Number(a.runCount)||0) - (Number(b.runCount)||0));
  } else if(order === 'next-asc'){
    copy.sort((a,b) => (Number(a.__next) || 0) - (Number(b.__next) || 0));
  } else if(order === 'next-desc'){
    copy.sort((a,b) => (Number(b.__next) || 0) - (Number(a.__next) || 0));
  } else {
    // fallback to created desc
    copy.sort((a,b) => (b.id || '').localeCompare(a.id || ''));
  }
  
  // Apply search filter
  const searchBar = $('#searchBar');
  if(searchBar && searchBar.value.trim()){
    const query = searchBar.value.trim().toLowerCase();
    const filtered = copy.filter(s => {
      const url = (s.url || '').toLowerCase();
      const message = (s.message || '').toLowerCase();
      return url.includes(query) || message.includes(query);
    });
    renderSchedules(filtered);
  } else {
    renderSchedules(copy);
  }
}

// ensure we refresh when background broadcasts changes even if DOMContentLoaded already fired
try{ chrome.runtime.onMessage.addListener((msg) => { if(msg && msg.type === 'schedules_updated'){ try{ refresh(); }catch(e){} } }); }catch(e){}

window.addEventListener('DOMContentLoaded', () => {
  const form = $('#addForm');
  const mode = $('#mode');
  const onceFields = $('#onceFields');
  const recurringFields = $('#recurringFields');
  const monthlyFields = $('#monthlyFields');
  const weeklyDays = $('#weeklyDays');

  if(!form) return;

  formEl = form;
  submitBtnEl = $('#submitBtn');
  cancelBtnEl = $('#cancelEdit');
  updateModeFn = updateMode;
  setFormMode(isEditing() ? 'edit' : 'add');

  if(cancelBtnEl){
    cancelBtnEl.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      exitEditMode({resetForm:true});
      try{ refresh(); }catch(e){}
    });
  }

  // Toast helper for options page (inject minimal styles when first used)
  let __ow_toast_styles_installed = false;
  function _ensureToastStyles(){
    if(__ow_toast_styles_installed) return;
    __ow_toast_styles_installed = true;
    try{
      const s = document.createElement('style'); s.type = 'text/css'; s.textContent = `
        .ow-toast{position:fixed;right:16px;bottom:24px;background:rgba(30,30,30,0.95);color:#fff;padding:10px 14px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.35);z-index:2147483650;font-size:13px;opacity:1;transition:opacity 300ms ease, transform 300ms ease}
        .ow-toast.ow-toast-fade{opacity:0;transform:translateY(6px)}
        .ow-fade{transition:opacity 240ms ease, transform 240ms ease;opacity:0 !important;transform:translateY(-8px) !important;pointer-events:none}
      `;
      document.head.appendChild(s);
    }catch(e){}
  }
  function showOptionsToast(msg, duration = 3000){
    try{
      _ensureToastStyles();
      const t = document.createElement('div'); t.className = 'ow-toast'; t.textContent = msg || '';
      document.body.appendChild(t);
      setTimeout(() => { try{ t.classList.add('ow-toast-fade'); setTimeout(() => { try{ t.remove(); }catch(e){} }, 320); }catch(e){} }, duration);
    }catch(e){}
  }

  // expose toast helper to other popup scripts (popup_prefill.js) so they can show confirmation toasts
  try{ window.showOptionsToast = showOptionsToast; }catch(e){}

  // if another script (popup_prefill.js) set a session flag to show a toast after prefill, consume it now
  try{
    if(window.sessionStorage && window.sessionStorage.getItem('openwhen_prefill_toast')){
      try{ showOptionsToast('Prefilled URL'); }catch(e){}
      try{ window.sessionStorage.removeItem('openwhen_prefill_toast'); }catch(e){}
    }
  }catch(e){}

  function updateMode(){
    const val = mode ? mode.value : 'once';
    // update min for datetime-local when 'once' is selected to prevent past dates
    try{
      const whenInput = $('#when');
      if(whenInput){
        const pad = n => String(n).padStart(2,'0');
        const now = new Date();
        const minStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        whenInput.min = minStr;
      }
    }catch(e){}
    if(val === 'once'){
      if(onceFields) onceFields.hidden = false;
      if(recurringFields) recurringFields.hidden = true;
      if(weeklyDays) weeklyDays.hidden = true;
      if(monthlyFields) monthlyFields.hidden = true;
      const stopLabel = $('#stopAfterLabel'); if(stopLabel) stopLabel.hidden = true;
    } else if(val === 'daily'){
      if(onceFields) onceFields.hidden = true;
      if(recurringFields) recurringFields.hidden = false;
      if(weeklyDays) weeklyDays.hidden = true;
      if(monthlyFields) monthlyFields.hidden = true;
      const stopLabel = $('#stopAfterLabel'); if(stopLabel) stopLabel.hidden = false;
    } else if(val === 'weekly'){
      if(onceFields) onceFields.hidden = true;
      if(recurringFields) recurringFields.hidden = false;
      if(weeklyDays) weeklyDays.hidden = false;
      if(monthlyFields) monthlyFields.hidden = true;
      const stopLabel = $('#stopAfterLabel'); if(stopLabel) stopLabel.hidden = false;
    } else if(val === 'monthly'){
      if(onceFields) onceFields.hidden = true;
      if(recurringFields) recurringFields.hidden = false;
      if(weeklyDays) weeklyDays.hidden = true;
      if(monthlyFields) monthlyFields.hidden = false;
      const stopLabel = $('#stopAfterLabel'); if(stopLabel) stopLabel.hidden = false;
    }
  }
  if(mode && typeof mode.addEventListener === 'function'){ mode.addEventListener('change', updateMode); }
  updateMode();

  // check for a prefill URL set by the context menu
  try{
    chrome.storage.local.get(['openwhen_prefill_url'], res => { const u = res && res.openwhen_prefill_url; if(u){ const input = $('#url'); if(input) input.value = u; chrome.storage.local.remove(['openwhen_prefill_url']); } });
  }catch(e){/* ignore */}

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const url = $('#url').value.trim();
  const openIn = $('#openIn').value;
  const openInBackground = !!$('#openInBackground').checked;
    const type = $('#mode').value;
    const message = $('#message').value.trim();
    const when = $('#when').value;
    // if once mode, ensure when is not in the past
    if(type === 'once'){
      if(!when){ alert('please select a date and time for once schedules'); return; }
      // parse local YYYY-MM-DDTHH:MM (may include seconds but we only need minutes)
      const parts = when.split('T');
      let whenDate = null;
      if(parts.length === 2){
        const [d, t] = parts;
        const [y, m, day] = d.split('-').map(Number);
        const [hh, mm] = t.split(':').map(Number);
        whenDate = new Date(y, (m||1)-1, day||1, hh||0, mm||0, 0, 0);
      } else {
        whenDate = new Date(when);
      }
      if(!whenDate || isNaN(whenDate.getTime())){ alert('please enter a valid date/time'); return; }
      const now = new Date();
      if(whenDate.getTime() <= now.getTime()){
        alert('please choose a date & time in the future for once schedules');
        return;
      }
    }
    const time = $('#time').value || '00:00';
  const days = (weeklyDays && weeklyDays.querySelectorAll) ? Array.from(weeklyDays.querySelectorAll('input[type=checkbox]:checked')).map(i => Number(i.value)) : [];
    const monthDayInput = $('#monthDay');
    const monthDay = monthDayInput ? Number(monthDayInput.value) : null;
      const stopAfterInput = $('#stopAfter');
      const stopAfter = stopAfterInput ? Number(stopAfterInput.value) : null;

    // normalize URL: if scheme missing, prepend https://
    function normalizeUrl(u){
      if(!u) return '';
      // already has scheme
      if(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u) || /^\/\//.test(u)) return u;
      // looks like domain
  if(/^[^\s]+\.[^\s]+$/.test(u) || /^localhost([:/]|$)/.test(u)) return 'https://' + u;
      return u;
    }
    const normalized = normalizeUrl(url);
    if(!normalized){ alert('please enter a valid url'); return; }

    const editing = isEditing();
    const editingId = currentEditingId;
    if(type === 'weekly' && (!days || days.length === 0)){ alert('please select at least one weekday for weekly schedules'); return; }

    const schedules = await getSchedules();
    const nextSchedules = schedules.slice(0);

    if(editing){
      const idx = nextSchedules.findIndex(x => String(x.id) === editingId);
      const base = idx >= 0 ? nextSchedules[idx] : null;
      const updated = Object.assign({}, base || {}, {
        id: base && base.id != null ? base.id : (editingId || (base && base.id) || uid()),
        url: normalized,
        openIn,
        openInBackground,
        type,
        message
      });
      delete updated.when;
      delete updated.time;
      delete updated.days;
      delete updated.day;
      delete updated.stopAfter;
      delete updated.__next;

      if(type === 'once'){
        updated.when = when;
      } else if(type === 'daily'){
        updated.time = time;
      } else if(type === 'weekly'){
        updated.time = time;
        updated.days = days;
      } else if(type === 'monthly'){
        updated.time = time;
        if(Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31) updated.day = monthDay;
      }

      if(type !== 'once' && Number.isInteger(stopAfter) && stopAfter > 0){
        updated.stopAfter = stopAfter;
      }

      if(!Number.isFinite(updated.runCount)) updated.runCount = 0;
      if(idx >= 0){
        nextSchedules[idx] = updated;
      } else {
        if(!updated.id) updated.id = editingId || uid();
        nextSchedules.push(updated);
      }
    } else {
      const newSchedule = {id: uid(), url: normalized, openIn, openInBackground, type, message, runCount: 0};
      if(type === 'once') newSchedule.when = when;
      else if(type === 'daily') newSchedule.time = time;
      else if(type === 'weekly'){ newSchedule.time = time; newSchedule.days = days; }
      else if(type === 'monthly'){ newSchedule.time = time; if(Number.isInteger(monthDay) && monthDay >=1 && monthDay <=31) newSchedule.day = monthDay; }
      if(type !== 'once' && Number.isInteger(stopAfter) && stopAfter > 0) newSchedule.stopAfter = stopAfter;
      nextSchedules.push(newSchedule);
    }

    await setSchedules(nextSchedules);
    chrome.runtime.sendMessage({type:'rebuild', suppressLate:true}, resp => {
      try{ chrome.runtime && chrome.runtime.lastError; }catch(e){}
      try{
        if(editing){ exitEditMode({resetForm:true}); showOptionsToast('Schedule updated'); }
        else { resetFormFields(); showOptionsToast('Schedule added'); }
      }catch(e){}
      try{ refresh(); }catch(e){}
    });
  });

  refresh();

  // wire up the "order by" selector so changes re-run the list refresh
  try{
    const orderBy = $('#orderBy');
    if(orderBy){
      orderBy.addEventListener('change', () => {
    try{ refresh(); }catch(e){}
      });
    }
  }catch(e){/* ignore */}

  // wire up the search bar for real-time filtering
  try{
    const searchBar = $('#searchBar');
    if(searchBar){
      searchBar.addEventListener('input', () => {
        try{ refresh(); }catch(e){}
      });
    }
  }catch(e){/* ignore */}

  // rely on storage.onChanged and runtime messages for live updates

  // debug dump removed

  // update UI when schedules change in storage (so runCount updates appear live)
  try{ chrome.storage.onChanged.addListener((changes, area) => { if(area === 'local' && changes && changes.schedules){ try{ refresh(); }catch(e){} } }); }catch(e){}
  // explicit runtime messages are handled by the top-level listener above
});
