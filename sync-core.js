(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OrbitSync=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().filter(k=>k!=='updatedAt').map(k=>[k,canonical(x[k])]));return x}
 const fingerprint=x=>JSON.stringify(canonical(x));
 function decide(local,remote,meta){
  const l=fingerprint(local),r=remote?fingerprint(remote.payload):null;
  if(remote&&l===r)return 'equal';
  if(!meta||meta.base==null)return 'choose';
  if(!remote)return 'choose';
  if(remote.revision===meta.revision)return l===meta.base?'equal':'push';
  return l===meta.base?'pull':'conflict';
 }
 function config(url,key){
  const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.pathname!=='/'||u.search||u.hash||u.username||u.password||u.port)throw Error('সঠিক https://PROJECT.supabase.co URL দাও।');
  if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)){
   try{const raw=key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const body=JSON.parse(typeof atob==='function'?atob(raw):Buffer.from(raw,'base64').toString());if(body.role!=='anon')throw Error()}catch{throw Error('শুধু Publishable বা anon public key দাও; secret/service_role নয়।')}
  }
  return {url:u.origin,key};
 }
 return {fingerprint,decide,config};
});
