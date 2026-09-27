import test from 'node:test';
import assert from 'node:assert/strict';
import {EnvironmentCredentials} from '../src/core/credentials.js';
test('new provider secrets are redacted from nested results and later echoed errors',()=>{
 const credentials=new EnvironmentCredentials({});
 const value={connection_string:'postgres://test:fixture-pass@fixture.invalid/db',accessToken:'test-only-issued-token',metadata:{token_id:'public-token-identifier'},count:42};
 const safe=credentials.redact(value);
 assert.equal(safe.connection_string,'[REDACTED]');assert.equal(safe.accessToken,'[REDACTED]');
 assert.equal(safe.metadata.token_id,'public-token-identifier');assert.equal(safe.count,42);
 assert.equal(credentials.redact('error: '+value.connection_string),'error: [REDACTED]');
 assert.equal(credentials.redact(encodeURIComponent(value.accessToken)),'[REDACTED]');
 assert.equal(value.accessToken,'test-only-issued-token');
});
test('environment setter inputs protect newly supplied secrets without redacting ordinary values',()=>{
 const credentials=new EnvironmentCredentials({});
 credentials.rememberSecrets({key:'STRIPE_SECRET_KEY',value:'test-only-new-secret'});
 assert.equal(credentials.redact('test-only-new-secret failed'),'[REDACTED] failed');
 assert.equal(credentials.redact({key:'STRIPE_SECRET_KEY',value:'test-only-new-secret'}).value,'[REDACTED]');
 assert.deepEqual(credentials.redact({key:'port',value:5432}),{key:'port',value:5432});
});

test('credential-bearing URLs and bearer headers are redacted without prior secret registration',()=>{
 const credentials=new EnvironmentCredentials({});
 assert.equal(credentials.redact('fatal: https://fixture:test-only-remote-password@example.invalid/repo'), 'fatal: https://[REDACTED]@example.invalid/repo');
 assert.equal(credentials.redact('https://test-only-token@example.invalid/repo?access_token=test-only-query'), 'https://[REDACTED]@example.invalid/repo?access_token=[REDACTED]');
 assert.equal(credentials.redact('Authorization: Bearer test-only-issued-token'),'Authorization: Bearer [REDACTED]');
 assert.equal(credentials.redact('https://example.invalid/repo?page=2'),'https://example.invalid/repo?page=2');
});
