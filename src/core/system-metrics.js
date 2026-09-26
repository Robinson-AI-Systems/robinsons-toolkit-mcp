import {cpus,freemem,totalmem} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

export function memoryUsage(){
  const totalBytes=totalmem(),freeBytes=freemem();
  if(!Number.isFinite(totalBytes)||totalBytes<=0||!Number.isFinite(freeBytes)||freeBytes<0||freeBytes>totalBytes){
    throw new Error('Operating system returned unavailable or inconsistent memory counters');
  }
  return {totalBytes,freeBytes,usedBytes:totalBytes-freeBytes,
    scope:'System memory reported by the operating system; may exceed container limits.',
    usedDefinition:'totalBytes minus freeBytes; includes memory used for caches, not just applications.'};
}

export async function cpuUsage(sampleMs=250){
  if(!Number.isInteger(sampleMs)||sampleMs<100||sampleMs>2000){
    throw Object.assign(new Error('sample_ms must be an integer from 100 to 2000'),{code:'INVALID_ARGUMENTS'});
  }
  const before=cpus();
  if(!before.length)throw new Error('CPU counters are unavailable on this host');
  const started=performance.now();
  await delay(sampleMs);
  const after=cpus();
  const elapsedMs=performance.now()-started;
  if(after.length!==before.length)throw new Error('CPU topology changed during sampling; retry the read');
  let totalDelta=0,idleDelta=0;
  for(let i=0;i<after.length;i++){
    for(const key of ['user','nice','sys','idle','irq']){
      const delta=after[i].times[key]-before[i].times[key];
      if(!Number.isFinite(delta)||delta<0)throw new Error('CPU counters changed inconsistently during sampling');
      totalDelta+=delta;
      if(key==='idle')idleDelta+=delta;
    }
  }
  if(totalDelta<=0)throw new Error('CPU counters did not advance during sampling; retry with a longer interval');
  return {busyPercent:100*(totalDelta-idleDelta)/totalDelta,idlePercent:100*idleDelta/totalDelta,
    sampleMs:elapsedMs,logicalCpuCount:after.length,
    scope:'Aggregate of OS-reported logical CPUs; not process usage or container CPU entitlement.'};
}
