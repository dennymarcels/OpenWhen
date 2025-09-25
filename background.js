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

chrome.runtime.onInstalled.addListener(() => { rebuildAlarms({suppressLate:true}); try{ chrome.contextMenus.create({ id: 'openwhen_open_link', title: 'OpenWhen this link...', contexts: ['link'] }); chrome.contextMenus.create({ id: 'openwhen_open_page', title: 'OpenWhen this page...', contexts: ['page'] }); }catch(e){} });
chrome.runtime.onStartup.addListener(() => { rebuildAlarms({suppressLate:true}); });
ensureContextMenu = function(){ try{ chrome.contextMenus.create({ id: 'openwhen_open_link', title: 'OpenWhen this link...', contexts: ['link'] }); chrome.contextMenus.create({ id: 'openwhen_open_page', title: 'OpenWhen this page...', contexts: ['page'] }); }catch(e){} };
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
