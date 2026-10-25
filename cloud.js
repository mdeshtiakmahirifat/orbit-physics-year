/* Optional Supabase sync. Local study remains usable without a configured project. */
(()=>{'use strict';
const S=OrbitSync,$=s=>document.querySelector(s),K='orbit-cloud-v1',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let adapter,busy=false,timer,choice=null,message='Cloud setup বাকি। Local save চালু আছে।';
const read=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(k))||fallback}catch{return fallback}};
let cfg=read(K+'-config',window.ORBIT_CLOUD_CONFIG),session=read(K+'-session',null);
const persist=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const OWNER='mdeshtiakmahi@gmail.com';
const L=(bn,en)=>adapter?.language?.()==='en'?en:bn;
function permitted(user,token){try{const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return user?.email?.toLowerCase()===OWNER&&user.app_metadata?.providers?.includes('google')&&claims.amr?.some(x=>x.method==='oauth')}catch{return false}}
async function googleLogin(){
 const settings=await request('/auth/v1/settings');
 if(!settings.external?.google)throw Error(L('Google provider এখনও enabled নয়। Supabase-এ Google OAuth setup শেষ করতে হবে।','Google provider is not enabled yet. Finish Google OAuth setup in Supabase.'));
 const verifier=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const challenge=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const nonce=crypto.randomUUID();persist(K+'-pkce',{verifier,nonce,created:Date.now()});
 const redirect=new URL(location.origin+location.pathname);redirect.searchParams.set('orbit_login',nonce);
 const target=new URL(cfg.url+'/auth/v1/authorize');target.search=new URLSearchParams({provider:'google',redirect_to:redirect.href,code_challenge:challenge,code_challenge_method:'s256',login_hint:OWNER,prompt:'select_account'}).toString();
 location.assign(target.href);
}
async function acceptLink(){
 const url=new URL(location.href),code=url.searchParams.get('code'),hash=new URLSearchParams(location.hash.slice(1));
 if(!code&&!hash.has('error_description')&&!hash.has('access_token'))return;
 const nonce=url.searchParams.get('orbit_login');url.searchParams.delete('code');url.searchParams.delete('orbit_login');url.hash='settings';history.replaceState(null,'',url);
 if(hash.has('error_description'))throw Error(hash.get('error_description'));
 if(!code)throw Error(L('পুরোনো email link নয়; Sign in with Google ব্যবহার করো।','Use Sign in with Google instead of an old email link.'));
 const pending=read(K+'-pkce',null);
 if(!pending||pending.nonce!==nonce||Date.now()-pending.created>3600000)throw Error('Restart Google login in this browser.');
 const next=await request('/auth/v1/token?grant_type=pkce',{auth_code:code,code_verifier:pending.verifier});
 localStorage.removeItem(K+'-pkce');
 const user=await request('/auth/v1/user',null,next.access_token);
 if(!permitted(user,next.access_token)){try{await request('/auth/v1/logout?scope=local',{},next.access_token)}catch{}throw Error(L('শুধু নির্ধারিত Google account অনুমোদিত।','Only the designated Google account is allowed.'));}
 session={...next,user,expires_at:next.expires_at||Date.now()/1000+next.expires_in};persist(K+'-session',session);mount();
}
const metaKey=()=>K+'-base:'+cfg.url+':'+session.user.id;
function status(s){message=s;const translations={'Database connected · sync শুরু করতে login করো।':'Database connected · Sign in to sync.','Cloud connection ready · sync চলছে…':'Cloud connection ready · Syncing…','দুই copy মিলছে না। Backup রেখে কোনটি রাখবে বেছে নাও।':'Copies differ. Keep backups and choose which copy to use.','এই account-এ progress নেই। Local copy upload করে sync শুরু করো।':'No cloud progress yet. Upload the local copy to start sync.','Cloud-এ আবার পরিবর্তন এসেছে। Copy আবার বেছে নাও।':'The cloud copy changed again. Review both copies before choosing.','অন্য device এখনই save করেছে। Sync now চাপো, তারপর copy বেছে নাও।':'Another device saved just now. Sync again and review both copies.'};const display=adapter?.language?.()==='en'?(translations[s]||s):s;const el=$('#cloudStatus');if(el)el.textContent=display;const badge=$('#cloudBadge');if(badge)badge.textContent=display}
function download(data,label){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='orbit-'+label+'-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function request(path,body,token){
 const res=await fetch(cfg.url+path,{method:body?'POST':'GET',headers:{apikey:cfg.key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const data=await res.json().catch(()=>null);if(!res.ok)throw Error(data?.msg||data?.message||data?.error_description||'Cloud request failed ('+res.status+')');return data;
}
async function auth(){
 session=read(K+'-session',null);if(!session)throw Error('আবার login করো।');
 if(session.expires_at*1000<Date.now()+60000){
  const next=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});
  if(!next.access_token||!next.user)throw Error('Login refresh হয়নি। আবার login করো।');
  session={...next,expires_at:next.expires_at||Date.now()/1000+next.expires_in};persist(K+'-session',session);
 }
 if(!permitted(session.user,session.access_token))throw Error(L('এই session Google-only নিয়ম পূরণ করে না। Logout করে Google দিয়ে login করো।','This session does not meet the Google-only rule. Sign out and sign in with Google.'));
 return session.access_token;
}
function lock(fn){return navigator.locks?navigator.locks.request('orbit-cloud-sync',fn):fn()}
function remember(row){persist(metaKey(),{base:S.fingerprint(row.payload),revision:row.revision});persist(K+'-owner',cfg.url+':'+session.user.id);}
function showChoice(row,text){choice=row||{revision:0,payload:null};status(text);mount();}
async function sync(action){
 if(busy||!adapter||!cfg?.url||!session)return;
 if(!navigator.onLine){status(L('Saved locally · Offline; internet ফিরলে retry হবে।','Saved locally · Offline; retry when connected.'));return}
 busy=true;status('Syncing…');
 try{await lock(async()=>{
  const token=await auth();
  const before=adapter.read(),finger=S.fingerprint(before);
  if(!before)throw Error('Local save conflict মিটিয়ে reload করো।');
  const rows=await request('/rest/v1/orbit_progress?select=payload,revision&user_id=eq.'+encodeURIComponent(session.user.id),null,token);
  const row=rows[0]||null;if(row)row.payload=adapter.validate(row.payload);
  if(S.fingerprint(adapter.read())!==finger)throw Error('পড়ার কাজ বদলেছে; পরের sync-এ নেওয়া হবে।');
  const ownsLocal=read(K+'-owner',null)===cfg.url+':'+session.user.id;
  let decision=S.decide(before,row,ownsLocal?read(metaKey(),null):null);
  if(!ownsLocal&&row&&adapter.pristine?.())decision='pull';
  if(!row&&(!read(K+'-owner',null)||ownsLocal))decision='push';
  if(action&&(!choice||choice.revision!==(row?.revision||0)))return showChoice(row,'Cloud-এ আবার পরিবর্তন এসেছে। Copy আবার বেছে নাও।');
  const mode=action||(decision==='choose'||decision==='conflict'?null:decision);
  if(!mode)return showChoice(row,row?'দুই copy মিলছে না। Backup রেখে কোনটি রাখবে বেছে নাও।':'এই account-এ progress নেই। Local copy upload করে sync শুরু করো।');
  if(mode==='pull'){
   if(!row)throw Error('Cloud copy নেই।');
   if(action){persist(K+'-conflict-local',before);download(before,'before-cloud-restore');}
   adapter.replace(row.payload);remember(row);
  }else if(mode==='push'){
   if(action&&row){persist(K+'-conflict-cloud',row.payload);download(row.payload,'before-cloud-replace');}
   const result=await request('/rest/v1/rpc/orbit_save',{p_payload:before,p_revision:row?.revision||0},token);
   if(!result?.length)return showChoice(null,'অন্য device এখনই save করেছে। Sync now চাপো, তারপর copy বেছে নাও।');
   remember(result[0]);
  }else remember(row);
  choice=null;status('✓ Cloud synced · '+new Date().toLocaleTimeString('bn-BD'));mount();
 });}catch(e){status('Sync failed · '+e.message+L(' · Local data অক্ষত।',' · Local data retained.'))}finally{busy=false;}
}
function changed(){if(!session)return;status('Saved locally · sync pending');clearTimeout(timer);timer=setTimeout(()=>sync(),1500)}
function mount(){
 status(message);
 const host=$('#cloudPanel');if(!host)return;
 host.innerHTML=`<p class="eyebrow">YOUR STUDY, EVERYWHERE</p><h2>Cloud sync</h2><p id="cloudStatus" role="status" class="banner info">${esc(message)}</p><p>${L('একই Google account দিয়ে অন্য device-এ login করলে latest synced copy আসবে। Offline কাজ local-এ থাকবে।','Sign in with the same Google account on another device to load the latest synced copy. Offline work stays local.')}</p>`;
 if(!session){host.innerHTML+=`<p>${OWNER}</p><button id="googleLogin" class="button">Sign in with Google</button><p class="micro">${L('Google provider setup না থাকলে স্পষ্ট error দেখাবে; email link দিয়ে restriction এড়াবে না।','An unfinished Google provider setup produces an explicit error; email links cannot bypass the restriction.')}</p>`;
 $('#googleLogin').onclick=async()=>{try{if(adapter.read())await googleLogin()}catch(e){status(e.message)}};
 }else{
 host.innerHTML+=`<p>${esc(session.user.email)}</p><div class="toolbar"><button class="button" id="cloudSync">Sync now</button><button class="button subtle" id="cloudLogout">${L('Logout','Logout')}</button></div><p class="micro">${L('খোলা tab প্রতি ৩০ সেকেন্ডে check করে। Offline edits থাকলে দুই copy সংঘর্ষে confirmation ও backup হবে। Logout-এ local copy মুছবে না; নিজের browser profile ব্যবহার করবে।','Open tabs check every 30 seconds. Conflicting offline edits require confirmation and backups. Signing out retains the local copy; use your own browser profile.')}</p>`;
 $('#cloudSync').onclick=()=>sync();$('#cloudLogout').onclick=async()=>{if(busy)return;clearTimeout(timer);try{await request('/auth/v1/logout?scope=local',{},session.access_token)}catch{}session=null;localStorage.removeItem(K+'-session');choice=null;status('Saved locally · Signed out');mount()};
 if(choice){host.innerHTML+=`<div class="banner"><strong>${L('দুই copy আলাদা—বেছে নেওয়ার আগে backup','Copies differ—back up before choosing')}</strong><p>${L('কোনো copy নীরবে overwrite হবে না। দুইটি backup download করবে।','Neither copy is overwritten silently. Download both backups.')}</p><button id="backupBoth" class="button subtle">${L('দুই copy backup','Back up both copies')}</button><div class="toolbar"><button id="takeCloud" class="button" ${choice.payload?'':'disabled'}>${L('Cloud copy নাও','Use cloud copy')}</button><button id="takeLocal" class="button subtle">${L('Local copy রাখো','Use local copy')}</button></div></div>`;
 $('#backupBoth').onclick=()=>{download(adapter.read(),'local-conflict');if(choice.payload)download(choice.payload,'cloud-conflict')};
 for(const [id,mode] of [['takeCloud','pull'],['takeLocal','push']])$('#'+id).onclick=()=>{if(confirm(L('বদলে যাওয়ার copy backup হবে। নির্বাচিত copy দিয়ে replace করব?','The replaced copy will be backed up. Replace it with the selected copy?')))sync(mode)};
 }
 }
 status(message);
}
window.OrbitCloud={async init(a){adapter=a;try{if(cfg?.url){cfg=S.config(cfg.url,cfg.key);await acceptLink();status(session?'Cloud connection ready · sync চলছে…':'Database connected · sync শুরু করতে login করো।')}}catch(e){status(e.message)}mount();if(session&&cfg?.url)sync();setInterval(()=>{if(!document.hidden&&!choice)sync()},30000);window.addEventListener('online',()=>sync());document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!choice)sync()})},mount,changed};
})();
