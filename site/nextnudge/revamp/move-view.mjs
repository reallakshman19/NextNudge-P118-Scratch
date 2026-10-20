import {summary,replyWarnings,replyAcks} from './reply.mjs';
import {sealHtml} from './seal.mjs';
import {groundingSummary} from './grounding.mjs';
import {workspaceSummary} from './workspace.mjs';
export function moveMarkup(thread,move,esc) {
  if(move.kind==='sealed')return '<div id="move-'+esc(move.id)+'" tabindex="-1">'+sealHtml(thread,move,esc)+'</div>';
  const first=move.kind==='reply'?replyAcks(move.replyText||move.returnLine||'').primary:'';
  const warnings=move.kind==='reply'?replyWarnings(move.replyText||move.digest||'',first,
    !first||!!move.answers):[];
  const info=summary(move,thread);
  return '<div id="move-'+esc(move.id)+'" tabindex="-1" class="move-summary"><strong>'+esc(info)+'</strong> · '+
    esc(move.returnLine||groundingSummary(move)||workspaceSummary(move)||(move.note?.startsWith('GITHUB_SEND_V1:')?'GitHub delivery recorded':move.note)||'No reply')+
    warnings.map(w=>'<p class="hold">'+esc(w)+'</p>').join('')+'</div>';
}
