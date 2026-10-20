import {freshId,MOVE_ID,assertPublic} from './thread.mjs';
const empty=(id)=>({id,kind:'sealed',delivery:'draft',packet:'',returnLine:'',
  digest:'',evidence:'',gap:'',decision:'',archive:'',note:''});
export async function makeSeal(thread,{text,names,id=freshId(),date=new Date()}){
  if(typeof text!=='string'||!text||text.length>90000)throw Error('Sealed note text required (max 90000)');
  if(!MOVE_ID.test(names)||!thread.moves.some(m=>m.id===names))throw Error('Seal must name an existing move ID');
  assertPublic(text);
  if(!crypto?.subtle)throw Error('SHA-256 unavailable');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  const sha256=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  return {...empty(id),text,sha256,createdAt:date.toISOString(),names};
}
export function sealUnlocked(thread,seal){
  const idx=thread.moves.findIndex(m=>m.id===seal.id);
  return idx>=0&&thread.moves.some(m=>m.kind==='reply'&&m.answers===seal.names);
}
export function sealHtml(thread,move,esc) {
  const tip='<p>Do not put sensitive text in a sealed note. The text is public in the thread file.</p>';
  const header=esc(move.createdAt)+' · SHA-256 '+esc(move.sha256);
  return sealUnlocked(thread,move)?
    '<details><summary>Sealed note · '+header+'</summary>'+tip+'<pre>'+esc(move.text)+'</pre></details>':
    '<div class="sealed"><strong>Sealed note · '+header+'</strong>'+tip+
    '<p>Collapsed until an answering reply is recorded.</p></div>';
}
export function sealForm(thread,esc){
  return '<form id="seal-form"><h3>Seal public note</h3>'+
    '<label>Names an existing move<select name="names" required>'+
    thread.moves.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.id)+'</option>').join('')+
    '</select></label><label>Public note<textarea name="text" required maxlength="90000"></textarea></label>'+
    '<p>Do not put sensitive text in a sealed note.</p>'+
    '<button type="submit">Seal once (immutable)</button> <button type="button" data-action="cancel-edit">Cancel</button></form>';
}
