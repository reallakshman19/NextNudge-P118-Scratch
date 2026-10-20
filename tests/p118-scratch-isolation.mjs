import test from 'node:test';
import assert from 'node:assert/strict';
import {assertScratchRun,assertScratchApi} from '../scripts/nextnudge_scratch_guard.mjs';
import {assertScratchRepo,SCRATCH_REPO} from '../site/nextnudge/revamp/scratch-identity.mjs';
const S=SCRATCH_REPO;
const good='contents/site/nextnudge-data/threads/NN-20261020-200000-abcd.md';
const body={message:'test',branch:'main',content:'YWJj'};
test('exact scratch identity; production fail closed',()=>{
  assert.equal(assertScratchRepo(S),S);
  for(const bad of ['reallakshman19/CoordinatorLandingpage','reallakshman19/CoordinatorLandingpage/main', '',undefined])
    assert.throws(()=>assertScratchRun(bad),/SCRATCH_REPOSITORY_REQUIRED/);
  assert.throws(()=>assertScratchRun(S,'reallakshman19/CoordinatorLandingpage'),/SCRATCH_EVENT_REPOSITORY_REQUIRED/);
});
test('writer only permits synthetic data paths on scratch main',()=>{
  assert.equal(assertScratchApi(S,good,{method:'PUT',body:JSON.stringify(body)}),
    'https://api.github.com/repos/'+S+'/'+good);
  for(const bad of ['contents/site/nextnudge-data/workbench.json','contents/README.md',
    'contents/../CoordinatorLandingpage','https://api.github.com/repos/reallakshman19/CoordinatorLandingpage/contents/x'])
    assert.throws(()=>assertScratchApi(S,bad,{method:'PUT',body:JSON.stringify(body)}));
  assert.throws(()=>assertScratchApi(S,good,{method:'PUT',body:JSON.stringify({...body,branch:'not-main'})}),/SCRATCH_MAIN_WRITE_REQUIRED/);
});
test('only issue comments and issue-close are permitted',()=>{
  assert.match(assertScratchApi(S,'issues/42/comments',{method:'POST',body:'{"body":"test"}'}),/issues\/42\/comments$/);
  assert.throws(()=>assertScratchApi(S,'repos/production/issues/1/comments',{method:'POST'}),/SCRATCH_POST_REJECTED/);
  assert.throws(()=>assertScratchApi(S,'issues',{method:'POST'}),/SCRATCH_POST_REJECTED/);
  assert.match(assertScratchApi(S,'issues/42',{method:'PATCH',body:'{"state":"closed"}'}),/issues\/42$/);
  assert.throws(()=>assertScratchApi(S,'issues/42',{method:'PATCH',body:'{"state":"open"}'}),/SCRATCH_CLOSE_ONLY/);
});
test('read paths restricted to scratch main data; no encoded escape',()=>{
  assert.match(assertScratchApi(S,'contents/site/nextnudge-data/projects?ref=main'),/projects\?ref=main$/);
  assert.throws(()=>assertScratchApi(S,'contents/site/nextnudge-data/projects?ref=production'),/SCRATCH_MAIN_DATA_READ_ONLY/);
  assert.throws(()=>assertScratchApi(S,'issues/%2e%2e/comments'),/SCRATCH_API_PATH_REJECTED/);
});
