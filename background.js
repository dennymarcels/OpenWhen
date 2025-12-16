const SCHEDULES_KEY = 'schedules';
const LAST_CHECK_KEY = 'last_check';

try {
  self.addEventListener &&
    self.addEventListener('unhandledrejection', (ev) => {
      try {
        try {
          ev.preventDefault && ev.preventDefault();
        } catch (e) {}
      } catch (e) {}
    });
} catch (e) {}

async function getSchedules() {
  return new Promise((resolve) =>
    chrome.storage.local.get([SCHEDULES_KEY], (res) =>
      resolve(res[SCHEDULES_KEY] || [])
    )
  );
}

const _writeQueue = [];
let _writeProcessing = false;

function _enqueueWrite(schedules) {
  return new Promise((resolve) => {
    _writeQueue.push({ schedules, resolve });
    if (!_writeProcessing) _processWriteQueue();
  });
}

function _processWriteQueue() {
  if (_writeProcessing) return;
  _writeProcessing = true;
  (async () => {
    while (_writeQueue.length) {
      const job = _writeQueue.shift();
      if (job && job.atomic) {
        await new Promise((res) => {
          chrome.storage.local.get([SCHEDULES_KEY], (cur) => {
            const stored = (cur && cur[SCHEDULES_KEY]) || [];
            const found = stored.find((x) => String(x.id) === String(job.id));
            if (!found) {
              try {
                job.resolve && job.resolve(null);
              } catch (e) {}
              return res();
            }
            let updated;
            try {
              updated =
                typeof job.updater === 'function'
                  ? job.updater(Object.assign({}, found))
                  : Object.assign({}, found, job.updater || {});
            } catch (e) {
              updated = Object.assign({}, found);
            }
            updated.runCount = Number(updated.runCount) || 0;
            if (updated.lastRun === undefined) delete updated.lastRun;
            const merged = stored.map((x) =>
              String(x.id) === String(job.id) ? updated : x
            );
            const obj = {};
            obj[SCHEDULES_KEY] = merged;
            chrome.storage.local.set(obj, () => {
              try {
                job.resolve && job.resolve(updated);
              } catch (e) {}
              res();
            });
          });
        });
        continue;
      }
      const schedules = job.schedules;
      const obj = {};
      obj[SCHEDULES_KEY] = schedules;
      await new Promise((res) => {
        if (Array.isArray(schedules) && schedules.length === 0) {
          chrome.storage.local.get([SCHEDULES_KEY], (cur) => {
            const curList = (cur && cur[SCHEDULES_KEY]) || [];
            if (curList && curList.length > 0) return res();
            chrome.storage.local.set(obj, res);
          });
        } else {
          chrome.storage.local.set(obj, res);
        }
      });
      try {
        job.resolve && job.resolve();
      } catch (e) {}
    }
    _writeProcessing = false;
  })();
}

async function setSchedules(schedules) {
  return _enqueueWrite(schedules);
}

function makeAlarmName(id) {
  return `openwhen_${id}`;
}

function computeNextForSchedule(s) {
  const now = new Date();
  if (s.type === 'once') {
    const t = new Date(s.when).getTime();
    return t > now.getTime() ? t : null;
  }
  const [hour, minute] = (s.time || '00:00').split(':').map(Number);
  if (s.type === 'daily') {
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  if (s.type === 'weekly') {
    if (!Array.isArray(s.days) || s.days.length === 0) return null;
    const candidates = s.days.map((d) => {
      const candidate = new Date(now);
      const currentDow = candidate.getDay();
      let delta = (d - currentDow + 7) % 7;
      candidate.setDate(candidate.getDate() + delta);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() <= now.getTime())
        candidate.setDate(candidate.getDate() + 7);
      return candidate.getTime();
    });
    return Math.min(...candidates);
  }
  if (s.type === 'monthly') {
    const day = Number(s.day);
    if (!day || day < 1) return null;
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const useDay = Math.min(day, daysInMonth);
    const next = new Date(now);
    next.setDate(useDay);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) {
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
}

function occurrencesBetween(s, startTs, endTs, cap = 365) {
  const out = [];
  const start = new Date(startTs);
  const end = new Date(endTs);
  if (s.type === 'once') {
    const t = new Date(s.when).getTime();
    if (t > startTs && t <= endTs) out.push(t);
    return out;
  }
  if (s.type === 'monthly') {
    const day = Number(s.day);
    if (!day || day < 1) return out;
    const [hour, minute] = (s.time || '00:00').split(':').map(Number);
    let cand = new Date(start);
    cand.setDate(1);
    cand.setHours(0, 0, 0, 0);
    let i = 0;
    while (cand.getTime() <= end.getTime() && i < cap) {
      const y = cand.getFullYear(),
        m = cand.getMonth();
      const dim = new Date(y, m + 1, 0).getDate();
      const useDay = Math.min(day, dim);
      const occ = new Date(y, m, useDay, hour, minute, 0, 0);
      if (occ.getTime() > startTs && occ.getTime() <= endTs)
        out.push(occ.getTime());
      cand.setMonth(cand.getMonth() + 1);
      i++;
    }
    return out;
  }
  if (s.type === 'daily') {
    const [hour, minute] = (s.time || '00:00').split(':').map(Number);
    let cand = new Date(start);
    cand.setHours(hour, minute, 0, 0);
    if (cand.getTime() <= startTs) cand.setDate(cand.getDate() + 1);
    let i = 0;
    while (cand.getTime() <= end.getTime() && i < cap) {
      out.push(cand.getTime());
      cand.setDate(cand.getDate() + 1);
      i++;
    }
    return out;
  }
  if (s.type === 'weekly') {
    if (!Array.isArray(s.days) || s.days.length === 0) return out;
    const [hour, minute] = (s.time || '00:00').split(':').map(Number);
    let cand = new Date(start);
    cand.setHours(0, 0, 0, 0);
    let i = 0;
    while (cand.getTime() <= end.getTime() && i < cap) {
      const dow = cand.getDay();
      if (s.days.includes(dow)) {
        const occ = new Date(cand);
        occ.setHours(hour, minute, 0, 0);
        if (occ.getTime() > startTs && occ.getTime() <= endTs)
          out.push(occ.getTime());
      }
      cand.setDate(cand.getDate() + 1);
      i++;
    }
    return out;
  }
  return out;
}

// Try to fetch a favicon URL and resize it to a small PNG data URL (returns null on failure)
async function fetchAndResizeIcon(url, size = 32) {
  try {
    if (!url) return null;
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp || !resp.ok) return null;
    const blob = await resp.blob();
    if (
      typeof createImageBitmap !== 'function' ||
      typeof OffscreenCanvas === 'undefined'
    )
      return null;
    const imgBitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sw = imgBitmap.width || size;
    const sh = imgBitmap.height || size;
    const ratio = Math.min(size / sw, size / sh);
    const dw = Math.round(sw * ratio);
    const dh = Math.round(sh * ratio);
    const dx = Math.round((size - dw) / 2);
    const dy = Math.round((size - dh) / 2);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(imgBitmap, dx, dy, dw, dh);
    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    return await new Promise((res) => {
      try {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(outBlob);
      } catch (e) {
        res(null);
      }
    });
  } catch (e) {
    return null;
  }
}

async function getLastCheck() {
  return new Promise((resolve) =>
    chrome.storage.local.get([LAST_CHECK_KEY], (res) =>
      resolve(res[LAST_CHECK_KEY] || null)
    )
  );
}
async function setLastCheck(ts) {
  return new Promise((resolve) => {
    const o = {};
    o[LAST_CHECK_KEY] = ts;
    chrome.storage.local.set(o, resolve);
  });
}

function updateScheduleAtomic(id, updater) {
  return new Promise((resolve) => {
    try {
      _writeQueue.push({ atomic: true, id, updater, resolve });
      if (!_writeProcessing) _processWriteQueue();
    } catch (e) {
      resolve(null);
    }
  });
}

function _sendMessageToTabWhenReady(tabId, message, timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (!tabId) return resolve({ delivered: false, fallback: false });
    let sent = false,
      settled = false;
    const trySend = () => {
      try {
        chrome.tabs.sendMessage(tabId, message, () => {
          const lastErr = chrome.runtime.lastError;
          if (!lastErr) {
            sent = true;
            if (!settled) {
              settled = true;
              resolve({ delivered: true, fallback: false });
            }
          }
        });
      } catch (e) {}
    };
    chrome.tabs.get(tabId, (tab) => {
      const doFallback = () => {
        if (!sent) {
          const _title = `opened by OpenWhen${
            message && message.source ? ` (${message.source})` : ''
          }`; /* fallback: log */
        }
        if (!settled) {
          settled = true;
          resolve({ delivered: false, fallback: true });
        }
      };
      if (tab && tab.status === 'complete') {
        trySend();
        setTimeout(() => {
          if (!sent) doFallback();
        }, 500);
        return;
      }
      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId) return;
        if (changeInfo && changeInfo.status === 'complete') {
          trySend();
          chrome.tabs.onUpdated.removeListener(onUpdated);
          settled = true;
          setTimeout(() => {
            if (!sent) doFallback();
          }, 500);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => {
        if (!sent) doFallback();
        if (!settled) chrome.tabs.onUpdated.removeListener(onUpdated);
      }, timeoutMs);
    });
  });
}

function _buildMessage(s) {
  try {
    const value = s && typeof s.message === 'string' ? s.message.trim() : '';
    if (value) return value;
  } catch (e) {}
  if (s && s.url) return s.url;
  const manifest = chrome.runtime.getManifest && chrome.runtime.getManifest();
  if (manifest && manifest.name) return manifest.name;
  return 'OpenWhen reminder';
}

function _describeSchedule(s) {
  try {
    if (!s) return '';
    const parts = [];
    const typeMap = {
      once: 'once',
      daily: 'daily',
      weekly: 'weekly',
      monthly: 'monthly',
    };
    if (s.type && typeMap[s.type]) parts.push(typeMap[s.type]);
    if (s.openIn === 'window') parts.push('new window');
    else parts.push('new tab');
    if (s.openInBackground) parts.push('background');
    else parts.push('focus');
    return parts.join(', ');
  } catch (e) {
    return '';
  }
}

function _resolveWhenDate(s, opts) {
  try {
    if (opts && opts.late) {
      if (typeof opts.missedAt !== 'undefined' && opts.missedAt !== null) {
        const mv = Number(opts.missedAt);
        if (!Number.isNaN(mv) && mv > 0) return new Date(mv);
        const parsed = Date.parse(String(opts.missedAt));
        if (!Number.isNaN(parsed)) return new Date(parsed);
      }
    }
  } catch (e) {}
  return _computeWhenDate(s, opts);
}

function _formatScheduleDetails(schedule) {
  try {
    if (!schedule || !schedule.type) return '';
    if (schedule.type === 'once') return '[once]';
    if (schedule.type === 'daily') {
      const time = schedule.time || '00:00';
      return `[daily @ ${time}]`;
    }
    if (schedule.type === 'weekly') {
      const time = schedule.time || '00:00';
      const days = schedule.days || [];
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const dayStr = days.map((d) => dayNames[d] || '?').join(',');
      return `[weekly @ ${dayStr} ${time}]`;
    }
    if (schedule.type === 'monthly') {
      const time = schedule.time || '00:00';
      const day = schedule.day || 1;
      const suffix =
        day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
      return `[monthly @ ${day}${suffix} ${time}]`;
    }
    return '';
  } catch (e) {
    return '';
  }
}

function _buildDisplayContent(schedule, whenDate, opts) {
  const message = _buildMessage(schedule);
  const descriptor = _describeSchedule(schedule);
  const headline = message || descriptor || 'OpenWhen';
  const hasMessage = !!(
    schedule &&
    typeof schedule.message === 'string' &&
    schedule.message.trim()
  );
  const scheduleDetails = _formatScheduleDetails(schedule);
  const whenLine = whenDate
    ? `scheduled for: ${_formatDateShort(whenDate)} ${scheduleDetails}`
    : `scheduled for: unknown ${scheduleDetails}`;
  let lateInline = null;
  if (opts && opts.late) {
    const rawMissed = Number(opts.missedCount);
    const missed =
      Number.isFinite(rawMissed) && rawMissed > 0 ? Math.floor(rawMissed) : 1;
    const plural = missed === 1 ? 'time' : 'times';
    lateInline = `late! (missed ${missed} ${plural})`;
  }
  return { headline, whenLine, lateInline, hasMessage };
}

// Safely compute a Date object for display from opts.missedAt or schedule.when
function _computeWhenDate(s, opts) {
  try {
    // Only consider an explicit scheduledAt (when this event was scheduled) or the schedule.when
    if (
      opts &&
      typeof opts.scheduledAt !== 'undefined' &&
      opts.scheduledAt !== null
    ) {
      const v0 = Number(opts.scheduledAt);
      if (!Number.isNaN(v0) && v0 > 0) return new Date(v0);
      const p0 = Date.parse(String(opts.scheduledAt));
      if (!Number.isNaN(p0)) return new Date(p0);
    }
    // fallback to schedule.when (for one-off schedules)
    if (s && typeof s.when !== 'undefined' && s.when !== null) {
      const v2 = Number(s.when);
      if (!Number.isNaN(v2) && v2 > 0) return new Date(v2);
      const p2 = Date.parse(String(s.when));
      if (!Number.isNaN(p2)) return new Date(p2);
    }
  } catch (e) {}
  return null;
}

// Format a Date as DD/MM/YYYY, HH:MM:SS (zero-padded)
function _formatDateShort(d) {
  try {
    if (!d) return null;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss}`;
  } catch (e) {
    return null;
  }
}

async function rebuildAlarms(opts = {}) {
  const schedules = await getSchedules();
  const lastCheck = await getLastCheck();
  const now = Date.now();
  const windowStart = lastCheck || now - 1000 * 60 * 60 * 24;
  chrome.alarms.getAll(async (alms) => {
    alms.forEach((a) => {
      if (a.name && a.name.startsWith('openwhen_')) chrome.alarms.clear(a.name);
    });

    // Track window groups to only create one alarm per group
    const processedWindowGroups = new Set();

    for (let i = schedules.length - 1; i >= 0; i--) {
      const s = schedules[i];
      const missed = occurrencesBetween(s, windowStart, now);
      if (missed.length > 0 && !opts.suppressLate) {
        const mostRecentMissed = missed[missed.length - 1];
        const res = await openScheduleNow(s, {
          late: true,
          missedCount: missed.length,
          missedAt: mostRecentMissed,
        });
        if (res && (res.delivered === true || res.fallback === true)) {
          try {
            await updateScheduleAtomic(s.id, (prev) => {
              const now = Date.now();
              const newCount = (Number(prev.runCount) || 0) + missed.length;
              return Object.assign({}, prev, {
                runCount: newCount,
                lastRun: now,
              });
            });
          } catch (e) {}
          try {
            chrome.alarms.clear(makeAlarmName(s.id));
          } catch (e) {}
          await setLastCheck(Date.now());
        }
      }
      if (s.stopAfter && Number(s.runCount) >= Number(s.stopAfter)) continue;

      // For window groups, only create alarm for the first schedule in the group
      if (s.windowGroup) {
        if (processedWindowGroups.has(s.windowGroup)) {
          continue; // Skip - alarm already created for this window group
        }
        processedWindowGroups.add(s.windowGroup);
      }

      const next = computeNextForSchedule(s);
      if (next) chrome.alarms.create(makeAlarmName(s.id), { when: next });
    }
    try {
      await (async function persistMerged(localSchedules) {
        const stored = await getSchedules();
        const storedMap = new Map((stored || []).map((x) => [String(x.id), x]));
        const merged = (localSchedules || []).map((s) => {
          const id = String(s.id);
          const base = storedMap.get(id) || {};
          const runA = Number(base.runCount) || 0;
          const runB = Number(s.runCount) || 0;
          const lastA = Number(base.lastRun) || 0;
          const lastB = Number(s.lastRun) || 0;
          return Object.assign({}, s, {
            runCount: Math.max(runA, runB),
            lastRun: Math.max(lastA, lastB) || undefined,
          });
        });
        await setSchedules(merged);
        return merged;
      })(schedules);
    } catch (e) {}
    await setLastCheck(now);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  rebuildAlarms({ suppressLate: true });
  try {
    ensureContextMenu();
  } catch (e) {}
});
chrome.runtime.onStartup.addListener(() => {
  rebuildAlarms({ suppressLate: true });
});
ensureContextMenu = function () {
  try {
    chrome.contextMenus.removeAll(() => {
      try {
        chrome.contextMenus.create({
          id: 'openwhen_open_link',
          title: 'OpenWhen this link...',
          contexts: ['link'],
        });
        chrome.contextMenus.create({
          id: 'openwhen_open_page',
          title: 'OpenWhen this page...',
          contexts: ['page'],
        });
      } catch (e) {}
    });
  } catch (e) {}
};

ensureContextMenu();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm || !alarm.name || !alarm.name.startsWith('openwhen_')) return;
  const id = alarm.name.replace('openwhen_', '');
  const schedules = await getSchedules();
  const s = schedules.find((x) => String(x.id) === String(id));
  if (!s) return;

  try {
    const now = Date.now();
    const scheduledTs =
      alarm && alarm.scheduledTime ? alarm.scheduledTime : now;
    const lastCheck = await getLastCheck();
    const windowStart = lastCheck || scheduledTs;
    const missed = occurrencesBetween(s, windowStart, now);
    const missedCount = missed.length;
    const isLate = missedCount > 1 || now - scheduledTs > 60000;

    // If this is part of a window group, update all schedules in the group
    if (s.windowGroup) {
      const groupSchedules = schedules.filter(
        (x) => x.windowGroup === s.windowGroup
      );
      for (const gs of groupSchedules) {
        try {
          await updateScheduleAtomic(gs.id, (prev) => {
            const newCount =
              (Number(prev.runCount) || 0) + Math.max(1, missedCount);
            return Object.assign({}, prev, {
              runCount: newCount,
              lastRun: now,
            });
          });
        } catch (e) {}
      }

      // Open all URLs in the window group in a single new window
      try {
        const openOpts = {
          scheduledAt: scheduledTs,
          windowGroup: s.windowGroup,
        };
        if (isLate) {
          openOpts.late = true;
          openOpts.missedCount = missedCount;
          openOpts.missedAt = scheduledTs;
        }

        // Sort by windowIndex and collect all URLs
        groupSchedules.sort(
          (a, b) => (a.windowIndex || 0) - (b.windowIndex || 0)
        );
        const allUrls = groupSchedules.map((gs) => gs.url);

        // Open all in one window
        const createdWindow = await new Promise((resolve) => {
          chrome.windows.create({ url: allUrls, focused: true }, (w) =>
            resolve(w)
          );
        });

        // Inject banner to FIRST tab only by calling openScheduleNow
        // which has all the retry/wait logic built in
        if (
          createdWindow &&
          createdWindow.tabs &&
          createdWindow.tabs.length > 0
        ) {
          const firstTab = createdWindow.tabs[0];
          const firstSched = groupSchedules[0];

          if (firstTab && firstTab.id && firstSched) {
            try {
              // Use the existing _injectToast logic from openScheduleNow
              // by creating a minimal path that just injects the banner
              const whenDate = _resolveWhenDate(firstSched, openOpts);
              const display = _buildDisplayContent(
                firstSched,
                whenDate,
                openOpts
              );
              const manifest = chrome.runtime.getManifest();
              const extName =
                manifest && manifest.name ? manifest.name : 'OpenWhen';
              const extIconUrl = chrome.runtime.getURL('icons/icon48.png');

              // Mark as window schedule for banner display
              display.isWindowSchedule = true;

              // Wait for tab to be ready, then inject using the same pattern as openScheduleNow
              chrome.tabs.get(firstTab.id, (tab) => {
                const doInject = async () => {
                  try {
                    await chrome.scripting.executeScript({
                      target: { tabId: firstTab.id },
                      func: function () {
                        // Brief wait for page to be ready
                      },
                    });
                  } catch (e) {
                    // Tab not ready yet, will retry
                  }

                  // Now inject via executeScript with the full banner code
                  try {
                    const cssFiles = ['banner.css'];

                    // Insert CSS
                    try {
                      await chrome.scripting.insertCSS({
                        target: { tabId: firstTab.id },
                        files: cssFiles,
                      });
                    } catch (e) {}

                    // Execute banner script
                    await chrome.scripting.executeScript({
                      target: { tabId: firstTab.id },
                      func: function (
                        scheduleId,
                        headline,
                        whenLine,
                        lateInline,
                        extIcon,
                        extN,
                        urls,
                        hasMsg,
                        isWinSched
                      ) {
                        try {
                          const id = `openwhen-toast-${String(scheduleId)}`;
                          if (document.getElementById(id)) return;
                          const toast = document.createElement('div');
                          toast.id = id;
                          toast.className = 'openwhen-toast openwhen-banner';

                          // Icon
                          const iconWrap = document.createElement('div');
                          iconWrap.className = 'openwhen-icon-wrap';
                          if (extIcon) {
                            const img = document.createElement('img');
                            img.className = 'openwhen-icon';
                            img.src = extIcon;
                            img.alt = extN || '';
                            iconWrap.appendChild(img);
                          }

                          // Content
                          const content = document.createElement('div');
                          content.className = 'openwhen-content';
                          const contentTop = document.createElement('div');
                          contentTop.className = 'openwhen-content-top';
                          const messageStack = document.createElement('div');
                          messageStack.className = 'openwhen-message-stack';

                          // Window schedule badge
                          if (isWinSched) {
                            const badge = document.createElement('div');
                            badge.className = 'openwhen-badge';
                            badge.textContent = 'window schedule';
                            messageStack.appendChild(badge);
                          }

                          // Message (bold for all schedules)
                          if (hasMsg) {
                            const reminder = document.createElement('div');
                            reminder.className = 'openwhen-headline';
                            reminder.textContent = headline;
                            messageStack.appendChild(reminder);
                          }

                          // URL(s) - expandable list for window schedules
                          if (urls && urls.length > 0) {
                            if (isWinSched && urls.length > 1) {
                              // Window schedule: No URL shown, just toggle

                              // Add "see urls" toggle
                              const toggle = document.createElement('div');
                              toggle.className = 'openwhen-url-toggle';
                              toggle.textContent = `see urls (${urls.length})`;
                              toggle.style.cursor = 'pointer';
                              messageStack.appendChild(toggle);

                              // Add expandable URL list
                              const urlList = document.createElement('ul');
                              urlList.className = 'openwhen-url-list';
                              urls.forEach((url) => {
                                const li = document.createElement('li');
                                li.textContent = url;
                                urlList.appendChild(li);
                              });
                              messageStack.appendChild(urlList);

                              // Toggle expansion on click
                              toggle.addEventListener('click', () => {
                                urlList.classList.toggle('expanded');
                                toggle.textContent = urlList.classList.contains(
                                  'expanded'
                                )
                                  ? `hide urls (${urls.length})`
                                  : `see urls (${urls.length})`;
                              });
                            } else {
                              // Single URL (or non-window schedule)
                              const urlDiv = document.createElement('div');
                              urlDiv.className = 'openwhen-url';
                              urlDiv.textContent = urls[0] || urls;
                              messageStack.appendChild(urlDiv);
                            }
                          }

                          // When line
                          if (whenLine) {
                            const when = document.createElement('div');
                            when.className = 'openwhen-when';
                            when.textContent = whenLine;
                            if (lateInline) {
                              const tag = document.createElement('span');
                              tag.className = 'openwhen-late';
                              tag.textContent = lateInline;
                              when.appendChild(tag);
                            }
                            messageStack.appendChild(when);
                          }

                          contentTop.appendChild(messageStack);

                          // Cancel button for window schedules
                          if (scheduleId) {
                            const cancelBtn = document.createElement('button');
                            cancelBtn.className = 'openwhen-cancel-btn';
                            cancelBtn.textContent = 'cancel schedule';
                            let undoTimeout = null;
                            let countdownInterval = null;

                            cancelBtn.addEventListener('click', () => {
                              console.log(
                                '[OpenWhen] Cancel button clicked, has undo class:',
                                cancelBtn.classList.contains('undo')
                              );
                              if (cancelBtn.classList.contains('undo')) {
                                // Cancel the deletion
                                console.log(
                                  '[OpenWhen] Undo clicked - cancelling deletion'
                                );
                                clearTimeout(undoTimeout);
                                if (countdownInterval) {
                                  clearInterval(countdownInterval);
                                  countdownInterval = null;
                                }
                                cancelBtn.textContent = 'cancel schedule';
                                cancelBtn.classList.remove('undo');
                                cancelBtn.disabled = false;
                                return;
                              }

                              // Start undo countdown
                              console.log('[OpenWhen] Starting undo countdown');
                              cancelBtn.classList.add('undo');
                              let countdown = 3;
                              cancelBtn.textContent = `undo (${countdown})`;
                              cancelBtn.disabled = false; // Keep enabled for undo

                              countdownInterval = setInterval(() => {
                                countdown--;
                                if (countdown > 0) {
                                  cancelBtn.textContent = `undo (${countdown})`;
                                } else {
                                  clearInterval(countdownInterval);
                                  countdownInterval = null;
                                }
                              }, 1000);

                              undoTimeout = setTimeout(() => {
                                // After 3 seconds, actually delete
                                if (countdownInterval) {
                                  clearInterval(countdownInterval);
                                  countdownInterval = null;
                                }
                                cancelBtn.classList.remove('undo');
                                cancelBtn.classList.add('cancelled');
                                cancelBtn.disabled = true;
                                cancelBtn.textContent = 'schedule cancelled';

                                if (
                                  typeof chrome !== 'undefined' &&
                                  chrome.runtime &&
                                  typeof chrome.runtime.sendMessage ===
                                    'function'
                                ) {
                                  chrome.runtime.sendMessage(
                                    {
                                      type: 'openwhen_cancel_schedule',
                                      id: scheduleId,
                                    },
                                    () => {
                                      // Fade out after showing confirmation
                                      setTimeout(() => {
                                        toast.classList.add('openwhen-fade');
                                        setTimeout(() => toast.remove(), 350);
                                      }, 1000);
                                    }
                                  );
                                }
                              }, 3000);
                            });
                            contentTop.appendChild(cancelBtn);
                          }

                          content.appendChild(contentTop);

                          // Close button
                          const close = document.createElement('button');
                          close.textContent = '\u00d7';
                          close.className = 'openwhen-close-btn';
                          close.setAttribute(
                            'aria-label',
                            'Dismiss OpenWhen reminder'
                          );
                          close.addEventListener('click', () => {
                            toast.classList.add('openwhen-fade');
                            setTimeout(() => toast.remove(), 350);
                          });

                          toast.appendChild(iconWrap);
                          toast.appendChild(content);
                          toast.appendChild(close);
                          document.documentElement.appendChild(toast);
                        } catch (e) {}
                      },
                      args: [
                        firstSched.id,
                        display.headline,
                        display.whenLine,
                        display.lateInline,
                        extIconUrl,
                        extName,
                        groupSchedules.map((gs) => gs.url), // Pass all URLs
                        display.hasMessage,
                        true, // isWindowSchedule = true
                      ],
                    });
                  } catch (e) {}
                };

                // If tab is complete, inject now; otherwise wait
                if (tab && tab.status === 'complete') {
                  doInject();
                } else {
                  // Wait for tab to complete loading
                  const onUpdated = (updatedTabId, changeInfo) => {
                    if (updatedTabId !== firstTab.id) return;
                    if (changeInfo && changeInfo.status === 'complete') {
                      doInject();
                      chrome.tabs.onUpdated.removeListener(onUpdated);
                    }
                  };
                  chrome.tabs.onUpdated.addListener(onUpdated);
                  // Fallback: inject after 3 seconds regardless
                  setTimeout(() => {
                    doInject();
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                  }, 3000);
                }
              });
            } catch (e) {}
          }
        }
      } catch (e) {}

      // Clear alarms for all schedules in group (for once schedules)
      if (s.type === 'once') {
        const groupSchedules = schedules.filter(
          (x) => x.windowGroup === s.windowGroup
        );
        for (const gs of groupSchedules) {
          try {
            chrome.alarms.clear(makeAlarmName(gs.id));
          } catch (e) {}
        }
      } else {
        // For recurring window schedules, only recreate alarm for first schedule in group
        // (to prevent multiple alarms for the same window group)
        const groupSchedules = schedules.filter(
          (x) => x.windowGroup === s.windowGroup
        );
        groupSchedules.sort(
          (a, b) => (a.windowIndex || 0) - (b.windowIndex || 0)
        );
        const isFirstInGroup =
          groupSchedules[0] && groupSchedules[0].id === s.id;

        if (isFirstInGroup) {
          // Only the first schedule recreates the alarm for the whole group
          if (!(s.stopAfter && Number(s.runCount) >= Number(s.stopAfter))) {
            const next = computeNextForSchedule(s);
            if (next) chrome.alarms.create(makeAlarmName(s.id), { when: next });
          }
        }
      }
    } else {
      // Single schedule (existing behavior)
      try {
        await updateScheduleAtomic(s.id, (prev) => {
          const newCount =
            (Number(prev.runCount) || 0) + Math.max(1, missedCount);
          return Object.assign({}, prev, { runCount: newCount, lastRun: now });
        });
      } catch (e) {}

      try {
        const openOpts = { scheduledAt: scheduledTs };
        if (isLate) {
          openOpts.late = true;
          openOpts.missedCount = missedCount;
          openOpts.missedAt = scheduledTs;
        }
        await openScheduleNow(s, openOpts);
      } catch (e) {}

      try {
        if (s.type === 'once') chrome.alarms.clear(makeAlarmName(s.id));
      } catch (e) {}

      // Recreate alarm for recurring single schedules
      if (s.type !== 'once') {
        if (!(s.stopAfter && Number(s.runCount) >= Number(s.stopAfter))) {
          const next = computeNextForSchedule(s);
          if (next) chrome.alarms.create(makeAlarmName(s.id), { when: next });
        }
      }
    }

    await setLastCheck(Date.now());
  } catch (e) {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'rebuild') {
    try {
      rebuildAlarms(msg || {});
    } catch (e) {}
    sendResponse({ ok: true });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || msg.type !== 'openwhen_cancel_schedule' || !msg.id) return;
      const id = msg.id;
      const schedules = await getSchedules();

      // Find the schedule being cancelled
      const cancelledSchedule = schedules.find(
        (s) => String(s.id) === String(id)
      );

      // If it's a window schedule, remove all schedules with the same windowGroup
      let remaining;
      if (cancelledSchedule && cancelledSchedule.windowGroup) {
        const windowGroup = cancelledSchedule.windowGroup;
        remaining = schedules.filter((s) => s.windowGroup !== windowGroup);

        // Clear the shared alarm for the window group
        try {
          chrome.alarms.clear(makeAlarmName(id));
        } catch (e) {}
      } else {
        // Regular schedule - just remove the single schedule
        remaining = schedules.filter((s) => String(s.id) !== String(id));

        // Clear the alarm
        try {
          chrome.alarms.clear(makeAlarmName(id));
        } catch (e) {}
      }

      await setSchedules(remaining);
      try {
        const keys =
          (await new Promise((res) =>
            chrome.storage.local.get(null, (r) => res(Object.keys(r || {})))
          )) || [];
        const toRemove = keys.filter((k) => k && k.indexOf('_notif_') === 0);
        if (toRemove.length) chrome.storage.local.remove(toRemove);
      } catch (e) {}
      try {
        chrome.runtime.sendMessage({ type: 'schedules_updated' }, (resp) => {
          try {
            chrome.runtime && chrome.runtime.lastError;
          } catch (e) {}
        });
      } catch (e) {}
      sendResponse({ ok: true });
    } catch (e) {
      try {
        sendResponse({ ok: false, error: String(e) });
      } catch (e) {}
    }
  })();
  return true;
});

// Handle "open now" requests (manual trigger without incrementing runCount)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || msg.type !== 'openwhen_open_now' || !msg.id) return;
      const id = msg.id;
      const schedules = await getSchedules();

      // Find the schedule
      const schedule = schedules.find((s) => String(s.id) === String(id));
      if (!schedule) {
        sendResponse({ ok: false, error: 'Schedule not found' });
        return;
      }

      // If it's a window schedule, open all tabs in the group
      if (schedule.windowGroup) {
        const groupSchedules = schedules.filter(
          (s) => s.windowGroup === schedule.windowGroup
        );

        // Sort by windowIndex and collect all URLs
        groupSchedules.sort(
          (a, b) => (a.windowIndex || 0) - (b.windowIndex || 0)
        );
        const allUrls = groupSchedules.map((gs) => gs.url);

        // Open all in one window
        await new Promise((resolve) => {
          chrome.windows.create({ url: allUrls, focused: true }, (w) => {
            resolve(w);
          });
        });

        // Update lastRun for all schedules in the group (but NOT runCount)
        const now = Date.now();
        for (const gs of groupSchedules) {
          try {
            await updateScheduleAtomic(gs.id, (prev) => {
              return Object.assign({}, prev, { lastRun: now });
            });
          } catch (e) {}
        }
      } else {
        // Regular schedule - just open it
        await openScheduleNow(schedule, {
          late: false,
          missedCount: 0,
          manualTrigger: true,
        });

        // Update lastRun (but NOT runCount)
        const now = Date.now();
        try {
          await updateScheduleAtomic(schedule.id, (prev) => {
            return Object.assign({}, prev, { lastRun: now });
          });
        } catch (e) {}
      }

      // Notify UI to refresh
      try {
        chrome.runtime.sendMessage({ type: 'schedules_updated' }, (resp) => {
          try {
            chrome.runtime && chrome.runtime.lastError;
          } catch (e) {}
        });
      } catch (e) {}

      sendResponse({ ok: true });
    } catch (e) {
      try {
        sendResponse({ ok: false, error: String(e) });
      } catch (e) {}
    }
  })();
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info || !info.menuItemId) return;
  if (
    info.menuItemId === 'openwhen_open_link' ||
    info.menuItemId === 'openwhen_open_page'
  ) {
    const linkUrl = info.linkUrl || info.pageUrl || info.selectionText || null;
    if (!linkUrl) return;
    try {
      chrome.storage.local.set({ openwhen_prefill_url: linkUrl }, () => {
        try {
          chrome.runtime.openOptionsPage(() => {
            if (chrome.runtime.lastError)
              chrome.tabs.create({
                url: chrome.runtime.getURL('options.html'),
              });
          });
        } catch (e) {
          chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
        }
      });
    } catch (e) {
      const tempSchedule = {
        id: 'ctx_' + Date.now(),
        url: linkUrl,
        type: 'once',
        openIn: 'tab',
        message: '',
      };
      openScheduleNow(tempSchedule, { late: false, missedCount: 0 });
    }
  }
});

const _notifToTab = new Map();

function _createNotificationSafe(notifId, options, tabId) {
  try {
    chrome.notifications.create(notifId, options, (nid) => {
      const err = chrome.runtime.lastError;
      if (err) {
        try {
          // retry with extension icon
          const fallbackOpts = Object.assign({}, options, {
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          });
          chrome.notifications.create(notifId, fallbackOpts, (nid2) => {
            try {
              if (tabId) {
                _notifToTab.set(nid2, tabId);
                chrome.storage.local.set({ ['_notif_' + nid2]: tabId });
              }
            } catch (e) {}
          });
        } catch (e) {}
      } else {
        try {
          if (tabId) {
            _notifToTab.set(nid, tabId);
            chrome.storage.local.set({ ['_notif_' + nid]: tabId });
          }
        } catch (e) {}
      }
    });
  } catch (e) {}
}

function _updateNotificationSafe(notifId, options) {
  try {
    chrome.notifications.update(notifId, options, (ok) => {
      const err = chrome.runtime.lastError;
      if (err) {
        try {
          const fallbackOpts = Object.assign({}, options, {
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          });
          chrome.notifications.update(notifId, fallbackOpts, () => {});
        } catch (e) {}
      }
    });
  } catch (e) {}
}

function _makeNotificationId(schedule) {
  return `openwhen_notif_${String(schedule.id)}_${Date.now()}_${Math.floor(
    Math.random() * 10000
  )}`;
}

async function openScheduleNow(s, opts) {
  try {
    const url = (s && s.url) || null;
    if (!url) return { delivered: false, fallback: false, tabId: null };
    const meta = Object.assign({}, opts || {});
    const nowTs = Date.now();
    let scheduledTs = null;
    if (meta.scheduledAt !== undefined && meta.scheduledAt !== null) {
      const direct = Number(meta.scheduledAt);
      if (!Number.isNaN(direct) && direct > 0) {
        scheduledTs = direct;
      } else {
        const parsed = Date.parse(String(meta.scheduledAt));
        if (!Number.isNaN(parsed)) scheduledTs = parsed;
      }
    }
    if (scheduledTs === null) {
      const fallbackDate = _computeWhenDate(s, meta);
      if (fallbackDate) scheduledTs = fallbackDate.getTime();
    }
    if (!meta.late && scheduledTs !== null) {
      if (nowTs - scheduledTs > 60000) {
        meta.late = true;
        if (meta.missedCount === undefined || meta.missedCount === null) {
          meta.missedCount = 1;
        }
        if (meta.missedAt === undefined || meta.missedAt === null)
          meta.missedAt = scheduledTs;
      }
    }

    let createdTab = null;

    if (s.openIn === 'window') {
      await new Promise((res) => {
        chrome.windows.create({ url, focused: !s.openInBackground }, (w) => {
          try {
            if (w && w.tabs && w.tabs[0]) createdTab = w.tabs[0];
          } catch (e) {}
          res();
        });
      });
    } else {
      await new Promise((res) => {
        chrome.tabs.create({ url, active: !s.openInBackground }, (t) => {
          createdTab = t;
          res();
        });
      });
    }

    const tabId = createdTab && createdTab.id ? createdTab.id : null;
    const _injectToast = async (
      tabId,
      scheduleId,
      headline,
      whenLine,
      lateInline,
      extIconUrl,
      extName,
      urlArg,
      hasMessageArg,
      isWindowScheduleArg
    ) => {
      if (!tabId) return;
      try {
        const run = (
          scheduleIdArg,
          headlineArg,
          whenLineArg,
          lateInlineArg,
          extIconArg,
          extNameArg,
          urlArgInner,
          hasMessageInner,
          isWindowSched
        ) => {
          try {
            const id = `openwhen-toast-${String(scheduleIdArg)}`;
            if (document.getElementById(id)) return;
            const toast = document.createElement('div');
            toast.id = id;
            toast.className = 'openwhen-toast openwhen-banner';

            // Icon (left)
            const iconWrap = document.createElement('div');
            iconWrap.className = 'openwhen-icon-wrap';
            // add extension-provided icon if available
            try {
              if (extIconArg) {
                const img = document.createElement('img');
                img.className = 'openwhen-icon';
                img.src = extIconArg;
                img.alt = extNameArg || '';
                iconWrap.appendChild(img);
              }
            } catch (e) {}
            // Content (center)
            const content = document.createElement('div');
            content.className = 'openwhen-content';
            // top row to keep message stack and inline cancel together
            const contentTop = document.createElement('div');
            contentTop.className = 'openwhen-content-top';
            const messageStack = document.createElement('div');
            messageStack.className = 'openwhen-message-stack';
            // If this is a window schedule, show bold "Window schedule!" first
            if (isWindowSched) {
              try {
                const windowLabel = document.createElement('div');
                windowLabel.className = 'openwhen-headline';
                windowLabel.textContent = 'Window schedule!';
                messageStack.appendChild(windowLabel);
              } catch (e) {}
            }
            // If the schedule included a human message, render it as the bold headline.
            if (hasMessageInner) {
              try {
                const reminder = document.createElement('div');
                reminder.className = isWindowSched
                  ? 'openwhen-url'
                  : 'openwhen-headline';
                reminder.textContent = headlineArg;
                messageStack.appendChild(reminder);
              } catch (e) {}
            }
            // show url (if provided) between message and scheduled line. If there was no message, show the URL as the primary non-bold line.
            if (typeof urlArgInner !== 'undefined' && urlArgInner) {
              try {
                const headlineStr = (headlineArg || '').toString().trim();
                const urlStr = (urlArgInner || '').toString().trim();
                if (hasMessageInner) {
                  // only append url when it differs from headline
                  if (urlStr && urlStr !== headlineStr) {
                    const urlDiv = document.createElement('div');
                    urlDiv.className = 'openwhen-url';
                    urlDiv.textContent = urlArgInner;
                    messageStack.appendChild(urlDiv);
                  }
                } else {
                  // no message: show the URL as the primary line (non-bold)
                  const urlDiv = document.createElement('div');
                  urlDiv.className = 'openwhen-url';
                  urlDiv.textContent = urlArgInner;
                  messageStack.appendChild(urlDiv);
                }
              } catch (e) {}
            }
            if (whenLineArg) {
              const when = document.createElement('div');
              when.className = 'openwhen-when';
              when.textContent = whenLineArg;
              if (lateInlineArg) {
                const tag = document.createElement('span');
                tag.className = 'openwhen-late';
                tag.textContent = lateInlineArg;
                when.appendChild(tag);
              }
              messageStack.appendChild(when);
            }
            contentTop.appendChild(messageStack);
            content.appendChild(contentTop);

            // Cancel (attached to content top on the right)
            let cancelBtn = null;
            try {
              if (
                typeof scheduleIdArg !== 'undefined' &&
                scheduleIdArg !== null
              ) {
                cancelBtn = document.createElement('button');
                cancelBtn.className = 'openwhen-cancel-btn';
                cancelBtn.textContent = 'cancel schedule';
                let undoTimeout = null;
                let countdownInterval = null;

                cancelBtn.addEventListener('click', () => {
                  try {
                    console.log(
                      '[OpenWhen] Cancel button clicked, has undo class:',
                      cancelBtn.classList.contains('undo')
                    );
                    if (cancelBtn.classList.contains('undo')) {
                      // Cancel the deletion
                      console.log(
                        '[OpenWhen] Undo clicked - cancelling deletion'
                      );
                      clearTimeout(undoTimeout);
                      if (countdownInterval) {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                      }
                      cancelBtn.textContent = 'cancel schedule';
                      cancelBtn.classList.remove('undo');
                      cancelBtn.disabled = false;
                      return;
                    }

                    // Start undo countdown
                    console.log('[OpenWhen] Starting undo countdown');
                    cancelBtn.classList.add('undo');
                    let countdown = 3;
                    cancelBtn.textContent = `undo (${countdown})`;
                    cancelBtn.disabled = false; // Keep enabled for undo

                    countdownInterval = setInterval(() => {
                      countdown--;
                      if (countdown > 0) {
                        cancelBtn.textContent = `undo (${countdown})`;
                      } else {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                      }
                    }, 1000);

                    undoTimeout = setTimeout(() => {
                      // After 3 seconds, actually delete
                      if (countdownInterval) {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                      }
                      cancelBtn.classList.remove('undo');
                      cancelBtn.classList.add('cancelled');
                      cancelBtn.disabled = true;
                      cancelBtn.textContent = 'schedule cancelled';

                      // Prefer direct runtime call when available (works when this code executes via executeScript in extension context)
                      if (
                        typeof chrome !== 'undefined' &&
                        chrome.runtime &&
                        typeof chrome.runtime.sendMessage === 'function'
                      ) {
                        try {
                          // Retry helper: attempts sendMessage up to 3 times with small backoffs
                          (function sendWithRetries(msg, attempts, delays, cb) {
                            let attempt = 0;
                            function tryOnce() {
                              try {
                                chrome.runtime.sendMessage(
                                  msg,
                                  function (resp) {
                                    try {
                                      const le =
                                        chrome.runtime &&
                                        chrome.runtime.lastError;
                                      if (!le) {
                                        return cb(resp, null);
                                      }
                                      attempt++;
                                      if (attempt < attempts) {
                                        const wait =
                                          delays[
                                            Math.min(
                                              attempt - 1,
                                              delays.length - 1
                                            )
                                          ] || 100;
                                        setTimeout(tryOnce, wait);
                                      } else {
                                        return cb(resp, le);
                                      }
                                    } catch (e) {
                                      attempt++;
                                      if (attempt < attempts) {
                                        setTimeout(
                                          tryOnce,
                                          delays[
                                            Math.min(
                                              attempt - 1,
                                              delays.length - 1
                                            )
                                          ] || 100
                                        );
                                      } else {
                                        cb(null, e);
                                      }
                                    }
                                  }
                                );
                              } catch (err) {
                                attempt++;
                                if (attempt < attempts) {
                                  setTimeout(
                                    tryOnce,
                                    delays[
                                      Math.min(attempt - 1, delays.length - 1)
                                    ] || 100
                                  );
                                } else {
                                  cb(null, err);
                                }
                              }
                            }
                            tryOnce();
                          })(
                            {
                              type: 'openwhen_cancel_schedule',
                              id: scheduleIdArg,
                            },
                            3,
                            [100, 300],
                            (resp, lastError) => {
                              try {
                                // if lastError is present after retries, re-enable button
                                if (lastError) {
                                  try {
                                    cancelBtn.disabled = false;
                                  } catch (e) {}
                                  try {
                                    // preserve existing debug-flag path (no logging)
                                    chrome.storage &&
                                      chrome.storage.local &&
                                      chrome.storage.local.get &&
                                      chrome.storage.local.get(
                                        ['openwhen_debug'],
                                        function (r) {
                                          try {
                                            if (r && r.openwhen_debug) {
                                              /* debug mode: developer may inspect storage */
                                            }
                                          } catch (e) {}
                                        }
                                      );
                                  } catch (e) {}
                                } else if (resp && resp.ok) {
                                  // Replace the cancel button with the confirmation toast
                                  try {
                                    const small = document.createElement('div');
                                    small.className = 'openwhen-cancel-toast';
                                    small.textContent = 'schedule cancelled';
                                    // Insert toast before button, then remove button
                                    cancelBtn.parentNode.insertBefore(
                                      small,
                                      cancelBtn
                                    );
                                    cancelBtn.remove();
                                    setTimeout(() => {
                                      try {
                                        small.classList.add(
                                          'openwhen-toast-fade'
                                        );
                                        setTimeout(() => {
                                          try {
                                            small.remove();
                                          } catch (e) {}
                                        }, 350);
                                      } catch (e) {}
                                    }, 2000);
                                  } catch (e) {}
                                } else {
                                  try {
                                    cancelBtn.disabled = false;
                                  } catch (e) {}
                                }
                              } catch (e) {}
                            }
                          );
                        } catch (e) {
                          // fallback to postMessage bridge
                          window.postMessage(
                            {
                              type: 'openwhen_cancel_schedule',
                              id: scheduleIdArg,
                            },
                            '*'
                          );
                          const onResp = (ev) => {
                            try {
                              const d = ev && ev.data;
                              if (
                                !d ||
                                d.type !== 'openwhen_cancel_response' ||
                                String(d.id) !== String(scheduleIdArg)
                              )
                                return;
                              window.removeEventListener('message', onResp);
                              if (d.ok) {
                                // Replace the cancel button with the confirmation toast
                                try {
                                  const small = document.createElement('div');
                                  small.className = 'openwhen-cancel-toast';
                                  small.textContent = 'schedule cancelled';
                                  // Insert toast before button, then remove button
                                  cancelBtn.parentNode.insertBefore(
                                    small,
                                    cancelBtn
                                  );
                                  cancelBtn.remove();
                                  setTimeout(() => {
                                    try {
                                      small.classList.add(
                                        'openwhen-toast-fade'
                                      );
                                      setTimeout(() => {
                                        try {
                                          small.remove();
                                        } catch (e) {}
                                      }, 350);
                                    } catch (e) {}
                                  }, 2000);
                                } catch (e) {}
                              } else {
                                try {
                                  cancelBtn.disabled = false;
                                } catch (e) {}
                              }
                            } catch (e) {}
                          };
                          window.addEventListener('message', onResp);
                        }
                      } else {
                        // no chrome.runtime available - use postMessage bridge
                        window.postMessage(
                          {
                            type: 'openwhen_cancel_schedule',
                            id: scheduleIdArg,
                          },
                          '*'
                        );
                        const onResp = (ev) => {
                          try {
                            const d = ev && ev.data;
                            if (
                              !d ||
                              d.type !== 'openwhen_cancel_response' ||
                              String(d.id) !== String(scheduleIdArg)
                            )
                              return;
                            window.removeEventListener('message', onResp);
                            if (d.ok) {
                              // Replace the cancel button with the confirmation toast
                              try {
                                const small = document.createElement('div');
                                small.className = 'openwhen-cancel-toast';
                                small.textContent = 'schedule cancelled';
                                // Insert toast before button, then remove button
                                cancelBtn.parentNode.insertBefore(
                                  small,
                                  cancelBtn
                                );
                                cancelBtn.remove();
                                setTimeout(() => {
                                  try {
                                    small.classList.add('openwhen-toast-fade');
                                    setTimeout(() => {
                                      try {
                                        small.remove();
                                      } catch (e) {}
                                    }, 350);
                                  } catch (e) {}
                                }, 2000);
                              } catch (e) {}
                            } else {
                              try {
                                cancelBtn.disabled = false;
                              } catch (e) {}
                            }
                          } catch (e) {}
                        };
                        window.addEventListener('message', onResp);
                      }
                    }, 3000); // End of setTimeout for undo countdown
                  } catch (e) {}
                });
              }
            } catch (e) {}

            const close = document.createElement('button');
            close.textContent = '\u00d7';
            close.className = 'openwhen-close-btn';
            close.setAttribute('aria-label', 'Dismiss OpenWhen reminder');
            close.addEventListener('click', () => {
              try {
                const OPENWHEN_FADE_MS = 350;
                requestAnimationFrame(() => {
                  try {
                    toast.classList.add('openwhen-fade');
                  } catch (e) {}
                });
                try {
                  toast.addEventListener(
                    'transitionend',
                    () => {
                      try {
                        toast.remove();
                      } catch (e) {}
                    },
                    { once: true }
                  );
                } catch (e) {}
                setTimeout(() => {
                  try {
                    toast.remove();
                  } catch (e) {}
                }, OPENWHEN_FADE_MS + 120);
              } catch (e) {
                try {
                  toast.remove();
                } catch (e) {}
              }
            });

            toast.appendChild(iconWrap);
            toast.appendChild(content);
            if (cancelBtn) contentTop.appendChild(cancelBtn);
            toast.appendChild(close);
            document.documentElement.appendChild(toast);
          } catch (e) {}
        };

        chrome.tabs.get(tabId, (t) => {
          const doInject = async () => {
            try {
              // starting injection attempts for tab
              const cssFiles = ['banner.css'];
              const maxAttempts = 3;
              let injected = false;

              // ensure a small bridge is present in the page that forwards cancel postMessage -> chrome.runtime
              try {
                await chrome.scripting.executeScript({
                  target: { tabId },
                  func: function () {
                    try {
                      if (window.__openwhen_bridge_installed) return;
                      window.__openwhen_bridge_installed = true;
                      window.addEventListener('message', (ev) => {
                        try {
                          const d = ev && ev.data;
                          if (!d || typeof d !== 'object') return;
                          if (d.type === 'openwhen_cancel_schedule' && d.id) {
                            try {
                              // retry helper within bridge to handle transient closed-port errors
                              (function bridgeSendWithRetries(
                                msg,
                                attempts,
                                delays,
                                cb
                              ) {
                                let attempt = 0;
                                function tryOnce() {
                                  try {
                                    chrome.runtime.sendMessage(
                                      msg,
                                      function (resp) {
                                        try {
                                          const le =
                                            chrome.runtime &&
                                            chrome.runtime.lastError;
                                          if (!le) {
                                            return cb(resp, null);
                                          }
                                          attempt++;
                                          if (attempt < attempts) {
                                            const wait =
                                              delays[
                                                Math.min(
                                                  attempt - 1,
                                                  delays.length - 1
                                                )
                                              ] || 100;
                                            setTimeout(tryOnce, wait);
                                          } else {
                                            return cb(resp, le);
                                          }
                                        } catch (e) {
                                          attempt++;
                                          if (attempt < attempts) {
                                            setTimeout(
                                              tryOnce,
                                              delays[
                                                Math.min(
                                                  attempt - 1,
                                                  delays.length - 1
                                                )
                                              ] || 100
                                            );
                                          } else {
                                            cb(null, e);
                                          }
                                        }
                                      }
                                    );
                                  } catch (err) {
                                    attempt++;
                                    if (attempt < attempts) {
                                      setTimeout(
                                        tryOnce,
                                        delays[
                                          Math.min(
                                            attempt - 1,
                                            delays.length - 1
                                          )
                                        ] || 100
                                      );
                                    } else {
                                      cb(null, err);
                                    }
                                  }
                                }
                                tryOnce();
                              })(
                                { type: 'openwhen_cancel_schedule', id: d.id },
                                3,
                                [100, 300],
                                function (resp, lastError) {
                                  try {
                                    const ok =
                                      !lastError && !!(resp && resp.ok);
                                    try {
                                      window.postMessage(
                                        {
                                          type: 'openwhen_cancel_response',
                                          id: d.id,
                                          ok,
                                          lastError:
                                            lastError && String(lastError),
                                        },
                                        '*'
                                      );
                                    } catch (e) {}
                                    try {
                                      if (lastError) {
                                        // only log when debug enabled
                                        chrome.storage &&
                                          chrome.storage.local &&
                                          chrome.storage.local.get &&
                                          chrome.storage.local.get(
                                            ['openwhen_debug'],
                                            function (r) {
                                              try {
                                                if (r && r.openwhen_debug) {
                                                  /* debug mode: developer may inspect storage */
                                                }
                                              } catch (e) {}
                                            }
                                          );
                                      }
                                    } catch (e) {}
                                  } catch (e) {}
                                }
                              );
                            } catch (e) {}
                          }
                        } catch (e) {}
                      });
                    } catch (e) {}
                  },
                });
              } catch (e) {}

              for (
                let attempt = 1;
                attempt <= maxAttempts && !injected;
                attempt++
              ) {
                try {
                  // insertCSS attempt
                  await chrome.scripting.insertCSS({
                    target: { tabId },
                    files: cssFiles,
                  });
                  // insertCSS OK on attempt
                } catch (icErr) {
                  /* insertCSS attempt failed */
                }

                try {
                  // executeScript attempt
                  await chrome.scripting.executeScript({
                    target: { tabId },
                    func: run,
                    args: [
                      scheduleId,
                      headline,
                      whenLine,
                      lateInline,
                      extIconUrl,
                      extName,
                      urlArg,
                      hasMessageArg,
                      isWindowScheduleArg,
                    ],
                  });
                  injected = true;
                  // executeScript OK on attempt
                  break;
                } catch (esErr) {
                  /* executeScript attempt failed */
                }

                // backoff before next attempt
                const backoffs = [500, 1000, 2000];
                const wait =
                  backoffs[Math.min(attempt - 1, backoffs.length - 1)];
                await new Promise((r) => setTimeout(r, wait));
              }

              if (!injected) {
                // Inline fallback if class/CSS approach didn't work
                try {
                  // attempting inline-styles fallback for tab
                  await chrome.scripting.executeScript({
                    target: { tabId },
                    func: function (
                      scheduleIdArg,
                      headlineArg,
                      whenLineArg,
                      lateInlineArg,
                      extIconArg,
                      extNameArg,
                      urlArgInner,
                      hasMessageInner,
                      isWindowSched
                    ) {
                      try {
                        const id = 'openwhen-toast-' + String(scheduleIdArg);
                        if (document.getElementById(id)) return;
                        const toast = document.createElement('div');
                        toast.id = id;
                        toast.style.position = 'fixed';
                        toast.style.top = '0';
                        toast.style.left = '0';
                        toast.style.right = '0';
                        toast.style.zIndex = '2147483647';
                        toast.style.background = 'rgba(89,15,111,0.95)';
                        toast.style.color = '#fff';
                        toast.style.display = 'flex';
                        toast.style.alignItems = 'center';
                        toast.style.gap = '12px';
                        toast.style.padding = '10px 14px';
                        toast.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';
                        toast.style.fontFamily =
                          'system-ui, -apple-system, "Segoe UI", Roboto, Arial';

                        // Icon
                        const iconWrap = document.createElement('div');
                        iconWrap.style.flex = '0 0 auto';
                        if (extIconArg) {
                          try {
                            const img = document.createElement('img');
                            img.src = extIconArg;
                            img.alt = extNameArg || '';
                            img.style.width = '48px';
                            img.style.height = '48px';
                            img.style.borderRadius = '6px';
                            img.style.objectFit = 'contain';
                            iconWrap.appendChild(img);
                          } catch (e) {}
                        }

                        // Content
                        const content = document.createElement('div');
                        content.style.display = 'flex';
                        content.style.flexDirection = 'column';
                        content.style.gap = '0';
                        content.style.lineHeight = '1.05';
                        content.style.flex = '1 1 auto';
                        content.style.minWidth = '0';
                        // If this is a window schedule, show bold "Window schedule!" first
                        if (isWindowSched) {
                          try {
                            const windowLabel = document.createElement('div');
                            windowLabel.style.fontWeight = '700';
                            windowLabel.style.fontSize = '14px';
                            windowLabel.textContent = 'Window schedule!';
                            content.appendChild(windowLabel);
                          } catch (e) {}
                        }
                        // Only render a bold headline when the schedule provided a human message.
                        if (hasMessageInner) {
                          try {
                            const reminder = document.createElement('div');
                            reminder.style.fontWeight = isWindowSched
                              ? '400'
                              : '700';
                            reminder.style.fontSize = '14px';
                            reminder.textContent = headlineArg;
                            content.appendChild(reminder);
                          } catch (e) {}
                        }
                        if (typeof urlArgInner !== 'undefined' && urlArgInner) {
                          try {
                            const headlineStr = (headlineArg || '')
                              .toString()
                              .trim();
                            const urlStr = (urlArgInner || '')
                              .toString()
                              .trim();
                            if (hasMessageInner) {
                              if (urlStr && urlStr !== headlineStr) {
                                const urlDiv = document.createElement('div');
                                urlDiv.style.fontSize = '13px';
                                urlDiv.style.opacity = '0.95';
                                urlDiv.style.whiteSpace = 'nowrap';
                                urlDiv.style.overflow = 'hidden';
                                urlDiv.style.textOverflow = 'ellipsis';
                                urlDiv.textContent = urlArgInner;
                                content.appendChild(urlDiv);
                              }
                            } else {
                              // no message: show URL as primary non-bold line
                              const urlDiv = document.createElement('div');
                              urlDiv.style.fontSize = '13px';
                              urlDiv.style.opacity = '0.95';
                              urlDiv.style.whiteSpace = 'nowrap';
                              urlDiv.style.overflow = 'hidden';
                              urlDiv.style.textOverflow = 'ellipsis';
                              urlDiv.textContent = urlArgInner;
                              content.appendChild(urlDiv);
                            }
                          } catch (e) {}
                        }
                        if (whenLineArg) {
                          const when = document.createElement('div');
                          when.style.fontSize = '12px';
                          when.style.opacity = '0.95';
                          when.textContent = whenLineArg;
                          if (lateInlineArg) {
                            const tag = document.createElement('span');
                            tag.style.fontWeight = '700';
                            tag.style.marginLeft = '6px';
                            tag.style.color = '#ccc';
                            tag.textContent = lateInlineArg;
                            when.appendChild(tag);
                          }
                          content.appendChild(when);
                        }

                        const _OPENWHEN_FADE_MS = 350;
                        const maybeCancel = document.createElement('div');
                        maybeCancel.style.flex = '0 0 auto';
                        if (
                          typeof scheduleIdArg !== 'undefined' &&
                          scheduleIdArg !== null
                        ) {
                          const cancelBtn = document.createElement('button');
                          cancelBtn.textContent = 'cancel schedule';
                          cancelBtn.style.background = '#e53935';
                          cancelBtn.style.border = 'none';
                          cancelBtn.style.color = '#fff';
                          cancelBtn.style.padding = '8px 12px';
                          cancelBtn.style.borderRadius = '6px';
                          cancelBtn.style.cursor = 'pointer';
                          cancelBtn.style.fontWeight = '600';

                          cancelBtn.addEventListener('click', () => {
                            try {
                              cancelBtn.disabled = true;
                              window.postMessage(
                                {
                                  type: 'openwhen_cancel_schedule',
                                  id: scheduleIdArg,
                                },
                                '*'
                              );
                              const onResp = (ev) => {
                                try {
                                  const d = ev && ev.data;
                                  if (
                                    !d ||
                                    d.type !== 'openwhen_cancel_response' ||
                                    String(d.id) !== String(scheduleIdArg)
                                  )
                                    return;
                                  window.removeEventListener('message', onResp);
                                  if (d.ok) {
                                    try {
                                      const small =
                                        document.createElement('div');
                                      small.className = 'openwhen-cancel-toast';
                                      small.textContent = 'schedule cancelled';
                                      small.style.fontSize = '12px';
                                      small.style.color = '#fff';
                                      small.style.padding = '8px 12px';
                                      // Insert toast before button, then remove button
                                      cancelBtn.parentNode.insertBefore(
                                        small,
                                        cancelBtn
                                      );
                                      cancelBtn.remove();
                                      setTimeout(() => {
                                        small.classList.add(
                                          'openwhen-toast-fade'
                                        );
                                        setTimeout(() => small.remove(), 350);
                                      }, 2000);
                                    } catch (e) {}
                                  } else {
                                    try {
                                      cancelBtn.disabled = false;
                                    } catch (e) {}
                                  }
                                } catch (e) {}
                              };
                              window.addEventListener('message', onResp);
                            } catch (e) {}
                          });
                          maybeCancel.appendChild(cancelBtn);
                        }

                        const close = document.createElement('button');
                        close.textContent = '\u00d7';
                        close.style.background = 'transparent';
                        close.style.border = 'none';
                        close.style.color = '#fff';
                        close.style.fontSize = '18px';
                        close.style.cursor = 'pointer';
                        close.style.marginLeft = '12px';
                        close.addEventListener('click', () => {
                          const OPENWHEN_FADE_MS = 350;
                          try {
                            requestAnimationFrame(() => {
                              try {
                                toast.classList.add('openwhen-fade');
                              } catch (e) {}
                            });
                            try {
                              toast.addEventListener(
                                'transitionend',
                                () => {
                                  try {
                                    toast.remove();
                                  } catch (e) {}
                                },
                                { once: true }
                              );
                            } catch (e) {}
                            setTimeout(() => {
                              try {
                                toast.remove();
                              } catch (e) {}
                            }, OPENWHEN_FADE_MS + 120);
                          } catch (e) {
                            try {
                              toast.remove();
                            } catch (e) {}
                          }
                        });

                        toast.appendChild(iconWrap);
                        toast.appendChild(content);
                        toast.appendChild(maybeCancel);
                        toast.appendChild(close);
                        document.documentElement.appendChild(toast);
                      } catch (e) {}
                    },
                    args: [
                      scheduleId,
                      headline,
                      whenLine,
                      lateInline,
                      extIconUrl,
                      extName,
                      urlArg,
                      hasMessageArg,
                      isWindowScheduleArg,
                    ],
                  });
                } catch (fbErr) {}
              }
            } catch (err) {}
          };
          if (t && t.status === 'complete') return doInject();
          const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId) return;
            if (changeInfo && changeInfo.status === 'complete') {
              try {
                doInject();
              } catch (e) {}
              chrome.tabs.onUpdated.removeListener(onUpdated);
            }
          };
          chrome.tabs.onUpdated.addListener(onUpdated);
          setTimeout(() => {
            try {
              doInject();
              chrome.tabs.onUpdated.removeListener(onUpdated);
            } catch (e) {}
          }, 8000);
        });
      } catch (e) {}
    };

    const whenDate = _resolveWhenDate(s, meta);
    const display = _buildDisplayContent(s, whenDate, meta);

    // Skip banner and notifications for manual triggers
    if (meta.manualTrigger) {
      return { delivered: false, fallback: false, tabId };
    }

    try {
      const notifId = _makeNotificationId(s);
      try {
        if (tabId) _notifToTab.set(notifId, tabId);
      } catch (e) {}
      let icon = chrome.runtime.getURL('icons/icon128.png');
      let titleText = `Opened by OpenWhen${
        s && s.source ? ` (${s.source})` : ''
      }`;
      try {
        if (tabId) {
          chrome.tabs.get(tabId, (t) => {
            try {
              if (t && t.favIconUrl) icon = t.favIconUrl;
              if (t && t.title) titleText = t.title;
            } catch (e) {}
            const notifLines = [];
            if (display.headline) notifLines.push(display.headline);
            if (display.whenLine) {
              const whenWithLate = display.lateInline
                ? `${display.whenLine} ${display.lateInline}`
                : display.whenLine;
              notifLines.push(whenWithLate);
            }
            const notifOptions = {
              type: 'basic',
              title: titleText,
              message: notifLines.filter(Boolean).join('\n'),
              iconUrl: icon,
            };
            try {
              _createNotificationSafe(notifId, notifOptions, tabId);
            } catch (e) {}
            try {
              if (tabId) {
                chrome.tabs.onUpdated.addListener(
                  (updatedTabId, changeInfo, tabObj) => {
                    if (updatedTabId !== tabId) return;
                    if (changeInfo && changeInfo.favIconUrl) {
                      (async () => {
                        try {
                          const resized = await fetchAndResizeIcon(
                            changeInfo.favIconUrl,
                            32
                          );
                          const useIcon = resized || changeInfo.favIconUrl;
                          try {
                            _updateNotificationSafe(notifId, {
                              iconUrl: useIcon,
                            });
                          } catch (e) {}
                        } catch (e) {}
                      })();
                    } else if (tabObj && tabObj.favIconUrl) {
                      (async () => {
                        try {
                          const resized = await fetchAndResizeIcon(
                            tabObj.favIconUrl,
                            32
                          );
                          const useIcon = resized || tabObj.favIconUrl;
                          try {
                            _updateNotificationSafe(notifId, {
                              iconUrl: useIcon,
                            });
                          } catch (e) {}
                        } catch (e) {}
                      })();
                    }
                  }
                );
                try {
                  if (t && t.favIconUrl && t.favIconUrl !== icon) {
                    (async () => {
                      const resized = await fetchAndResizeIcon(
                        t.favIconUrl,
                        32
                      );
                      const useIcon = resized || t.favIconUrl;
                      try {
                        _updateNotificationSafe(notifId, { iconUrl: useIcon });
                      } catch (e) {}
                    })();
                  }
                } catch (e) {}
              }
            } catch (e) {}
            try {
              const manifest = chrome.runtime.getManifest();
              const extName =
                manifest && manifest.name ? manifest.name : 'OpenWhen';
              const extIconUrl = chrome.runtime.getURL('icons/icon48.png');
              _injectToast(
                tabId,
                s.id,
                display.headline,
                display.whenLine,
                display.lateInline,
                extIconUrl,
                extName,
                s.url,
                display.hasMessage,
                false
              );
            } catch (e) {}
          });
        } else {
          const notifLines = [];
          if (display.headline) notifLines.push(display.headline);
          if (display.whenLine) {
            const whenWithLate = display.lateInline
              ? `${display.whenLine} ${display.lateInline}`
              : display.whenLine;
            notifLines.push(whenWithLate);
          }
          const notifOptions = {
            type: 'basic',
            title: titleText,
            message: notifLines.filter(Boolean).join('\n'),
            iconUrl: icon,
          };
          try {
            _createNotificationSafe(notifId, notifOptions, tabId);
          } catch (e) {}
          try {
            const manifest = chrome.runtime.getManifest();
            const extName =
              manifest && manifest.name ? manifest.name : 'OpenWhen';
            const extIconUrl = chrome.runtime.getURL('icons/icon48.png');
            _injectToast(
              tabId,
              s.id,
              display.headline,
              display.whenLine,
              display.lateInline,
              extIconUrl,
              extName,
              s.url,
              display.hasMessage,
              false
            );
          } catch (e) {}
        }
      } catch (e) {}
    } catch (e) {}

    return { delivered: false, fallback: true, tabId };
  } catch (e) {
    return { delivered: false, fallback: true, tabId: null };
  }
}

chrome.notifications.onClicked.addListener(async (notifId) => {
  try {
    let tabId = _notifToTab.get(notifId);
    if (!tabId) {
      try {
        const stored = await new Promise((res) =>
          chrome.storage.local.get(['_notif_' + notifId], (r) =>
            res((r && r['_notif_' + notifId]) || null)
          )
        );
        if (stored) tabId = stored;
      } catch (e) {}
    }
    if (tabId) {
      try {
        const tab = await new Promise((res) => chrome.tabs.get(tabId, res));
        if (tab && tab.windowId !== undefined) {
          chrome.windows.update(tab.windowId, { focused: true });
          chrome.tabs.update(tabId, { active: true });
        }
      } catch (e) {}
    }
    try {
      chrome.notifications.clear(notifId);
    } catch (e) {}
    try {
      chrome.storage.local.remove(['_notif_' + notifId]);
    } catch (e) {}
  } catch (e) {}
});

chrome.notifications.onClosed.addListener((notifId, byUser) => {
  try {
    try {
      chrome.storage.local.remove(['_notif_' + notifId]);
    } catch (e) {}
    try {
      _notifToTab.delete(notifId);
    } catch (e) {}
  } catch (e) {}
});
