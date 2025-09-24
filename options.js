// options page script for openwhen
const SCHEDULES_KEY = 'schedules';

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

async function getSchedules(){
  return new Promise(resolve => chrome.storage.local.get([SCHEDULES_KEY], res => resolve(res[SCHEDULES_KEY] || [])));
}
async function setSchedules(schedules){
  return new Promise(resolve => { const o={}; o[SCHEDULES_KEY]=schedules; chrome.storage.local.set(o, resolve); });
}

function toLowerCaseAllTextNodes(root = document.body){
  // ensure headings and labels are already lowercase via CSS; leave content values
}

function $(sel){return document.querySelector(sel)}

// compute next occurrence locally for display purposes
function computeNextForScheduleLocal(s){
  try{
    const now = new Date();
    if(!s) return null;
    if(s.type === 'once'){
      const t = s.when ? new Date(s.when).getTime() : null;
      return t && t > now.getTime() ? t : null;
    }
    const [hour, minute] = (s.time || '00:00').split(':').map(Number);
    if(s.type === 'daily'){
      const next = new Date(now);
      next.setHours(hour, minute, 0, 0);
      if(next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      return next.getTime();
    }
    if(s.type === 'weekly'){
      if(!Array.isArray(s.days) || s.days.length === 0) return null;
      const candidates = s.days.map(d => {
        const candidate = new Date(now);
        const currentDow = candidate.getDay();
        let delta = (d - currentDow + 7) % 7;
        candidate.setDate(candidate.getDate() + delta);
        candidate.setHours(hour, minute, 0, 0);
        if(candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 7);
        return candidate.getTime();
      });
      return Math.min(...candidates);
    }
    if(s.type === 'monthly'){
      const day = Number(s.day);
      if(!day || day < 1) return null;
      const year = now.getFullYear();
      const month = now.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const useDay = Math.min(day, daysInMonth);
      const next = new Date(now);
      next.setDate(useDay);
      next.setHours(hour, minute, 0, 0);
      if(next.getTime() <= now.getTime()){
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
        const y2 = nextMonth.getFullYear();
        const m2 = nextMonth.getMonth();
        const dim2 = new Date(y2, m2 + 1, 0).getDate();
        nextMonth.setDate(Math.min(day, dim2));
        nextMonth.setHours(hour, minute, 0, 0);
        return nextMonth.getTime();
      }
      return next.getTime();
    }
    return null;
  }catch(e){ return null; }
}

// populate the add/edit form with a schedule object
function populateFormFromSchedule(s){
  try{
    const inputUrl = $('#url'); if(inputUrl) inputUrl.value = s.url || '';
    const openIn = $('#openIn'); if(openIn) openIn.value = s.openIn || 'tab';
    const openInBackground = $('#openInBackground'); if(openInBackground) openInBackground.checked = !!s.openInBackground;
    const mode = $('#mode'); if(mode) mode.value = s.type || 'once';
    const when = $('#when'); if(when){
      // If the stored value is already in the 'YYYY-MM-DDTHH:MM' form, use it verbatim.
      // This avoids parsing round-trips that can shift minutes due to timezone/offsets.
      if(!s.when){
        when.value = '';
      } else if(typeof s.when === 'string' && /^\d{4}-\d{2}-\d{2}[T \t]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(s.when) && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s.when)){
        // string like '2025-09-24T18:06' or '2025-09-24 18:06:02' (no timezone offset):
        // normalize separator to 'T' then take the first 16 chars (YYYY-MM-DDTHH:MM)
        const norm = s.when.replace(/\s+/, 'T');
        when.value = norm.slice(0,16);
      } else {
        // fallback: parse as Date and format into local 'YYYY-MM-DDTHH:MM'
        try{
          let d = null;
          if(typeof s.when === 'number') d = new Date(Number(s.when));
          else d = new Date(String(s.when));
          if(!isNaN(d.getTime())){
            const pad = n => String(n).padStart(2,'0');
            const local = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            when.value = local;
          } else {
            when.value = String(s.when || '');
          }
        }catch(e){ when.value = String(s.when || ''); }
      }
    }
    const time = $('#time'); if(time) time.value = s.time || '00:00';
    const monthDay = $('#monthDay'); if(monthDay) monthDay.value = s.day || '';
    const stopAfter = $('#stopAfter'); if(stopAfter) stopAfter.value = s.stopAfter ? String(s.stopAfter) : '';
    const message = $('#message'); if(message) message.value = s.message || '';
    // weekly days: check checkboxes that match s.days
    const weeklyDays = $('#weeklyDays');
    if(weeklyDays && Array.isArray(s.days)){
      Array.from(weeklyDays.querySelectorAll('input[type=checkbox]')).forEach(cb => {
        cb.checked = s.days.map(String).includes(String(cb.value));
      });
    }
    // ensure the UI shows the right fields
    try{ if(typeof updateMode === 'function') updateMode(); }catch(e){}
  }catch(e){ console.warn('[openwhen options] populateFormFromSchedule failed', e); }
}

function renderSchedules(list){
  console.log('[openwhen options] renderSchedules called, count=', (list && list.length) || 0);
  const ul = $('#schedulesList');
  ul.innerHTML = '';
  list.forEach(s => {
    // defensive coercions and debug logging
    const rid = s && s.id ? String(s.id) : '<no-id>';
    const runc = Number(s && s.runCount) || 0;
    const lrun = s && s.lastRun ? Number(s.lastRun) : null;
    console.log('[openwhen options] schedule', {id: rid, runCount: runc, lastRun: lrun, raw: s});
  // normalize fields for display
  s.runCount = runc;
  if(lrun) s.lastRun = lrun;
  // For recurring schedules, expired when runCount >= stopAfter.
  // For once schedules, consider expired if it has run at least once.
  const isExpired = (s.type === 'once') ? (Number(s.runCount) >= 1) : (s.stopAfter && Number(s.runCount) >= Number(s.stopAfter));
    const li = document.createElement('li');
    li.className = 'schedule-item';
  const left = document.createElement('div');
  left.className = 'schedule-left';
    const title = document.createElement('div');
    title.textContent = s.url.toLowerCase();
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
    // show if this will open in background right under the url
    if(s.openInBackground){
      const bgMarker = document.createElement('div'); bgMarker.className = 'small'; bgMarker.textContent = 'opens in background';
      left.appendChild(bgMarker);
    }
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
  edit.className = 'edit-btn'; edit.textContent = 'edit';
    edit.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      try{
        const schedules = await getSchedules();
        const remaining = schedules.filter(x => String(x.id) !== String(s.id));
        await setSchedules(remaining);
        // populate the form with the selected schedule's data
        populateFormFromSchedule(s);
  // notify background to rebuild alarms (do not open missed occurrences from UI actions)
  chrome.runtime.sendMessage({type:'rebuild', suppressLate:true}, () => {
          if(chrome.runtime.lastError){
            const m = String(chrome.runtime.lastError.message || '');
            if(/message port closed|Receiving end does not exist|Could not establish connection|No receiver/i.test(m)){
              // benign
            } else { console.warn('[openwhen options] sendMessage error', m); }
          }
          renderSchedules(remaining);
        });
      }catch(e){ console.warn('[openwhen options] edit failed', e); }
    });
    right.appendChild(edit);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete-btn'; del.textContent = 'delete';
    del.addEventListener('click', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const schedules = await getSchedules();
      const remaining = schedules.filter(x => String(x.id) !== String(s.id));
      await setSchedules(remaining);
      // notify background to rebuild alarms (do not open missed occurrences from UI actions)
        chrome.runtime.sendMessage({type:'rebuild', suppressLate:true}, () => {
          if(chrome.runtime.lastError){
            const m = String(chrome.runtime.lastError.message || '');
            if(/message port closed|Receiving end does not exist|Could not establish connection|No receiver/i.test(m)){
              // benign
            } else { console.warn('[openwhen options] sendMessage error', m); }
          }
          renderSchedules(remaining);
        });
    });
    right.appendChild(del);

    li.appendChild(left); li.appendChild(right);
    ul.appendChild(li);
  });
}

async function refresh(){
  console.log('[openwhen options] refresh() called');
  const schedules = await getSchedules();
  console.log('[openwhen options] got schedules from storage', schedules && schedules.map && schedules.map(s => ({id: s.id, runCount: s.runCount || 0, lastRun: s.lastRun || null})));
  // order by setting
  const order = ($('#orderBy') && $('#orderBy').value) || 'created';
  const copy = (schedules || []).slice(0);
  // precompute a heuristic next timestamp for each schedule so 'next' ordering works
  copy.forEach(s => {
    try{
      const ts = computeNextForScheduleLocal(s);
      s.__next = (ts !== null && typeof ts !== 'undefined') ? Number(ts) : Number.POSITIVE_INFINITY;
    }catch(e){ s.__next = Number.POSITIVE_INFINITY; }
  });
  if(order === 'created'){
    copy.sort((a,b) => (a.id || '').localeCompare(b.id || ''));
  } else if(order === 'times'){
    copy.sort((a,b) => (Number(b.runCount)||0) - (Number(a.runCount)||0));
  } else if(order === 'next'){
    // compute next trigger time heuristically: use computeNextForSchedule if available in background, otherwise approximate
    copy.sort((a,b) => (Number(a.__next) || 0) - (Number(b.__next) || 0));
  }
  renderSchedules(copy);
}

// ensure we refresh when background broadcasts changes even if DOMContentLoaded already fired
try{
  chrome.runtime.onMessage.addListener((msg) => {
    console.log('[openwhen options] runtime.onMessage received', msg);
    if(msg && msg.type === 'schedules_updated'){
      // Always refresh so the current "order by" selection is applied.
      try{ refresh(); }catch(e){ console.warn('[openwhen options] refresh failed on schedules_updated', e); }
    }
  });
}catch(e){/* ignore */}

window.addEventListener('DOMContentLoaded', () => {
  const form = $('#addForm');
  const mode = $('#mode');
  const onceFields = $('#onceFields');
  const recurringFields = $('#recurringFields');
  const monthlyFields = $('#monthlyFields');
  const weeklyDays = $('#weeklyDays');

  function updateMode(){
    const val = mode.value;
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
      onceFields.hidden = false; recurringFields.hidden = true; weeklyDays.hidden = true;
      if(monthlyFields) monthlyFields.hidden = true;
      const stopLabel = $('#stopAfterLabel'); if(stopLabel) stopLabel.hidden = true;
    } else if(val === 'daily'){
      onceFields.hidden = true; recurringFields.hidden = false; weeklyDays.hidden = true;
      if(monthlyFields) monthlyFields.hidden = true;
      const stopLabel = $('#stopAfterLabel'); if(stopLabel) stopLabel.hidden = false;
    } else if(val === 'weekly'){
      onceFields.hidden = true; recurringFields.hidden = false; weeklyDays.hidden = false;
      if(monthlyFields) monthlyFields.hidden = true;
      const stopLabel = $('#stopAfterLabel'); if(stopLabel) stopLabel.hidden = false;
    } else if(val === 'monthly'){
      onceFields.hidden = true; recurringFields.hidden = false; weeklyDays.hidden = true;
      if(monthlyFields) monthlyFields.hidden = false;
      const stopLabel = $('#stopAfterLabel'); if(stopLabel) stopLabel.hidden = false;
    }
  }
  mode.addEventListener('change', updateMode);
  updateMode();

  // check for a prefill URL set by the context menu
  try{
    chrome.storage.local.get(['openwhen_prefill_url'], res => {
      const u = res && res.openwhen_prefill_url;
      if(u){
        const input = $('#url');
        if(input) input.value = u;
        // clear the stored value
        chrome.storage.local.remove(['openwhen_prefill_url']);
      }
    });
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
    const days = Array.from(weeklyDays.querySelectorAll('input[type=checkbox]:checked')).map(i => Number(i.value));
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
      if(/^[^\s]+\.[^\s]+$/.test(u) || /^localhost([:\/]|$)/.test(u)) return 'https://' + u;
      return u;
    }
    const normalized = normalizeUrl(url);
    if(!normalized){ alert('please enter a valid url'); return; }

  const newSchedule = {id: uid(), url: normalized, openIn, openInBackground, type, message, runCount: 0};
  if(type === 'once') newSchedule.when = when;
  else if(type === 'daily') newSchedule.time = time;
  else if(type === 'weekly') { 
    if(!days || days.length === 0){ alert('please select at least one weekday for weekly schedules'); return; }
    newSchedule.time = time; newSchedule.days = days; 
  }
  else if(type === 'monthly') { newSchedule.time = time; if(Number.isInteger(monthDay) && monthDay >=1 && monthDay <=31) newSchedule.day = monthDay; }
  if(type !== 'once' && Number.isInteger(stopAfter) && stopAfter > 0) newSchedule.stopAfter = stopAfter;

    const schedules = await getSchedules();
    schedules.push(newSchedule);
    await setSchedules(schedules);
  // ask background to rebuild alarms (do not open missed occurrences from UI actions)
  chrome.runtime.sendMessage({type:'rebuild', suppressLate:true}, resp => {
      if(chrome.runtime.lastError){
        const m = String(chrome.runtime.lastError.message || '');
        if(/message port closed|Receiving end does not exist|Could not establish connection|No receiver/i.test(m)){
          // benign
        } else { console.warn('[openwhen options] sendMessage error', m); }
      }
      refresh();
      form.reset();
      updateMode();
    });
  });

  refresh();

  // wire up the "order by" selector so changes re-run the list refresh
  try{
    const orderBy = $('#orderBy');
    if(orderBy){
      orderBy.addEventListener('change', () => {
        try{ refresh(); }catch(e){ console.warn('[openwhen options] refresh failed on orderBy change', e); }
      });
    }
  }catch(e){/* ignore */}

  // rely on storage.onChanged and runtime messages for live updates

  // debug dump removed

  // update UI when schedules change in storage (so runCount updates appear live)
  try{
    chrome.storage.onChanged.addListener((changes, area) => {
      console.log('[openwhen options] storage.onChanged', {area, changes});
      if(area === 'local' && changes && changes.schedules){
        // prefer to refresh (which respects the current "order by" selection) instead of rendering raw storage data
        try{ refresh(); }catch(e){ console.warn('[openwhen options] refresh failed on storage change', e); }
      }
    });
  }catch(e){/* ignore */}
  // explicit runtime messages are handled by the top-level listener above
});
