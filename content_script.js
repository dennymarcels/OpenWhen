// content script to show a small banner when extension opens a page
(function(){
  const OPENWHEN_FADE_MS = 350;
  
  function removeWithFade(el){
    try{
      requestAnimationFrame(() => { try{ el.classList.add('openwhen-fade'); }catch(e){} });
      try{ el.addEventListener('transitionend', () => { try{ el.remove(); }catch(e){} }, {once:true}); }catch(e){}
      setTimeout(() => { try{ el.remove(); }catch(e){} }, OPENWHEN_FADE_MS + 120);
    }catch(e){ try{ el.remove(); }catch(e){} }
  }
  
  function showBanner(text, source, missedAt, scheduleId){
    try{
      const id = 'openwhen-banner';
      if(document.getElementById(id)) return;
      const banner = document.createElement('div');
      banner.id = id; banner.className = 'openwhen-banner';

      // icon (left)
      const iconWrap = document.createElement('div'); iconWrap.className = 'openwhen-icon-wrap';
      try{
        const img = document.createElement('img');
        img.className = 'openwhen-icon';
        if(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL){ img.src = chrome.runtime.getURL('icons/icon48.png'); }
        iconWrap.appendChild(img);
      }catch(e){}

  // center content: headline, url/message, schedule
  const content = document.createElement('div'); content.className = 'openwhen-content';
  // top row: message stack (headline/url/when) + inline cancel
  const contentTop = document.createElement('div'); contentTop.className = 'openwhen-content-top';
  const messageStack = document.createElement('div'); messageStack.className = 'openwhen-message-stack';
  // If a human-authored schedule message exists, show it as a bold headline.
  // Otherwise show the URL as the primary (non-bold) line.
  const rawMessage = (typeof text === 'string' ? text.trim() : '');
  const rawSource = (typeof source === 'string' ? source.trim() : '');
  if(rawMessage){
    const headline = document.createElement('div'); headline.className = 'openwhen-headline'; headline.textContent = rawMessage;
    messageStack.appendChild(headline);
    if(rawSource && rawSource !== rawMessage){ const urlLine = document.createElement('div'); urlLine.className = 'openwhen-url'; urlLine.textContent = rawSource; messageStack.appendChild(urlLine); }
  } else {
    // no message: show URL as primary non-bold line
    if(rawSource){ const urlLine = document.createElement('div'); urlLine.className = 'openwhen-url'; urlLine.textContent = rawSource; messageStack.appendChild(urlLine); }
  }
  if(missedAt){ try{ const d = new Date(Number(missedAt)); if(!isNaN(d.getTime())){ const when = document.createElement('div'); when.className = 'openwhen-when'; when.textContent = `scheduled for: ${d.toLocaleString()}`; messageStack.appendChild(when); } }catch(e){} }
  contentTop.appendChild(messageStack);
  content.appendChild(contentTop);

  // cancel button (attached to content top on the right)
      let cancelBtn = null;
      if(typeof scheduleId !== 'undefined' && scheduleId !== null){
        try{
          cancelBtn = document.createElement('button');
          cancelBtn.className = 'openwhen-cancel-btn';
          cancelBtn.textContent = 'Cancel schedule';

          cancelBtn.addEventListener('click', () => {
            try{
              cancelBtn.disabled = true;
              let responded = false;

              const handleResp = (ok) => {
                if(responded) return;
                responded = true;
                if(ok){
                  const bannerId = 'openwhen-banner';
                  const bannerEl = document.getElementById(bannerId);
                  if(bannerEl){
                    const cancelBtnEl = bannerEl.querySelector('.openwhen-cancel-btn');
                    if(cancelBtnEl){
                      const small = document.createElement('div');
                      small.className = 'openwhen-cancel-toast';
                      small.textContent = 'Schedule cancelled';
                      // Insert toast before button, then remove button
                      cancelBtnEl.parentNode.insertBefore(small, cancelBtnEl);
                      cancelBtnEl.remove();
                      setTimeout(() => { small.classList.add('openwhen-toast-fade'); setTimeout(() => small.remove(), OPENWHEN_FADE_MS); }, 2200);
                    }
                  }
                } else {
                  try{ cancelBtn.disabled = false; }catch(e){}
                }
              };

              // Try the extension runtime first (preferred)
              try{
                if(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage){
                  // sendMessage with retries; if final attempt still yields lastError, allow the postMessage bridge fallback
                  (function sendWithRetries(msg, attempts, delays, cb){
                    let attempt = 0;
                    function tryOnce(){
                      try{
                        chrome.runtime.sendMessage(msg, function(resp){
                          try{
                            const le = chrome.runtime && chrome.runtime.lastError;
                            if(!le) return cb(resp, null);
                            attempt++;
                            if(attempt < attempts){
                              const wait = delays[Math.min(attempt-1, delays.length-1)] || 100;
                              setTimeout(tryOnce, wait);
                            } else {
                              return cb(resp, le);
                            }
                          }catch(e){
                            attempt++;
                            if(attempt < attempts){ setTimeout(tryOnce, delays[Math.min(attempt-1, delays.length-1)] || 100); }
                            else { cb(null, e); }
                          }
                        });
                      }catch(err){ attempt++; if(attempt < attempts){ setTimeout(tryOnce, delays[Math.min(attempt-1, delays.length-1)] || 100); } else { cb(null, err); } }
                    }
                    tryOnce();
                  })({ type: 'openwhen_cancel_schedule', id: scheduleId }, 3, [100, 300], (resp, lastError) => {
                    try{
                      if(lastError){
                        // allow fallback postMessage bridge (do not mark responded)
                        return;
                      }
                      handleResp(Boolean(resp && resp.ok));
                    }catch(e){}
                  });
                }
              }catch(e){}

              // Fallback: if no response within timeout, postMessage to injected bridge
              setTimeout(() => {
                if(responded) return;
                // listen for bridge response
                const onBridge = (ev) => {
                  try{
                    const d = ev && ev.data;
                    if(!d || typeof d !== 'object') return;
                    if(d.type === 'openwhen_cancel_response' && String(d.id) === String(scheduleId)){
                      window.removeEventListener('message', onBridge);
                      handleResp(Boolean(d.ok));
                    }
                  }catch(e){}
                };
                window.addEventListener('message', onBridge);
                try{ window.postMessage({ type: 'openwhen_cancel_schedule', id: scheduleId }, '*'); }catch(e){}
                setTimeout(() => { if(!responded){ try{ cancelBtn.disabled = false; }catch(e){} window.removeEventListener('message', onBridge); } }, 3000);
              }, 900);

            }catch(e){}
          });
        }catch(e){}
      }

      const close = document.createElement('button'); close.className = 'openwhen-close-btn'; close.textContent = '\u00d7'; close.addEventListener('click', () => {
        try{ removeWithFade(banner); document.documentElement.style.setProperty('--openwhen-banner-height', '0px'); }catch(e){}
      });

      banner.appendChild(iconWrap);
      banner.appendChild(content);
      if(cancelBtn) contentTop.appendChild(cancelBtn);
      banner.appendChild(close);
      document.documentElement.appendChild(banner);
      try{ document.documentElement.style.setProperty('--openwhen-banner-height', banner.offsetHeight + 'px'); }catch(e){}
    }catch(e){ }
  }
  // Listen for runtime messages from background to show banner (include scheduleId when available)
  chrome.runtime.onMessage.addListener((msg) => { if(msg && msg.type === 'openwhen_opened') showBanner(msg.message || '', msg.source || 'scheduled', msg.missedAt || null, msg.scheduleId || null); });

  // Listen for responses from the injected bridge when a cancel request completes.
  // The bridge will post back an 'openwhen_cancel_response' message with {id, ok}.
  window.addEventListener('message', (ev) => {
    try{
      const data = ev && ev.data;
      if(!data || typeof data !== 'object') return;
      if(data && data.type === 'openwhen_cancel_response' && data.id){
        try{
          const tid = 'openwhen-toast-' + String(data.id);
          const t = document.getElementById(tid);
          // remove any injected toast element's cancel button while keeping the banner
          if(t){ try{ const cb = t.querySelector && t.querySelector('.openwhen-cancel-btn'); if(cb) cb.remove(); }catch(e){} }
          const b = document.getElementById('openwhen-banner');
          if(b){ try{ const cb2 = b.querySelector && b.querySelector('.openwhen-cancel-btn'); if(cb2) cb2.remove(); }catch(e){} }
          // show small inline confirmation if possible
          try{
            const el = t || b;
            if(el){ const toast = document.createElement('div'); toast.className = 'openwhen-cancel-toast'; toast.textContent = 'Schedule cancelled'; el.appendChild(toast); setTimeout(() => { try{ requestAnimationFrame(() => { toast.classList.add('openwhen-toast-fade'); }); setTimeout(() => { try{ toast.remove(); }catch(e){} }, OPENWHEN_FADE_MS); }catch(e){} }, 2000); }
          }catch(e){}
        }catch(e){}
      }
    }catch(e){}
  });
})();
