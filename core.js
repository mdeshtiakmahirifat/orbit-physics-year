(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.StudyCore=factory()})(globalThis,function(){
 'use strict';
 const VERSION=1;
 const iso=d=>d.toISOString().slice(0,10);
 const add=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return iso(d)};
 const weekday=s=>new Date(s+'T12:00:00Z').getUTCDay();
 const week=s=>add(s,-((weekday(s)+6)%7));
 const defaults=()=>({version:VERSION,settings:{days:[0,1,2,3,4],minutes:660,recovery:60,weeklyGoal:5,reward:'',name:'',start:'2026-10-25',theme:'light',language:'bn'},tasks:{},plans:{},notes:{},weeks:{},timer:null,updatedAt:null});
 const complete=(state,id)=>{const x=state.tasks[id]||{};return !!(x.read&&x.practice&&x.review)};
 const spent=(state,id)=>Object.values(state.plans).flat().filter(s=>s.taskId===id&&s.done).reduce((a,s)=>a+s.minutes,0);
 const reserved=(state,id,asOf='0000-00-00')=>Object.values(state.plans).flat().filter(s=>s.taskId===id&&!s.done&&s.recovery&&s.date>=asOf).reduce((a,s)=>a+s.minutes,0);
 const remaining=(state,t)=>complete(state,t.id)?0:Math.max(15,t.minutes-spent(state,t.id));
 function allowed(state,t,d){
  const wd=weekday(d);
  if(t.archived)return false;
  if(d<='2026-11-12')return ['Physics','Mathematics','Chemistry','History','ICT','Math private'].includes(t.subject);
  if(wd===5)return t.subject==='CSE';
  if(wd===6)return t.subject==='Skills';
  if(!state.settings.days.includes(wd))return false;
  const rules={Chemistry:[0,1],ICT:[2,3],History:[4],CSE:[],Skills:[]};
  return !rules[t.subject]||rules[t.subject].includes(wd);
 }
 function activeDay(state,d){return d<='2026-11-12'||[5,6].includes(weekday(d))||state.settings.days.includes(weekday(d))}
 function makePlan(state,tasks,d,budget=state.settings.minutes){
  if(!activeDay(state,d))return [];
  let left=budget;const arr=[];
  const fixed=t=>['Math private','BCS','English'].includes(t.subject)?0:1;
  for(const t of tasks.filter(t=>t.date===d&&!complete(state,t.id)&&!state.tasks[t.id]?.paused).sort((a,b)=>fixed(a)-fixed(b)||a.priority-b.priority||a.order-b.order)){
   if(!allowed(state,t,d)||left<15)continue;
   const n=Math.min(remaining(state,t),left);
   arr.push({id:'base:'+t.id,taskId:t.id,date:d,minutes:n,done:false,recovery:false});left-=n;
  }
  return arr.sort((a,b)=>{const ta=tasks.find(t=>t.id===a.taskId),tb=tasks.find(t=>t.id===b.taskId);return ta.order-tb.order});
 }
 function backlog(state,tasks,today){return tasks.filter(t=>!t.archived&&t.date>=state.settings.start&&t.date<today&&!complete(state,t.id)&&!state.tasks[t.id]?.paused).sort((a,b)=>a.priority-b.priority||a.date.localeCompare(b.date)||a.order-b.order)}
 function recover(state,tasks,today,days=7){
  const candidates=backlog(state,tasks,today);const alloc=new Map();const output=[];
  for(let k=1;k<=days;k++){
   const d=add(today,k);if(d>'2027-06-01'||!activeDay(state,d))continue;
   const existing=state.plans[d];
   // Preserve existing, user-visible plans; never displace completed/started sessions.
   const preserved=existing?existing.slice():[];
   let room=Math.max(0,state.settings.minutes-preserved.reduce((a,s)=>a+s.minutes,0));
   let cap=Math.min(state.settings.recovery,room);let sessions=[];
   for(const t of candidates){
    if(cap<15||sessions.length>=2)break;
    if(!allowed(state,t,d))continue;
    const rem=Math.max(0,remaining(state,t)-reserved(state,t.id,today)-(alloc.get(t.id)||0));
    if(rem<15)continue;
    const minutes=Math.min(45,cap,rem);
    sessions.push({id:'recovery:'+d+':'+t.id,taskId:t.id,date:d,minutes,done:false,recovery:true});
    alloc.set(t.id,(alloc.get(t.id)||0)+minutes);cap-=minutes;
   }
   if(sessions.length){
    const mins=sessions.reduce((a,s)=>a+s.minutes,0);
    const base=existing?preserved:makePlan(state,tasks,d,state.settings.minutes-mins);
    output.push({date:d,sessions,base,total:mins+base.reduce((a,s)=>a+s.minutes,0)});
   }
  }
  return {days:output,minutes:[...alloc.values()].reduce((a,n)=>a+n,0),taskCount:alloc.size,pending:candidates.length};
 }
 function dayStats(state,d){const p=state.plans[d]||[];const total=p.reduce((a,s)=>a+s.minutes,0),done=p.filter(s=>s.done).reduce((a,s)=>a+s.minutes,0);return {total,done,success:total>0&&done>=total,percent:total?Math.round(done/total*100):0}}
 function weekStats(state,d){const start=week(d),dates=Array.from({length:7},(_,i)=>add(start,i));return {start,dates,completed:dates.filter(x=>dayStats(state,x).success).length,minutes:dates.reduce((a,x)=>a+dayStats(state,x).done,0)}}
 function consistency(state,today){
  let best=0,run=0;const dates=Object.keys(state.plans).filter(d=>d<=today).sort();
  if(!dates.length)return {best:0,current:0,lifetime:0};
  let lifetime=0;
  for(let d=dates[0];d<=today;d=add(d,1)){
   if(dayStats(state,d).success){run++;lifetime++;best=Math.max(best,run)}
   else if(d<today&&state.settings.days.includes(weekday(d)))run=0;
  }
  return {best,current:run,lifetime};
 }
 function validate(input,taskIds){
  if(!input||input.version!==VERSION||!input.settings||!input.tasks||!input.plans)throw Error('এই backup-এর format সমর্থিত নয়।');
  const s={...defaults(),...input,tasks:{},plans:{},notes:{},weeks:{}},st=input.settings;
  if(!Array.isArray(st.days)||!st.days.length||st.days.some(x=>!Number.isInteger(x)||x<0||x>6))throw Error('Study days invalid');
  if(!Number.isInteger(st.minutes)||st.minutes<60||st.minutes>780||!Number.isInteger(st.recovery)||st.recovery<15||st.recovery>120)throw Error('Daily capacity invalid');
  if(!Number.isInteger(st.weeklyGoal)||st.weeklyGoal<1||st.weeklyGoal>7||!/^202[67]-\d\d-\d\d$/.test(st.start)||st.start<'2026-10-24'||st.start>'2027-06-01')throw Error('Study settings invalid');
  s.settings={...s.settings,...st,days:[...new Set(st.days)],reward:String(st.reward||'').slice(0,1000),name:String(st.name||'').slice(0,80)};
  const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>='2026-10-24'&&d<='2027-06-01';
  for(const [id,t]of Object.entries(input.tasks)){if(!taskIds.has(id))throw Error('Unknown task in backup');s.tasks[id]={...t,read:!!t.read,practice:!!t.practice,review:!!t.review,paused:!!t.paused,note:String(t.note||'').slice(0,10000),topic:String(t.topic||'').slice(0,1000),resource:String(t.resource||'').slice(0,2000),goal:String(t.goal||'').slice(0,2000)}}
  const ids=new Set();
  for(const[d,list]of Object.entries(input.plans)){
   if(!validDate(d)||!Array.isArray(list)||list.length>30)throw Error('Invalid plan');
   s.plans[d]=list.map(x=>{if(!taskIds.has(x.taskId)||!Number.isInteger(x.minutes)||x.minutes<1||x.minutes>780||typeof x.id!=='string'||ids.has(x.id))throw Error('Invalid or duplicate session');ids.add(x.id);return {...x,id:x.id,taskId:x.taskId,date:d,minutes:x.minutes,done:!!x.done,recovery:!!x.recovery}});
  }
  for(const[d,n]of Object.entries(input.notes||{})){if(validDate(d))s.notes[d]=String(n).slice(0,10000)}
  for(const[d,w]of Object.entries(input.weeks||{})){if(validDate(d)||d==='2026-10-19')s.weeks[d]={...w,reward:String(w.reward||'').slice(0,1000),claimed:!!w.claimed}}
  s.updatedAt=typeof input.updatedAt==='string'?input.updatedAt:null;
  return s;
 }
 return {VERSION,defaults,activeDay,add,weekday,week,complete,remaining,reserved,spent,allowed,makePlan,backlog,recover,dayStats,weekStats,consistency,validate};
});
