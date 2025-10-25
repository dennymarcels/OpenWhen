function showBanner(text, source, missedAt, scheduleId){
  const id = 'openwhen-banner';
  if(document.getElementById(id)) return;
  const banner = document.createElement('div');
  banner.id = id; banner.className = 'openwhen-banner';

  const iconWrap = document.createElement('div'); iconWrap.className = 'openwhen-icon-wrap';
  try{ const img = document.createElement('img'); img.className = 'openwhen-icon'; if(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) img.src = chrome.runtime.getURL('icons/icon48.png'); iconWrap.appendChild(img); }catch(e){}

  const content = document.createElement('div'); content.className = 'openwhen-content';
  const contentTop = document.createElement('div'); contentTop.className = 'openwhen-content-top';
  const messageStack = document.createElement('div'); messageStack.className = 'openwhen-message-stack';
  const headline = document.createElement('div'); headline.className = 'openwhen-headline'; headline.textContent = `opened by OpenWhen (${source || 'scheduled'})`;
  const msg = document.createElement('div'); msg.className = 'openwhen-url'; msg.textContent = text || '';
  messageStack.appendChild(headline);
  if(msg.textContent) messageStack.appendChild(msg);
  if(missedAt){ try{ const d = new Date(Number(missedAt)); if(!isNaN(d.getTime())){ const when = document.createElement('div'); when.className = 'openwhen-when'; when.textContent = `scheduled for ${d.toLocaleString()}`; messageStack.appendChild(when); } }catch(e){} }
  contentTop.appendChild(messageStack);
  content.appendChild(contentTop);

  let cancelBtn = null;
  if(typeof scheduleId !== 'undefined' && scheduleId !== null){
    try{
  cancelBtn = document.createElement('button'); cancelBtn.className = 'openwhen-cancel-btn'; cancelBtn.textContent = 'Cancel schedule';
      const OPENWHEN_FADE_MS = 350;
      const showCancelToast = (msg) => {
        try{
          const t = document.createElement('div'); t.className = 'openwhen-cancel-toast'; t.textContent = msg || 'Schedule cancelled';
          content.appendChild(t);
          setTimeout(() => { try{ requestAnimationFrame(() => { t.classList.add('openwhen-toast-fade'); }); setTimeout(() => { try{ t.remove(); }catch(e){} }, OPENWHEN_FADE_MS); }catch(e){} }, 2200);
        }catch(e){}
      };
      cancelBtn.addEventListener('click', () => {
        try{
          cancelBtn.disabled = true;
          let responded = false;
          const handleResp = (ok) => {
            if(responded) return; responded = true;
            if(ok){ try{ showCancelToast('Schedule cancelled'); }catch(e){} try{ cancelBtn.remove(); }catch(e){} }
            else { try{ cancelBtn.disabled = false; }catch(e){} }
          };

          // Try extension runtime first (with retries). If final lastError occurs, allow bridge fallback
          try{
            if(typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function'){
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
                        } else { return cb(resp, le); }
                      }catch(e){ attempt++; if(attempt < attempts){ setTimeout(tryOnce, delays[Math.min(attempt-1, delays.length-1)] || 100); } else { cb(null, e); } }
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

          // Fallback to bridge if no response within timeout
          setTimeout(() => {
            if(responded) return;
            const onResp = (ev) => {
              try{
                const d = ev && ev.data;
                if(!d || typeof d !== 'object') return;
                if(d.type === 'openwhen_cancel_response' && String(d.id) === String(scheduleId)){
                  window.removeEventListener('message', onResp);
                  handleResp(Boolean(d.ok));
                }
              }catch(e){}
            };
            window.addEventListener('message', onResp);
            try{ window.postMessage({ type: 'openwhen_cancel_schedule', id: scheduleId }, '*'); }catch(e){}
            setTimeout(() => { if(!responded){ try{ cancelBtn.disabled = false; }catch(e){} window.removeEventListener('message', onResp); } }, 3000);
          }, 900);
        }catch(e){}
      });
    }catch(e){}
  }

  function removeWithFade(el){
    try{
      requestAnimationFrame(() => { try{ el.classList.add('openwhen-fade'); }catch(e){} });
      try{ el.addEventListener('transitionend', () => { try{ el.remove(); }catch(e){} }, {once:true}); }catch(e){}
      setTimeout(() => { try{ el.remove(); }catch(e){} }, OPENWHEN_FADE_MS + 120);
    }catch(e){ try{ el.remove(); }catch(e){} }
  }

  const close = document.createElement('button'); close.className = 'openwhen-close-btn'; close.textContent = '\u00d7'; close.addEventListener('click', () => {
    try{ removeWithFade(banner); }catch(e){}
  });

  banner.appendChild(iconWrap);
  banner.appendChild(content);
  if(cancelBtn) contentTop.appendChild(cancelBtn);
  banner.appendChild(close);
  document.documentElement.appendChild(banner);
}

module.exports = { showBanner };
