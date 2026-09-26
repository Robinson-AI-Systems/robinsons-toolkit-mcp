import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
import {cpuUsage} from '../src/core/system-metrics.js';
test('memory and CPU capabilities return actual host measurements without credentials',async()=>{
 const core=await createToolkit({credentials:new EnvironmentCredentials({})});
 const {memory}=await core.execute('local_get_memory_usage');
 assert.ok(memory.totalBytes>0);assert.ok(memory.freeBytes>=0);
 assert.equal(memory.usedBytes+memory.freeBytes,memory.totalBytes);
 const {cpu}=await core.execute('local_get_cpu_usage',{sample_ms:100});
 assert.ok(cpu.logicalCpuCount>0);assert.ok(cpu.sampleMs>=90);
 assert.ok(cpu.busyPercent>=0&&cpu.busyPercent<=100);
 assert.ok(Math.abs(cpu.busyPercent+cpu.idlePercent-100)<1e-9);
});
test('CPU sampling rejects invalid durations before waiting',async()=>{
 for(const value of [0,99,2001,1.5,'100',NaN])await assert.rejects(cpuUsage(value),{code:'INVALID_ARGUMENTS'});
});
test('CLI memory read works without PATH or optional credentials',()=>{
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/rt.js',import.meta.url)),'exec','local_get_memory_usage','--json','{}'],{env:{},encoding:'utf8',timeout:10000});
 assert.equal(r.status,0,r.stderr);assert.ok(JSON.parse(r.stdout).result.memory.totalBytes>0);
});
