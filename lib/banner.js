function showBanner(text, source, missedAt){
  const id = 'openwhen-banner';
  if(document.getElementById(id)) return;
  const banner = document.createElement('div');
  banner.id = id; banner.className = 'openwhen-banner';
  const content = document.createElement('div'); content.className = 'openwhen-content';
  let extra = '';
  if(missedAt){ const d = new Date(Number(missedAt)); if(!isNaN(d.getTime())) extra = `<div class="scheduled">scheduled for ${d.toLocaleString()}</div>`; }
  content.innerHTML = `<strong>opened by OpenWhen (${source})</strong><div class="msg">${text || ''}</div>${extra}`;
  const close = document.createElement('button'); close.className = 'openwhen-close-btn'; close.textContent = '\u00d7'; close.addEventListener('click', () => { banner.remove(); });
  banner.appendChild(content); banner.appendChild(close); document.documentElement.appendChild(banner);
}

module.exports = { showBanner };
