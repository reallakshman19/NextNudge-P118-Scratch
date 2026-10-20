import {assertScratchRepo} from './revamp/scratch-identity.mjs';
import {validate} from './schema.mjs';
export const REPO='reallakshman19/NextNudge-P118-Scratch';
assertScratchRepo(REPO);
export const PATH='site/nextnudge-data/workbench.json';
export const EDIT=`https://github.com/${REPO}/edit/main/${PATH}`;
const API=`https://api.github.com/repos/${REPO}/contents/${PATH}?ref=main`;
export async function readRepository() {
  const response=await fetch(API,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
  if(!response.ok) throw Error(`GitHub read failed (${response.status}). Drafts remain local.`);
  const entry=await response.json();
  if(!/^[a-f0-9]{40}$/.test(entry.sha)||entry.encoding!=='base64'||!entry.content) throw Error('GitHub snapshot is unavailable or too large.');
  const bytes=Uint8Array.from(atob(entry.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
  return {db:validate(JSON.parse(new TextDecoder().decode(bytes))),sha:entry.sha};
}
export async function fingerprint(db) {
  function sorted(v) {
    if(Array.isArray(v))return v.map(sorted);
    if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]));
    return v;
  }
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(sorted(db))));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function prepareSave(db,baseSha) {
  const remote=await readRepository();
  if(!baseSha||remote.sha!==baseSha) throw Error('GitHub changed or the base is unknown. Export your draft and reload GitHub before preparing an update.');
  validate(db);
  return {text:JSON.stringify(db,null,2)+'\n',digest:await fingerprint(db),base:remote.db};
}
export function download(db) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='nextnudge-workbench-v2.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/** Delta is intentionally narrow: ordered ID collections and append-only events. */
export function buildDelta(base,draft) {
  validate(base);validate(draft);
  function collection(key) {
    const old=new Map(base[key].map(x=>[x.id,x]));
    const current=new Set(draft[key].map(x=>x.id));
    // Existing IDs must retain order. This is not a general-purpose merge.
    const existing=draft[key].filter(x=>old.has(x.id)).map(x=>x.id);
    const previous=base[key].filter(x=>current.has(x.id)).map(x=>x.id);
    if(JSON.stringify(existing)!==JSON.stringify(previous) ||
       draft[key].some((x,i)=>!old.has(x.id)&&draft[key].slice(i+1).some(y=>old.has(y.id)))) {
      throw Error('Reordered records need the manual GitHub editor route.');
    }
    return {upsert:Object.fromEntries(draft[key].filter(x=>!old.has(x.id)||
      JSON.stringify(x)!==JSON.stringify(old.get(x.id))).map(x=>[x.id,x])),
      deleted:base[key].filter(x=>!current.has(x.id)).map(x=>x.id)};
  }
  if(draft.events.length<base.events.length||
     base.events.some((e,i)=>JSON.stringify(e)!==JSON.stringify(draft.events[i]))) {
    throw Error('History is not append-only; use the manual GitHub editor route.');
  }
  return {projects:collection('projects'),runs:collection('runs'),
    events:draft.events.slice(base.events.length),
    ...(JSON.stringify(base.profiles)!==JSON.stringify(draft.profiles)?{profiles:draft.profiles}:{})};
}
/** Pure deterministic replay, shared by browser preview and authenticated writer. */
export function applyDelta(base,packet) {
  validate(base);
  if(packet?.v!==1||!Number.isSafeInteger(packet.baseRevision)||
     !Number.isSafeInteger(packet.revision)||packet.baseRevision!==base.revision||
     packet.revision<base.revision)throw Error('Invalid or stale packet revision');
  const d=packet.delta;
  if(!d||!Array.isArray(d.events))throw Error('Invalid delta');
  const out=structuredClone(base);
  for(const key of ['projects','runs']) {
    const part=d[key];
    if(!part||!part.upsert||Array.isArray(part.upsert)||
       typeof part.upsert!=='object'||!Array.isArray(part.deleted))throw Error('Invalid '+key+' delta');
    const removed=new Set(part.deleted);
    if(removed.size!==part.deleted.length||part.deleted.some(id=>typeof id!=='string'||
       !out[key].some(x=>x.id===id)))throw Error('Invalid deleted '+key+' ID');
    const updates=Object.entries(part.upsert);
    if(updates.some(([id,obj])=>id!==obj?.id||removed.has(id)))throw Error('Invalid upsert '+key+' ID');
    const found=new Set(out[key].map(x=>x.id));
    out[key]=out[key].filter(x=>!removed.has(x.id)).map(x=>part.upsert[x.id]??x);
    for(const [id,obj] of updates)if(!found.has(id))out[key].push(obj);
  }
  if(Object.hasOwn(d,'profiles'))out.profiles=d.profiles;
  out.events.push(...d.events);
  out.revision=packet.revision;
  return validate(out);
}
export function saveIssueUrl(packet,encoded) {
  const body='NextNudge workbench save, revision '+packet.revision+' (base '+packet.baseSha.slice(0,8)+
    '). Generated by the Owner workbench; changes require an exact base SHA.\n\n'+
    '```nextnudge-save\n'+encoded+'\n```';
  return `https://github.com/${REPO}/issues/new?labels=nextnudge-save&title=${encodeURIComponent('NextNudge save r'+packet.revision)}&body=${encodeURIComponent(body)}`;
}
export async function prepareIssueSave(db,prepared,baseSha) {
  const packet={v:1,baseSha,baseRevision:prepared.base.revision,
    revision:db.revision,digest:prepared.digest,delta:buildDelta(prepared.base,db)};
  const projected=applyDelta(prepared.base,packet);
  if(await fingerprint(projected)!==prepared.digest)throw Error('Delta cannot reproduce this draft; use the manual GitHub editor.');
  if(typeof CompressionStream!=='function')throw Error('This browser cannot gzip; use the manual GitHub editor.');
  const stream=new Blob([JSON.stringify(packet)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {packet,url:saveIssueUrl(packet,btoa(binary))};
}
