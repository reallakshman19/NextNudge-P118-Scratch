import {id,now,utc,safeURL} from './identity.mjs';
import {emptyFixtures,fixtureChange,pullFixtures} from './fixtures.mjs';
export const STATES=['ready','sent','submitted','accepted','revision'];
export const TYPES=['new_requirement','ground','next_step','course_correction'];
export const children=(r,n)=>r.nodes.filter(x=>x.parent===n&&!x.deleted);
export function event(db,run,step,state,note='',proof='',data=null,by='Owner') {
  const row={id:id('EV',db),project:run?.projectId||null,run:run?.id||null,
    step:step?.id||null,state,by,at:now(),proof,note,data};
  db.events.push(row);db.revision++;return row;
}
export function newProject(db,name) {
  if (!name.trim()) throw Error('Enter a project name.');
  const p={id:id('PRJ',db),name:name.trim(),createdAt:now()};db.projects.push(p);
  event(db,null,null,'PROJECT_CREATED',p.name,'',p);return p;
}
export function newStep(db,run,label,instruction='',type='next_step',parent=null) {
  if (!label.trim()||!TYPES.includes(type)) throw Error('Enter a label and valid type.');
  const n={id:id('NN',db),label:label.trim(),instruction,type,parent,status:'ready',
    messages:[],checks:{},sentAt:null,copied:null,deleted:false};
  run.nodes.push(n);event(db,run,n,'CREATED',label);return n;
}
export function newRun(db,projectId,title,aim) {
  if (!db.projects.some(p=>p.id===projectId)||!title.trim()||!aim.trim()) {
    throw Error('Select a project and enter a task title and aim.');
  }
  const r={id:id('NN',db),projectId,title:title.trim(),aim:aim.trim(),createdAt:now(),
    archived:false,deleted:false,paused:false,chatId8:'',profiles:Object.hasOwn(db.profiles.profiles,'Coding')
      ? ['Coding'] : [Object.keys(db.profiles.profiles)[0]],
    nodes:[],fixtures:emptyFixtures(),drafts:{}};
  db.runs.push(r);event(db,r,null,'RUN_CREATED',r.title);
  newStep(db,r,'Initial prompt',aim+'\nReply with your understanding and fill the On boarding fixtures.','new_requirement');
  newStep(db,r,'Grounding','Confirm or correct understanding; record unresolved inputs.','ground');
  return r;
}
export function editable(run,node) {
  if(run.archived||run.deleted||run.paused||node?.deleted) throw Error('Resume the active run before editing.');
}
export function editStep(db,r,n,values) {
  editable(r,n);
  if(n.sentAt||n.messages.length) throw Error('Sent or answered instructions are frozen. Add a correction.');
  if(!values.label.trim()||!TYPES.includes(values.type)) throw Error('Invalid step details.');
  const before={label:n.label,instruction:n.instruction,type:n.type};
  Object.assign(n,values,{copied:null});event(db,r,n,'INSTRUCTION_REVISED','', '',{before,after:values});
}
export function packet(r,n) {
  if(n.sentText)return n.sentText;
  const context=['1a','1b','1c','1d','1e','1f','2','3','4','5'].map(key => {
    const rows=r.fixtures[key].filter(row=>!row.deleted);
    return key+': '+(rows.length?rows.map(row=>`${row.text} [${row.status}] ${row.url}`).join(' | '):'UNKNOWN');
  }).join('\n');
  const grounding=n.type==='new_requirement'||n.type==='ground'
    ? '\n\nGrounding inputs (fill missing headings from sources; do not infer proof):\n'+context : '';
  return `[Owner · NextNudge ${n.id}]\nProject: ${r.projectId}\nRun: ${r.id}\nAim: ${r.aim}\nStep: ${n.label}\n\n${n.instruction}${grounding}\n\nStart your reply with ACK ${n.id}. Record missing information explicitly. Supporting evidence is optional.`;
}
export function copied(db,r,n,text) {
  editable(r,n);n.copied={text,at:now()};event(db,r,n,'COPIED','Copied for manual delivery; not sent.');
}
export function markSent(db,r,n) {
  editable(r,n);
  if(n.sentAt) throw Error('Already marked sent. Use a correction for a new instruction.');
  if(!/^[a-f0-9]{8}$/i.test(r.chatId8)) throw Error('Record the destination chat’s 8-character ID first.');
  if(n.copied?.text!==packet(r,n)) throw Error('Copy the current instruction before marking it sent.');
  n.sentAt=now();n.sentText=n.copied.text;n.sentChatId8=r.chatId8;
  if(n.status==='ready') n.status='sent';
  event(db,r,n,'SENT','Owner records manual delivery; not independently verified.','',
    {text:n.sentText,chatId8:r.chatId8,sentAt:n.sentAt});
}
export function reply(db,r,n,{by,text,proof='',repliedAt=''}) {
  editable(r,n);
  if(!text.trim()||!['Owner','Agent'].includes(by)||!safeURL(proof)) throw Error('Enter a reply and a valid optional evidence URL.');
  if(n.status==='accepted') throw Error('Add a correction to reopen a reviewed step.');
  const ack=text.match(/\bACK\s+(NN-\d{8}-\d{6}-[a-f0-9]{4})\b/);
  if(ack&&ack[1]!==n.id) throw Error('ACK belongs to a different step. Select the matching step.');
  const m={by,text,proof,at:now(),recordedBy:'Owner',relayed:by==='Agent',
    repliedAt:by==='Agent'?utc(repliedAt):null,chatId8:r.chatId8||null,ack:ack?.[1]||null};
  n.messages.push(m);
  if(by==='Agent'||n.type==='ground') n.status=children(r,n.id).some(c=>c.status!=='accepted')?'revision':'submitted';
  event(db,r,n,by==='Agent'?'REPLY_RECORDED':'FEEDBACK_RECORDED',text,proof,m,by);
}
export function checklist(db,r) {
  return r.profiles.flatMap(p=>(db.profiles.profiles[p]||[]).map(q=>({...q,key:p+':'+q.id,profile:p})));
}
export function accept(db,r,n,note='') {
  editable(r,n);
  if(n.status!=='submitted') throw Error('Record a result before reviewing.');
  if(children(r,n.id).some(c=>c.status!=='accepted')) throw Error('Resolve blocking children before rechecking the parent.');
  const qs=checklist(db,r);
  if(qs.some(q=>n.checks[q.key]==='Needs correction')) throw Error('Resolve checklist items marked Needs correction.');
  const gaps=qs.filter(q=>!n.checks[q.key]||n.checks[q.key]==='Proceed with gap').map(q=>q.question);
  if(!n.messages.some(m=>m.proof)) gaps.push('No supporting evidence link supplied');
  if(gaps.length&&!note.trim()) throw Error('Record a note to proceed with the listed gaps.');
  n.status='accepted';event(db,r,n,'ACCEPTED',note,'',{gaps});
  if(n.parent) {
    const p=r.nodes.find(x=>x.id===n.parent);
    if(children(r,p.id).every(c=>c.status==='accepted')) {
      p.status=p.messages.length?'submitted':p.sentAt?'sent':'ready';
      event(db,r,p,'PARENT_RECHECK_REQUIRED','Children resolved; parent still needs review.');
    }
  }
}
export function correction(db,r,n,label,instruction) {
  editable(r,n);
  if(!instruction.trim()) throw Error('Describe the correction.');
  const child=newStep(db,r,label,instruction,'course_correction',n.id);
  n.status='revision';event(db,r,n,'NEEDS_CORRECTION',instruction,'',{child:child.id});return child;
}
export function removeStep(db,r,n) {
  editable(r,n);
  if(children(r,n.id).length) throw Error('Remove or resolve child entries first.');
  if(n.sentAt||n.messages.length) throw Error('Delivered or answered steps are retained. Use a correction.');
  n.deleted=true;event(db,r,n,'STEP_REMOVED','Removed from ladder; history retained.');
  if(n.parent) {
    const p=r.nodes.find(x=>x.id===n.parent);
    if(children(r,p.id).every(c=>c.status==='accepted'))p.status=p.messages.length?'submitted':p.sentAt?'sent':'ready';
  }
}
export function lifecycle(db,r,action) {
  if(!['pause','archive','delete'].includes(action)) throw Error('Unknown action.');
  const key={pause:'paused',archive:'archived',delete:'deleted'}[action];r[key]=!r[key];
  event(db,r,null,action.toUpperCase(),`${key}: ${r[key]}`);
}
export function fixture(db,r,key,values,rowId,approvalNote) {
  editable(r);const change=fixtureChange(db,r,key,values,rowId,approvalNote);
  event(db,r,null,'FIXTURE_RECORDED',key,values.url,change);
}
export function removeFixture(db,r,key,rowId) {
  editable(r);const row=r.fixtures[key].find(x=>x.id===rowId);
  if(!row) throw Error('Item not found.');
  row.deleted=true;event(db,r,null,'FIXTURE_REMOVED',key,'',structuredClone(row));
}
export function pull(db,r,key,sourceId) {
  editable(r);const rows=pullFixtures(db,r,key,sourceId);
  event(db,r,null,'FIXTURES_PULLED',key,'',{sourceId,rows});return rows.length;
}
