/**
 * app.js
 * Full client-side application logic for YesShare!
 *
 * Features included:
 * - Firebase init (Auth + Realtime Database)
 * - Theme toggle (light/dark)
 * - Auth: register (username,email,password), login, logout
 * - Profile: avatar upload (client-side resize + Base64 stored in /users/{uid}/photo),
 *            profile avatar in topbar and popover with meta
 * - Create page flow: two-step modal (content -> slug) supporting "rich" and "html" pages
 * - Slug validation + uniqueness check
 * - Publish pages to Realtime DB under /pages/{slug}
 * - Open pages: HTML pages are rendered in a blob-based iframe (allow-scripts, NO allow-same-origin)
 *              so external CSS/JS CDNs (e.g. Tailwind CDN) can load and style the page
 * - Limited postMessage channel between page iframe and parent (only current iframe, limited API)
 * - Comments per page: stored under /pages/{slug}/comments, UI shows avatar + name + comment
 * - Search: diacritic-insensitive / partial matching across title + content (returns relevant pages)
 *
 * IMPORTANT:
 * - The DB rules you set should match earlier guidance (users writable only by owner, pages readable/writeable per auth).
 * - We intentionally DO NOT set allow-same-origin for iframes. Scripts from CDNs run, but the iframe remains origin-isolated.
 * - postMessage handling only replies to messages from the active iframe window to reduce risk.
 *
 * Save this file as app.js in the same folder as index.html and style.css.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-analytics.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getDatabase,
  ref as dbRef,
  set,
  get,
  update,
  push
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* === FIREBASE CONFIG ===
   Replace firebaseConfig only if your project uses a different config.
   The project config used here matches the demo earlier.
*/
const firebaseConfig = {
  apiKey: "AIzaSyC2Othb6-uKSCDqV33qZMPebK2Kr35wcJ4",
  authDomain: "yeschat-705e3.firebaseapp.com",
  databaseURL: "https://yeschat-705e3-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "yeschat-705e3",
  storageBucket: "yeschat-705e3.firebasestorage.app",
  messagingSenderId: "822569522357",
  appId: "1:822569522357:web:e799216327f0264ef9dafc",
  measurementId: "G-XTBN06NQCL"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth();
const db = getDatabase();

/* === UI references (must match IDs in index.html) === */
const searchInput = document.getElementById('searchInput');
const goBtn = document.getElementById('goBtn');
const createPageBtn = document.getElementById('createPageBtn');

const openLogin = document.getElementById('openLogin');
const authModal = document.getElementById('authModal');
const closeAuth = document.getElementById('closeAuth');
const toRegister = document.getElementById('toRegister');
const toLogin = document.getElementById('toLogin');
const formLogin = document.getElementById('formLogin');
const formRegister = document.getElementById('formRegister');
const loginSubmit = document.getElementById('loginSubmit');
const regSubmit = document.getElementById('regSubmit');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const regEmail = document.getElementById('regEmail');
const regPassword = document.getElementById('regPassword');
const regUsername = document.getElementById('regUsername');
const themeToggle = document.getElementById('themeToggle');

const profileWrapper = document.getElementById('profileWrapper');
const profileAvatarBtn = document.getElementById('profileAvatar');
const profilePopover = document.getElementById('profilePopover');
const profilePopoverClose = document.getElementById('profilePopoverClose');
const popoverUsername = document.getElementById('popoverUsername');
const popoverEmail = document.getElementById('popoverEmail');
const popoverCount = document.getElementById('popoverCount');
const popoverAvatar = document.getElementById('popoverAvatar');
const avatarInput = document.getElementById('avatarInput');
const popoverLogout = document.getElementById('popoverLogout');

const modal = document.getElementById('modal'); // create page modal
const pageType = document.getElementById('pageType');
const pageTitle = document.getElementById('pageTitle');
const richEditor = document.getElementById('richEditor');
const richContent = document.getElementById('richContent');
const htmlEditor = document.getElementById('htmlEditor');
const htmlContent = document.getElementById('htmlContent');
const toStep2 = document.getElementById('toStep2');
const backToStep1 = document.getElementById('backToStep1');
const pageSlug = document.getElementById('pageSlug');
const checkSlug = document.getElementById('checkSlug');
const publishBtn = document.getElementById('publishBtn');
const cancelBtn = document.getElementById('cancelBtn');
const step1Msg = document.getElementById('step1Msg');
const step2Msg = document.getElementById('step2Msg');

const pageView = document.getElementById('pageView');
const openUrl = document.getElementById('openUrl');
const commentsContainer = document.getElementById('commentsContainer');
const searchResults = document.getElementById('searchResults');

let currentUser = null;
let stagedPage = null;

/* === Theme management (keeps user preference) === */
const THEME_KEY = 'ys_theme';
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  if(themeToggle) themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
}
function initTheme(){
  const stored = localStorage.getItem(THEME_KEY);
  if(stored === 'dark' || stored === 'light'){ applyTheme(stored); return; }
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}
function toggleTheme(){
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
}
if(themeToggle) themeToggle.addEventListener('click', toggleTheme);
initTheme();

/* === Utility helpers === */
function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
// remove diacritics for normalized search
function normalizeText(s){ if(!s) return ''; return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function containsNonAscii(s){ return /[^\x00-\x7F]/.test(s); }

/* === User metadata cache === */
const userMetaCache = {};
async function getUserMeta(uid){
  if(!uid) return null;
  if(userMetaCache[uid]) return userMetaCache[uid];
  const snap = await get(dbRef(db, 'users/' + uid));
  const val = snap.exists() ? snap.val() : null;
  userMetaCache[uid] = val;
  return val;
}

/* === Avatar image helper (set element content or default silhouette) === */
function setAvatarImage(el, dataUrl){
  if(!el) return;
  el.classList.remove('default');
  el.innerHTML = '';
  if(dataUrl){
    const img = document.createElement('img');
    img.src = dataUrl;
    el.appendChild(img);
  } else {
    el.classList.add('default');
    el.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5z" fill="#6b7280"/><path d="M3 20c0-3.866 3.582-7 9-7s9 3.134 9 7v1H3v-1z" fill="#9ca3af"/></svg>';
  }
}

/* === Client-side image resize + compress for avatar upload (returns data URL) === */
function resizeImageFileToDataUrl(file, maxSize = 128, quality = 0.75){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nem olvasható a fájl.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if(w > h){
          if(w > maxSize){ h = Math.round(h * (maxSize / w)); w = maxSize; }
        } else {
          if(h > maxSize){ w = Math.round(w * (maxSize / h)); h = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
        ctx.drawImage(img, 0, 0, w, h);
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        } catch(err){ reject(err); }
      };
      img.onerror = () => reject(new Error('Érvénytelen képformátum.'));
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* === postMessage channel: only accept messages from current iframe window === */
let currentIframeWindow = null;
window.addEventListener('message', async (ev) => {
  if(!ev.data || typeof ev.data !== 'object') return;
  if(ev.source !== currentIframeWindow) return; // only respond to active iframe
  const data = ev.data;
  try {
    if(data.type === 'requestUserMeta' && data.ownerUid){
      const meta = await getUserMeta(data.ownerUid) || {};
      // compute pages count
      const pagesSnap = await get(dbRef(db, 'pages'));
      const pagesVal = pagesSnap.val() || {};
      const entries = Object.entries(pagesVal);
      const count = entries.filter(([s,p]) => p.ownerUid === data.ownerUid).length;
      ev.source.postMessage({ type:'userMetaResponse', ownerUid: data.ownerUid, meta: { username: meta.username || '(no-name)', email: meta.email || '—', count } }, '*');
    } else if(data.type === 'requestAddComment' && data.slug && data.text){
      if(!currentUser){
        ev.source.postMessage({ type:'commentAdded', success:false, reason:'not-auth' }, '*');
        return;
      }
      const comment = { uid: currentUser.uid, text: String(data.text).slice(0,2000), createdAt: Date.now() };
      await push(dbRef(db, `pages/${data.slug}/comments`), comment);
      ev.source.postMessage({ type:'commentAdded', success:true, comment }, '*');
      if(openUrl.textContent === data.slug + '.yes') renderCommentsForSlug(data.slug);
    }
  } catch(err) {
    try{ ev.source.postMessage({ type:'error', message: err.message || String(err) }, '*'); }catch(e){}
  }
});

/* === openPage: loads page data and renders; HTML pages -> blob iframe (allow-scripts, but NO allow-same-origin) === */
let lastBlobUrl = null;
function revokeLastBlob(){
  try{ if(lastBlobUrl){ URL.revokeObjectURL(lastBlobUrl); lastBlobUrl = null; } }catch(e){}
}

async function openPage(slug){
  if(!slug) return;
  openUrl.textContent = slug + '.yes';
  const snap = await get(dbRef(db, 'pages/' + slug));
  if(!snap.exists()){
    pageView.innerHTML = '<div style="color:#888">Oldal nem található: '+escapeHtml(slug)+'.yes</div>';
    commentsContainer.innerHTML = '';
    currentIframeWindow = null;
    revokeLastBlob();
    return;
  }
  const data = snap.val();
  // clear previous
  revokeLastBlob();
  pageView.innerHTML = '';
  currentIframeWindow = null;

  if(data.isHtml){
    const iframe = document.createElement('iframe');
    iframe.className = 'pageIframe';
    // allow-scripts so CDNs can run (e.g. tailwind CDN)
    // do NOT use allow-same-origin
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation');
    const html = data.content || '<!doctype html><html><body></body></html>';
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    lastBlobUrl = url;
    iframe.src = url;
    iframe.title = slug + '.yes';
    pageView.appendChild(iframe);
    iframe.addEventListener('load', ()=> {
      try { currentIframeWindow = iframe.contentWindow; } catch(e){ currentIframeWindow = null; }
    });
  } else {
    // rich content: directly inject
    pageView.innerHTML = data.content || '';
    currentIframeWindow = null;
  }

  // load comment UI for this page
  renderCommentSection(slug);
}

/* === Comments: render form and list; storage under pages/{slug}/comments === */
async function renderCommentSection(slug){
  commentsContainer.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'commentsSection';

  const title = document.createElement('h4'); title.textContent = 'Kommentek';
  wrapper.appendChild(title);

  // if logged in, show form
  if(currentUser){
    const form = document.createElement('div'); form.className = 'commentForm';
    const ta = document.createElement('textarea'); ta.placeholder = 'Írd ide a hozzászólásodat...'; ta.rows = 3;
    const btn = document.createElement('button'); btn.textContent = 'Küldés';
    form.appendChild(ta); form.appendChild(btn);
    wrapper.appendChild(form);
    btn.addEventListener('click', async ()=> {
      const text = (ta.value || '').trim();
      if(!text) return alert('Írj valamit a kommenthez.');
      const comment = { uid: currentUser.uid, text: text.slice(0,1500), createdAt: Date.now() };
      await push(dbRef(db, `pages/${slug}/comments`), comment);
      ta.value = '';
      await renderCommentsForSlug(slug);
    });
  } else {
    const info = document.createElement('div'); info.style.marginBottom='8px'; info.style.color='var(--soft-text)';
    info.textContent = 'Jelentkezz be a kommenteléshez.';
    wrapper.appendChild(info);
  }

  const list = document.createElement('div'); list.className = 'commentsList';
  wrapper.appendChild(list);
  commentsContainer.appendChild(wrapper);

  await renderCommentsForSlug(slug);
}

async function renderCommentsForSlug(slug){
  const list = commentsContainer.querySelector('.commentsList');
  if(!list) return;
  list.innerHTML = '';
  const snap = await get(dbRef(db, `pages/${slug}/comments`));
  const val = snap.val() || {};
  const entries = Object.entries(val).map(([k,v]) => ({ key:k, ...v }));
  entries.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
  for(const c of entries){
    const item = document.createElement('div'); item.className = 'commentItem';
    const avatarWrap = document.createElement('div'); avatarWrap.className = 'commentAvatar';
    const meta = await getUserMeta(c.uid) || {};
    if(meta.photo){
      const img = document.createElement('img'); img.src = meta.photo; avatarWrap.appendChild(img);
    } else {
      avatarWrap.classList.add('default');
      avatarWrap.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5z" fill="#6b7280"/><path d="M3 20c0-3.866 3.582-7 9-7s9 3.134 9 7v1H3v-1z" fill="#9ca3af"/></svg>';
    }

    const body = document.createElement('div'); body.className = 'commentBody';
    const author = document.createElement('div'); author.className = 'commentAuthor'; author.textContent = meta.username || '(no-name)';
    const text = document.createElement('div'); text.className = 'commentText'; text.textContent = c.text || '';
    const metaLine = document.createElement('div'); metaLine.className = 'commentMeta'; metaLine.textContent = new Date(c.createdAt||0).toLocaleString();

    body.appendChild(author); body.appendChild(text); body.appendChild(metaLine);
    item.appendChild(avatarWrap); item.appendChild(body);
    list.appendChild(item);

    // avatar popover -> show name, email, count
    avatarWrap.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const ownerMeta = await getUserMeta(c.uid) || {};
      const pagesSnap = await get(dbRef(db, 'pages'));
      const pagesVal = pagesSnap.val() || {};
      const count = Object.entries(pagesVal).filter(([s,p]) => p.ownerUid === c.uid).length;
      const pop = document.createElement('div'); pop.className = 'miniUserPopover';
      pop.style.position = 'absolute'; pop.style.zIndex = 140; pop.style.padding='10px'; pop.style.borderRadius='8px';
      pop.style.boxShadow = '0 8px 30px rgba(0,0,0,0.12)';
      pop.style.background = document.documentElement.getAttribute('data-theme') === 'dark' ? 'rgba(15,23,42,0.95)' : '#fff';
      pop.innerHTML = `<div style="font-weight:700">${escapeHtml(ownerMeta.username||'(no-name)')}</div>
                       <div style="color:var(--soft-text);font-size:13px">${escapeHtml(ownerMeta.email||'—')}</div>
                       <div style="margin-top:8px;color:var(--soft-text);font-size:13px">Oldalak száma: ${count}</div>
                       <div style="margin-top:8px;text-align:right"><button class="miniClose">Bezár</button></div>`;
      document.body.appendChild(pop);
      const rect = avatarWrap.getBoundingClientRect();
      pop.style.left = Math.max(8, rect.left + window.scrollX) + 'px';
      pop.style.top = Math.max(8, rect.bottom + window.scrollY + 6) + 'px';
      function removePop(){ pop.remove(); document.removeEventListener('click', onDocClick); }
      function onDocClick(e){ if(!pop.contains(e.target)) removePop(); }
      document.addEventListener('click', onDocClick);
      const closeBtn = pop.querySelector('.miniClose'); if(closeBtn) closeBtn.addEventListener('click', removePop);
    });
  }
}

/* === Search: diacritic-insensitive + partial matching on title/content === */
async function performSearch(q){
  const queryNorm = normalizeText(q || '');
  const pagesSnap = await get(dbRef(db, 'pages'));
  const val = pagesSnap.val() || {};
  const entries = Object.entries(val);
  const results = [];
  for(const [slug,data] of entries){
    const title = normalizeText(data.title || '');
    const content = normalizeText((data.content || '').replace(/<[^>]*>/g,' '));
    let score = 0;
    if(title.includes(queryNorm)) score += 5;
    for(const token of queryNorm.split(/\s+/).filter(Boolean)){
      if(title.includes(token)) score += 3;
      const cnt = content.split(token).length - 1;
      score += cnt;
    }
    if(score > 0) results.push({ slug, data, score });
  }
  results.sort((a,b) => b.score - a.score);
  // owner meta
  const ownerCache = {};
  for(const r of results){
    const uid = r.data.ownerUid;
    if(uid){
      if(!ownerCache[uid]) ownerCache[uid] = await getUserMeta(uid) || { username:'(no-name)', email:'—', photo:null };
      r.ownerMeta = ownerCache[uid];
    } else r.ownerMeta = { username:'(no-owner)', email:'—', photo:null };
  }
  renderSearchResults(results);
}

function renderSearchResults(results){
  if(!searchResults) return;
  searchResults.innerHTML = '';
  if(results.length === 0){
    searchResults.textContent = 'Nincsenek találatok.';
    return;
  }

  results.forEach((r, idx) => {
    const row = document.createElement('div'); row.className = 'result';

    const avatarWrap = document.createElement('div'); avatarWrap.className = 'resultAvatar';
    if(r.ownerMeta.photo){
      const img = document.createElement('img'); img.src = r.ownerMeta.photo; avatarWrap.appendChild(img);
    } else {
      avatarWrap.classList.add('default');
      avatarWrap.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5z" fill="#6b7280"/><path d="M3 20c0-3.866 3.582-7 9-7s9 3.134 9 7v1H3v-1z" fill="#9ca3af"/></svg>';
    }
    row.appendChild(avatarWrap);

    const body = document.createElement('div'); body.className = 'resultBody';
    const ownerLine = document.createElement('div'); ownerLine.className = 'resultOwner';
    ownerLine.textContent = `${r.ownerMeta.username || '(no-name)'} • ${r.ownerMeta.email || '—'}`;
    body.appendChild(ownerLine);

    const title = document.createElement('a'); title.className = 'resultTitle'; title.href = '#';
    title.textContent = `${r.slug}.yes — ${r.data.title || ''}`;
    title.addEventListener('click', (e) => { e.preventDefault(); openPage(r.slug); });
    body.appendChild(title);

    const linkLine = document.createElement('div'); linkLine.className = 'resultLink';
    linkLine.textContent = `${r.slug}.yes`;
    body.appendChild(linkLine);

    row.appendChild(body);
    searchResults.appendChild(row);

    // separator
    const sep = document.createElement('div'); sep.className = 'resultSeparator';
    searchResults.appendChild(sep);

    // avatar click -> popover with author meta
    avatarWrap.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const ownerUid = r.data.ownerUid;
      const meta = await getUserMeta(ownerUid) || {};
      const pagesSnap = await get(dbRef(db, 'pages'));
      const pagesVal = pagesSnap.val() || {};
      const count = Object.entries(pagesVal).filter(([s,p]) => p.ownerUid === ownerUid).length;
      const pop = document.createElement('div'); pop.className = 'miniUserPopover';
      pop.style.position = 'absolute'; pop.style.zIndex=120; pop.style.padding='10px'; pop.style.borderRadius='8px';
      pop.style.boxShadow = '0 8px 30px rgba(0,0,0,0.12)';
      pop.style.background = document.documentElement.getAttribute('data-theme') === 'dark' ? 'rgba(15,23,42,0.95)' : '#fff';
      pop.innerHTML = `<div style="font-weight:700">${escapeHtml(meta.username||'(no-name)')}</div>
                       <div style="color:var(--soft-text);font-size:13px">${escapeHtml(meta.email||'—')}</div>
                       <div style="margin-top:8px;color:var(--soft-text);font-size:13px">Oldalak száma: ${count}</div>
                       <div style="margin-top:8px;text-align:right"><button class="miniClose">Bezár</button></div>`;
      document.body.appendChild(pop);
      const rect = avatarWrap.getBoundingClientRect();
      pop.style.left = Math.max(8, rect.left + window.scrollX) + 'px';
      pop.style.top = Math.max(8, rect.bottom + window.scrollY + 6) + 'px';
      function removePop(){ pop.remove(); document.removeEventListener('click', onDocClick); }
      function onDocClick(e){ if(!pop.contains(e.target)) removePop(); }
      document.addEventListener('click', onDocClick);
      const closeBtn = pop.querySelector('.miniClose'); if(closeBtn) closeBtn.addEventListener('click', removePop);
    });
  });
}

/* === Search handlers (input/enter) and url-like styling === */
function updateSearchInputState(){
  if(!searchInput) return;
  const raw = (searchInput.value || '').trim();
  const lower = raw.toLowerCase();
  if(lower.endsWith('.yes')){
    const before = raw.slice(0, -4);
    if(before.length > 0 && !containsNonAscii(before) && /^[a-z0-9\-\_\(\)\!\+\?\:\%]+$/.test(before.toLowerCase())){
      searchInput.classList.add('url-like');
      return;
    }
  }
  searchInput.classList.remove('url-like');
}
if(searchInput){
  searchInput.addEventListener('input', updateSearchInputState);
  searchInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') goBtn && goBtn.click(); });
}
if(goBtn) goBtn.addEventListener('click', () => {
  const qRaw = (searchInput.value || '').trim();
  if(!qRaw) return;
  const qLower = qRaw.toLowerCase();
  if(qLower.endsWith('.yes')){
    const before = qRaw.slice(0, -4);
    if(containsNonAscii(before)) { performSearch(qRaw); return; }
    if(/^[a-z0-9\-\_\(\)\!\+\?\:\%]+$/.test(before.toLowerCase())) openPage(before.toLowerCase());
    else performSearch(qRaw);
  } else {
    performSearch(qRaw);
  }
});

/* === Create page flow: open modal only when logged in (createPageBtn wired earlier) === */
if(createPageBtn){
  createPageBtn.addEventListener('click', ()=> {
    if(!currentUser) return alert('Előbb jelentkezz be.');
    pageSlug.value = ''; pageTitle.value = ''; richContent.innerHTML = ''; htmlContent.value = '';
    stagedPage = null;
    document.getElementById('step1').style.display = 'block';
    document.getElementById('step2').style.display = 'none';
    if(publishBtn){ publishBtn.disabled = true; publishBtn.setAttribute('disabled','disabled'); }
    modal.classList.remove('hidden');
  });
}
if(cancelBtn) cancelBtn.addEventListener('click', ()=> modal.classList.add('hidden'));
if(pageType) pageType.addEventListener('change', ()=> {
  if(pageType.value === 'rich'){ richEditor.style.display = 'block'; htmlEditor.style.display = 'none'; }
  else { richEditor.style.display = 'none'; htmlEditor.style.display = 'block'; }
});
if(toStep2) toStep2.addEventListener('click', ()=> {
  const isHtml = pageType.value === 'html';
  const content = isHtml ? (htmlContent.value || '') : (richContent.innerHTML || '');
  const title = (pageTitle.value || '').trim();
  if(!content || content.trim().length < 1){ step1Msg.textContent = 'A tartalom nem lehet üres.'; return; }
  stagedPage = { isHtml, content, title: title || '(no title)', ownerUid: currentUser ? currentUser.uid : null, createdAt: Date.now() };
  step1Msg.textContent = '';
  document.getElementById('step1').style.display = 'none';
  document.getElementById('step2').style.display = 'block';
  step2Msg.textContent = 'Add meg a slug-ot (csak ékezet nélküli abc, szám, - _ ( ) ! + ? : % )';
  if(publishBtn){ publishBtn.disabled = true; publishBtn.setAttribute('disabled','disabled'); }
});
if(backToStep1) backToStep1.addEventListener('click', ()=> {
  document.getElementById('step2').style.display = 'none';
  document.getElementById('step1').style.display = 'block';
  step2Msg.textContent = '';
});

/* === Slug validation and publish === */
function validateSlug(s){ if(!s) return false; const re = /^[a-z0-9\-\_\(\)\!\+\?\:\%]+$/; return re.test(s); }

let slugCheckTimer = null;
if(pageSlug){
  pageSlug.addEventListener('input', ()=> {
    const raw = (pageSlug.value || '').trim();
    const slug = raw.toLowerCase();
    if(!validateSlug(slug)){
      step2Msg.style.color = 'red';
      step2Msg.textContent = 'Érvénytelen slug — csak kisbetűk, számok és -_()!+?:% engedett.';
      if(publishBtn){ publishBtn.disabled = true; publishBtn.setAttribute('disabled','disabled'); }
      return;
    }
    if(slugCheckTimer) clearTimeout(slugCheckTimer);
    slugCheckTimer = setTimeout(async ()=>{
      const pRef = dbRef(db, 'pages/' + slug);
      const snap = await get(pRef);
      if(snap.exists()){
        step2Msg.style.color = 'red';
        step2Msg.textContent = 'Ez a slug már foglalt.';
        if(publishBtn){ publishBtn.disabled = true; publishBtn.setAttribute('disabled','disabled'); }
      } else {
        step2Msg.style.color = 'green';
        step2Msg.textContent = 'Szabad: ' + slug + '.yes';
        if(publishBtn){ publishBtn.disabled = false; publishBtn.removeAttribute('disabled'); publishBtn.type = 'button'; }
      }
    }, 350);
  });
}

if(publishBtn){
  publishBtn.addEventListener('click', async ()=> {
    const raw = (pageSlug.value || '').trim().toLowerCase();
    if(!validateSlug(raw)){ step2Msg.textContent = 'Érvénytelen slug.'; return; }
    const pRef = dbRef(db, 'pages/' + raw);
    const snap = await get(pRef);
    if(snap.exists()){ step2Msg.textContent = 'A slug most foglalt lett — válassz másikat.'; publishBtn.disabled = true; return; }
    const data = Object.assign({}, stagedPage, { ownerUid: currentUser.uid, slug: raw });
    await set(pRef, data);
    step2Msg.style.color = 'green';
    step2Msg.textContent = 'Sikeres közzététel: ' + raw + '.yes';
    modal.classList.add('hidden');
    if(publishBtn){ publishBtn.disabled = true; publishBtn.setAttribute('disabled','disabled'); }
    await loadProfile(currentUser.uid);
  });
}

/* === Avatar upload handler (client-side resize + Base64 saved to /users/{uid}/photo) === */
if(avatarInput){
  avatarInput.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    if(!f.type.startsWith('image/')) return alert('Kérlek képet válassz.');
    const MAX_ORIGINAL_BYTES = 512 * 1024;
    if(f.size > MAX_ORIGINAL_BYTES && !confirm('A fájl nagy (>' + Math.round(MAX_ORIGINAL_BYTES/1024) + 'KB). Folytatod?')){ avatarInput.value = ''; return; }
    try {
      const dataUrl = await resizeImageFileToDataUrl(f, 128, 0.75);
      const approxBytes = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 3/4);
      const SOFT_LIMIT = 120 * 1024;
      let finalDataUrl = dataUrl;
      if(approxBytes > SOFT_LIMIT){
        const dataUrl2 = await resizeImageFileToDataUrl(f, 128, 0.55);
        const approx2 = Math.round((dataUrl2.length - 'data:image/jpeg;base64,'.length) * 3/4);
        if(approx2 <= SOFT_LIMIT) finalDataUrl = dataUrl2;
        else {
          if(!confirm('A tömörített kép még nagy (' + Math.round(approx2/1024) + 'KB). Elfogadod a mentést?')){ avatarInput.value = ''; return; }
          finalDataUrl = dataUrl2;
        }
      }
      if(!currentUser) return alert('Előbb jelentkezz be.');
      await update(dbRef(db, 'users/' + currentUser.uid), { photo: finalDataUrl });
      setAvatarImage(profileAvatarBtn, finalDataUrl);
      setAvatarImage(popoverAvatar, finalDataUrl);
      alert('Kép elmentve (Base64, tömörítve).');
    } catch(err){
      console.error(err);
      alert('Hiba a kép feldolgozásakor: ' + (err.message || err));
    } finally { avatarInput.value = ''; }
  });
}

/* === onAuthStateChanged: update UI when user logs in/out === */
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if(user){
    // hide login button, show profile wrapper
    if(openLogin) openLogin.style.display = 'none';
    if(profileWrapper) profileWrapper.classList.remove('hidden');

    // load user metadata
    const userRef = dbRef(db, 'users/' + user.uid);
    const snap = await get(userRef);
    const meta = snap.exists() ? snap.val() : { username:'(no-name)', email: user.email, photo: null };

    if(popoverUsername) popoverUsername.textContent = meta.username || '(no-name)';
    if(popoverEmail) popoverEmail.textContent = meta.email || user.email || '—';

    // avatar
    const photo = meta.photo || null;
    setAvatarImage(profileAvatarBtn, photo);
    setAvatarImage(popoverAvatar, photo);

    // pages count
    const pagesSnap = await get(dbRef(db, 'pages'));
    const pagesVal = pagesSnap.val() || {};
    const entries = Object.entries(pagesVal);
    const userPages = entries.filter(([slug,data]) => data.ownerUid === user.uid);
    if(popoverCount) popoverCount.textContent = String(userPages.length);

    // show logout (popoverLogout)
    if(popoverLogout) popoverLogout.addEventListener('click', async ()=> await doLogout());

    // avatar click -> toggle popover
    if(profileAvatarBtn) profileAvatarBtn.addEventListener('click', (e)=> { e.stopPropagation(); if(profilePopover) profilePopover.classList.toggle('hidden'); });

    // close popover button
    if(profilePopoverClose) profilePopoverClose.addEventListener('click', ()=> profilePopover && profilePopover.classList.add('hidden'));

    // close popover on outside click
    document.addEventListener('click', (ev)=> {
      if(!profilePopover) return;
      if(profilePopover.classList.contains('hidden')) return;
      const t = ev.target;
      if(profilePopover.contains(t) || (profileAvatarBtn && profileAvatarBtn.contains(t))) return;
      profilePopover.classList.add('hidden');
    });
  } else {
    // logged out
    if(openLogin) openLogin.style.display = 'inline-block';
    if(profileWrapper) profileWrapper.classList.add('hidden');
    if(popoverUsername) popoverUsername.textContent = '—';
    if(popoverEmail) popoverEmail.textContent = '—';
    if(popoverCount) popoverCount.textContent = '0';
  }
});

/* helper logout wrapper */
async function doLogout(){
  try { await signOut(auth); } catch(e){ alert('Hiba: ' + e.message); }
}

/* === Register / Login handlers === */
if(toRegister) toRegister.addEventListener('click', ()=> { if(formLogin && formRegister){ formLogin.style.display='none'; formRegister.style.display='block'; document.getElementById('authTitle').textContent='Regisztráció'; }});
if(toLogin) toLogin.addEventListener('click', ()=> { if(formRegister && formLogin){ formRegister.style.display='none'; formLogin.style.display='block'; document.getElementById('authTitle').textContent='Bejelentkezés'; }});
if(closeAuth) closeAuth.addEventListener('click', ()=> authModal.classList.add('hidden'));

if(regSubmit){
  regSubmit.addEventListener('click', async ()=> {
    const username = (regUsername && regUsername.value || '').trim();
    const email = (regEmail && regEmail.value || '').trim();
    const pw = (regPassword && regPassword.value || '');
    if(!username) return alert('Adj meg felhasználónevet.');
    if(!email || pw.length < 6) return alert('Adj meg érvényes emailt és legalább 6 karakteres jelszót.');
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      const uid = cred.user.uid;
      await set(dbRef(db, 'users/' + uid), { username, email, photo: null, createdAt: Date.now() });
      alert('Sikeres regisztráció.');
      authModal.classList.add('hidden');
    } catch(e){ alert('Hiba: ' + e.message); }
  });
}

if(loginSubmit){
  loginSubmit.addEventListener('click', async ()=> {
    const email = (loginEmail && loginEmail.value || '').trim();
    const pw = (loginPassword && loginPassword.value || '');
    if(!email || !pw) return alert('Adj meg emailt és jelszót.');
    try {
      await signInWithEmailAndPassword(auth, email, pw);
      alert('Sikeres bejelentkezés.');
      authModal.classList.add('hidden');
    } catch(e){ alert('Hiba: ' + e.message); }
  });
}

/* === loadProfile helper (updates any sidebar/popover counts; reused after publish) === */
async function loadProfile(uid){
  const pagesSnap = await get(dbRef(db, 'pages'));
  const val = pagesSnap.val() || {};
  const entries = Object.entries(val);
  const userPages = entries.filter(([slug,data]) => data.ownerUid === uid);
  if(popoverCount) popoverCount.textContent = String(userPages.length);
}

/* === Clean up blob URL on unload === */
window.addEventListener('beforeunload', ()=> { revokeLastBlob(); });

/* === Initial query param check: open slug if ?slug=... present === */
(function checkQuery(){
  const params = new URLSearchParams(location.search);
  const s = params.get('slug');
  if(s){
    if(searchInput) searchInput.value = s + '.yes';
    openPage(s);
  }
})();