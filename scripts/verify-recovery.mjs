import {spawnSync,execFileSync} from 'node:child_process';
import {readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventory,duplicateCandidates} from './inventory.mjs';
import {probeMcp} from './probe-mcp.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(process.argv[2]||join(root,'reports/verification/latest.json'));
const tests=spawnSync(process.execPath,['--test','--test-reporter=tap',...readdirSync(join(root,'tests')).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>join(root,'tests',n))],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
const count=label=>Number(tests.stdout.match(new RegExp('^# '+label+' (\\d+)$','m'))?.[1]||0);
const data=inventory(root),duplicates=duplicateCandidates(data),runtime=await probeMcp(root);
const checks=['scripts/generate-capabilities.mjs','scripts/generate-catalog.mjs'].map(script=>{
 const result=spawnSync(process.execPath,[script,'--check'],{cwd:root,encoding:'utf8'});return {script,passed:result.status===0};
});
const report={sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),verifiedAt:new Date().toISOString(),node:process.version,
 tests:{exitCode:tests.status,tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),timedOut:tests.error?.code==='ETIMEDOUT'},
 freshness:checks,inventory:data.counts,mismatches:data.mismatches,
 strictIntegrity:{passed:!data.findings.length&&!data.duplicateNames.length&&!data.repeatedDispatchNames.length&&!data.mismatches.registryWithoutHandler.length&&!data.mismatches.handlerWithoutRegistry.length,findings:data.findings.length,unreachableRegisteredNames:new Set(data.findings.filter(f=>f.rule==='unreachable-dispatch'&&data.entries.some(e=>e.name===f.name)).map(f=>f.name)).size},
 duplicateCandidates:duplicates.length,mcp:{...runtime,noSecretSearch:undefined,stderr:undefined},
 providerLiveTests:'not run — authorized test credentials unavailable',productionReady:false};
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(tests.status!==0||!count('tests')||count('fail')||!checks.every(c=>c.passed)||!report.strictIntegrity.passed||!['booted','localCallPassed','missingStripeIsError','largeOutputStored','resultReadPassed','transactionListPassed','invalidBrokerRejected'].every(key=>runtime[key]))process.exitCode=1;
