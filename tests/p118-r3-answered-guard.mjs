import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {applyAction} from '../scripts/nextnudge_action_apply.mjs';
import {newThread,parse,serialize} from '../site/nextnudge/revamp/thread.mjs';
import {makeReply} from '../site/nextnudge/revamp/reply.mjs';
const REPO='reallakshman19/NextNudge-P118-Scratch';
const THREAD='NN-20261021-070000-a301';
const TASK='NN-20261021-070001-a302',OTHER='NN-20261021-070002-a303';
const TARGET={repository:REPO,issue:8,agent:'G1'};
const url=id=>'https://github.com/'+REPO+'/issues/8#issuecomment-'+id;
const stamp='2026-10-21T06:00:00Z';
const blob=text=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0'+text).digest('hex');
function sent(id) {
  return {id,kind:'task',delivery:'sent',packet:'EXACT SYNTHETIC SENT PACKET '+id,
    returnLine:'',digest:'',evidence:url(100),gap:'',decision:'task',archive:'',
    role:'worker',agent:'G1',
    note:'GITHUB_SEND_V1:'+JSON.stringify({target:TARGET,commentUrl:url(100),sentAt:stamp})};
}
const replyText=id=>'ACK '+id+'\nFROM: G1\nPublic synthetic reply; not a live GitHub comment.';
const comment=(id,move=TASK,created='2026-10-21T06:01:00Z',from='G1')=>({
  body:'ACK '+move+'\nFROM: '+from+'\nPublic synthetic fixture only.',
  html_url:url(id),created_at:created,user:{login:'TEST_ONLY_NO_GITHUB_POST'}});
function fixture({answered=false,twoMoves=false}={}) {
  const t=newThread({id:THREAD,title:'P08 answered-move regression',agent:'G1',
    goal:'Exactly one reply for each sent task.',inScope:'Local scratch test only.',
    outScope:'Production and real GitHub comments.',hold:'',doneWhen:['No duplicate return']});
  t.moves.push(sent(TASK));
  if(answered){
    const r=makeReply(t,replyText(TASK),{id:'NN-20261021-070003-a304',
      evidence:url(201),label:'SELF-ASSESSED'}).move;
    t.moves.push(r);
  }
  if(twoMoves)t.moves.push(sent(OTHER));
  return parse(serialize(t));
}
function request(thread,sha,moveId){
  const packet={v:1,operation:'fetch',target:TARGET,
    delta:{v:3,id:thread.id,baseSha:sha,expectedCount:thread.moves.length,moves:[]},
    moveId};
  const fence=String.fromCharCode(96).repeat(3);
  return 'NextNudge scratch test only.\n\n'+fence+'nextnudge-thread-action\n'+
    gzipSync(Buffer.from(JSON.stringify(packet))).toString('base64')+'\n'+fence;
}
function harness(t,comments){
  let source=serialize(t),sha=blob(source),writes=0,reads=0,lists=0;
  const receipts=[];
  return {
    async fetch(moveId=TASK,{wrongOwner=false,stale=false}={}){
      const current=parse(source);
      const issue={number:40,state:'open',
        user:{login:wrongOwner?'not-the-owner':'reallakshman19'},
        labels:[{name:'nextnudge-save'}],
        body:request(current,stale?'0'.repeat(40):sha,moveId)};
      return applyAction({issue,owner:'reallakshman19',
        read:async path=>{
          assert.equal(path,'site/nextnudge-data/threads/'+THREAD+'.md');
          reads++;return {content:source,sha};
        },
        write:async(path,content,base)=>{
          assert.equal(path,'site/nextnudge-data/threads/'+THREAD+'.md');
          assert.equal(base,sha);
          writes++;source=content;sha=blob(content);
        },
        listComments:async target=>{
          assert.deepEqual(target,TARGET);lists++;return comments;
        },
        postComment:async()=>{throw Error('NO LIVE COMMENT POSTS');},
        comment:async body=>receipts.push(body),
        close:async()=>{},
        projects:{}});
    },
    state:()=>({thread:parse(source),source,sha,writes,reads,lists,receipts})
  };
}
test('R3: answered task ignores a second matching URL; zero writes',async()=>{
  const initial=fixture({answered:true}),h=harness(initial,[comment(201),comment(202)]);
  assert.equal(await h.fetch(),'WAITING');
  const x=h.state();
  assert.equal(x.writes,0);
  assert.equal(x.lists,0,'guard should short-circuit before listing comments');
  assert.equal(x.thread.moves.length,2);
  assert.deepEqual(x.thread.moves,initial.moves);
});
test('same consumed URL remains a no-op',async()=>{
  const h=harness(fixture({answered:true}),[comment(201)]);
  assert.equal(await h.fetch(),'WAITING');
  assert.equal(h.state().writes,0);
  assert.equal(h.state().thread.moves.length,2);
});
test('two matching URLs on first fetch: one reply; second fetch zero writes',async()=>{
  const t=fixture(),h=harness(t,[comment(301),comment(302)]);
  assert.equal(await h.fetch(),'SAVED');
  assert.equal(h.state().writes,1);
  assert.equal(h.state().thread.moves.filter(m=>m.kind==='reply').length,1);
  assert.equal(h.state().thread.moves[1].answers,TASK);
  assert.deepEqual(h.state().thread.moves[0],t.moves[0]);
  assert.equal(await h.fetch(),'WAITING');
  assert.equal(h.state().writes,1);
  assert.equal(h.state().thread.moves.filter(m=>m.kind==='reply').length,1);
  assert.deepEqual(parse(serialize(h.state().thread)),h.state().thread);
});
test('reply to earlier task does not block a distinct unanswered task',async()=>{
  const t=fixture({answered:true,twoMoves:true});
  const h=harness(t,[comment(201),comment(303,OTHER)]);
  assert.equal(await h.fetch(OTHER),'SAVED');
  const moves=h.state().thread.moves;
  assert.equal(h.state().writes,1);
  assert.equal(moves.filter(m=>m.kind==='reply').length,2);
  assert.equal(moves.at(-1).answers,OTHER);
  assert.deepEqual(moves.slice(0,3),t.moves);
});
test('wrong-move, stale, and wrong-FROM comments cannot answer',async()=>{
  for(const c of [
    comment(400,'NN-20261021-070009-bbbb'),
    comment(401,TASK,'2026-10-21T05:59:00Z'),
    comment(402,TASK,'2026-10-21T06:01:00Z','G2')]){
    const h=harness(fixture(),[c]);
    assert.equal(await h.fetch(),'WAITING');
    assert.equal(h.state().writes,0);
    assert.equal(h.state().thread.moves.length,1);
  }
});
test('Owner authorization and stale SHA remain enforced',async()=>{
  const h=harness(fixture(),[comment(501)]);
  assert.equal(await h.fetch(TASK,{wrongOwner:true}),'IGNORED');
  assert.equal(h.state().reads,0);
  assert.equal(h.state().writes,0);
  assert.equal(await h.fetch(TASK,{stale:true}),'REJECTED');
  assert.equal(h.state().writes,0);
  assert.equal(h.state().lists,0);
  assert.match(h.state().receipts.at(-1),/NEEDS RELOAD/);
});
