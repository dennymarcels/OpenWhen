// background service worker for OpenWhen (concise, minimal logging)

const SCHEDULES_KEY = 'schedules';
const LAST_CHECK_KEY = 'last_check';

function _debug(...args){ /* use console for errors only to keep output small */ }

async function getSchedules(){
  return new Promise(resolve => chrome.storage.local.get([SCHEDULES_KEY], res => resolve(res[SCHEDULES_KEY] || [])));
}

const _writeQueue = [];
let _writeProcessing = false;

function _enqueueWrite(schedules){
  return new Promise((resolve) => { _writeQueue.push({schedules, resolve}); if(!_writeProcessing) _processWriteQueue(); });
}

function _processWriteQueue(){
  if(_writeProcessing) return;
  _writeProcessing = true;
  (async () => {
    while(_writeQueue.length){
      const job = _writeQueue.shift();
      if(job && job.atomic){
        await new Promise(res => {
          chrome.storage.local.get([SCHEDULES_KEY], cur => {
            const stored = (cur && cur[SCHEDULES_KEY]) || [];
            const found = stored.find(x => String(x.id) === String(job.id));
            if(!found){ try{ job.resolve && job.resolve(null); }catch(e){} return res(); }
            let updated;
            try{ updated = typeof job.updater === 'function' ? job.updater(Object.assign({}, found)) : Object.assign({}, found, job.updater || {}); }catch(e){ updated = Object.assign({}, found); }
            updated.runCount = Number(updated.runCount) || 0;
            if(updated.lastRun === undefined) delete updated.lastRun;
            const merged = stored.map(x => String(x.id) === String(job.id) ? updated : x);
            const obj = {}; obj[SCHEDULES_KEY] = merged;
            chrome.storage.local.set(obj, () => { try{ job.resolve && job.resolve(updated); }catch(e){} res(); });
          });
        });
        continue;
      }
      const schedules = job.schedules;
      const obj = {}; obj[SCHEDULES_KEY] = schedules;
      await new Promise(res => {
        // safety: avoid overwriting non-empty storage with empty array
        if(Array.isArray(schedules) && schedules.length === 0){
          chrome.storage.local.get([SCHEDULES_KEY], cur => { const curList = (cur && cur[SCHEDULES_KEY]) || []; if(curList && curList.length > 0) return res(); chrome.storage.local.set(obj, res); });
        } else {
          chrome.storage.local.set(obj, res);
        }
      });
      try{ job.resolve && job.resolve(); }catch(e){}
    }
    _writeProcessing = false;
  })();
}

async function setSchedules(schedules){ return _enqueueWrite(schedules); }

function makeAlarmName(id){ return `openwhen_${id}`; }

function computeNextForSchedule(s){
  const now = new Date();
  if(s.type === 'once'){ const t = new Date(s.when).getTime(); return t > now.getTime() ? t : null; }
  const [hour, minute] = (s.time || '00:00').split(':').map(Number);
  if(s.type === 'daily'){ const next = new Date(now); next.setHours(hour, minute, 0, 0); if(next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1); return next.getTime(); }
  if(s.type === 'weekly'){ if(!Array.isArray(s.days) || s.days.length === 0) return null; const candidates = s.days.map(d => { const candidate = new Date(now); const currentDow = candidate.getDay(); let delta = (d - currentDow + 7) % 7; candidate.setDate(candidate.getDate() + delta); candidate.setHours(hour, minute, 0, 0); if(candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 7); return candidate.getTime(); }); return Math.min(...candidates); }
  if(s.type === 'monthly'){ const day = Number(s.day); if(!day || day < 1) return null; const year = now.getFullYear(); const month = now.getMonth(); const daysInMonth = new Date(year, month + 1, 0).getDate(); const useDay = Math.min(day, daysInMonth); const next = new Date(now); next.setDate(useDay); next.setHours(hour, minute, 0, 0); if(next.getTime() <= now.getTime()){ const nextMonth = new Date(now); nextMonth.setMonth(nextMonth.getMonth() + 1, 1); const y2 = nextMonth.getFullYear(); const m2 = nextMonth.getMonth(); const dim2 = new Date(y2, m2 + 1, 0).getDate(); nextMonth.setDate(Math.min(day, dim2)); nextMonth.setHours(hour, minute, 0, 0); return nextMonth.getTime(); } return next.getTime(); }
  return null;
}

function occurrencesBetween(s, startTs, endTs, cap=365){
  const out = []; const start = new Date(startTs); const end = new Date(endTs);
  if(s.type === 'once'){ const t = new Date(s.when).getTime(); if(t > startTs && t <= endTs) out.push(t); return out; }
  if(s.type === 'monthly'){ const day = Number(s.day); if(!day || day < 1) return out; const [hour, minute] = (s.time || '00:00').split(':').map(Number); let cand = new Date(start); cand.setDate(1); cand.setHours(0,0,0,0); let i=0; while(cand.getTime() <= end.getTime() && i < cap){ const y=cand.getFullYear(), m=cand.getMonth(); const dim=new Date(y,m+1,0).getDate(); const useDay=Math.min(day,dim); const occ=new Date(y,m,useDay,hour,minute,0,0); if(occ.getTime()>startTs && occ.getTime()<=endTs) out.push(occ.getTime()); cand.setMonth(cand.getMonth()+1); i++; } return out; }
  if(s.type === 'daily'){ const [hour, minute] = (s.time || '00:00').split(':').map(Number); let cand = new Date(start); cand.setHours(hour,minute,0,0); if(cand.getTime()<=startTs) cand.setDate(cand.getDate()+1); let i=0; while(cand.getTime()<=end.getTime() && i<cap){ out.push(cand.getTime()); cand.setDate(cand.getDate()+1); i++; } return out; }
  if(s.type === 'weekly'){ if(!Array.isArray(s.days) || s.days.length===0) return out; const [hour, minute] = (s.time || '00:00').split(':').map(Number); let cand = new Date(start); cand.setHours(0,0,0,0); let i=0; while(cand.getTime()<=end.getTime() && i<cap){ const dow=cand.getDay(); if(s.days.includes(dow)){ const occ=new Date(cand); occ.setHours(hour,minute,0,0); if(occ.getTime()>startTs && occ.getTime()<=endTs) out.push(occ.getTime()); } cand.setDate(cand.getDate()+1); i++; } return out; }
  return out;
}

// Try to fetch a favicon URL and resize it to a small PNG data URL (returns null on failure)
async function fetchAndResizeIcon(url, size=32){
  try{
    if(!url) return null;
    // try to fetch the image
    const resp = await fetch(url, {mode: 'cors'});
    if(!resp || !resp.ok) return null;
    const blob = await resp.blob();
    // create an ImageBitmap and draw into an OffscreenCanvas to resize
    if(typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
    const imgBitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if(!ctx) return null;
    // draw preserving aspect ratio and center
    const sw = imgBitmap.width || size;
    const sh = imgBitmap.height || size;
    const ratio = Math.min(size / sw, size / sh);
    const dw = Math.round(sw * ratio);
    const dh = Math.round(sh * ratio);
    const dx = Math.round((size - dw) / 2);
    const dy = Math.round((size - dh) / 2);
    ctx.clearRect(0,0,size,size);
    ctx.drawImage(imgBitmap, dx, dy, dw, dh);
    const outBlob = await canvas.convertToBlob({type: 'image/png'});
    return await new Promise(res => {
      try{
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(outBlob);
      }catch(e){ res(null); }
    });
  }catch(e){ return null; }
}

async function getLastCheck(){ return new Promise(resolve => chrome.storage.local.get([LAST_CHECK_KEY], res => resolve(res[LAST_CHECK_KEY] || null))); }
async function setLastCheck(ts){ return new Promise(resolve => { const o={}; o[LAST_CHECK_KEY]=ts; chrome.storage.local.set(o, resolve); }); }

function updateScheduleAtomic(id, updater){ return new Promise((resolve) => { try{ _writeQueue.push({atomic:true, id, updater, resolve}); if(!_writeProcessing) _processWriteQueue(); }catch(e){ resolve(null); } }); }

function _sendMessageToTabWhenReady(tabId, message, timeoutMs = 10000){
  return new Promise(resolve => {
    if(!tabId) return resolve({delivered:false, fallback:false});
    let sent = false, settled = false;
    const trySend = () => {
      try{
        chrome.tabs.sendMessage(tabId, message, () => {
          const lastErr = chrome.runtime.lastError;
          if(!lastErr){ sent = true; if(!settled){ settled = true; resolve({delivered:true, fallback:false}); } }
        });
      }catch(e){}
    };
    chrome.tabs.get(tabId, tab => {
  const doFallback = () => { if(!sent) { const _title = `opened by OpenWhen${message && message.source ? ` (${message.source})` : ''}`; /* fallback: log */ } if(!settled){ settled = true; resolve({delivered:false, fallback:true}); } };
      if(tab && tab.status === 'complete'){ trySend(); setTimeout(() => { if(!sent) doFallback(); }, 500); return; }
      const onUpdated = (updatedTabId, changeInfo) => { if(updatedTabId !== tabId) return; if(changeInfo && changeInfo.status === 'complete'){ trySend(); chrome.tabs.onUpdated.removeListener(onUpdated); settled = true; setTimeout(() => { if(!sent) doFallback(); }, 500); } };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => { if(!sent) doFallback(); if(!settled) chrome.tabs.onUpdated.removeListener(onUpdated); }, timeoutMs);
    });
  });
}

function _buildMessage(s, opts){ const base = s.message || ''; if(opts && opts.late){ if(opts.missedCount && opts.missedCount > 1) return (`late — missed ${opts.missedCount} occurrences. ${base}`).trim(); if(opts.missedCount === 1) return (`late — missed 1 occurrence. ${base}`).trim(); return (`late — missed scheduled time. ${base}`).trim(); } return base; }

async function rebuildAlarms(opts = {}){
  const schedules = await getSchedules();
  const lastCheck = await getLastCheck();
  const now = Date.now();
  const windowStart = lastCheck || (now - 1000 * 60 * 60 * 24);
  chrome.alarms.getAll(async alms => {
    alms.forEach(a => { if(a.name && a.name.startsWith('openwhen_')) chrome.alarms.clear(a.name); });
    for(let i = schedules.length - 1; i >= 0; i--){
      const s = schedules[i];
      const missed = occurrencesBetween(s, windowStart, now);
      if(missed.length > 0 && !opts.suppressLate){
        const mostRecentMissed = missed[missed.length - 1];
        const res = await openScheduleNow(s, {late:true, missedCount: missed.length, missedAt: mostRecentMissed});
        if(res && (res.delivered === true || res.fallback === true)){
          try{ await updateScheduleAtomic(s.id, prev => { const now = Date.now(); const newCount = (Number(prev.runCount) || 0) + missed.length; return Object.assign({}, prev, { runCount: newCount, lastRun: now }); }); }catch(e){}
          try{ chrome.alarms.clear(makeAlarmName(s.id)); }catch(e){}
          await setLastCheck(Date.now());
        }
      }
      if(s.stopAfter && Number(s.runCount) >= Number(s.stopAfter)) continue;
      const next = computeNextForSchedule(s);
      if(next) chrome.alarms.create(makeAlarmName(s.id), {when: next});
    }
    try{ await (async function persistMerged(localSchedules){ const stored = await getSchedules(); const storedMap = new Map((stored || []).map(x => [String(x.id), x])); const merged = (localSchedules || []).map(s => { const id = String(s.id); const base = storedMap.get(id) || {}; const runA = Number(base.runCount) || 0; const runB = Number(s.runCount) || 0; const lastA = Number(base.lastRun) || 0; const lastB = Number(s.lastRun) || 0; return Object.assign({}, s, { runCount: Math.max(runA, runB), lastRun: Math.max(lastA, lastB) || undefined }); }); await setSchedules(merged); return merged; })(schedules); }catch(e){}
    await setLastCheck(now);
  });
}

chrome.runtime.onInstalled.addListener(() => { rebuildAlarms({suppressLate:true}); try{ ensureContextMenu(); }catch(e){} });
chrome.runtime.onStartup.addListener(() => { rebuildAlarms({suppressLate:true}); });
ensureContextMenu = function(){
  try{
    chrome.contextMenus.removeAll(() => {
      try{
        chrome.contextMenus.create({ id: 'openwhen_open_link', title: 'OpenWhen this link...', contexts: ['link'] });
        chrome.contextMenus.create({ id: 'openwhen_open_page', title: 'OpenWhen this page...', contexts: ['page'] });
      }catch(e){}
    });
  }catch(e){}
};

ensureContextMenu();

chrome.alarms.onAlarm.addListener(async alarm => {
  if(!alarm || !alarm.name || !alarm.name.startsWith('openwhen_')) return;
  const id = alarm.name.replace('openwhen_', '');
  const schedules = await getSchedules();
  const s = schedules.find(x => String(x.id) === String(id));
  if(!s) return;
  try{
    try{ await updateScheduleAtomic(s.id, prev => { const now = Date.now(); const newCount = (Number(prev.runCount) || 0) + 1; return Object.assign({}, prev, { runCount: newCount, lastRun: now }); }); }catch(e){}
  try{ const _openRes = await openScheduleNow(s, {}); }catch(e){}
    try{ if(s.type === 'once') chrome.alarms.clear(makeAlarmName(s.id)); }catch(e){}
    await setLastCheck(Date.now());
    if(s.type !== 'once'){ if(!(s.stopAfter && Number(s.runCount) >= Number(s.stopAfter))){ const next = computeNextForSchedule(s); if(next) chrome.alarms.create(makeAlarmName(s.id), {when: next}); } }
  }catch(e){}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => { if(msg && msg.type === 'rebuild'){ try{ rebuildAlarms(msg || {}); }catch(e){} sendResponse({ok:true}); } });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if(!info || !info.menuItemId) return;
  if(info.menuItemId === 'openwhen_open_link' || info.menuItemId === 'openwhen_open_page'){
    const linkUrl = info.linkUrl || info.pageUrl || info.selectionText || null; if(!linkUrl) return;
    try{ chrome.storage.local.set({openwhen_prefill_url: linkUrl}, () => { try{ chrome.runtime.openOptionsPage(() => { if(chrome.runtime.lastError) chrome.tabs.create({url: chrome.runtime.getURL('options.html')}); }); }catch(e){ chrome.tabs.create({url: chrome.runtime.getURL('options.html')}); } }); }catch(e){ const tempSchedule = {id: 'ctx_' + Date.now(), url: linkUrl, type: 'once', openIn: 'tab', message: ''}; openScheduleNow(tempSchedule, {late:false, missedCount:0}); }
  }
});

// Map notificationId -> tabId so click events can focus the correct tab
const _notifToTab = new Map();

function _makeNotificationId(schedule){ return `openwhen_notif_${String(schedule.id)}_${Date.now()}_${Math.floor(Math.random()*10000)}`; }

async function openScheduleNow(s, opts){
  // contract:
  // inputs: s = schedule object {id, url, openIn, openInBackground, message}
  // opts: {late, missedCount, missedAt}
  // outputs: {delivered:bool, fallback:bool, tabId: number|null}
  try{
    const url = (s && s.url) || null; if(!url) return {delivered:false, fallback:false, tabId:null};
    // open the URL according to schedule preference
    let createdTab = null;
    if(s.openIn === 'window'){
      await new Promise(res => chrome.windows.create({url, focused: !s.openInBackground}, w => { try{ if(w && w.tabs && w.tabs[0]) createdTab = w.tabs[0]; }catch(e){} res(); }));
    } else {
      // open as tab
      await new Promise(res => chrome.tabs.create({url, active: !s.openInBackground}, t => { createdTab = t; res(); }));
    }

    const tabId = createdTab && createdTab.id ? createdTab.id : null;

    // Helper: inject a persistent toast into the tab (persists until dismissed or the page unloads)
  const _injectToast = async (tabId, scheduleId, messageBody, whenLine, extIconUrl, extName) => {
      if(!tabId) return;
      try{
        const run = (scheduleIdArg, messageBodyArg, whenLineArg, extIconArg, extNameArg) => {
          try{
            const id = `openwhen-toast-${String(scheduleIdArg)}`;
            if(document.getElementById(id)) return;
            const toast = document.createElement('div');
            toast.id = id;
            toast.style.position = 'fixed';
            toast.style.top = '0';
            toast.style.left = '0';
            toast.style.right = '0';
            toast.style.zIndex = '2147483647';
            toast.style.background = 'rgba(89, 15, 111, 0.95)';
            toast.style.color = '#ffffff';
            toast.style.fontFamily = 'sans-serif';
            toast.style.display = 'flex';
            toast.style.alignItems = 'center';
            toast.style.justifyContent = 'space-between';
            toast.style.padding = '10px 14px';
            toast.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';
            toast.style.backdropFilter = 'saturate(120%) blur(2px)';
            toast.style.borderBottom = '1px solid rgba(255,255,255,0.06)';

            // left area: extension icon + name, then content
            const left = document.createElement('div');
            left.style.display = 'flex';
            left.style.alignItems = 'center';
            left.style.gap = '12px';

            const brand = document.createElement('div');
            brand.style.display = 'flex';
            brand.style.alignItems = 'center';
            brand.style.gap = '8px';

            if(extIconArg){
              try{
                const img = document.createElement('img');
                img.src = extIconArg;
                img.alt = extNameArg || '';
                img.style.width = '28px';
                img.style.height = '28px';
                img.style.borderRadius = '4px';
                img.style.flex = '0 0 auto';
                brand.appendChild(img);
              }catch(e){}
            }
            const titleSpan = document.createElement('div');
            titleSpan.style.fontWeight = '700';
            titleSpan.style.fontSize = '14px';
            titleSpan.textContent = extNameArg || 'OpenWhen';
            brand.appendChild(titleSpan);

            const content = document.createElement('div');
            content.style.display = 'flex';
            content.style.flexDirection = 'column';
            content.style.gap = '4px';
            content.style.maxWidth = 'calc(100% - 48px)';

            if(messageBodyArg){
              const reminder = document.createElement('div');
              reminder.style.fontWeight = '600';
              reminder.style.fontSize = '13px';
              reminder.textContent = `Reminder: ${messageBodyArg}`;
              content.appendChild(reminder);
            }

            const when = document.createElement('div');
            when.style.fontSize = '12px';
            when.style.opacity = '0.95';
            when.textContent = whenLineArg || '';
            content.appendChild(when);

            left.appendChild(brand);
            left.appendChild(content);

            const close = document.createElement('button');
            close.textContent = '\u00d7';
            close.setAttribute('aria-label', 'Dismiss OpenWhen reminder');
            close.style.background = 'transparent';
            close.style.border = 'none';
            close.style.color = '#fff';
            close.style.fontSize = '18px';
            close.style.cursor = 'pointer';
            close.style.marginLeft = '12px';
            close.addEventListener('click', () => { try{ toast.remove(); }catch(e){} });

            toast.appendChild(left);
            toast.appendChild(close);
            document.documentElement.appendChild(toast);
          }catch(e){}
        };

        // Wait for tab to be complete then inject by executing the function in page context
        chrome.tabs.get(tabId, t => {
          const doInject = () => {
              try{
              chrome.scripting.executeScript({
                target: { tabId },
                func: run,
                args: [scheduleId, messageBody, whenLine, extIconUrl, extName]
              });
            }catch(e){}
          };
          if(t && t.status === 'complete') return doInject();
          const onUpdated = (updatedTabId, changeInfo) => {
            if(updatedTabId !== tabId) return;
            if(changeInfo && changeInfo.status === 'complete'){
              try{ doInject(); }catch(e){}
              chrome.tabs.onUpdated.removeListener(onUpdated);
            }
          };
          chrome.tabs.onUpdated.addListener(onUpdated);
          // safety timeout: try injecting after a short delay even if tab doesn't report complete
          setTimeout(() => { try{ doInject(); chrome.tabs.onUpdated.removeListener(onUpdated); }catch(e){} }, 8000);
        });
      }catch(e){}
    };

    // build message text
    const messageBody = _buildMessage(s, opts || {});

    // Always create a browser notification that can focus the tab when clicked
    try{
      const notifId = _makeNotificationId(s);
      // ensure mapping exists immediately so clicks on the notification card
      // focus the tab even if the create callback runs slightly later
      try{ if(tabId) _notifToTab.set(notifId, tabId); }catch(e){}
      // try to use the tab's title and favicon to feel more "in-browser"
      let icon = chrome.runtime.getURL('icons/icon128.png');
      let titleText = `Opened by OpenWhen${s && s.source ? ` (${s.source})` : ''}`;
      try{
        if(tabId){
          chrome.tabs.get(tabId, t => {
            try{
              if(t && t.favIconUrl) icon = t.favIconUrl;
              if(t && t.title) titleText = t.title;
            }catch(e){}
            const whenText = (opts && opts.missedAt) ? new Date(opts.missedAt) : (s && s.when ? new Date(s.when) : null);
            let whenLine = whenText ? `Scheduled for: ${whenText.toLocaleString()}` : 'Scheduled for: unknown';
            if(opts && opts.late){ if(opts.missedCount && opts.missedCount > 1) whenLine += ` (missed ${opts.missedCount} occurrences)`; else if(opts.missedCount === 1) whenLine += ' (missed 1 occurrence)'; else whenLine += ' (missed)'; }
            const reminderLine = messageBody ? `Reminder: ${messageBody}` : null;
            const notifOptions = {
              type: 'basic',
              title: titleText,
              message: [reminderLine, whenLine].filter(Boolean).join('\n'),
              iconUrl: icon
            };
            try{ chrome.notifications.create(notifId, notifOptions, nid => { try{ if(tabId) _notifToTab.set(nid, tabId); }catch(e){} }); }catch(e){}
            // If the tab later reports a favIconUrl, update the notification icon to match the page
            try{
              if(tabId){
                // (no-op placeholder removed; using onUpdated listener below)
                // listen for the tab to update with a favIconUrl
                chrome.tabs.onUpdated.addListener((updatedTabId, changeInfo, tabObj) => {
                  if(updatedTabId !== tabId) return;
                  if(changeInfo && changeInfo.favIconUrl){
                      (async () => {
                        try{
                          const resized = await fetchAndResizeIcon(changeInfo.favIconUrl, 32);
                          const useIcon = resized || changeInfo.favIconUrl;
                          try{ chrome.notifications.update(notifId, { iconUrl: useIcon }); }catch(e){}
                        }catch(e){}
                      })();
                      // remove listener via wrapper above
                    } else if(tabObj && tabObj.favIconUrl){
                      (async () => {
                        try{
                          const resized = await fetchAndResizeIcon(tabObj.favIconUrl, 32);
                          const useIcon = resized || tabObj.favIconUrl;
                          try{ chrome.notifications.update(notifId, { iconUrl: useIcon }); }catch(e){}
                        }catch(e){}
                      })();
                    }
                });
                // also attempt immediate update if favIconUrl already present on tab object
                try{ if(t && t.favIconUrl && t.favIconUrl !== icon){ chrome.notifications.update(notifId, { iconUrl: t.favIconUrl }); } }catch(e){}
              }
            }catch(e){}
            // inject a persistent toast inside the tab (notification still appears)
            try{ const manifest = chrome.runtime.getManifest(); const extName = manifest && manifest.name ? manifest.name : 'OpenWhen'; const extIconUrl = chrome.runtime.getURL('icons/icon32.png'); _injectToast(tabId, s.id, messageBody, whenLine, extIconUrl, extName); }catch(e){}
          });
        } else {
          const whenText = (opts && opts.missedAt) ? new Date(opts.missedAt) : (s && s.when ? new Date(s.when) : null);
          let whenLine = whenText ? `Scheduled for: ${whenText.toLocaleString()}` : 'Scheduled for: unknown';
          if(opts && opts.late){ if(opts.missedCount && opts.missedCount > 1) whenLine += ` (missed ${opts.missedCount} occurrences)`; else if(opts.missedCount === 1) whenLine += ' (missed 1 occurrence)'; else whenLine += ' (missed)'; }
          const reminderLine = messageBody ? `Reminder: ${messageBody}` : null;
          const notifOptions = {
            type: 'basic',
            title: titleText,
            message: [reminderLine, whenLine].filter(Boolean).join('\n'),
            iconUrl: icon
          };
          try{ chrome.notifications.create(notifId, notifOptions, nid => { try{ if(tabId) _notifToTab.set(nid, tabId); }catch(e){} }); }catch(e){}
          try{ const manifest = chrome.runtime.getManifest(); const extName = manifest && manifest.name ? manifest.name : 'OpenWhen'; const extIconUrl = chrome.runtime.getURL('icons/icon32.png'); _injectToast(tabId, s.id, messageBody, whenLine, extIconUrl, extName); }catch(e){}
        }
      }catch(e){}
    }catch(e){}

    // Return fallback:true to indicate handled by notification
    return {delivered:false, fallback:true, tabId};
  }catch(e){ return {delivered:false, fallback:true, tabId:null}; }
}

// When a notification is clicked, focus the tab it opened (if still available)
chrome.notifications.onClicked.addListener(async notifId => {
  try{
    const tabId = _notifToTab.get(notifId);
    if(tabId){
      try{ const tab = await new Promise(res => chrome.tabs.get(tabId, res)); if(tab && tab.windowId !== undefined){ chrome.windows.update(tab.windowId, {focused:true}); chrome.tabs.update(tabId, {active:true}); } }
      catch(e){}
    }
    // clear notification
    try{ chrome.notifications.clear(notifId); }catch(e){}
  }catch(e){}
});

// handle notification button clicks (Focus / Dismiss)
// (Notification buttons removed; clicking the notification card focuses the tab.)

