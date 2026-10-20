import {freshId,activeAgent,assertPublic,MOVE_ID} from './thread.mjs';
import {pendingMoves} from './status.mjs';
export const LABELS=['UNKNOWN','INDEPENDENT','SELF-ASSESSED','NOT BLIND'];
const tag='([A-Za-z0-9][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9_-]+)*)';
const ACK=new RegExp('\\bACK[ \\t]+'+tag+'(?=[^A-Za-z0-9._-]|$)','g');
export function replyAcks(text) {
  const first=text.split(/\r?\n/).find(line=>line.trim().length>0)||'';
  const scan=first.replace(/^\uFEFF/,'');
  const tags=[...scan.matchAll(ACK)].map(m=>m[1]);
  return {primary:tags[0]||'',also:tags.slice(1)};
}
export function replyWarnings(text,primary='',found=true){
  const warnings=[];
  if(text.startsWith('\uFEFF'))warnings.push('Leading BOM in reply');
  if(/â€|Ã/.test(text))warnings.push('Possible garbled text encoding');
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length);
  if(new Set(lines).size!==lines.length)warnings.push('Duplicate non-empty lines');
  if(primary&&!found)warnings.push('ACK tag not found');
  return warnings;
}
export function makeReply(thread,text,{label='UNKNOWN',id=freshId(),evidence=''}={}) {
  if(typeof text!=='string'||!text.trim()||text.length>90000)throw Error('Invalid reply text');
  if(!LABELS.includes(label))throw Error('Choose a reply assessment label');
  assertPublic(text);
  const tags=replyAcks(text);
  const matched=thread.moves.some(m=>m.id===tags.primary&&m.delivery==='sent'&&m.kind!=='reply');
  const last=thread.moves.filter(m=>m.delivery==='sent').at(-1);
  const lines=text.split(/\r?\n/);
  const line=lines.find(z=>/\bACK\b|\bSAVED\b/.test(z))||lines[0];
  const move={id,kind:'reply',delivery:'draft',packet:'',returnLine:line.slice(0,300),
    digest:text.slice(0,300),evidence,gap:'',decision:'',archive:'',
    note:'Reply recorded against '+(last?.id||'UNKNOWN'),
    replyText:text,label};
  if(tags.primary&&matched)move.answers=tags.primary;
  if(tags.also.length)move.also_acks=tags.also;
  return {move,warnings:replyWarnings(text,tags.primary,matched)};
}
export function replyLabel(move){return move.label||'UNKNOWN';}
export function moveRole(move){return move.role||'worker';}
export function moveAgent(thread,move){return move.agent||activeAgent(thread)||'UNKNOWN';}
export function openMoves(thread) {
  return pendingMoves(thread);
}
export function openAgents(thread){
  const opens=openMoves(thread);
  return opens.length?[...new Set(opens.map(m=>moveAgent(thread,m)))]:[activeAgent(thread)||'UNKNOWN'];
}
export function summary(move,thread) {
  let line=move.kind+' · '+move.id;
  if(move.kind==='reply')line+=' · '+replyLabel(move)+(move.answers?' · answers '+move.answers:'');
  else if(move.delivery==='sent')line+=' · '+moveRole(move)+' · '+moveAgent(thread,move);
  return line;
}
