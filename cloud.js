/* Optional Supabase sync. Local study remains usable without a configured project. */
(()=>{'use strict';
const S=OrbitSync,$=s=>document.querySelector(s),K='orbit-cloud-v1',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let adapter,busy=false,timer,choice=null,message='Cloud setup বাকি। Local save চালু আছে।';
const read=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(k))||fallback}catch{return fallback}};
let cfg=read(K+'-config',window.ORBIT_CLOUD_CONFIG),session=read(K+'-session',null);
const persist=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
async function acceptLink(){
 const hash=new URLSearchParams(location.hash.slice(1)),url=new URL(location.href);
 if(!hash.has('access_token')&&!hash.has('error_description'))return;
 const pending=read(K+'-login',null),nonce=url.searchParams.get('orbit_login');
 url.searchParams.delete('orbit_login');url.hash='settings';history.replaceState(null,'',url);
 if(hash.has('error_description'))throw Error(hash.get('error_description'));
 if(!pending||pending.nonce!==nonce||Date.now()-pending.created>3600000)throw Error('এই browser থেকে আবার login link চাও। Email link একই browser-এ খুলতে হবে।');
 const user=await request('/auth/v1/user',null,hash.get('access_token'));
 if(user.email?.toLowerCase()!==pending.email.toLowerCase())throw Error('Login email মেলেনি। আবার link চাও।');
 session={access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),expires_at:Number(hash.get('expires_at'))||Date.now()/1000+Number(hash.get('expires_in')||3600),user};
 if(!session.refresh_token)throw Error('Login session অসম্পূর্ণ। আবার link চাও।');
 persist(K+'-session',session);localStorage.removeItem(K+'-login');mount();
}
const metaKey=()=>K+'-base:'+cfg.url+':'+session.user.id;
function status(s){message=s;const el=$('#cloudStatus');if(el)el.textContent=s;const badge=$('#cloudBadge');if(badge)badge.textContent=s}
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
 return session.access_token;
}
function lock(fn){return navigator.locks?navigator.locks.request('orbit-cloud-sync',fn):fn()}
function remember(row){persist(metaKey(),{base:S.fingerprint(row.payload),revision:row.revision});persist(K+'-owner',cfg.url+':'+session.user.id);}
function showChoice(row,text){choice=row||{revision:0,payload:null};status(text);mount();}
async function sync(action){
 if(busy||!adapter||!cfg?.url||!session)return;
 if(!navigator.onLine){status('Offline · local progress আছে; internet ফিরলে retry হবে।');return}
 busy=true;status('Cloud sync চলছে…');
 try{await lock(async()=>{
  const token=await auth();
  const before=adapter.read(),finger=S.fingerprint(before);
  if(!before)throw Error('Local save conflict মিটিয়ে reload করো।');
  const rows=await request('/rest/v1/orbit_progress?select=payload,revision&user_id=eq.'+encodeURIComponent(session.user.id),null,token);
  const row=rows[0]||null;if(row)row.payload=adapter.validate(row.payload);
  if(S.fingerprint(adapter.read())!==finger)throw Error('পড়ার কাজ বদলেছে; পরের sync-এ নেওয়া হবে।');
  const ownsLocal=read(K+'-owner',null)===cfg.url+':'+session.user.id;
  const decision=S.decide(before,row,ownsLocal?read(metaKey(),null):null);
  if(action&&(!choice||choice.revision!==(row?.revision||0)))return showChoice(row,'Cloud-এ আবার পরিবর্তন এসেছে। Copy আবার বেছে নাও।');
  const mode=action||(decision==='choose'||decision==='conflict'?null:decision);
  if(!mode)return showChoice(row,row?'দুই copy মিলছে না। Backup রেখে কোনটি রাখবে বেছে নাও।':'এই account-এ progress নেই। Local copy upload করে sync শুরু করো।');
  if(mode==='pull'){
   if(!row)throw Error('Cloud copy নেই।');
   if(action)download(before,'before-cloud-restore');
   adapter.replace(row.payload);remember(row);
  }else if(mode==='push'){
   if(action&&row)download(row.payload,'before-cloud-replace');
   const result=await request('/rest/v1/rpc/orbit_save',{p_payload:before,p_revision:row?.revision||0},token);
   if(!result?.length)return showChoice(null,'অন্য device এখনই save করেছে। Sync now চাপো, তারপর copy বেছে নাও।');
   remember(result[0]);
  }else remember(row);
  choice=null;status('✓ Cloud synced · '+new Date().toLocaleTimeString('bn-BD'));mount();
 });}catch(e){status('Sync হয়নি · '+e.message+' · Local data রাখা আছে।')}finally{busy=false;}
}
function changed(){if(!session)return;status('Local saved · cloud sync pending');clearTimeout(timer);timer=setTimeout(()=>sync(),1500)}
function mount(){
 const host=$('#cloudPanel');if(!host)return;
 host.innerHTML=`<p class="eyebrow">YOUR STUDY, EVERYWHERE</p><h2>Cloud sync</h2><p id="cloudStatus" role="status" class="banner info">${esc(message)}</p><p class="micro">Progress, notes, rewards ও routine তোমার Supabase account-এ থাকবে। প্রতিটি device-এ একই email দিয়ে login করো।</p>`;
 if(!cfg?.url){host.innerHTML+=`<p class="muted">Project connection এখনো বসানো হয়নি। cloud-config.js-এ Project URL ও Publishable key বসিয়ে setup SQL চালাতে হবে। Local dashboard আগের মতো ব্যবহার করতে পারো।</p>`;return}
 if(!session){host.innerHTML+=`<form id="cloudLogin"><div class="field"><label for="cloudEmail">Login email</label><input id="cloudEmail" type="email" autocomplete="email" required></div><button class="button" type="submit">Email-এ login link পাঠাও</button></form><form id="cloudVerify" hidden><div class="field"><label for="cloudCode">Email-এর OTP code</label><input id="cloudCode" inputmode="numeric" autocomplete="one-time-code" required></div><button class="button" type="submit">Verify ও login</button></form>`;
  let email='';$('#cloudLogin').onsubmit=async e=>{e.preventDefault();email=$('#cloudEmail').value.trim();const btn=e.target.querySelector('button');btn.disabled=true;try{S.config(cfg.url,cfg.key);if(location.protocol!=='https:'&&location.hostname!=='127.0.0.1'&&location.hostname!=='localhost')throw Error('Login-এর জন্য hosted HTTPS website খোলো।');const nonce=crypto.randomUUID();persist(K+'-login',{nonce,email,created:Date.now()});const redirect=new URL(location.origin+location.pathname);redirect.searchParams.set('orbit_login',nonce);await request('/auth/v1/otp?redirect_to='+encodeURIComponent(redirect.href),{email,create_user:true});status('Email-এর Sign in link এই browser-এ খোলো। Link share করবে না। না পেলে Spam দেখো।');}catch(err){status(err.message)}finally{btn.disabled=false}};
  $('#cloudVerify').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{const next=await request('/auth/v1/verify',{email,token:$('#cloudCode').value.trim(),type:'email'});if(!next.user||!next.access_token)throw Error('Login হয়নি।');session={...next,expires_at:next.expires_at||Date.now()/1000+next.expires_in};persist(K+'-session',session);mount();sync()}catch(err){status(err.message);btn.disabled=false}};
 }else{
  host.innerHTML+=`<p style="overflow-wrap:anywhere">${esc(session.user.email)}</p><div class="toolbar"><button class="button" id="cloudSync">Sync now</button><button class="button subtle" id="cloudLogout">এই browser-এ logout</button></div><p class="micro">খোলা tab-এ প্রতি ৩০ সেকেন্ডে check হয়। Offline edits local-এ থাকে; browser বন্ধ থাকলে sync হয় না। Logout করলেও local copy থাকবে—shared device-এ নিজের browser profile ব্যবহার করো।</p>`;
  $('#cloudSync').onclick=()=>sync();$('#cloudLogout').onclick=async()=>{if(busy)return;clearTimeout(timer);try{await request('/auth/v1/logout?scope=local',{},await auth())}catch{}session=null;localStorage.removeItem(K+'-session');choice=null;status('Logged out · local copy আছে।');mount()};
  if(choice){host.innerHTML+=`<div class="banner"><strong>কোন progress রাখবে?</strong><p>দুটি copy স্বয়ংক্রিয়ভাবে merge হবে না। Replace-এর আগে পুরোনো copy JSON backup download হবে।</p><div class="toolbar"><button id="takeCloud" class="button" ${choice.payload?'':'disabled'}>Cloud copy এই device-এ নাও</button><button id="takeLocal" class="button subtle">এই device-এর copy cloud-এ রাখো</button></div></div>`;
   for(const [id,mode] of [['takeCloud','pull'],['takeLocal','push']])$('#'+id).onclick=()=>{if(confirm(mode==='pull'?'এই device-এর progress cloud copy দিয়ে replace হবে। Backup download হবে। চালাব?':'Cloud progress এই device-এর copy দিয়ে replace হবে। পুরোনো cloud copy backup হবে। চালাব?'))sync(mode)};
  }
 }
}
window.OrbitCloud={async init(a){adapter=a;try{if(cfg?.url){cfg=S.config(cfg.url,cfg.key);await acceptLink();status(session?'Cloud connection ready · sync চলছে…':'Database connected · sync শুরু করতে login করো।')}}catch(e){status(e.message)}mount();if(session&&cfg?.url)sync();setInterval(()=>{if(!document.hidden&&!choice)sync()},30000);window.addEventListener('online',()=>sync());document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!choice)sync()})},mount,changed};
})();
