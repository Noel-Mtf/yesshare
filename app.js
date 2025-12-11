import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-analytics.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* === FIREBASE CONFIG === */
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

// UI elements
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

const loginBtn = document.getElementById('openLogin');
const logoutBtn = document.getElementById('logoutBtn');
const createPageBtn = document.getElementById('createPageBtn');
const profileEmail = document.getElementById('profileEmail');
const profileCount = document.getElementById('profileCount');
const profileLinks = document.getElementById('profileLinks');
const modal = document.getElementById('modal');
const pageType = document.getElementById('pageType');
const pageSlug = document.getElementById('pageSlug');
const pageTitle = document.getElementById('pageTitle');
const richEditor = document.getElementById('richEditor');
const htmlEditor = document.getElementById('htmlEditor');
const richContent = document.getElementById('richContent');
const htmlContent = document.getElementById('htmlContent');
const publishBtn = document.getElementById('publishBtn');
const cancelBtn = document.getElementById('cancelBtn');
const toStep2 = document.getElementById('toStep2');
const backToStep1 = document.getElementById('backToStep1');
const checkSlug = document.getElementById('checkSlug');
const step1Msg = document.getElementById('step1Msg');
const step2Msg = document.getElementById('step2Msg');

const searchInput = document.getElementById('searchInput');
const goBtn = document.getElementById('goBtn');
const pageView = document.getElementById('pageView');
const openUrl = document.getElementById('openUrl');
const searchResults = document.getElementById('searchResults');

let currentUser = null;
let stagedPage = null;

// Auth modal handlers
openLogin.addEventListener('click', ()=> { authModal.classList.remove('hidden'); });
closeAuth.addEventListener('click', ()=> authModal.classList.add('hidden'));
toRegister.addEventListener('click', ()=> { formLogin.style.display='none'; formRegister.style.display='block'; document.getElementById('authTitle').textContent='Regisztráció'; });
toLogin.addEventListener('click', ()=> { formRegister.style.display='none'; formLogin.style.display='block'; document.getElementById('authTitle').textContent='Bejelentkezés'; });

regSubmit.addEventListener('click', ()=> {
  const email = regEmail.value; const pw = regPassword.value;
  if(!email || pw.length<6) return alert('Adj meg érvényes emailt és legalább 6 karakteres jelszót.');
  createUserWithEmailAndPassword(auth, email, pw).then(()=>{ alert('Sikeres regisztráció.'); authModal.classList.add('hidden'); })
  .catch(e=>alert('Hiba: '+e.message));
});

loginSubmit.addEventListener('click', ()=> {
  const email = loginEmail.value; const pw = loginPassword.value;
  if(!email || !pw) return alert('Adj meg emailt és jelszót.');
  signInWithEmailAndPassword(auth, email, pw).then(()=>{ alert('Sikeres bejelentkezés.'); authModal.classList.add('hidden'); })
  .catch(e=>alert('Hiba: '+e.message));
});

logoutBtn.addEventListener('click', ()=> { signOut(auth).catch(e=>alert(e.message)); });

onAuthStateChanged(auth, user => {
  currentUser = user;
  if(user){
    document.getElementById('authArea').innerHTML = '<div>Bejelentkezve: '+(user.email||'—')+'</div>';
    logoutBtn.style.display='inline-block';
    loadProfile(user.uid);
  } else {
    document.getElementById('authArea').innerHTML = '<button id="openLogin">Bejelentkezés / Regisztráció</button>';
    document.getElementById('openLogin').addEventListener('click', ()=> authModal.classList.remove('hidden'));
    logoutBtn.style.display='none';
    profileEmail.textContent='—'; profileCount.textContent='0'; profileLinks.innerHTML='';
  }
});

// Profile load
async function loadProfile(uid){
  const pagesRef = ref(db, 'pages');
  const snap = await get(pagesRef);
  const val = snap.val() || {};
  const entries = Object.entries(val);
  const userPages = entries.filter(([slug,data])=> data.ownerUid===uid);
  profileEmail.textContent = (currentUser && currentUser.email) || '—';
  profileCount.textContent = userPages.length;
  profileLinks.innerHTML='';
  userPages.forEach(([slug,data])=>{
    const a = document.createElement('a');
    a.href='#'; a.textContent = slug + '.yes — ' + (data.title||'');
    a.addEventListener('click',(e)=>{ e.preventDefault(); openPage(slug); });
    profileLinks.appendChild(a);
  });
  searchResults.innerHTML='';
}

// Create page flow
createPageBtn.addEventListener('click', ()=> {
  if(!currentUser) return alert('Előbb jelentkezz be.');
  pageSlug.value=''; pageTitle.value=''; richContent.innerHTML=''; htmlContent.value=''; step1Msg.textContent=''; step2Msg.textContent='';
  stagedPage = null;
  document.getElementById('step1').style.display='block';
  document.getElementById('step2').style.display='none';
  modal.classList.remove('hidden');
});

cancelBtn.addEventListener('click', ()=> modal.classList.add('hidden'));

pageType.addEventListener('change', ()=> {
  if(pageType.value==='rich'){ richEditor.style.display='block'; htmlEditor.style.display='none'; }
  else { richEditor.style.display='none'; htmlEditor.style.display='block'; }
});

toStep2.addEventListener('click', ()=> {
  // validate content
  const isHtml = pageType.value==='html';
  const content = isHtml ? htmlContent.value : richContent.innerHTML;
  const title = (pageTitle.value||'').trim();
  if(!content || content.trim().length<1){ step1Msg.textContent='A tartalom nem lehet üres.'; return; }
  stagedPage = { isHtml, content, title: title || '(no title)', ownerUid: currentUser.uid, createdAt: Date.now() };
  step1Msg.textContent='';
  document.getElementById('step1').style.display='none';
  document.getElementById('step2').style.display='block';
  step2Msg.textContent='Add meg a slug-ot (csak ékezet nélküli abc, szám, - _ ( ) ! + ? : % )';
});

backToStep1.addEventListener('click', ()=> {
  document.getElementById('step2').style.display='none';
  document.getElementById('step1').style.display='block';
  step2Msg.textContent='';
});

// slug validation: allow a-z0-9 and these specials -_()!+?:% (no spaces, no ékezet)
function validateSlug(s){
  if(!s) return false;
  const re = /^[a-z0-9\-\_\(\)\!\+\?\:\%]+$/;
  return re.test(s);
}

checkSlug.addEventListener('click', async ()=> {
  const raw = (pageSlug.value||'').trim();
  const slug = raw.toLowerCase();
  if(!validateSlug(slug)){ step2Msg.textContent='Érvénytelen slug — csak kisbetűk, számok és -_()!+?:% engedett.'; return; }
  const pRef = ref(db, 'pages/' + slug);
  const snap = await get(pRef);
  if(snap.exists()){ step2Msg.textContent='Ez a slug már foglalt.'; publishBtn.disabled=true; }
  else { step2Msg.style.color='green'; step2Msg.textContent='Szabad: ' + slug + '.yes'; publishBtn.disabled=false; }
});

publishBtn.addEventListener('click', async ()=> {
  const raw = (pageSlug.value||'').trim().toLowerCase();
  if(!validateSlug(raw)){ step2Msg.textContent='Érvénytelen slug.'; return; }
  const pRef = ref(db, 'pages/' + raw);
  const snap = await get(pRef);
  if(snap.exists()){ step2Msg.textContent='A slug most foglalt lett — válassz másikat.'; publishBtn.disabled=true; return; }
  // save
  const data = Object.assign({}, stagedPage, { ownerUid: currentUser.uid, slug: raw });
  await set(pRef, data);
  step2Msg.style.color='green';
  step2Msg.textContent='Sikeres közzététel: ' + raw + '.yes';
  modal.classList.add('hidden');
  loadProfile(currentUser.uid);
});

// Search & open behavior
goBtn.addEventListener('click', ()=> {
  const q = (searchInput.value||'').trim();
  if(!q) return;
  if(q.toLowerCase().endsWith('.yes')){
    const before = q.slice(0, -4).toLowerCase();
    // if invalid slug characters, treat as plain search
    if(validateSlug(before)) openPage(before);
    else performSearch(q);
  } else {
    // if looks like a valid slug without .yes (e.g., hello) open directly if exists
    if(validateSlug(q.toLowerCase())) openPage(q.toLowerCase());
    else performSearch(q);
  }
});

async function openPage(slug){
  if(!slug) return;
  openUrl.textContent = slug + '.yes';
  const pRef = ref(db, 'pages/' + slug);
  const snap = await get(pRef);
  if(!snap.exists()){
    pageView.innerHTML = '<div style="color:#888">Oldal nem található: '+slug+'.yes</div>';
    return;
  }
  const data = snap.val();
  if(data.isHtml){
    pageView.innerHTML = data.content;
  } else {
    pageView.innerHTML = data.content;
  }
}

// simple search across pages (title + content)
async function performSearch(q){
  q = q.toLowerCase();
  const pagesRef = ref(db, 'pages');
  const snap = await get(pagesRef);
  const val = snap.val() || {};
  const entries = Object.entries(val);
  const scored = entries.map(([slug,data])=>{
    const title = (data.title||'').toLowerCase();
    const content = (data.content||'').toLowerCase().replace(/<[^>]*>/g,' ');
    const titleScore = (title.split(q).length -1) * 3;
    const contentScore = (content.split(q).length -1);
    const score = titleScore + contentScore;
    return {slug, data, score};
  }).filter(s=>s.score>0);
  scored.sort((a,b)=>b.score - a.score);
  renderSearchResults(scored, q);
}

function renderSearchResults(results, q=''){
  searchResults.innerHTML='';
  if(results.length===0){ searchResults.textContent='Nincsenek találatok.'; return; }
  results.forEach(r=>{
    const div = document.createElement('div');
    div.className='result';
    const a = document.createElement('a');
    a.href='#';
    a.textContent = r.slug + '.yes — ' + (r.data.title||'');
    a.addEventListener('click',(e)=>{ e.preventDefault(); openPage(r.slug); });
    div.appendChild(a);
    const snippet = document.createElement('div');
    const plain = (r.data.content||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    let snippetText = plain.slice(0,220);
    if(q && plain.toLowerCase().includes(q)){
      const idx = plain.toLowerCase().indexOf(q);
      const start = Math.max(0, idx-30);
      snippetText = (start>0? '...':'') + plain.slice(start, idx+q.length+60) + (idx+q.length+60 < plain.length ? '...' : '');
    }
    snippet.textContent = snippetText;
    div.appendChild(snippet);
    searchResults.appendChild(div);
  });
}

// helper: allow opening by pressing Enter
searchInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') goBtn.click(); });

// initial: attempt to load query param slug if present
(function checkQuery(){
  const params = new URLSearchParams(location.search);
  const s = params.get('slug');
  if(s) openPage(s);
})();