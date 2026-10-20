import {ID,safeURL} from './identity.mjs';
import {HEADINGS} from './fixtures.mjs';
import {STATES,TYPES} from './model.mjs';
const fail = text => {throw Error('Invalid backup: '+text);};
const text = (v,max=100000) => typeof v==='string'&&v.length<=max;
const date = v => typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*Z$/.test(v)&&Number.isFinite(Date.parse(v));
const ident = (v,prefix) => text(v,40)&&ID.test(v)&&(!prefix||v.startsWith(prefix+'-'));
function plain(value,depth=0) {
  if(depth>30) fail('nesting is too deep');
  if(value&&typeof value==='object') for(const key of Object.keys(value)) {
    if(['__proto__','constructor','prototype','chatUrl','agentChatUrl'].includes(key)) fail('unsafe or private field '+key);
    plain(value[key],depth+1);
  }
}
export function validateProfiles(config) {
  if(config?.formatVersion!==1||!config.profiles||Array.isArray(config.profiles)) fail('profile configuration');
  plain(config);
  const names=Object.keys(config.profiles);
  if(!names.length||names.length>30) fail('profile count');
  for(const name of names) {
    if(!/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/.test(name)) fail('profile name');
    const qs=config.profiles[name];
    if(!Array.isArray(qs)||qs.length>40) fail('questions');
    const ids=new Set();
    for(const q of qs) {
      if(!/^[a-z0-9_-]{1,40}$/.test(q.id)||ids.has(q.id)||!text(q.question,500)||
        !text(q.example,2000)||!text(q.evidence,2000)) fail('question');
      ids.add(q.id);
    }
  }
  return config;
}
function validateNode(n,ids) {
  if(!ident(n.id,'NN')||ids.has(n.id)||!text(n.label,300)||!text(n.instruction)||
    !STATES.includes(n.status)||!TYPES.includes(n.type)||!Array.isArray(n.messages)||
    !n.checks||typeof n.checks!=='object'||Array.isArray(n.checks)) fail('step');
  ids.add(n.id);
  if(n.sentAt!==null&&(!date(n.sentAt)||!text(n.sentText)||!/^[a-f0-9]{8}$/i.test(n.sentChatId8||''))) fail('send record');
  for(const m of n.messages) {
    if(!['Owner','Agent'].includes(m.by)||!text(m.text)||!date(m.at)||
      !safeURL(m.proof)||m.repliedAt!==null&&!date(m.repliedAt)||
      typeof m.relayed!=='boolean') fail('reply');
  }
}
function validateRun(r,projects,ids,profiles) {
  if(!ident(r.id,'NN')||ids.has(r.id)||!projects.has(r.projectId)||
    !text(r.title,300)||!text(r.aim)||!date(r.createdAt)||!Array.isArray(r.nodes)||
    r.nodes.length>500||!Array.isArray(r.profiles)||r.profiles.some(p=>!Object.hasOwn(profiles,p))) fail('run');
  ids.add(r.id);
  for(const n of r.nodes) validateNode(n,ids);
  const nodes=new Map(r.nodes.map(n=>[n.id,n]));
  for(const n of r.nodes) {
    const seen=new Set();let p=n;
    while(p.parent) {
      if(seen.has(p.id)||!nodes.has(p.parent)) fail('cyclic or missing parent');
      seen.add(p.id);p=nodes.get(p.parent);
    }
  }
  for(const [,key] of HEADINGS) {
    const rows=r.fixtures?.[key];
    if(!Array.isArray(rows)||rows.length>1000) fail('fixture section '+key);
    for(const row of rows) {
      if(!ident(row.id,'GF')||ids.has(row.id)||!text(row.text)||!safeURL(row.url)||!date(row.at)||
        !['UNKNOWN','RECORDED','NEEDS_REVIEW'].includes(row.status)) fail('fixture row');
      ids.add(row.id);
      if(row.source&&(!ident(row.source.project,'PRJ')||!ident(row.source.run,'NN')||
        !ident(row.source.row,'GF')||!date(row.source.pulledAt))) fail('fixture provenance');
    }
  }
}
export function validate(db) {
  plain(db);
  if(db?.formatVersion!==2||!Number.isSafeInteger(db.revision)||db.revision<0||
    !Array.isArray(db.projects)||!Array.isArray(db.runs)||!Array.isArray(db.events)||
    db.projects.length>100||db.runs.length>500||db.events.length>50000) fail('document');
  validateProfiles(db.profiles);
  const ids=new Set(),projects=new Set();
  for(const p of db.projects) {
    if(!ident(p.id,'PRJ')||ids.has(p.id)||!text(p.name,300)||!date(p.createdAt)) fail('project');
    ids.add(p.id);projects.add(p.id);
  }
  for(const r of db.runs) validateRun(r,projects,ids,db.profiles.profiles);
  for(const e of db.events) {
    if(!ident(e.id,'EV')||ids.has(e.id)||!date(e.at)||!['Owner','Agent'].includes(e.by)||
      !text(e.state,100)||!text(e.note)||!safeURL(e.proof)||
      e.step!==null&&!ident(e.step,'NN')||e.run!==null&&!ident(e.run,'NN')||
      e.project!==null&&!ident(e.project,'PRJ')) fail('event');
    ids.add(e.id);
  }
  return db;
}
