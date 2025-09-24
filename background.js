// background service worker for openwhen
// manages schedules, alarms, and opens tabs/windows when alarms fire

const SCHEDULES_KEY = 'schedules';
const LAST_CHECK_KEY = 'last_check';

function log(...args){
  // keep logs small
  console.log('[openwhen]', ...args);
}

// ensure our context menu exists (safe to call multiple times)
function ensureContextMenu(){
  try{
    console.log('[openwhen] ensureContextMenu: creating context menu (remove old items first)');

    // Remove any existing items with these ids to avoid duplicate-id errors,
    // then create fresh items. remove() callbacks run whether or not the id existed.
    chrome.contextMenus.remove('openwhen_open_link', () => {
      // acknowledge benign error when item does not exist yet
      if(chrome.runtime.lastError){
        // expected if the item didn't exist; log at debug level
        console.debug('[openwhen] remove open_link warning:', chrome.runtime.lastError.message);
      }
      // Try creating with icons first, fall back to without icons on error
      try{
        chrome.contextMenus.create({
          id: 'openwhen_open_link',
          title: 'OpenWhen this link...',
          contexts: ['link'],
          icons: {"16": "icons/icon16.png","32": "icons/icon32.png","48": "icons/icon48.png"}
        });
        console.log('[openwhen] ensureContextMenu: created open_link with icons');
      }catch(errIcons){
        console.warn('[openwhen] ensureContextMenu: creating open_link with icons failed, trying without icons', errIcons && errIcons.message);
        try{
          chrome.contextMenus.create({ id: 'openwhen_open_link', title: 'OpenWhen this link...', contexts: ['link'] });
          console.log('[openwhen] ensureContextMenu: created open_link without icons');
        }catch(errPlain){
          console.error('[openwhen] ensureContextMenu: failed to create open_link', errPlain && errPlain.message);
        }
      }
    });

    // Also remove/create the page fallback item
    chrome.contextMenus.remove('openwhen_open_page', () => {
      if(chrome.runtime.lastError){
        console.debug('[openwhen] remove open_page warning:', chrome.runtime.lastError.message);
      }
      try{
        chrome.contextMenus.create({ id: 'openwhen_open_page', title: 'OpenWhen this link...', contexts: ['page'], icons: {"16": "icons/icon16.png","32": "icons/icon32.png"} });
        console.log('[openwhen] ensureContextMenu: created open_page with icons');
      }catch(e){
        try{
          chrome.contextMenus.create({ id: 'openwhen_open_page', title: 'OpenWhen this link...', contexts: ['page'] });
          console.log('[openwhen] ensureContextMenu: created open_page without icons');
        }catch(err){
          // ignore
        }
      }
    });
  }catch(e){/* ignore */}
}

async function getSchedules(){
  return new Promise(resolve => {
    chrome.storage.local.get([SCHEDULES_KEY], res => {
      resolve(res[SCHEDULES_KEY] || []);
    });
  });
}

// Single-writer queue to serialize writes to `schedules` and avoid storage races.
const _writeQueue = [];
let _writeProcessing = false;

function _enqueueWrite(schedules){
  return new Promise((resolve, reject) => {
    _writeQueue.push({schedules, resolve, reject});
    if(!_writeProcessing) _processWriteQueue();
  });
}

function _processWriteQueue(){
  if(_writeProcessing) return;
  _writeProcessing = true;
  (async function loop(){
    while(_writeQueue.length){
      const job = _writeQueue.shift();
      // atomic per-schedule update: perform read-modify-write inside the queue
      if(job && job.atomic){
        await new Promise(res => {
          chrome.storage.local.get([SCHEDULES_KEY], resCur => {
            const stored = resCur && resCur[SCHEDULES_KEY] ? resCur[SCHEDULES_KEY] : [];
            const found = (stored || []).find(x => String(x.id) === String(job.id));
            if(!found){
              try{ job.resolve(null); }catch(e){}
              return res();
            }
            let updated;
            try{ updated = typeof job.updater === 'function' ? job.updater(Object.assign({}, found)) : Object.assign({}, found, job.updater || {}); }catch(e){ updated = Object.assign({}, found); }
            updated.runCount = Number(updated.runCount) || 0;
            if(updated.lastRun === undefined) delete updated.lastRun;
            const merged = (stored || []).map(x => String(x.id) === String(job.id) ? updated : x);
            const obj = {}; obj[SCHEDULES_KEY] = merged;
            function afterSet(){
              if(chrome.runtime.lastError) console.error('[openwhen] setSchedules error', chrome.runtime.lastError && chrome.runtime.lastError.message);
              else {
                try{
                  chrome.runtime.sendMessage({type:'schedules_updated', schedules: merged}, () => {
                    if(chrome.runtime.lastError){
                      const m = String(chrome.runtime.lastError.message || '');
                      if(/message port closed|Receiving end does not exist|Could not establish connection|No receiver/i.test(m)){
                        // benign: no listener present
                      } else {
                        console.warn('[openwhen] sendMessage error', m);
                      }
                    }
                  });
                }catch(e){}
              }
              try{ job.resolve(updated); }catch(e){}
              res();
            }
            chrome.storage.local.set(obj, afterSet);
          });
        });
        continue;
      }
      const schedules = job.schedules;
      const obj = {};
      obj[SCHEDULES_KEY] = schedules;

      // create a promise that resolves when set is complete (or skipped due to safety guard)
      await new Promise(res => {
        function afterSet(){
          if(chrome.runtime.lastError){
            console.error('[openwhen] setSchedules error', chrome.runtime.lastError && chrome.runtime.lastError.message);
          } else {
            try{
              chrome.runtime.sendMessage({type:'schedules_updated', schedules}, () => {
                if(chrome.runtime.lastError){
                  const m = String(chrome.runtime.lastError.message || '');
                  if(/message port closed|Receiving end does not exist|Could not establish connection|No receiver/i.test(m)){
                    // benign: no listener present
                  } else {
                    console.warn('[openwhen] sendMessage error', m);
                  }
                }
              });
            }catch(e){}
          }
          res();
        }

        // if empty array and storage currently has schedules, skip writing to avoid data loss
        if(Array.isArray(schedules) && schedules.length === 0){
          try{
            chrome.storage.local.get([SCHEDULES_KEY], resCur => {
              const cur = resCur && resCur[SCHEDULES_KEY] ? resCur[SCHEDULES_KEY] : [];
              if(cur && cur.length > 0){
                console.warn('[openwhen] queued setSchedules called with empty array but storage has existing schedules; skipping write to avoid data loss');
                return res();
              }
              chrome.storage.local.set(obj, afterSet);
            });
          }catch(e){ console.warn('[openwhen] error during empty-array safety check', e); chrome.storage.local.set(obj, afterSet); }
        } else {
          chrome.storage.local.set(obj, afterSet);
        }
      });
      try{ job.resolve(); }catch(e){/* ignore */}
    }
    _writeProcessing = false;
  })();
}

async function setSchedules(schedules){
  // keep API promise semantics; writes are serialized by the queue
  return _enqueueWrite(schedules);
}

function makeAlarmName(id){
  return `openwhen_${id}`;
}

function computeNextForSchedule(s){
  const now = new Date();
  if(s.type === 'once'){
    const t = new Date(s.when).getTime();
    return t > now.getTime() ? t : null;
  }
  // recurring: daily or weekly
  const [hour, minute] = (s.time || '00:00').split(':').map(Number);
  if(s.type === 'daily'){
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if(next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  if(s.type === 'weekly'){
    // s.days is array of numbers 0-6 (0 sunday)
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
    // s.day is day of month (1-31)
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
      // move to next month
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1, 1); // set to first of next month
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
}

function occurrencesBetween(s, startTs, endTs, cap=365){
  // return array of timestamps for occurrences > startTs and <= endTs
  const out = [];
  const start = new Date(startTs);
  const end = new Date(endTs);
  if(s.type === 'once'){
    const t = new Date(s.when).getTime();
    if(t > startTs && t <= endTs) out.push(t);
    return out;
  }
  if(s.type === 'monthly'){
    const day = Number(s.day);
    if(!day || day < 1) return out;
    const [hour, minute] = (s.time || '00:00').split(':').map(Number);
    // start from start date's month and iterate month by month
    let cand = new Date(start);
    cand.setDate(1);
    cand.setHours(0,0,0,0);
    let i = 0;
    while(cand.getTime() <= end.getTime() && i < cap){
      const y = cand.getFullYear();
      const m = cand.getMonth();
      const dim = new Date(y, m + 1, 0).getDate();
      const useDay = Math.min(day, dim);
      const occ = new Date(y, m, useDay, hour, minute, 0, 0);
      if(occ.getTime() > startTs && occ.getTime() <= endTs) out.push(occ.getTime());
      cand.setMonth(cand.getMonth() + 1);
      i++;
    }
    return out;
  }
  if(s.type === 'daily'){
    const [hour, minute] = (s.time || '00:00').split(':').map(Number);
    let cand = new Date(start);
    cand.setHours(hour, minute, 0, 0);
    if(cand.getTime() <= startTs) cand.setDate(cand.getDate() + 1);
    let i = 0;
    while(cand.getTime() <= end.getTime() && i < cap){
      out.push(cand.getTime());
      cand.setDate(cand.getDate() + 1);
      i++;
    }
    return out;
  }
  if(s.type === 'weekly'){
    if(!Array.isArray(s.days) || s.days.length === 0) return out;
    const [hour, minute] = (s.time || '00:00').split(':').map(Number);
    // start from the day of start and iterate day by day until end
    let cand = new Date(start);
    // normalize to beginning of day
    cand.setHours(0,0,0,0);
    let i = 0;
    while(cand.getTime() <= end.getTime() && i < cap){
      const dow = cand.getDay();
      if(s.days.includes(dow)){
        const occ = new Date(cand);
        occ.setHours(hour, minute, 0, 0);
        if(occ.getTime() > startTs && occ.getTime() <= endTs) out.push(occ.getTime());
      }
      cand.setDate(cand.getDate() + 1);
      i++;
    }
    return out;
  }
  return out;
}

async function getLastCheck(){
  return new Promise(resolve => chrome.storage.local.get([LAST_CHECK_KEY], res => resolve(res[LAST_CHECK_KEY] || null)));
}
async function setLastCheck(ts){
  return new Promise(resolve => { const o = {}; o[LAST_CHECK_KEY] = ts; chrome.storage.local.set(o, () => {
    if(chrome.runtime.lastError) console.warn('[openwhen] setLastCheck error', chrome.runtime.lastError && chrome.runtime.lastError.message);
    else console.log('[openwhen] setLastCheck', ts);
    resolve();
  }); });
}

async function openScheduleNow(s, opts={late:false, missedCount:0}){
  try{
    if(s.openIn === 'window'){
      const createOpts = {url: s.url};
      // if schedule requests background open, do not focus the window
      if(typeof s.openInBackground !== 'undefined') createOpts.focused = !s.openInBackground;
      const win = await new Promise(resolve => chrome.windows.create(createOpts, win => resolve(win)));
        if(win && win.tabs && win.tabs[0]){
          const res = await sendMessageToTabWhenReady(win.tabs[0].id, {type:'openwhen_opened', source: opts.late ? 'late' : (s.type === 'once' ? 'once' : 'scheduled'), message: buildMessage(s, opts), late: !!opts.late, missedCount: opts.missedCount || 0, scheduleId: s.id});
          console.log('[openwhen] openScheduleNow result (window):', res);
          return res;
        }
        return {delivered:false, fallback:false};
    } else {
      const createOpts = {url: s.url, active: !(s.openInBackground === true)};
      const tab = await new Promise(resolve => chrome.tabs.create(createOpts, tab => resolve(tab)));
      if(tab && tab.id){
        const res = await sendMessageToTabWhenReady(tab.id, {type:'openwhen_opened', source: opts.late ? 'late' : (s.type === 'once' ? 'once' : 'scheduled'), message: buildMessage(s, opts), late: !!opts.late, missedCount: opts.missedCount || 0, scheduleId: s.id});
        console.log('[openwhen] openScheduleNow result (tab):', res);
        return res;
      }
      return {delivered:false, fallback:false};
    }
  } catch(e){
    console.error('failed open', e);
    return {delivered:false, fallback:false};
  }
}

// atomically update a single schedule by id: enqueue an atomic job so read-modify-write
// happens inside the single-writer queue to avoid races.
function updateScheduleAtomic(id, updater){
  return new Promise((resolve, reject) => {
    try{
      _writeQueue.push({atomic:true, id, updater, resolve, reject});
      if(!_writeProcessing) _processWriteQueue();
    }catch(e){ console.warn('[openwhen] updateScheduleAtomic enqueue failed', e); resolve(null); }
  });
}


// helper: send a message to a tab after it reaches 'complete' status or after a timeout
function sendMessageToTabWhenReady(tabId, message, timeoutMs = 10000){
  return new Promise(resolve => {
    if(!tabId) return resolve({delivered:false, fallback:false});
    // fallback notification helper
    function showNotification(title, msg, durationMs = 8000){
      try{
        // don't create a platform notification to avoid image-download errors in some environments
        console.log('[openwhen] fallback notification:', title, msg);
        // we intentionally avoid chrome.notifications.create here because some platforms
        // attempt to download icons and can spam the console with image errors. This
        // fallback still counts as a successful delivery for our purposes.
      }catch(e){/* ignore */}
    }

  let sent = false;
  let settled = false;
  let delivered = false;

    const trySend = () => {
      try{
        chrome.tabs.sendMessage(tabId, message, resp => {
          const lastErr = chrome.runtime.lastError;
          if(!lastErr){
            sent = true;
            delivered = true;
            if(!settled){ settled = true; console.log('[openwhen] message delivered to tab', tabId); resolve({delivered:true, fallback:false}); }
          } else {
            // read/acknowledge benign runtime error to avoid unchecked runtime.lastError warning
            const msg = String(lastErr && lastErr.message || '');
            if(/Could not establish connection|Receiving end does not exist|No receiver/i.test(msg)){
              // expected when content script not present
            } else {
              console.warn('[openwhen] tabs.sendMessage error', msg);
            }
          }
        });
      }catch(e){
        // ignore
      }
    };

    chrome.tabs.get(tabId, tab => {
      const doFallback = () => {
        if(!sent){
    const title = `opened by OpenWhen${message && message.source ? ` (${message.source})` : ''}`;
          const msg = message && message.message ? message.message : '';
          showNotification(title, msg);
        }
  if(!settled){ settled = true; console.log('[openwhen] fallback used for tab', tabId); resolve({delivered:false, fallback:true}); }
      };

      if(tab && tab.status === 'complete'){
        trySend();
        // small grace window to let sendMessage callback run; if not delivered, fallback
        setTimeout(() => { if(!sent) doFallback(); }, 500);
        return;
      }

      const onUpdated = (updatedTabId, changeInfo) => {
        if(updatedTabId !== tabId) return;
        if(changeInfo && changeInfo.status === 'complete'){
          trySend();
          chrome.tabs.onUpdated.removeListener(onUpdated);
          settled = true;
          // allow callback to set `sent`; fallback if not delivered shortly
          setTimeout(() => { if(!sent) doFallback(); }, 500);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);

      // overall timeout fallback
      setTimeout(() => {
        if(!sent) doFallback();
        if(!settled) chrome.tabs.onUpdated.removeListener(onUpdated);
      }, timeoutMs);
    });
  });
}

function buildMessage(s, opts){
  const base = s.message || '';
  if(opts && opts.late){
    if(opts.missedCount && opts.missedCount > 1) return (`late — missed ${opts.missedCount} occurrences. ${base}`).trim();
    if(opts.missedCount === 1) return (`late — missed 1 occurrence. ${base}`).trim();
    return (`late — missed scheduled time. ${base}`).trim();
  }
  return base;
}

async function rebuildAlarms(opts = {}){
  log('rebuilding alarms');
  const schedules = await getSchedules();
  const lastCheck = await getLastCheck();
  const now = Date.now();
  // helper: merge with storage to avoid overwriting newer runCount/lastRun when persisting
  async function persistMerged(localSchedules){
    try{
      const stored = await getSchedules();
      const storedMap = new Map((stored || []).map(x => [String(x.id), x]));
      const merged = (localSchedules || []).map(s => {
        const id = String(s.id);
        const base = storedMap.get(id) || {};
        const runA = Number(base.runCount) || 0;
        const runB = Number(s.runCount) || 0;
        const lastA = Number(base.lastRun) || 0;
        const lastB = Number(s.lastRun) || 0;
        return Object.assign({}, s, {
          runCount: Math.max(runA, runB),
          lastRun: Math.max(lastA, lastB) || undefined
        });
      });
      await setSchedules(merged);
      return merged;
    }catch(e){ console.warn('[openwhen] persistMerged failed', e); await setSchedules(localSchedules); return localSchedules; }
  }
  // clear existing openwhen_ alarms
  chrome.alarms.getAll(async alms => {
    alms.forEach(a => { if(a.name && a.name.startsWith('openwhen_')) chrome.alarms.clear(a.name); });

  // detect missed occurrences between lastCheck and now
  const windowStart = lastCheck || (now - (1000 * 60 * 60 * 24)); // if no lastCheck, look back 24h
    // iterate backwards so we can remove 'once' schedules safely
    for(let i = schedules.length - 1; i >= 0; i--){
      const s = schedules[i];
      const missed = occurrencesBetween(s, windowStart, now);
      if(missed.length > 0){
        // open a single late tab/window representing missed occurrences (do not open multiple tabs)
        if(!opts.suppressLate){
          const res = await openScheduleNow(s, {late:true, missedCount: missed.length});
          if(res && (res.delivered === true || res.fallback === true)){
          // record last run time and increment runCount for missed occurrences using atomic updater
          try{
            const updated = await updateScheduleAtomic(s.id, prev => {
              const now = Date.now();
              const newCount = (Number(prev.runCount) || 0) + missed.length;
              return Object.assign({}, prev, { runCount: newCount, lastRun: now });
            });
            if(!updated) console.warn('[openwhen] failed to persist missed runs for', s.id);
          }catch(e){ console.warn('[openwhen] failed to persist missed runs for', s.id, e); }
          try{ chrome.alarms.clear(makeAlarmName(s.id)); }catch(e){}
          await setLastCheck(Date.now());
        }
        } else {
          // if suppressLate is true, we won't open missed occurrences; just skip opening
          // but still allow scheduling next occurrences below
        }
        // if stopAfter is reached, mark as expired (do not remove; UI will gray it out)
        if(s.stopAfter && Number(s.runCount) >= Number(s.stopAfter)){
          log('schedule expired (stopAfter reached)', s.id);
          // do not schedule next occurrence for expired schedules
          continue;
        }
        log('opened late for', s.id, 'missed', missed.length);
        // if it's a once schedule, mark it as run (do not remove)
        if(s.type === 'once'){
          // ensure lastRun/runCount are set (missed.length already added)
          // leave schedule in storage so UI can show it as expired
          continue;
        }
      }

      // create alarm for next occurrence (only for schedules still present and not expired)
      if(s.stopAfter && Number(s.runCount) >= Number(s.stopAfter)) continue;
      const next = computeNextForSchedule(s);
      if(next){
        chrome.alarms.create(makeAlarmName(s.id), {when: next});
        log('alarm set', s.id, new Date(next).toString());
      }
    }
    // persist any remaining changes (merge with storage to avoid clobbering atomic per-item updates)
    try{
      await persistMerged(schedules);
    }catch(e){ console.warn('[openwhen] final persistMerged failed', e); }
    await setLastCheck(now);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  log('installed');
  // on install/update, do not open missed occurrences immediately — just rebuild alarms
  rebuildAlarms({suppressLate:true});
  // ensure context menu exists
  ensureContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  log('startup');
  // on browser startup, avoid opening missed occurrences during worker reload
  rebuildAlarms({suppressLate:true});
  ensureContextMenu();
});

// create the context menu once when the worker evaluates (safe no-op if already created)
ensureContextMenu();

chrome.alarms.onAlarm.addListener(async alarm => {
  if(!alarm || !alarm.name) return;
  if(!alarm.name.startsWith('openwhen_')) return;
  const id = alarm.name.replace('openwhen_', '');
  log('alarm fired for', id);
  const schedules = await getSchedules();
  console.log('[openwhen] alarm handler read schedules, count=', (schedules||[]).length, 'ids=', (schedules||[]).map(x => x.id));
  console.log('[openwhen] writeQueue length=', _writeQueue.length, 'processing=', _writeProcessing);
  const s = schedules.find(x => String(x.id) === String(id));
  if(!s){
    console.warn('[openwhen] alarm handler: schedule not found in storage for id', id, 'available ids=', (schedules||[]).map(x => x.id));
    return;
  }

  // open the url and wait for the content script delivery/fallback so we can record lastRun accurately
  try{
  // atomically record a run first so the UI reflects the attempt even if opening fails
    let updated = null;
    try{
      updated = await updateScheduleAtomic(s.id, prev => {
        const now = Date.now();
        const newCount = (Number(prev.runCount) || 0) + 1;
        return Object.assign({}, prev, { runCount: newCount, lastRun: now });
      });
      if(updated){
        console.log('[openwhen] run recorded for', s.id, 'runCount', updated.runCount);
      } else {
        console.warn('[openwhen] failed to persist run for', s.id);
      }
    }catch(e){ console.warn('[openwhen] atomic persist failed', e); }

    // attempt to open after recording the run
    try{
      const openRes = await openScheduleNow(s, {});
      console.log('[openwhen] alarm open result for', s.id, openRes && (openRes.delivered ? 'delivered' : 'fallback'));
    }catch(e){ console.warn('[openwhen] openScheduleNow threw', e); }
    // clear alarm for once schedules
    try{ if(s.type === 'once') chrome.alarms.clear(makeAlarmName(s.id)); }catch(e){}
    await setLastCheck(Date.now());
    // schedule next for recurring
    if(s.type !== 'once'){
      if(s.stopAfter && Number(s.runCount) >= Number(s.stopAfter)){
        log('schedule expired (stopAfter reached)', s.id);
        return;
      }
      const next = computeNextForSchedule(s);
      if(next){
        chrome.alarms.create(makeAlarmName(s.id), {when: next});
        log('next for', s.id, new Date(next).toString());
      }
    }
  } catch(e){
    console.error('failed open handling', e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if(msg && msg.type === 'rebuild'){
    // allow callers to request suppression of late opens by passing suppressLate:true
    try{ rebuildAlarms(msg || {}); }catch(e){ /* ignore */ }
    sendResponse({ok:true});
  }
});

// context menu click handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if(!info || !info.menuItemId) return;
  if(info.menuItemId === 'openwhen_open_link' || info.menuItemId === 'openwhen_open_page'){
    // prefer a clicked link URL, fall back to the page URL if not available
    const linkUrl = info.linkUrl || info.pageUrl || info.selectionText || null;
    if(!linkUrl) return;
    // open the options page and prefill the URL there instead of opening the link directly
    try{
      chrome.storage.local.set({openwhen_prefill_url: linkUrl}, () => {
        // use callback form to avoid unhandled promise rejections on some platforms
        try{
          chrome.runtime.openOptionsPage(() => {
            if(chrome.runtime.lastError){
              try{ chrome.tabs.create({url: chrome.runtime.getURL('options.html')}, () => {}); }catch(e){}
            }
          });
        }catch(e){
          try{ chrome.tabs.create({url: chrome.runtime.getURL('options.html')}, () => {}); }catch(e){}
        }
      });
    }catch(e){
      // fallback to direct open if storage/openOptionsPage fails
      const tempSchedule = {id: 'ctx_' + Date.now(), url: linkUrl, type: 'once', openIn: 'tab', message: ''};
      openScheduleNow(tempSchedule, {late:false, missedCount:0});
    }
  }
});
