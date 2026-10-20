// Read-only project view. Original thread moves remain the only activity authority.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function kind(move){
  if(move.kind!=='amendment')return move.kind==='reply'?'Agent reply':move.kind[0].toUpperCase()+move.kind.slice(1);
  if(move.note?.startsWith('WORKSPACE_V1:')){
    try{const x=JSON.parse(move.note.slice('WORKSPACE_V1:'.length));return (x.mode||'Workspace')+' saved';}
    catch{return 'Workspace record (unreadable)';}
  }
  if(move.note?.startsWith('GROUNDING_FIXTURES_V1:'))return 'Historical grounding';
  if(move.note?.startsWith('OWNER_INTENT_CHANGE:'))return 'Owner intent amended';
  return 'Amendment';
}
function preview(move){
  if(move.kind==='sealed')return 'Private contents not shown';
  if(move.returnLine?.trim())return move.returnLine.trim().slice(0,180);
  if(move.kind==='amendment'&&move.note?.startsWith('WORKSPACE_V1:')){
    try{const data=JSON.parse(move.note.slice('WORKSPACE_V1:'.length));
      const v=data.values||{};
      return String(v.task||v.brief||v.claim||v.nextTask||v.decision||'Saved source workspace').slice(0,180);
    }catch{return 'Workspace data needs inspection in original thread';}
  }
  if(move.kind==='amendment')return 'Open the original Owner/context amendment';
  if(move.packet){
    const m=/One bounded task:\s*\n([^\n]+)/.exec(move.packet)||
      /Project context:\s*([^\n]+)/.exec(move.packet)||
      /Observed error \/ quoted claim:\s*([^\n]+)/.exec(move.packet);
    if(m?.[1]?.trim())return m[1].trim().slice(0,180);
  }
  return String(move.gap||move.note||'Open original item in agent thread').slice(0,180);
}
function stamp(move){
  const m=/^NN-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(move.id);
  if(!m)return null;
  return m[1]+'-'+m[2]+'-'+m[3]+' '+m[4]+':'+m[5]+':'+m[6]+' UTC';
}
function selectThread(local,remote){
  if(!local)return {thread:remote||null,origin:remote?'GitHub':'not available'};
  if(!remote)return {thread:local,origin:'device (remote unverified)'};
  const prefix=JSON.stringify(remote.moves.slice(0,local.moves.length))===JSON.stringify(local.moves);
  if(prefix&&remote.moves.length===local.moves.length)return {thread:local,origin:'device (matches GitHub)'};
  if(prefix&&remote.moves.length>local.moves.length)
    return {thread:local,origin:'device (GitHub has newer moves — compare before opening)'};
  const localAhead=JSON.stringify(local.moves.slice(0,remote.moves.length))===JSON.stringify(remote.moves);
  return {thread:local,origin:localAhead?'device (newer local moves)':'device (GitHub conflict — compare)'};
}
export function masterLogEntries(project,device={},remote={}){
  const rows=[],unavailable=[];
  for(const member of project.threads){
    const remoteResult=remote[member.id],selection=selectThread(device[member.id],remoteResult?.thread);
    if(!selection.thread){unavailable.push({agent:member.agent,id:member.id,reason:remoteResult?.error||'Not loaded from this device or GitHub'});continue;}
    const thread=selection.thread;
    thread.moves.forEach((move,index)=>{
      // Sealed-note contents are not repeated in the project overview.
      const description=preview(move);
      rows.push({agent:member.agent,threadId:member.id,threadTitle:thread.title,
        moveId:move.id,kind:kind(move),delivery:move.delivery,
        description,origin:selection.origin,time:stamp(move),index,memberIndex:project.threads.indexOf(member)});
    });
  }
  // An ID without the native timestamp has UNKNOWN time, never a fabricated clock.
  rows.sort((a,b)=>{
    if(!!a.time!==!!b.time)return a.time?-1:1;
    if(a.time!==b.time)return a.time<b.time?1:-1;
    if(a.memberIndex!==b.memberIndex)return a.memberIndex-b.memberIndex;
    return b.index-a.index;
  });
  return {rows,unavailable};
}
export function masterLogMarkup(project,device={},remote={},limit=100,loading=false){
  const {rows,unavailable}=masterLogEntries(project,device,remote),visible=rows.slice(0,limit);
  const count=project.threads.length-unavailable.length;
  return '<div class="heading"><button data-action="project">← Project</button><h2>Master Log · '+esc(project.name)+'</h2></div>'+
    '<p>One read-only running view of source agent threads. No new log entries are created by opening this page. '+
    'Items are claims/records, not proof of Owner acceptance. Timestamps appear only when present in a move ID.</p>'+
    '<p><strong>'+count+'/'+project.threads.length+' threads available</strong> · '+rows.length+
    ' recorded items · '+(loading?'Refreshing GitHub…':'Local and fetched GitHub sources; refresh for current remote state')+'</p>'+
    '<p><button data-action="master-log-refresh"'+(loading?' disabled':'')+'>Refresh from GitHub (read-only)</button></p>'+
    (unavailable.length?'<section role="status"><strong>Incomplete source coverage</strong><ul>'+
      unavailable.map(x=>'<li>'+esc(x.agent)+' ('+esc(x.id)+'): '+esc(x.reason)+'</li>').join('')+
      '</ul></section>':'')+
    (rows.length?'<div class="master-log-list">'+visible.map(x=>{
      const href='?thread='+encodeURIComponent(x.threadId)+'&move='+encodeURIComponent(x.moveId);
      return '<article class="master-log-item"><div><strong>'+esc(x.agent)+' · '+esc(x.kind)+'</strong>'+
        ' · '+esc(x.delivery)+' · <small>'+esc(x.time||'Time UNKNOWN')+'</small></div>'+
        '<p>'+esc(x.description)+'</p><p class="small">'+esc(x.threadTitle)+' · '+esc(x.origin)+
        ' · Move '+esc(x.moveId)+'</p><a href="'+href+'">Open exact thread item</a></article>';
    }).join('')+'</div>':'<p class="workspace-empty">No recorded agent moves in available threads.</p>')+
    (visible.length<rows.length?'<button data-action="master-log-more">Show next 100 of '+(rows.length-visible.length)+' remaining</button>':'')+
    '<p class="small">For another device to see a thread, its original thread file must be saved to GitHub. Missing/failed reads remain explicitly visible.</p>';
}
