// Canonical Markdown thread codec. Sent packets are length-framed to preserve exact bytes.
import {pendingMoves,answered} from './status.mjs';
export const THREAD_ID=/^NN-\d{8}-\d{6}-[a-f0-9]{4}$/;
const MODES=new Set(['ground','task','correction','evidence','direction','close','amendment','reply','agent','sealed']);
export const MOVE_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Match the service HOST token, regardless of message punctuation or real newlines.
// A plain domain mention (no path/query/fragment) is not a conversation link.
const CHAT=/(?<![a-z0-9-])(?:chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|aistudio\.google\.com|antigravity\.google\.com|copilot\.microsoft\.com|chat\.mistral\.ai|grok\.com|chat\.deepseek\.com|poe\.com|character\.ai|perplexity\.ai)(?::\d+)?(?=[/?#])/;
const ZW=/[\u200B-\u200D\u2060\uFEFF]/g;
function decodeSafe(input) {
  let s=input;
  for(let pass=0;pass<3;pass++) {
    const next=s.replace(/(?:%[0-9A-Fa-f]{2})+/g,seq=>{
      try{return decodeURIComponent(seq);}
      catch{return seq.replace(/%([0-9A-Fa-f]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));}
    }).replace(ZW,'');
    if(next===s)break;
    s=next;
  }
  return s.replace(ZW,'');
}
const MARKER=/<!--\s*nn3:(?:header|move)\b/i;
const clean=s=>typeof s==='string'&&s.length<=90000;
const line=s=>s.replace(/[\r\n]+/g,' ').trim();
// Scan STRING VALUES, not JSON.stringify: JSON escapes newlines and hides host boundaries.
// This common validator runs in the browser and in the authenticated issue applier.
export function assertPublic(value) {
  const seen=new WeakSet();
  function check(item) {
    if(typeof item==='string') {
      if(CHAT.test(decodeSafe(item).toLowerCase()))
        throw Error('Private chat URL found. Keep conversation links on this device.');
    } else if(item&&typeof item==='object') {
      if(seen.has(item))return;
      seen.add(item);
      for(const child of Object.values(item))check(child);
    }
  }
  check(value);
}
export function validate(t) {
  if(!t||t.version!==3||!THREAD_ID.test(t.id)||!clean(t.title)||!t.title.trim()||
     !clean(t.agent)||!clean(t.goal)||!clean(t.inScope)||!clean(t.outScope)||
     !clean(t.hold)||!Array.isArray(t.doneWhen)||t.doneWhen.length>5||
     t.doneWhen.some(x=>!clean(x)||!x.trim())||!Array.isArray(t.moves)||t.moves.length>200)
    throw Error('Invalid thread intent or limits');
  const ids=new Set();
  for(const m of t.moves) {
    if(!MOVE_ID.test(m.id)||ids.has(m.id)||!MODES.has(m.kind)||
       !['draft','sent'].includes(m.delivery)||!clean(m.packet)||!clean(m.returnLine)||
       !clean(m.digest)||!clean(m.evidence)||!clean(m.gap)||!clean(m.decision)||
       !clean(m.archive)||!clean(m.note))throw Error('Invalid move');
    if(MARKER.test(m.packet))throw Error('Reserved thread metadata marker in packet');
    if(m.answers!==undefined&&(!clean(m.answers)||!MOVE_ID.test(m.answers)))throw Error('Invalid answers');
    if(m.also_acks!==undefined&&(!Array.isArray(m.also_acks)||m.also_acks.length>30||
       m.also_acks.some(a=>!clean(a)||!MOVE_ID.test(a))))throw Error('Invalid also_acks');
    for(const field of ['override_note','agent','replyText','text','createdAt','names'])
      if(m[field]!==undefined&&(!clean(m[field])||(field==='agent'&&m[field].length>200)||
        (field==='override_note'&&m[field].length>3000)||(field==='createdAt'&&m[field].length>64)||
        (field==='names'&&!MOVE_ID.test(m[field]))))
        throw Error('Invalid '+field);
    if(m.role!==undefined&&!['worker','generator','judge'].includes(m.role))throw Error('Invalid role');
    if(m.label!==undefined&&!['UNKNOWN','INDEPENDENT','SELF-ASSESSED','NOT BLIND'].includes(m.label))throw Error('Invalid label');
    if(m.sha256!==undefined&&(typeof m.sha256!=='string'||!(/^[0-9a-f]{64}$/.test(m.sha256))))
      throw Error('Invalid sealed hash');
    if(m.kind==='sealed') {
      if(!m.text||!m.createdAt||!/^\d{4}-\d\d-\d\dT/.test(m.createdAt)||
        !m.sha256||!MOVE_ID.test(m.names)||!ids.has(m.names)||m.names===m.id||
        m.delivery!=='draft'||['packet','returnLine','digest','evidence','gap','decision','archive','note'].some(k=>m[k]!==''))
        throw Error('Invalid sealed note');
    }
    if(m.delivery==='sent'&&!m.packet&&!m.archive)throw Error('Sent move requires exact packet or archive reference');
    if(m.archive&&!m.archive.startsWith('site/nextnudge-data/workbench.json#'))throw Error('Invalid archive reference');
    ids.add(m.id);
  }
  assertPublic(t);
  return t;
}
export function freshId(date=new Date(),suffix) {
  const stamp=date.toISOString().replace(/[-:]/g,'');
  const hex=suffix??Array.from(crypto.getRandomValues(new Uint8Array(2))).map(x=>x.toString(16).padStart(2,'0')).join('');
  return 'NN-'+stamp.slice(0,8)+'-'+stamp.slice(9,15)+'-'+hex;
}
export function newThread({id=freshId(),title,agent='',goal='',inScope='',outScope='',hold='',doneWhen=[]}) {
  return validate({version:3,id,title,agent,goal,inScope,outScope,hold,doneWhen,moves:[]});
}
const mark=(kind,v)=>'<!-- nn3:'+kind+'\n'+JSON.stringify(v)+'\n-->';
export function serialize(t) {
  validate(t);
  const {moves,...header}=t;
  const shown=activeIntent(t);
  const result=['# '+line(t.title),'',mark('header',header),'',
    '## Owner intent','',shown.goal||'UNKNOWN','',
    'Done-when: '+(shown.doneWhen.length?shown.doneWhen.map((x,i)=>'('+ (i+1)+') '+x).join(' · '):'UNKNOWN'),'',
    'In scope: '+(shown.inScope||'UNKNOWN'),'Out of scope: '+(shown.outScope||'UNKNOWN'),
    'Agent: '+(activeAgent(t)||'UNKNOWN'),'Owner constraint: '+(shown.hold||'None'),'',
    '## Moves'];
  for(const m of moves) {
    const {packet,...meta}=m;
    result.push('', '### '+m.kind.toUpperCase()+' · '+m.id,'',mark('move',{...meta,packetChars:packet.length}),
      '', 'Return: '+(m.returnLine||'UNKNOWN'),
      'Evidence: '+(m.evidence||m.archive||'UNKNOWN'),
      'Open gap: '+(m.gap||'None'),
      'Decision: '+(m.decision||'UNKNOWN'));
    if(packet)result.push('','#### Exact '+(m.delivery==='sent'?'sent':'draft')+' packet','', '~~~~~~text',packet,'~~~~~~');
  }
  return result.join('\n')+'\n';
}
function metadata(text,kind) {
  const pattern=new RegExp('<!-- nn3:'+kind+'\\n([^\\n]+)\\n-->','g');
  return [...text.matchAll(pattern)].map(match=>({at:match.index,end:match.index+match[0].length,
    value:JSON.parse(match[1])}));
}
export function parse(source) {
  if(typeof source!=='string'||source.length>2_000_000)throw Error('Invalid Markdown size');
  // Git's Windows checkout can turn the outer Markdown framing into CRLF.
  // Leave original LF-framed packet bytes unchanged.
  if(source.includes('<!-- nn3:header\r\n'))source=source.replace(/\r\n/g,'\n');
  const heads=metadata(source,'header');
  if(heads.length!==1)throw Error('Thread header missing or duplicated');
  const h=heads[0].value;
  const parts=metadata(source,'move'),moves=[];
  for(let i=0;i<parts.length;i++){
    const a=parts[i],end=parts[i+1]?.at??source.length;
    if(a.at<heads[0].end)throw Error('Move preceding header');
    const v=a.value,n=v.packetChars;
    if(!Number.isSafeInteger(n)||n<0||n>90000)throw Error('Invalid packet length');
    let packet='';
    if(n){
      const start=source.indexOf('~~~~~~text\n',a.end);
      if(start<0||start>end)throw Error('Missing packet fence');
      const pos=start+'~~~~~~text\n'.length;
      packet=source.slice(pos,pos+n);
      if(source.slice(pos+n,pos+n+7)!=='\n~~~~~~')throw Error('Packet length mismatch');
    }
    const {packetChars,...meta}=v;
    moves.push({...meta,packet});
  }
  return validate({...h,moves});
}
export function archiveRun(run) {
  const t=newThread({id:run.id,title:run.title,agent:'Google Antigravity',
    goal:run.aim,inScope:'Validation only; findings, no fixes',
    outScope:'Product edits and unapproved next tasks',
    hold:run.id==='NN-20261018-171656-66d2'?'Owner HOLD':''});
  t.moves=run.nodes.filter(n=>n.sentText||n.messages?.length).map(n=>{
    const r=n.messages?.find(x=>x.by==='Agent');
    const first=(r?.text||'').split(/\r?\n/).find(x=>/\bACK\b|\bSAVED\b|rows=/.test(x))||'';
    return {id:n.id,kind:n.type==='course_correction'?'correction':n.type==='new_requirement'?'ground':'task',
      delivery:'sent',packet:'',returnLine:line(first).slice(0,300),digest:line((r?.text||'').slice(0,300)),
      evidence:(r?.proof||'').startsWith('https://github.com/')?r.proof:'',
      gap:'UNKNOWN — historical status is not evidence of Owner acceptance',
      decision:'UNKNOWN',archive:'site/nextnudge-data/workbench.json#'+n.id,note:n.label};
  });
  return validate(t);
}
export function currentState(t) {
  if(activeIntent(t).hold)return 'Your move';
  if(pendingMoves(t).length)return 'Waiting on agent';
  const relevant=t.moves.filter(m=>m.kind!=='agent'&&m.kind!=='sealed'&&
    !(m.kind==='amendment'&&!m.note.startsWith('OWNER_INTENT_CHANGE:')));
  const last=relevant.filter(m=>m.kind!=='reply').at(-1);
  return last?.kind==='close'&&closureMet(t,last)&&answered(t,last)?'Done':'Your move';
}
export function closureMet(t,move) {
  if(move?.kind!=='close'||!move.note?.startsWith('OWNER_CLOSE_CHECKS:'))return false;
  try{
    const {criteria,checks}=JSON.parse(move.note.slice('OWNER_CLOSE_CHECKS:'.length));
    const expected=activeIntent(t).doneWhen;
    return expected.length>0&&JSON.stringify(criteria)===JSON.stringify(expected)&&
      Array.isArray(checks)&&checks.length===expected.length&&checks.every(x=>x==='met');
  }catch{return false;}
}
export function activeAgent(t) {
  const last=[...t.moves].reverse().find(m=>m.kind==='agent'&&m.note.startsWith('AGENT_CHANGE:'));
  return last?last.note.slice('AGENT_CHANGE:'.length):t.agent;
}
export function activeIntent(t) {
  const last=[...t.moves].reverse().find(m=>m.kind==='amendment'&&m.note.startsWith('OWNER_INTENT_CHANGE:'));
  if(!last)return {goal:t.goal,doneWhen:t.doneWhen,inScope:t.inScope,outScope:t.outScope,hold:t.hold};
  try{return {...t,...JSON.parse(last.note.slice('OWNER_INTENT_CHANGE:'.length))};}catch{return t;}
}
export function reconcile({checks,reply,decision,gap='',nudgeId,goal,criteria=[],agent='',method=''}) {
  if(!['continue','correct','request evidence','change direction','close'].includes(decision))throw Error('Choose a decision');
  if(!Array.isArray(checks)||checks.length!==criteria.length||
     checks.some(x=>!['met','not met','unknown'].includes(x)))throw Error('Invalid checks');
  const missing=criteria.filter((x,i)=>checks[i]!=='met');
  const negatives=criteria.filter((x,i)=>checks[i]==='not met');
  const unknown=criteria.filter((x,i)=>checks[i]==='unknown');
  if(decision==='close'&&(missing.length||!criteria.length))throw Error('Owner outcome cannot close with missing or UNKNOWN checks');
  if(decision==='correct'&&!negatives.length&&!gap)throw Error('Name the observed gap for correction');
  if(decision==='request evidence'&&!unknown.length&&!gap)throw Error('Name missing evidence');
  let kind={continue:'task',correct:'correction','request evidence':'evidence','change direction':'direction',close:'close'}[decision];
  const packet=['[Owner · NextNudge '+nudgeId+']','Intent: '+goal,
    'Agent: '+agent,'Move: '+decision,
    'Observed checks: Not met: '+(negatives.join(' | ')||'None')+'; UNKNOWN: '+(unknown.join(' | ')||'None'),
    'Observed gap:\n'+gap,
    'One bounded task:\n',
    'Authoritative inputs: '+(reply||'UNKNOWN'),
    'Boundaries: preserve Owner scope and HOLD; no unassigned edits.',
    'Success criteria: '+(criteria.length?criteria.join(' | '):'UNKNOWN — ask Owner'),
    'Uncertainty handling: UNKNOWN must be stated, not assumed.',
    'Evidence and continuation: return actual result, source and next feasible action.',
    method?'GUIDED method: '+method:'',
    'COMPLETE covers this task only; overall acceptance requires Owner checks.',
    'Start your reply with ACK '+nudgeId+'.'].filter(Boolean).join('\n');
  assertPublic(packet);
  return {kind,packet,gap,
    ...(decision==='close'?{closure:{criteria:[...criteria],checks:[...checks]}}:{})};
}
