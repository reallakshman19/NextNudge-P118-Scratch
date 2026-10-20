import {THREAD_ID} from './thread.mjs';
import {MODES} from './workspace.mjs';
const KEY='nextnudge.workspaces.drafts.v1';
function rows(storage){return JSON.parse(storage.getItem(KEY)||'{}');}
function key(id,mode){
  if(!THREAD_ID.test(id)||!MODES.includes(mode))throw Error('Invalid workspace identity');
  return id+'/'+mode;
}
export function readWorkspaceDraft(id,mode,storage=localStorage){
  return rows(storage)[key(id,mode)]||null;
}
export function writeWorkspaceDraft(id,mode,value,storage=localStorage){
  const all=rows(storage);all[key(id,mode)]=structuredClone(value);
  storage.setItem(KEY,JSON.stringify(all));
}
export function clearWorkspacePacket(id,mode,storage=localStorage){
  const all=rows(storage),k=key(id,mode);
  if(all[k])all[k].draft=null;
  storage.setItem(KEY,JSON.stringify(all));
}
