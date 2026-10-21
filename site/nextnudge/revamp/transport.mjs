import {assertScratchRepo} from './scratch-identity.mjs';
import {assertPublic,validate,freshId,activeIntent} from './thread.mjs';
import {makeReply,replyAcks} from './reply.mjs';
import {REPO} from './save.mjs';
import {answered} from './status.mjs';
const PREFIX='GITHUB_SEND_V1:';
export function targetOf(target){
  assertScratchRepo(REPO);
  if(target?.repository!==REPO)throw Error('Unsupported repository for this Owner workflow');
  if(!Number.isSafeInteger(target.issue)||target.issue<1)throw Error('Invalid target issue');
  if(typeof target.agent!=='string'||!target.agent.trim()||target.agent.length>200||/[\r\n]/.test(target.agent))
    throw Error('A single-line named agent is required');
  return {repository:target.repository,issue:target.issue,agent:target.agent.trim()};
}
const marker=(thread,move)=>'<!-- nextnudge:'+thread.id+':'+move.id+' -->';
export function deliveryText(thread,move,target){
  return 'TO: '+target.agent+'\n\n'+move.packet+'\n\n'+
    'Return identity: start with ACK '+move.id+' and put FROM: '+target.agent+' on the next line.\n'+marker(thread,move);
}
function commentUrl(comment,target){
  const url=comment?.html_url||comment?.url||'';
  const prefix='https://github.com/'+target.repository+'/issues/'+target.issue+'#issuecomment-';
  if(!url.startsWith(prefix)||!/^\d+$/.test(url.slice(prefix.length)))throw Error('Invalid target comment receipt');
  return url;
}
export function sentTarget(move){
  if(!move?.note?.startsWith(PREFIX))throw Error('Move has no GitHub delivery receipt');
  return JSON.parse(move.note.slice(PREFIX.length));
}
export async function sendNudge(thread,move,input,api){
  const target=targetOf(input);
  if(activeIntent(thread).hold)throw Error('Owner HOLD prevents sending');
  if(move.delivery!=='sent'||!move.packet||thread.moves.some(m=>m.id===move.id))throw Error('Invalid or already recorded move');
  validate({...thread,moves:[...thread.moves,move]});
  const body=deliveryText(thread,move,target);assertPublic(body);
  const comments=await api.listComments(target);
  const matches=comments.filter(c=>c.body?.includes(marker(thread,move)));
  if(matches.some(c=>c.body!==body))throw Error('Changed retry packet; reconcile before sending');
  const trusted=c=>[target.repository.split('/')[0],'github-actions[bot]'].includes(c.user?.login);
  if(matches.some(c=>!trusted(c)))throw Error('Untrusted comment uses this delivery marker');
  if(matches.length>1)throw Error('Duplicate delivery markers need reconciliation');
  const comment=matches[0]||await api.postComment(target,body);
  const url=commentUrl(comment,target);
  return {...move,agent:target.agent,evidence:url,note:PREFIX+JSON.stringify({target,
    commentUrl:url,sentAt:comment.created_at||null})};
}
export async function fetchReturn(thread,moveId,api){
  const sent=thread.moves.find(m=>m.id===moveId&&m.delivery==='sent');
  if(answered(thread,sent))return null;
  const receipt=sentTarget(sent),target=targetOf(receipt.target);
  const comments=await api.listComments(target);
  const matches=comments.filter(c=>{
    if(replyAcks(c.body||'').primary!==moveId)return false;
    if(!(c.body||'').split(/\r?\n/).some(line=>line.trim()==='FROM: '+target.agent))return false;
    if(receipt.sentAt&&c.created_at&&Date.parse(c.created_at)<Date.parse(receipt.sentAt))return false;
    return !thread.moves.some(m=>m.kind==='reply'&&m.evidence===(c.html_url||c.url));
  });
  if(!matches.length)return null;
  const comment=matches[0],evidence=commentUrl(comment,target);
  const {move}=makeReply(thread,comment.body,{label:'SELF-ASSESSED',evidence,id:freshId()});
  move.note='GitHub return · '+(comment.created_at||'time UNKNOWN')+' · FROM is the agent’s recorded claim';
  return move;
}
