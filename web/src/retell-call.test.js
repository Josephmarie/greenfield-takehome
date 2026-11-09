import test from 'node:test';
import assert from 'node:assert/strict';
import { startRetellCall, spokenTranscript } from './retell-call.js';

test('creates a v3 session with the configured key and agent, transcript and lifecycle hooks', () => {
  const events=[]; let params; let usedKey;
  class FakeClient { constructor({key}) { usedKey=key; } createWebCall(options) { params=options; return {end(){events.push('end')}}; } }
  const session=startRetellCall({RetellClient:FakeClient, publicKey:'public_test', agentId:'agent_test', onStatus:s=>events.push(s), onEnd:()=>events.push('ended'), onError:e=>events.push(e.message), onTranscript:t=>events.push(t)});
  assert.equal(usedKey,'public_test'); assert.equal(params.agent_id,'agent_test'); assert.equal(params.transcript,true);
  params.hooks.onStatus('live'); params.hooks.onTranscript([{role:'agent',content:'Hello'}]); params.hooks.onEnd(); session.end();
  assert.deepEqual(events,['live',[{who:'agent',text:'Hello'}],'ended','end']);
});
test('only spoken transcript turns are shown',()=>assert.deepEqual(spokenTranscript([{role:'user',content:'Hi'},{role:'tool_call_invocation',content:'secret'},{role:'agent',content:'Hello'},{role:'node_transition'}]),[{who:'user',text:'Hi'},{who:'agent',text:'Hello'}]));
test('fails clearly without public configuration',()=>assert.throws(()=>startRetellCall({RetellClient:class{},publicKey:'',agentId:''}),/not configured/i));
