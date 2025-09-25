// lightweight scheduler helpers extracted for unit testing
function computeNextForSchedule(s){
  const now = new Date();
  if(s.type === 'once'){ const t = new Date(s.when).getTime(); return t > now.getTime() ? t : null; }
  const [hour, minute] = (s.time || '00:00').split(':').map(Number);
  if(s.type === 'daily'){ const next = new Date(now); next.setHours(hour, minute, 0, 0); if(next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1); return next.getTime(); }
  if(s.type === 'weekly'){ if(!Array.isArray(s.days) || s.days.length === 0) return null; const candidates = s.days.map(d => { const candidate = new Date(now); const currentDow = candidate.getDay(); let delta = (d - currentDow + 7) % 7; candidate.setDate(candidate.getDate() + delta); candidate.setHours(hour, minute, 0, 0); if(candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 7); return candidate.getTime(); }); return Math.min(...candidates);
  }
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

module.exports = { computeNextForSchedule, occurrencesBetween };
