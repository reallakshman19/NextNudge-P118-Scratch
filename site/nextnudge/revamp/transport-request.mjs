import {readRemote,delta,issueUrl,REPO} from './save.mjs';
import {sentMove} from './editor.mjs';
import {targetOf,sentTarget} from './transport.mjs';
import {assertProjectAgent} from './project-store.mjs';
export function snapshotDelta(local,remote,sha){
  if(remote&&JSON.stringify(local)===JSON.stringify(remote))
    return {v:3,id:local.id,baseSha:sha,expectedCount:remote.moves.length,moves:[]};
  return delta(local,remote,sha);
}
export async function prepareAction(thread,operation,{draft,packet,issue,agent,moveId}={}){
  if(!['send','fetch'].includes(operation))throw Error('Unknown GitHub action');
  let move,target;
  if(operation==='send'){
    assertProjectAgent(thread,agent);
    target=targetOf({repository:REPO,issue:Number(issue),agent});
    move=sentMove(thread,draft,packet,{agent,role:'worker'});
  }else{
    const sent=thread.moves.find(m=>m.id===moveId&&m.delivery==='sent');
    target=targetOf(sentTarget(sent).target);
  }
  const remote=await readRemote(thread.id);
  const request={v:1,operation,target,delta:snapshotDelta(thread,remote.thread,remote.sha),
    ...(move?{move}:{moveId})};
  return {request,url:await issueUrl(request,'nextnudge-thread-action')};
}
