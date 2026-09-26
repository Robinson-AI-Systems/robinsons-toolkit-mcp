import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventory} from './inventory.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const report=inventory(root);
const failures=[...report.duplicateNames,...report.repeatedDispatchNames,...report.mismatches.registryWithoutHandler,
  ...report.mismatches.handlerWithoutRegistry,...report.findings.filter(f=>f.disposition.startsWith('confirmed'))];
console.log(JSON.stringify({passed:failures.length===0,failures},null,2));
process.exitCode=failures.length?1:0;
