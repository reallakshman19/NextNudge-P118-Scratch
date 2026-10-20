import {activeIntent} from './thread.mjs';
import {workspaceEntries,savedWorkspace,responseTargets,workspaceBasis} from './workspace.mjs';
import {workspaceNav,TITLES} from './workspace-nav.mjs';
import {replyLabel} from './reply.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={ground:'Save Ground context',task:'Save Task',correction:'Save Correction',reconcile:'Save Review'};
const builds={ground:'Build grounding brief',task:'Build task packet',correction:'Build correction packet',reconcile:'Build next instruction'};
const descriptions={ground:'Save the sources and context an agent should start from.',
  task:'Define one deliverable and link the exact Ground version it uses.',
  correction:'Anchor a redo to an actual instruction or agent response.',
  reconcile:'Assess one recorded response against the Owner checks, then choose what happens next.'};
function field(v,key,label,rows=3,hint=''){
  return '<label>'+label+'<textarea name="'+key+'" rows="'+rows+'" maxlength="12000"'+(rows===1?' class="compact-textarea"':'')+'>'+esc(v[key])+'</textarea>'+
    (hint?'<small>'+hint+'</small>':'')+'</label>';
}
function sources(v){
  const found=[...new Set(Object.values(v).flatMap(text=>String(text).match(/https?:\/\/[^\s<>"']+/g)||[]))];
  return found.length?'<ul class="source-links">'+found.map(url=>'<li><a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(url)+'</a></li>').join('')+'</ul>':
    '<p class="small">Save source links here to reopen them and include them in the agent brief.</p>';
}
function groundLink(thread,v){
  const versions=workspaceEntries(thread,'ground'),chosen=versions.find(x=>x.id===v.groundId);
  return '<div class="linked-context"><h3>Linked Ground version</h3><label>Saved context<select name="groundId"><option value="">No saved Ground linked</option>'+
    versions.slice().reverse().map(x=>'<option value="'+esc(x.id)+'"'+(x.id===v.groundId?' selected':'')+'>'+esc(x.id)+' · '+esc(x.values.brief.slice(0,70))+'</option>').join('')+
    '</select></label>'+(chosen?'<p>'+esc(chosen.values.brief)+'</p>'+sources(chosen.values):'<p class="small">Save context in Ground, then select its version here. Source notes below can also be used directly.</p>')+'</div>';
}
function responseLink(thread,mode,v){
  const targets=responseTargets(thread,mode),selected=targets.find(x=>x.id===v.target);
  return '<div class="response-source"><h3>'+ (mode==='reconcile'?'Response under review':'Instruction or response to correct')+'</h3>'+
    '<label>Recorded source<select name="target"><option value="">Select a recorded source</option>'+targets.slice().reverse().map(x=>
      '<option value="'+esc(x.id)+'"'+(x.id===v.target?' selected':'')+'>'+esc(x.kind+' · '+x.id)+'</option>').join('')+'</select></label>'+
    (!targets.length?'<p class="workspace-empty">No recorded '+(mode==='reconcile'?'response':'instruction or response')+' yet. Record the actual exchange in Overview before building this packet.</p>':'')+
    (selected?'<p>Linked ID: <strong>'+esc(selected.id)+'</strong>'+(selected.answers?' · Answers '+esc(selected.answers):'')+'</p>'+
      (mode==='reconcile'?'<p>Assessment: '+esc(replyLabel(selected||{}))+'</p>':'')+
      sources({evidence:selected.evidence})+'<details><summary>Read recorded text</summary><pre>'+esc(selected.replyText||selected.packet||selected.returnLine||selected.digest)+'</pre></details>':'')+'</div>';
}
function groundFields(thread,v){
  return '<div class="workspace-grid"><div><h3>Project sources</h3>'+field(v,'repository','Repository / project link',1)+
    field(v,'issue','Issue / assignment link',1)+field(v,'pullRequest','Pull request / candidate link',1)+field(v,'roadmap','Roadmap / governing document',1)+
    sources(v)+'</div><div><h3>Starting context</h3>'+field(v,'brief','What must the agent understand?')+
    field(v,'sources','Other inputs, files and source notes',2)+field(v,'unknowns','Unknowns to resolve',2)+field(v,'firstStep','First step / orientation',2)+
    '<p class="small">Saved Grounding Fixtures are included when you save or build this context.</p><button type="button" data-action="grounding">Open Grounding Fixtures</button></div></div>';
}
function taskFields(thread,v){
  return '<div class="workspace-grid"><div><h3>The assignment</h3>'+field(v,'task','One bounded task',4)+
    field(v,'deliverable','Expected deliverable',2)+field(v,'success','Task success check',2)+field(v,'constraints','Task boundaries / exclusions',2)+
    '</div><aside>'+groundLink(thread,v)+field(v,'sources','Additional source links and notes',3)+'</aside></div>';
}
function correctionFields(thread,v){
  return responseLink(thread,'correction',v)+'<div class="workspace-grid correction-comparison"><div><h3>Observed</h3>'+field(v,'claim','Incorrect claim / observed error')+
    '</div><div><h3>Expected</h3>'+field(v,'expected','Expected result')+'</div></div>'+field(v,'redo','Bounded redo scope')+
    field(v,'preserve','What must remain unchanged?',2)+'<details><summary>Context and supporting links</summary>'+groundLink(thread,v)+field(v,'sources','Evidence / source notes',2)+'</details>';
}
function reviewFields(thread,v){
  const criteria=activeIntent(thread).doneWhen;
  return responseLink(thread,'reconcile',v)+'<input type="hidden" hidden name="basis" value="'+esc(JSON.stringify(criteria))+'">'+
    '<div class="workspace-grid"><div><h3>Owner checks</h3>'+(criteria.length?criteria.map((q,n)=>'<label class="criterion"><span>'+esc(q)+'</span><select name="check'+n+'">'+
      ['unknown','met','not met'].map(value=>'<option'+((v['check'+n]||'unknown')===value?' selected':'')+'>'+value+'</option>').join('')+'</select></label>').join(''):
      '<p class="workspace-empty">Owner checks are UNKNOWN. Define them in Overview before closing the outcome.</p>')+
    field(v,'evidence','Evidence inspected / public links',3)+'</div><div><h3>Owner decision</h3><label>Next decision<select name="decision">'+
    ['request evidence','correct','continue','change direction','close'].map(d=>'<option'+(v.decision===d?' selected':'')+'>'+d+'</option>').join('')+'</select></label>'+
    field(v,'gap','Observed gap or missing evidence',3)+field(v,'nextTask','Next bounded instruction',3)+
    '<p class="small">Saving a review never accepts the outcome. Close still requires every current Owner check to be met.</p></div></div>';
}
export function workspaceView(thread,mode,v,draft){
  const saved=savedWorkspace(thread,mode),i=activeIntent(thread);
  const stale=draft?.workspaceMode&&draft.workspaceBasis!==workspaceBasis(thread,mode,v);
  const content={ground:groundFields,task:taskFields,correction:correctionFields,reconcile:reviewFields}[mode];
  return '<div class="heading"><button data-action="thread">← Overview</button><h2>'+esc(thread.title)+'</h2></div>'+workspaceNav(mode)+
    '<section class="workspace workspace-'+mode+'"><div class="workspace-heading"><div><p class="eyebrow">'+esc(descriptions[mode])+'</p>'+
    '<h2 id="workspace-title" tabindex="-1">'+TITLES[mode]+'</h2></div><a href="?thread='+encodeURIComponent(thread.id)+'&amp;workspace='+mode+'">Link to this tab</a></div>'+
    '<p class="workspace-owner"><strong>Owner goal:</strong> '+esc(i.goal)+(i.hold?' <strong class="hold-badge">HOLD: '+esc(i.hold)+'</strong>':'')+'</p>'+
    '<form id="workspace-form" data-mode="'+mode+'">'+content(thread,v)+
    '<div class="workspace-actions"><button type="submit" class="primary">'+labels[mode]+'</button><button type="button" data-action="workspace-build"'+(i.hold?' disabled':'')+'>'+builds[mode]+'</button>'+
    '<span id="workspace-status" role="status" aria-live="polite">'+(saved?'Saved version '+esc(saved.id):'No saved '+TITLES[mode]+' version yet')+'</span></div></form>'+
    '<p class="small">Typing keeps a separate device draft for this tab. Save records one meaningful version locally. Unchanged saves add nothing to history.</p>'+
    '<button data-action="github-save">Publish saved versions to GitHub…</button><p class="small">Device drafts are excluded until you save them. Review and submit the prepared Owner request to publish.</p>'+
    '<p id="workspace-packet-note" role="status">'+(stale?'Fields or Owner context changed. Build an updated packet before delivery.':draft&&!draft.workspaceMode?'An earlier freeform packet is preserved below. Build a new packet to use these workspace fields.':'')+'</p><section id="composer"></section></section>';
}
