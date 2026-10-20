import {freshId,activeIntent,activeAgent,assertPublic,validate,reconcile} from './thread.mjs';
import {effectiveGrounding} from './grounding.mjs';
import {packet} from './screens.mjs';
import {MODES,TITLES} from './workspace-nav.mjs';
export {MODES,TITLES};
const PREFIX='WORKSPACE_V1:';
const fields={
  ground:['repository','issue','pullRequest','roadmap','sources','brief','unknowns','firstStep'],
  task:['groundId','task','deliverable','success','constraints','sources'],
  correction:['groundId','target','claim','expected','redo','preserve','sources'],
  reconcile:['target','basis','check0','check1','check2','check3','check4','decision','gap','evidence','nextTask']
};
function ownerBasis(thread){
  const i=activeIntent(thread);
  return {goal:i.goal,doneWhen:[...i.doneWhen],inScope:i.inScope,outScope:i.outScope,hold:i.hold};
}
export function valuesFor(mode,values={}){
  if(!MODES.includes(mode))throw Error('Unknown workspace');
  const out={};
  for(const key of fields[mode]){
    const value=values[key]??'';
    if(typeof value!=='string'||value.length>12000)throw Error('Workspace field is too long');
    out[key]=value.trim();
  }
  return out;
}
export function workspaceEntries(thread,mode){
  return thread.moves.flatMap(move=>{
    if(move.kind!=='amendment'||!move.note.startsWith(PREFIX))return [];
    const data=JSON.parse(move.note.slice(PREFIX.length));
    if(!MODES.includes(data.mode)||!data.values)throw Error('Invalid saved workspace');
    return !mode||data.mode===mode?[{id:move.id,...data}]:[];
  });
}
export function savedWorkspace(thread,mode){return workspaceEntries(thread,mode).at(-1)||null;}
export function defaults(thread,mode){
  const stored=savedWorkspace(thread,mode),g=effectiveGrounding(thread);
  const value=valuesFor(mode,stored?.values||{});
  if(mode==='ground'&&!stored)Object.assign(value,{issue:g['1a']||'',pullRequest:g['1b']||'',
    roadmap:g['1d']||'',sources:g['1']||'',brief:g['1f']||''});
  if(mode==='reconcile'){
    const basis=JSON.stringify(activeIntent(thread).doneWhen);
    if(value.basis!==basis){for(let i=0;i<5;i++)value['check'+i]='unknown';value.basis=basis;}
    value.decision||='request evidence';
  }
  return value;
}
function linkedGround(thread,id){
  if(!id)return null;
  const g=workspaceEntries(thread,'ground').find(x=>x.id===id);
  if(!g)throw Error('Linked Ground version is unavailable');
  return g;
}
export function responseTargets(thread,mode){
  return thread.moves.filter(m=>mode==='reconcile'?m.kind==='reply':m.kind==='reply'||m.delivery==='sent');
}
function targetFor(thread,mode,id){
  const target=responseTargets(thread,mode).find(m=>m.id===id);
  if(!target)throw Error('Select an actual recorded '+(mode==='reconcile'?'agent response':'instruction or response'));
  return target;
}
export function workspaceMove(thread,mode,input,id=freshId()){
  const values=valuesFor(mode,input);assertPublic(values);
  if(values.groundId)linkedGround(thread,values.groundId);
  if(values.target)targetFor(thread,mode,values.target);
  const data={mode,values,owner:ownerBasis(thread),...(mode==='ground'?{fixtures:effectiveGrounding(thread)}:{})};
  const before=savedWorkspace(thread,mode);
  if(before){const {id:oldId,...old}=before;if(JSON.stringify(old)===JSON.stringify(data))return null;}
  const move={id,kind:'amendment',delivery:'draft',packet:'',returnLine:'',digest:'',
    evidence:'',gap:'',decision:'',archive:'',note:PREFIX+JSON.stringify(data)};
  validate({...thread,moves:[...thread.moves,move]});return move;
}
export function workspaceSummary(move){
  if(!move.note?.startsWith(PREFIX))return null;
  const data=JSON.parse(move.note.slice(PREFIX.length));
  return (TITLES[data.mode]||'Workspace')+' saved'+(data.values?.target?' · linked to '+data.values.target:'');
}
function contextText(thread,values){
  const g=linkedGround(thread,values.groundId);
  if(!g)return values.sources||'UNKNOWN — ask Owner';
  if(JSON.stringify(g.owner)!==JSON.stringify(ownerBasis(thread)))
    throw Error('Owner intent changed. Save an updated Ground version before using this context.');
  return ['Linked Ground version: '+g.id,...Object.entries(g.values).filter(([,v])=>v).map(([k,v])=>k+': '+v),
    ...Object.entries(g.fixtures||{}).map(([k,v])=>'Fixture '+k+': '+v),values.sources||''].filter(Boolean).join('\n');
}
export function workspaceBasis(thread,mode,input){
  return JSON.stringify({mode,values:valuesFor(mode,input),owner:ownerBasis(thread),agent:activeAgent(thread),
    ...(mode==='ground'?{fixtures:effectiveGrounding(thread)}:{})});
}
function required(values,keys){
  for(const [key,label] of keys)if(!values[key])throw Error('Enter '+label+' before building this packet');
}
export function buildWorkspacePacket(thread,mode,input,id=freshId()){
  if(activeIntent(thread).hold)throw Error('Owner HOLD prevents new packet');
  const v=valuesFor(mode,input),i=activeIntent(thread);assertPublic(v);
  let result;
  if(mode==='ground'){
    required(v,[['brief','the context the agent needs']]);
    const body=['Project context: '+v.brief,...['repository','issue','pullRequest','roadmap','sources'].filter(k=>v[k]).map(k=>k+': '+v[k]),
      ...Object.entries(effectiveGrounding(thread)).map(([k,text])=>'Fixture '+k+': '+text),
      'Known unknowns: '+(v.unknowns||'UNKNOWN'),'First step: '+(v.firstStep||'Ask about missing facts')].join('\n');
    result={kind:'ground',packet:packet(id,'ground',body,i)};
  }else if(mode==='task'){
    required(v,[['task','one bounded task'],['deliverable','the deliverable'],['success','a task success check']]);
    result={kind:'task',requiresTask:true,packet:packet(id,'task',v.task+'\nDeliverable:\n'+v.deliverable,i,
      {inputs:contextText(thread,v),success:v.success,boundaries:v.constraints||i.inScope})};
  }else if(mode==='correction'){
    const target=targetFor(thread,mode,v.target);
    required(v,[['claim','the observed error'],['expected','the expected result'],['redo','the redo scope']]);
    result={kind:'correction',gap:v.claim,packet:packet(id,'correction',[
      'Linked instruction/response: '+target.id,'Recorded evidence: '+(target.evidence||'UNKNOWN'),
      'Observed error / quoted claim: '+v.claim,'Expected result: '+v.expected,
      'Redo scope: '+v.redo,'Preserve: '+(v.preserve||'Original Owner boundaries'),contextText(thread,v)].join('\n'),i)};
  }else{
    const target=targetFor(thread,mode,v.target),criteria=i.doneWhen;
    if(v.basis!==JSON.stringify(criteria))throw Error('Owner checks changed. Reopen Reconcile and reassess the current checks.');
    required(v,[['nextTask','the next bounded instruction']]);
    result=reconcile({checks:criteria.map((_,n)=>v['check'+n]||'unknown'),decision:v.decision,
      reply:target.returnLine+'\nResponse ID: '+target.id+'\nEvidence: '+(v.evidence||target.evidence||'UNKNOWN'),
      gap:v.gap,nudgeId:id,goal:i.goal,criteria,agent:activeAgent(thread)});
    result.packet=result.packet.replace('One bounded task:\n',()=> 'One bounded task:\n'+v.nextTask+'\n');
    result.requiresTask=true;
  }
  assertPublic(result.packet);
  if(result.packet.length>90000)throw Error('Packet is too long; shorten context before building');
  return {id,...result,workspaceMode:mode,workspaceBasis:workspaceBasis(thread,mode,v)};
}
