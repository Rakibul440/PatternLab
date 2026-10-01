'use strict';
// Catalog is immutable; personal data is keyed by semantic problem IDs.
const STORE = 'patternlab:progress:v2', PREFS = 'patternlab:preferences:v2';
const PAGE_SIZE = 20, ids = new Set(CATALOG.map(p => p.id));
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
 bookmark:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z"/></svg>',
 revision:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></svg>'
};
let progress = Object.create(null), storageOK = true, page = 1, toastTimer;
const defaults = {theme:'dark',view:'all',tab:'all',search:'',topic:'',difficulty:'',platform:'',priority:'',status:'',sort:'order',bookmarked:false,revision:false};
let prefs = {...defaults};
const state = id => progress[id] || {status:'Not started',bookmarked:false,revision:false,note:'',updatedAt:null,completedAt:null};
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const timestamp = x => x === null || (typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x)) && Date.parse(x) <= Date.now() + 86400000);

function validateBackup(input) {
  if (!object(input) || input.app !== 'PatternLab' || input.version !== 2 || !object(input.progress)) throw Error('This is not a supported PatternLab v2 backup.');
  if (Object.keys(input.progress).length > 10000) throw Error('The backup contains too many records.');
  const clean = Object.create(null); let skipped = 0;
  for (const [id, s] of Object.entries(input.progress)) {
    if (!ids.has(id)) { skipped++; continue; }
    if (!object(s) || !['Not started','In progress','Done'].includes(s.status) || typeof s.bookmarked !== 'boolean' || typeof s.revision !== 'boolean' || typeof s.note !== 'string' || s.note.length > 20000 || !timestamp(s.updatedAt) || !timestamp(s.completedAt) || (s.status !== 'Done' && s.completedAt !== null)) throw Error('Invalid progress record for ' + id + '. Nothing was imported.');
    clean[id] = {status:s.status,bookmarked:s.bookmarked,revision:s.revision,note:s.note,updatedAt:s.updatedAt,completedAt:s.completedAt};
  }
  if (Object.keys(input.progress).length && !Object.keys(clean).length) throw Error('No recognized problem IDs were found. Nothing was imported.');
  return {clean, skipped};
}
function snapshot() { return {app:'PatternLab',version:2,exportedAt:new Date().toISOString(),progress}; }
let initialWarning = '';
try {
  const saved = localStorage.getItem(STORE);
  if (saved) progress = validateBackup(JSON.parse(saved)).clean;
} catch { initialWarning = 'Saved progress could not be read. This session is still usable; export a backup before leaving.'; storageOK = false; }
try {
  const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
  if (object(p)) for (const key of Object.keys(defaults)) if (typeof p[key] === typeof defaults[key]) prefs[key] = p[key];
} catch { /* Invalid preferences safely fall back to defaults. */ }
if (!['dark','light'].includes(prefs.theme)) prefs.theme='dark';
if (!['all','bookmarks','revision'].includes(prefs.view)) prefs.view='all';
if (!['all','essential','unfinished','done'].includes(prefs.tab)) prefs.tab='all';

function feedback(message) {
  $('#toast').textContent = message; $('#toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500);
}
function storageMessage() {
  $('#saveState').textContent = storageOK ? 'Saved in this browser' : 'Session only · export a backup';
  $('#saveState').classList.toggle('storage-warning', !storageOK);
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(snapshot())); storageOK = true; }
  catch { if (storageOK) feedback('Browser storage is unavailable or full. Your session still works; export a backup.'); storageOK = false; }
  storageMessage();
}
function savePrefs() { try { localStorage.setItem(PREFS,JSON.stringify(prefs)); } catch { /* Progress export remains available. */ } }
function update(id, patch, render = true) {
  const old = state(id), next = {...old,...patch,updatedAt:new Date().toISOString()};
  if (patch.status) next.completedAt = patch.status === 'Done' ? (old.completedAt || next.updatedAt) : null;
  progress[id] = next; save();
  if (render) { renderStats(); renderList(true); }
}
function platforms(p) { return [p.platform,...p.aliases.map(a=>a.platform)]; }
function filtered() {
  const q = prefs.search.trim().toLocaleLowerCase();
  let result = CATALOG.filter(p => {
    const s = state(p.id);
    return (!q || [p.title,p.topic,p.pattern,...platforms(p),...p.aliases.map(a=>a.title)].join(' ').toLocaleLowerCase().includes(q))
      && (!prefs.topic || p.topic===prefs.topic) && (!prefs.difficulty || p.difficulty===prefs.difficulty)
      && (!prefs.platform || platforms(p).includes(prefs.platform)) && (!prefs.priority || p.priority===prefs.priority)
      && (!prefs.status || s.status===prefs.status) && (!prefs.bookmarked || s.bookmarked) && (!prefs.revision || s.revision)
      && (prefs.view!=='bookmarks'||s.bookmarked) && (prefs.view!=='revision'||s.revision)
      && (prefs.tab!=='essential'||p.priority==='Essential') && (prefs.tab!=='unfinished'||s.status!=='Done') && (prefs.tab!=='done'||s.status==='Done');
  });
  const difficulty={Easy:0,Medium:1,Hard:2}, priority={Essential:0,Recommended:1,'Advanced/Optional':2};
  result.sort((a,b) => {
    let delta=0;
    if(prefs.sort==='difficulty') delta=difficulty[a.difficulty]-difficulty[b.difficulty];
    if(prefs.sort==='priority') delta=priority[a.priority]-priority[b.priority];
    if(prefs.sort==='title') delta=a.title.localeCompare(b.title);
    if(prefs.sort==='updated') delta=(Date.parse(state(b.id).updatedAt)||0)-(Date.parse(state(a.id).updatedAt)||0);
    return delta || a.order-b.order;
  });
  return result;
}
function nextRecommended() {
  const list=filtered().filter(p=>state(p.id).status!=='Done').sort((a,b)=>a.order-b.order);
  return list.find(p=>state(p.id).status==='In progress') || list.find(p=>p.priority==='Essential') || list[0];
}
function renderStats() {
  const done=CATALOG.filter(p=>state(p.id).status==='Done').length;
  const bookmarks=CATALOG.filter(p=>state(p.id).bookmarked).length;
  const revision=CATALOG.filter(p=>state(p.id).revision).length;
  const inProgress=CATALOG.filter(p=>state(p.id).status==='In progress').length;
  $('#doneCount').textContent=done; $('#totalCount').textContent='/ '+CATALOG.length;
  $('#progressCount').textContent=inProgress; $('#revisionCount').textContent=revision;
  const pct=Math.round(done/CATALOG.length*100);
  $('#completionPercent').textContent=pct+'% complete'; $('#completionBar').style.width=pct+'%';
  $('#coverageCount').textContent=TOPICS.filter(t=>CATALOG.some(p=>p.topic===t&&state(p.id).status==='Done')).length;
  $('#coverageTotal').textContent='/ '+TOPICS.length+' topics';
  $('#navTotal').textContent=CATALOG.length; $('#navBookmarks').textContent=bookmarks; $('#navRevision').textContent=revision;
  $('#tabTotal').textContent=CATALOG.length; $('#topicCount').textContent=TOPICS.length;
  $('#catalogLabel').textContent=CATALOG.length+' problems · '+new Set(CATALOG.flatMap(platforms)).size+' platforms';
  $('#topicNav').innerHTML=TOPICS.map((t,i)=>{
    const list=CATALOG.filter(p=>p.topic===t), done=list.filter(p=>state(p.id).status==='Done').length;
    return `<button data-topic="${esc(t)}" class="${prefs.topic===t?'active':''}" aria-pressed="${prefs.topic===t}" title="${esc(t)}: ${done} of ${list.length} solved"><span class="topic-num">${String(i+1).padStart(2,'0')}</span><span>${esc(t)}</span><span class="topic-pct">${done}/${list.length}</span><span class="topic-dot ${done?'started':''}"></span></button>`;
  }).join('');
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===prefs.view);b.setAttribute('aria-pressed',String(b.dataset.view===prefs.view));});
  document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b.dataset.tab===prefs.tab);b.setAttribute('aria-pressed',String(b.dataset.tab===prefs.tab));});
  const titles={all:'Practice library',bookmarks:'Your bookmarks',revision:'Revision queue'};
  $('#viewTitle').textContent=prefs.topic || titles[prefs.view];
  $('#viewSubtitle').textContent=prefs.view==='revision'?'Revisit the ideas that deserve another attempt.':prefs.view==='bookmarks'?'A personal shortlist for your next practice session.':'Learn the pattern. Solve the problem. Make it stick.';
  const next=nextRecommended();
  $('#continueTitle').textContent=next?next.title:'You’re all caught up in this view.';
  $('#continueMeta').textContent=next?`${next.topic}  ·  ${next.difficulty}  ·  ${next.platform}`:'Change your filters to explore more problems.';
  $('#continueLabel').textContent=next&&state(next.id).status==='In progress'?'PICK UP WHERE YOU LEFT OFF':'YOUR NEXT RECOMMENDED STEP';
  $('#continue').disabled=!next;
  $('#continue').textContent=next&&state(next.id).status==='In progress'?'Continue practicing ↗':'Start practicing ↗';
}
function dateText(value) { return value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Never'; }
function problemHTML(p) {
  const s=state(p.id), id=esc(p.id);
  return `<article class="problem panel" data-problem="${id}" id="problem-${id}">
    <div class="problem-main"><span class="order">${String(p.order).padStart(3,'0')}</span><div class="problem-body">
      <div class="problem-title"><h3><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}<span class="external" aria-label="opens in new tab">↗</span></a></h3><span class="badge difficulty-${p.difficulty.toLowerCase()}" title="${p.nativeDifficulty===p.difficulty?'Native difficulty':'Editorial difficulty estimate'}">${p.difficulty}${p.nativeDifficulty===p.difficulty?'':' ≈'}</span>${p.premium?'<span class="badge priority-other">Premium</span>':''}</div>
      <div class="badges"><span class="platform"><span class="platform-symbol" aria-hidden="true">${({LeetCode:'〈〉',CSES:'◆',Codeforces:'▥',AtCoder:'A',HackerRank:'H',GeeksforGeeks:'G',InterviewBit:'IB'})[p.platform]}</span>${esc(p.platform)}</span><span class="dot-sep">·</span><span>${esc(p.pattern)}</span><span class="badge ${p.priority==='Essential'?'priority-essential':'priority-other'}">${esc(p.priority)}</span></div>
    </div><div class="problem-controls"><select class="status-select ${s.status.toLowerCase().replace(' ','-')}" data-status="${id}" aria-label="Status for ${esc(p.title)}">${['Not started','In progress','Done'].map(x=>`<option${s.status===x?' selected':''}>${x}</option>`).join('')}</select><button class="toggle-button" data-bookmark="${id}" aria-pressed="${s.bookmarked}" aria-label="Bookmark ${esc(p.title)}" title="Bookmark">${icons.bookmark}</button><button class="toggle-button" data-revision="${id}" aria-pressed="${s.revision}" aria-label="Needs revision: ${esc(p.title)}" title="Needs revision">${icons.revision}</button></div></div>
    <details class="problem-details" data-details="${id}"><summary>Hint, notes & problem details${s.note?' · Has notes':''}${s.revision?' · Needs revision':''}</summary><div class="details-content">
      <div class="detail-grid"><div><h4>${esc(p.topic)} · ${esc(p.priority)} (editorial)</h4><p>${esc(p.why)}</p></div><div><h4>Source & difficulty</h4><p>Native: ${esc(p.nativeDifficulty||'Not provided / not verified')} · Browse level: ${p.difficulty}${p.nativeDifficulty===p.difficulty?'':' (estimate)'}</p><p>URL: ${esc(p.verification)}${p.verifiedOn?' · '+p.verifiedOn:''}${p.source?` · <a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">Source</a>`:''}</p></div></div>
      ${p.aliases.length?`<div class="aliases"><h4>Related platform versions</h4>${p.aliases.map(a=>`<p><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.platform)} · ${esc(a.title)} ↗</a> — ${esc(a.verification)}</p>`).join('')}</div>`:''}
      <details class="hint"><summary>A small nudge</summary><p>${esc(p.hint)}</p></details>
      <label class="note-label">Your notes<textarea class="notes" data-note="${id}" maxlength="20000" placeholder="Your approach, complexity, edge cases, or what to try next…">${esc(s.note)}</textarea></label>
      <p class="timestamp">Updated: <span data-updated="${id}">${esc(dateText(s.updatedAt))}</span> · Completed: ${esc(dateText(s.completedAt))}</p>
    </div></details></article>`;
}
function renderList(preserve=false) {
  const open=preserve?[...document.querySelectorAll('[data-details][open]')].map(d=>d.dataset.details):[];
  const active=document.activeElement, focusKey=active?.dataset ? ['status','bookmark','revision'].find(k=>active.dataset[k]):null;
  const focusId=focusKey?active.dataset[focusKey]:null;
  const result=filtered(), pages=Math.max(1,Math.ceil(result.length/PAGE_SIZE));
  page=Math.min(page,pages); const start=(page-1)*PAGE_SIZE;
  $('#resultCount').innerHTML=`<strong>${result.length}</strong> matching problems <span>of ${CATALOG.length}</span>`;
  $('#problems').innerHTML=result.length?result.slice(start,start+PAGE_SIZE).map(problemHTML).join(''):'<div class="empty panel"><div class="empty-symbol">⌕</div><h3>No problems in this view.</h3><p>Try a broader search, clear the filters, or return to all problems.</p><button class="button primary" data-empty-clear>Show all problems</button></div>';
  for(const d of document.querySelectorAll('[data-details]')) if(open.includes(d.dataset.details))d.open=true;
  if(focusKey){const next=[...document.querySelectorAll('[data-'+focusKey+']')].find(el=>el.dataset[focusKey]===focusId);if(next)next.focus({preventScroll:true});else $('#library').focus({preventScroll:true});}
  $('#pageInfo').textContent=result.length?`${start+1}–${Math.min(start+PAGE_SIZE,result.length)} of ${result.length} · Page ${page} of ${pages}`:'0 results';
  $('#previous').disabled=page===1; $('#next').disabled=page===pages;
}
function render(){renderStats();renderList();}
function applyPreferences(){for(const k of ['search','topic','difficulty','platform','priority','status','sort']) {$('#'+k).value=prefs[k];if($('#'+k).value!==prefs[k])prefs[k]=$('#'+k).value;}for(const k of ['bookmarked','revision'])$('#'+k).checked=prefs[k];}
function changed(){page=1;savePrefs();render();}
function clearFilters(){prefs={...defaults,theme:prefs.theme};applyPreferences();changed();}
function selectView(view){prefs.view=view;prefs.tab='all';prefs.topic='';prefs.status='';prefs.bookmarked=false;prefs.revision=false;applyPreferences();changed();closeNav();}
function goToProblem(p){
  const result=filtered();page=Math.floor(result.findIndex(x=>x.id===p.id)/PAGE_SIZE)+1;renderList();
  const article=document.getElementById('problem-'+p.id);if(!article)return;
  article.querySelector('details').open=true;article.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
  article.querySelector('a').focus({preventScroll:true});article.classList.add('flash');setTimeout(()=>article.classList.remove('flash'),1600);
}
function setTheme(){document.documentElement.dataset.theme=prefs.theme;$('#theme').textContent=prefs.theme==='dark'?'☼':'☾';$('#theme').setAttribute('aria-label','Switch to '+(prefs.theme==='dark'?'light':'dark')+' theme');document.querySelector('meta[name=theme-color]').content=prefs.theme==='dark'?'#10131c':'#f5f6fb';}
function closeNav(){$('#sidebar').classList.remove('open');$('#openNav').setAttribute('aria-expanded','false');}

// Initialize controls once. Event delegation keeps large catalogs responsive.
for(const t of TOPICS)$('#topic').add(new Option(t,t));
for(const p of [...new Set(CATALOG.flatMap(platforms))].sort())$('#platform').add(new Option(p,p));
applyPreferences();setTheme();
for(const key of ['search','topic','difficulty','platform','priority','status','sort','bookmarked','revision'])$('#'+key).addEventListener(key==='search'?'input':'change',e=>{prefs[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;changed();});
$('#mainNav').onclick=e=>{const b=e.target.closest('[data-view]');if(b)selectView(b.dataset.view);};
$('.brand').onclick=e=>{e.preventDefault();clearFilters();window.scrollTo({top:0});closeNav();};
$('#topicNav').onclick=e=>{const b=e.target.closest('[data-topic]');if(!b)return;prefs.topic=prefs.topic===b.dataset.topic?'':b.dataset.topic;applyPreferences();changed();closeNav();};
$('.view-tabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(b){prefs.tab=b.dataset.tab;changed();}};
$('#problems').onchange=e=>{if(e.target.dataset.status)update(e.target.dataset.status,{status:e.target.value});};
$('#problems').onclick=e=>{const b=e.target.closest('button');if(!b)return;for(const key of ['bookmark','revision'])if(b.dataset[key]){const id=b.dataset[key],flag=key==='bookmark'?'bookmarked':'revision';update(id,{[flag]:!state(id)[flag]});feedback(flag==='bookmarked'?(state(id)[flag]?'Bookmarked for later.':'Bookmark removed.'):(state(id)[flag]?'Added to your revision queue.':'Removed from revision queue.'));}if(b.hasAttribute('data-empty-clear'))clearFilters();};
$('#problems').oninput=e=>{if(e.target.dataset.note){const id=e.target.dataset.note;update(id,{note:e.target.value},false);const article=e.target.closest('article');article.querySelector('[data-updated]').textContent=dateText(state(id).updatedAt);}};
$('#clear').onclick=clearFilters;
$('#previous').onclick=()=>{page--;renderList();$('#library').scrollIntoView({block:'start'});};
$('#next').onclick=()=>{page++;renderList();$('#library').scrollIntoView({block:'start'});};
$('#revisionStat').onclick=()=>selectView('revision');
$('#random').onclick=()=>{const list=filtered().filter(p=>state(p.id).status!=='Done');if(!list.length)return feedback('No unfinished problems match these filters.');goToProblem(list[Math.floor(Math.random()*list.length)]);};
$('#continue').onclick=()=>{const p=nextRecommended();if(p){if(state(p.id).status==='Not started'&&prefs.status!=='Not started')update(p.id,{status:'In progress'});goToProblem(p);}};
$('#theme').onclick=()=>{prefs.theme=prefs.theme==='dark'?'light':'dark';setTheme();savePrefs();};
$('#openNav').onclick=()=>{$('#sidebar').classList.add('open');$('#openNav').setAttribute('aria-expanded','true');$('#closeNav').focus();};
$('#closeNav').onclick=()=>{closeNav();$('#openNav').focus();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeNav();}if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();$('#search').focus();}});
document.addEventListener('click',e=>{if($('#sidebar').classList.contains('open')&&!e.target.closest('#sidebar')&&!e.target.closest('#openNav'))closeNav();});
$('#backup').onclick=()=>$('#dataDialog').showModal();
$('#methodology').onclick=()=>$('#aboutDialog').showModal();
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
$('#catalogInfo').innerHTML=`<p><strong>${CATALOG.length} distinct entries</strong> across ${TOPICS.length} topics and ${new Set(CATALOG.flatMap(platforms)).size} platforms. ${CATALOG.filter(p=>p.verification!=='Not verified').length} primary links matched an official catalog or page title; ${CATALOG.filter(p=>p.verification==='Not verified').length} remain unverified. Individual source links and verification details appear inside each entry.</p>`;
$('#export').onclick=()=>{
  const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='patternlab-progress-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback('Progress backup downloaded.');
};
$('#import').onclick=()=>$('#importFile').click();
$('#importFile').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>10*1024*1024)throw Error('This file exceeds the 10 MB import limit.');
    const {clean,skipped}=validateBackup(JSON.parse(await file.text()));
    const replace=$('#importMode').value==='replace';
    if(replace&&!confirm('Replace all current progress, notes, bookmarks, and revision flags with this validated backup? Export first if you need to keep the current data.'))return;
    if(replace)progress=clean;
    else for(const [id,s] of Object.entries(clean))if(!progress[id]||(Date.parse(s.updatedAt)||0)>(Date.parse(progress[id].updatedAt)||0))progress[id]=s;
    save();render();const message=`Backup ${replace?'restored':'merged'}: ${Object.keys(clean).length} recognized records${skipped?'; '+skipped+' unknown IDs skipped':''}.`;
    $('#importFeedback').textContent=message;feedback(message);
  }catch(error){$('#importFeedback').textContent='Import failed: '+error.message;feedback('Import failed. Your current progress is unchanged.');}
  finally{e.target.value='';}
};
$('#reset').onclick=()=>{if(confirm('Permanently clear all PatternLab progress, notes, bookmarks, and revision flags in this browser? Export a backup first if needed.')){progress=Object.create(null);save();render();$('#importFeedback').textContent='All progress has been reset.';feedback('Progress reset. A fresh start.');}};
render();
// Probe storage even when no progress has been created yet.
try{localStorage.setItem('patternlab:probe','1');localStorage.removeItem('patternlab:probe');}catch{storageOK=false;initialWarning='Browser storage is blocked. Practice normally, then export your progress before closing.';}
storageMessage();if(initialWarning)feedback(initialWarning);
