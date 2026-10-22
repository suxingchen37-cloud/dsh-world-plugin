import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../lib/index.js',import.meta.url),'utf8');
const crash=source.slice(source.indexOf('function writeCrash('),source.indexOf('const readBrain ='));
const mirror=source.slice(source.indexOf('function mirrorBrainNow('),source.indexOf('// Push each bot'));
const context=vm.createContext({assert,Date,fs:{appendFileSync(file,text){context.logged.push(JSON.parse(text));}},path:{join:(...parts)=>parts.join('/')},logged:[],STATE_DIR:'test-only',brainDirty:true,brainMirroredAt:0,
  resolveVault:()=> 'test-vault',communitySnapshot:()=>({bots:[]}),planWrites:()=>[],applyPlan:()=>[]});
vm.runInContext(crash+'\n'+mirror,context);
vm.runInContext(`
applyPlan=()=>{throw new Error('mirror failed')};
assert.equal(mirrorBrainNow('test').ok,false);
assert.equal(logged.at(-1).kind,'brain-mirror');
assert.equal(logged.at(-1).message,'mirror failed');
assert.equal(brainDirty,true);
resolveVault=()=>{throw new Error('vault failed')};
assert.equal(mirrorBrainNow('test').ok,false);
assert.equal(logged.at(-1).message,'vault failed');
resolveVault=()=> 'test-vault';
applyPlan=()=>[{action:'create'},{action:'update'}];
let message='';const result=mirrorBrainNow('test',text=>{message=text});
assert.equal(result.ok,true);assert.equal(result.created,1);assert.equal(result.updated,1);
assert.equal(brainDirty,false);assert.ok(message.includes('create=1 update=1'));
assert.equal(mirrorBrainNow('test').skipped,'clean');
`,context);
console.log('PASS backup failure is logged without throwing; successful backup uses the supplied logger and clears dirty state');
