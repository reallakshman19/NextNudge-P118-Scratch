import {assertScratchRepo} from './scratch-identity.mjs';
import {parse,serialize,validate,assertPublic,THREAD_ID} from './thread.mjs';
export const REPO='reallakshman19/NextNudge-P118-Scratch';
assertScratchRepo(REPO);
export const ROOT='site/nextnudge-data/threads/';
export const LOCAL='nextnudge.threads.v3';
export const PRIVATE='nextnudge.threads.private.v3';
const LIMIT=7500;
const path=id=>ROOT+id+'.md';
export const safeId=id=>THREAD_ID.test(id)?id:(()=>{throw Error('Invalid thread id')})();
export function localThreads() {
  try{const rows=JSON.parse(localStorage.getItem(LOCAL)||'{}');
    return Object.fromEntries(Object.entries(rows).filter(([id,v])=>{try{safeId(id);validate(v);return true;}catch{return false;}}));
  }catch{return {};}
}
export function persist(thread) {
  validate(thread);
  const rows=localThreads();rows[thread.id]=thread;
  localStorage.setItem(LOCAL,JSON.stringify(rows));
}
export function persistMove(thread,move) {
  const next={...thread,moves:[...thread.moves,move]};
  persist(next);
  return next;
}
export function chatLink(id,url) {
  safeId(id);
  const links=JSON.parse(localStorage.getItem(PRIVATE)||'{}');
  if(url!==undefined) {
    if(url&&!/^https:\/\//.test(url))throw Error('Chat link must be HTTPS');
    links[id]=url;localStorage.setItem(PRIVATE,JSON.stringify(links));
  }
  return links[id]||'';
}
export async function readRemote(id) {
  assertScratchRepo(REPO);
  safeId(id);
  const api='https://api.github.com/repos/'+REPO+'/contents/'+path(id)+'?ref=main';
  const response=await fetch(api,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
  if(response.status===404)return {thread:null,sha:null};
  if(!response.ok)throw Error('GitHub read failed '+response.status+'; local draft preserved');
  const body=await response.json();
  if(!/^[a-f0-9]{40}$/.test(body.sha)||body.encoding!=='base64')throw Error('Invalid source blob');
  const raw=atob(body.content.replace(/\s/g,''));
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  return {thread:parse(new TextDecoder().decode(bytes)),sha:body.sha};
}
const header=t=>{const {moves,...head}=t;return head;};
export function delta(local,remote,sha) {
  validate(local);
  if(remote) {
    validate(remote);
    if(JSON.stringify(header(remote))!==JSON.stringify(header(local)))throw Error('Owner intent differs from saved header. Add an Owner amendment instead.');
    if(local.moves.length<remote.moves.length||
      remote.moves.some((m,i)=>JSON.stringify(m)!==JSON.stringify(local.moves[i])))throw Error('Saved history changed. Export and reconcile rather than overwriting.');
  }
  const added=local.moves.slice(remote?.moves.length||0);
  if(remote&&!added.length)throw Error('Nothing new to append');
  const packet={v:3,id:local.id,baseSha:sha||null,expectedCount:remote?.moves.length||0,
    ...(remote?{}:{header:header(local)}),moves:added};
  assertPublic(packet);
  return packet;
}
export function applyDelta(remote,packet) {
  if(packet?.v!==3||!THREAD_ID.test(packet.id)||!Number.isSafeInteger(packet.expectedCount)||
     !Array.isArray(packet.moves)||packet.moves.length>50)throw Error('Bad save packet');
  if(remote) {
    if(packet.id!==remote.id)throw Error('Thread path and ID disagree');
    if(packet.expectedCount!==remote.moves.length||packet.header)throw Error('Stale append');
    const merged=validate({...remote,moves:[...remote.moves,...packet.moves]});
    return serialize(merged);
  }
  if(packet.expectedCount!==0||!packet.header||packet.header.id!==packet.id)throw Error('New thread needs matching initial intent');
  return serialize(validate({...packet.header,moves:packet.moves}));
}
const KINDS=['nextnudge-thread-save','nextnudge-thread-action','nextnudge-project-save'];
export async function issueBody(packet,kind='nextnudge-thread-save'){
  if(!KINDS.includes(kind))throw Error('Unknown Owner request kind');
  assertPublic(packet);
  if(typeof CompressionStream!=='function')throw Error('Browser gzip unavailable; export draft');
  const stream=new Blob([JSON.stringify(packet)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  let binary='';for(let i=0;i<bytes.length;i+=8192)
    binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const b64=btoa(binary),fence=String.fromCharCode(96).repeat(3);
  return (kind==='nextnudge-project-save'?'NextNudge project fixtures and membership (Owner review required).\n\n':
    'NextNudge v3 single-thread append (Owner review required).\n\n')+
    fence+kind+'\n'+b64+'\n'+fence;
}
export async function issueUrl(packet,kind='nextnudge-thread-save') {
  assertScratchRepo(REPO);
  const body=await issueBody(packet,kind);
  const url='https://github.com/'+REPO+'/issues/new?labels=nextnudge-save&title='+
    encodeURIComponent('NextNudge '+(kind==='nextnudge-project-save'?'project ':'thread ')+packet.id)+'&body='+encodeURIComponent(body);
  if(url.length>LIMIT)throw Error('Save URL '+url.length+' characters exceeds one-click limit '+LIMIT+'. Draft retained; use manual issue body for project saves.');
  return url;
}
export async function prepareSave(thread) {
  const remote=await readRemote(thread.id);
  const packet=delta(thread,remote.thread,remote.sha);
  parse(applyDelta(remote.thread,packet));
  const url=await issueUrl(packet);
  return {url,packet,chars:url.length};
}
export function exportThread(t) {
  const content=serialize(t),blob=new Blob([content],{type:'text/markdown;charset=utf-8'});
  const href=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=href;a.download=t.id+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
