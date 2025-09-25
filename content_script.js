// content script to show a small banner when extension opens a page
(function(){
  function showBanner(text, source, missedAt){
    try{
      const id = 'openwhen-banner';
      if(document.getElementById(id)) return;
      const banner = document.createElement('div');
      banner.id = id; banner.className = 'openwhen-banner';
      const content = document.createElement('div'); content.className = 'openwhen-content';
      let extra = '';
      if(missedAt){ const d = new Date(Number(missedAt)); if(!isNaN(d.getTime())) extra = `<div style="margin-top:6px;font-weight:400">scheduled for ${d.toLocaleString()}</div>`; }
      content.innerHTML = `<strong>opened by OpenWhen (${source})</strong><div style="margin-top:6px;font-weight:400">${text || ''}</div>${extra}`;
      const close = document.createElement('button'); close.className = 'openwhen-close-btn'; close.textContent = '\u00d7'; close.addEventListener('click', () => { banner.remove(); document.documentElement.style.setProperty('--openwhen-banner-height', '0px'); });
      banner.appendChild(content); banner.appendChild(close); document.documentElement.appendChild(banner);
      document.documentElement.style.setProperty('--openwhen-banner-height', banner.offsetHeight + 'px');
    }catch(e){ }
  }
  chrome.runtime.onMessage.addListener((msg) => { if(msg && msg.type === 'openwhen_opened') showBanner(msg.message || '', msg.source || 'scheduled', msg.missedAt || null); });
})();
