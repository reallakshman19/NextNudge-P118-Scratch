import {MOVE_ID,freshId,activeIntent} from './thread.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function ackTag(packet) {
  const tag='([A-Za-z0-9][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9_-]+)*)';
  const directive=new RegExp('\\b(?:start your reply with|reply with|begin with)\\s+ACK\\s+'+tag,'i');
  const lineTag=new RegExp('^\\s*(?:[-*]\\s*)?ACK\\s+'+tag+'(?=[\\s.,;:!?)]|$)','i');
  const tags=packet.split(/\r?\n/).map(line=>{
    const m=directive.exec(line)||lineTag.exec(line);return m?.[1]||null;
  }).filter(Boolean);
  if(new Set(tags).size>1)throw Error('Conflicting ACK tags in pasted packet');
  return tags[0]||null;
}
export function boundedTaskFilled(packet) {
  const section=packet.match(/(?:^|\r?\n)One bounded task:[ \t]*([\s\S]*?)(?=\r?\n(?:Authoritative inputs|Boundaries|Success criteria|Uncertainty handling):|$)/);
  return !!section&&!!section[1].trim();
}
export function sentMove(thread,draft,packet,{override_note='',role='worker',agent=''}={}) {
  if(typeof packet!=='string'||!packet.trim())throw Error('Empty sent packet');
  const id=ackTag(packet)||draft.id||freshId();
  if(!MOVE_ID.test(id))throw Error('Invalid ACK move tag');
  if(thread.moves.some(m=>m.id===id))throw Error('Duplicate ACK tag; cannot reuse an existing move ID');
  if(!['worker','generator','judge'].includes(role))throw Error('Invalid role');
  if(typeof agent!=='string'||agent.length>200)throw Error('Invalid agent');
  if(typeof override_note!=='string'||override_note.length>3000)throw Error('Invalid override note');
  if(draft.requiresTask&&!boundedTaskFilled(packet)&&!override_note.trim())
    throw Error('One bounded task is blank. Fill it or record an explicit override note.');
  if(draft.kind==='close'){
    const proof=draft.closure;
    const criteria=activeIntent(thread).doneWhen;
    if(!proof||!criteria.length||JSON.stringify(proof.criteria)!==JSON.stringify(criteria)||
      !Array.isArray(proof.checks)||proof.checks.length!==criteria.length||
      !proof.checks.every(c=>c==='met'))
      throw Error('Close requires Reconcile with every Owner done-when Met');
  }
  return {id,kind:draft.kind,delivery:'sent',packet,returnLine:'',digest:'',
    evidence:'',gap:draft.gap||'',decision:draft.kind,archive:'',role,agent,
    ...(override_note.trim()?{override_note}:{}),
    note:draft.kind==='close'?'OWNER_CLOSE_CHECKS:'+JSON.stringify(draft.closure):''};
}
export function amendValues(values){
  const goal=String(values.goal??'').trim();
  const doneWhen=String(values.checks??'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const inScope=String(values.inScope??'').trim(),outScope=String(values.outScope??'').trim();
  const hold=String(values.hold??'').trim();
  if(!goal)throw Error('Owner goal is required');
  if(doneWhen.length>5)throw Error('At most five done-when checks');
  return {goal,doneWhen,inScope,outScope,hold};
}
export function agentChange(label,id=freshId()){
  const next=String(label??'').trim();
  if(!next||next.length>200)throw Error('Enter a valid new agent label');
  return {id,kind:'agent',delivery:'draft',packet:'',returnLine:'',digest:'',
    evidence:'',gap:'',decision:'',archive:'',note:'AGENT_CHANGE:'+next};
}
export function ownerForm(i) {
  return '<form id="owner-amend"><h3>Amend Owner intent</h3>'+
    '<label>Owner goal<textarea name="goal" required rows="3">'+esc(i.goal)+'</textarea></label>'+
    '<label>Done-when · one check per line (max 5)<textarea name="checks" rows="6">'+
      esc(i.doneWhen.join('\n'))+'</textarea></label>'+
    '<label>In scope<textarea name="inScope" rows="3">'+esc(i.inScope)+'</textarea></label>'+
    '<label>Out of scope<textarea name="outScope" rows="3">'+esc(i.outScope)+'</textarea></label>'+
    '<label>HOLD / Owner constraint<textarea name="hold" rows="2">'+esc(i.hold)+'</textarea></label>'+
    '<label><input type="checkbox" name="approved" required> I confirm this Owner-authorized amendment.</label>'+
    '<button type="submit">Save amendment</button> <button type="button" data-action="cancel-edit">Cancel</button></form>';
}
export function agentForm(agent){
  return '<form id="agent-change"><h3>Change agent · same Owner intent</h3>'+
    '<label>New agent label<input name="agent" required maxlength="200" value="'+esc(agent)+'"></label>'+
    '<p>After saving, the device-only chat URL will be cleared. Enter the new agent chat link.</p>'+
    '<button type="submit">Save new agent</button> <button type="button" data-action="cancel-edit">Cancel</button></form>';
}
export function sentForm(agent=''){
  return '<form id="sent-confirm"><label>Role<select name="role">'+
    ['worker','generator','judge'].map(v=>'<option value="'+v+'">'+v+'</option>').join('')+
    '</select></label><label>Agent<input name="agent" maxlength="200" value="'+esc(agent)+'"></label>'+
    '<label>Blank-task override note (optional)<textarea name="override_note" maxlength="3000"></textarea></label>'+
    '<label><input type="checkbox" name="approved" required>'+
    ' I confirm this exact packet was manually sent to the agent.</label>'+
    '<button type="submit">Save sent packet</button> <button type="button" data-action="cancel-edit">Cancel</button></form>';
}
