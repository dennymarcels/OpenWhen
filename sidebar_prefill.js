// sidebar_prefill.js — populate #url with the active tab URL when the side panel opens
(function(){
  try{
    chrome.storage && chrome.storage.local && chrome.storage.local.get(['openwhen_prefill_url'], res => {
      const stored = res && res.openwhen_prefill_url;
      if (stored) {
        const input = document.getElementById('url');
        if (input) input.value = stored;
        try {
          chrome.storage.local.remove(['openwhen_prefill_url']);
        } catch (e) {
          /* ignore */
        }
        return;
      }
      try {
        if (chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
            const u = (tabs && tabs[0] && (tabs[0].url || tabs[0].pendingUrl)) ? (tabs[0].url || tabs[0].pendingUrl) : null;
            if (u) {
              const input = document.getElementById('url');
              if (input) input.value = u;
            }
          });
        }
      } catch (e) {
        /* ignore */
      }
    });
  }catch(e){}
})();
