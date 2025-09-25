// content script to show a small banner when extension opens a page
(function(){
  function showBanner(text, source, missedAt){
    try{
      const id = 'openwhen-banner';
      if(document.getElementById(id)) return;
      const banner = document.createElement('div');
      banner.id = id;
      banner.className = 'openwhen-banner';
      const content = document.createElement('div');
      content.className = 'openwhen-content';
  let extra = '';
  try{ if(missedAt){ const d = new Date(Number(missedAt)); if(!isNaN(d.getTime())) extra = `<div style="margin-top:6px;font-weight:400">scheduled for ${d.toLocaleString()}</div>`; } }catch(e){}
  content.innerHTML = `<strong>opened by OpenWhen (${source})</strong><div style="margin-top:6px;font-weight:400">${text || ''}</div>${extra}`;
      const close = document.createElement('button');
      close.className = 'openwhen-close-btn';
      close.textContent = '×';
      close.addEventListener('click', () => { removeBanner(); });
      banner.appendChild(content);
      banner.appendChild(close);
      document.documentElement.appendChild(banner);
  // push page content down using css variable (pages can opt-in by reading the variable)
  const height = banner.offsetHeight + 'px';
  document.documentElement.style.setProperty('--openwhen-banner-height', height);
      function removeBanner(){
        banner.remove();
        document.documentElement.style.setProperty('--openwhen-banner-height', '0px');
      }
    }catch(e){
      // ignore
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if(msg && msg.type === 'openwhen_opened'){
      showBanner(msg.message || '', msg.source || 'scheduled', msg.missedAt || null);
    }
  });
})();
