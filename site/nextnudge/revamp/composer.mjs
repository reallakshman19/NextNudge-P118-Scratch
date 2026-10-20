import {THREAD_ID,MOVE_ID} from './thread.mjs';
const KEY='nextnudge.composers.v1';
const read=storage=>{try{return JSON.parse(storage.getItem(KEY)||'{}');}catch{return {};}};
export function rememberComposer(id,draft,storage=localStorage){
  if(!THREAD_ID.test(id)||!draft||!MOVE_ID.test(draft.id)||typeof draft.packet!=='string'||draft.packet.length>90000)
    throw Error('Invalid composer draft');
  const rows=read(storage);rows[id]=structuredClone(draft);storage.setItem(KEY,JSON.stringify(rows));
}
export function restoreComposer(id,storage=localStorage){
  const draft=read(storage)[id];
  return draft&&MOVE_ID.test(draft.id)&&typeof draft.packet==='string'&&draft.packet.length<=90000?draft:null;
}
export function clearComposer(id,storage=localStorage){
  const rows=read(storage);delete rows[id];storage.setItem(KEY,JSON.stringify(rows));
}
