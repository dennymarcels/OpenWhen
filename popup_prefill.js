// popup_prefill.js — prefill the popup URL field from storage or active tab
(function(){
  try{
    if(chrome.storage && chrome.storage.local){
      chrome.storage.local.get(['openwhen_prefill_url'], res => {
            const u = res && res.openwhen_prefill_url;
            if (u) {
              const input = document.getElementById('url');
              if (input) {
                input.value = u;
                try{ if(window.sessionStorage) window.sessionStorage.setItem('openwhen_prefill_toast','1'); }catch(e){}
              }
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
                  const v = (tabs && tabs[0] && (tabs[0].url || tabs[0].pendingUrl)) ? (tabs[0].url || tabs[0].pendingUrl) : null;
                  if (v) {
                    const input = document.getElementById('url');
                    if (input) {
                      input.value = v;
                      try{ if(window.sessionStorage) window.sessionStorage.setItem('openwhen_prefill_toast','1'); }catch(e){}
                    }
                  }
                });
              }
            } catch (e) {
              /* ignore */
            }
      });
    }
  }catch(e){}
})();
