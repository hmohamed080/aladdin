import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {client,contract,inventory,compare,apply,assertAtomic} from './migration-permission-gate.mjs';
const container=process.env.PERMISSION_TEST_CONTAINER;
test('transaction boundaries cannot bypass gate',()=>{
 for(const s of ['COMMIT;','/* nested /* comment */ */ END;','START TRANSACTION;','\\i other.sql','PREPARE TRANSACTION \'x\';'])assert.throws(()=>assertAtomic(s));
 assert.doesNotThrow(()=>assertAtomic("DO $x$ BEGIN RAISE NOTICE 'COMMIT'; END $x$; -- COMMIT\n select 'begin';"));
});
test('exact signatures and actionable privilege errors',()=>{
 const c=contract();const wrong=structuredClone(c);wrong[0].effective.anon=!wrong[0].effective.anon;
 assert.match(compare(wrong,c).join('\n'),/incorrect effective/);
 assert.match(compare(c.slice(1),c).join('\n'),/missing or renamed/);
 const unknown=structuredClone(c[0]);unknown.signature='public.unreviewed_acceptance_function()';
 assert.match(compare([...c,unknown],c).join('\n'),/unreviewed.*signature|unreviewed signature/);
});
test('narrow default correction preserves managed/global defaults',{skip:!container},()=>{
 const execute=client(container);
 const result=execute(`BEGIN; CREATE TEMP TABLE permission_defaults_before AS SELECT * FROM pg_default_acl;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon,authenticated,service_role;
 SELECT NOT EXISTS((SELECT * FROM pg_default_acl EXCEPT SELECT * FROM permission_defaults_before) UNION ALL (SELECT * FROM permission_defaults_before EXCEPT SELECT * FROM pg_default_acl)); ROLLBACK;`);
 assert.equal(result,'t');
});
test('actual PostgreSQL atomic permission matrix',{skip:!container},async()=>{
 const execute=client(container);const base=contract();
 assert.deepEqual(compare(JSON.parse(execute('BEGIN READ ONLY;'+inventory+'ROLLBACK;')),base),[]);
 const read=()=>JSON.parse(execute('BEGIN READ ONLY;'+inventory+'ROLLBACK;'));
 const delimiter=structuredClone(base);delimiter[0].signature+='$permission_gate$';
 assert.throws(()=>apply('',delimiter,execute),/missing\/renamed|unreviewed signature/);
 const create=(name,args='')=>`create function public.${name}(${args}) returns integer language sql security definer set search_path='' as 'select 1';`;
 const restrict=name=>`revoke execute on function public.${name}() from PUBLIC,anon,authenticated,service_role;`;
 const fixture=(name,role,args='')=>{const f=structuredClone(base.find(f=>f.signature==='public.media_storage_attest(text,text,uuid,text,bigint,text,text)'));f.signature=`public.${name}(${args})`;f.grants=[{role:'postgres',grantable:false},{role,grantable:false}].sort((a,b)=>a.role.localeCompare(b.role));for(const r of Object.keys(f.effective))f.effective[r]=r===role;return f;};
 // Pending bad DDL is never committed; the gate executes in the same transaction.
 for(const [name,sql] of [
  ['permission_implicit',create('permission_implicit')],
  ['permission_explicit',create('permission_explicit')+restrict('permission_explicit')+'grant execute on function public.permission_explicit() to anon;']
 ]){assert.throws(()=>apply(sql,[...base,fixture(name,'authenticated')],execute),/incorrect grants|incorrect effective/);assert.equal(read().some(f=>f.signature.includes(name)),false);}
 for(const role of ['anon','authenticated','service_role']){
  const name='permission_'+role;const f=fixture(name,role),expected=[...base,f];
  apply(create(name)+restrict(name)+`grant execute on function public.${name}() to ${role};`,expected,execute);
  assert.equal(read().find(x=>x.signature===f.signature).effective[role],true);
  // CREATE OR REPLACE retains exact grants; an added grant must fail and roll back.
  apply(`create or replace function public.${name}() returns integer language sql security definer set search_path='' as 'select 2';`,expected,execute);
  assert.throws(()=>apply(`grant execute on function public.${name}() to PUBLIC;`,expected,execute),/incorrect/);
  assert.throws(()=>apply(`alter function public.${name}() rename to permission_renamed;`,expected,execute),/signature|missing/);
  assert.throws(()=>apply(create(name,'integer'),expected,execute),/unreviewed signature/);
  assert.throws(()=>apply(`revoke execute on function public.${name}() from ${role}; select 1/0;`,expected,execute),/division by zero/);
  assert.equal(read().find(x=>x.signature===f.signature).effective[role],true);
  apply(`drop function public.${name}();`,base,execute);
 }
 // Unknown functions denied even if every API role is restricted.
 assert.throws(()=>apply(create('permission_unknown')+restrict('permission_unknown'),base,execute),/unreviewed signature/);
 assert.throws(()=>apply('revoke usage on schema app from authenticated;',base,execute),/incorrect schemaUsage/);
 // Inherited group execution is checked with PostgreSQL, not ACL text alone.
 assert.throws(()=>apply('grant authenticated to anon;',base,execute),/incorrect effective/);
 const overloads=[fixture('permission_overload','authenticated','integer'),fixture('permission_overload','service_role','text')];
 const sql=create('permission_overload','integer')+create('permission_overload','text')+
 'revoke execute on function public.permission_overload(integer),public.permission_overload(text) from PUBLIC,anon,authenticated,service_role;'+
 'grant execute on function public.permission_overload(integer) to authenticated;grant execute on function public.permission_overload(text) to service_role;';
 apply(sql,[...base,...overloads],execute);
 const renamed=structuredClone(overloads[0]);renamed.signature='public.permission_renamed(integer)';
 apply('alter function public.permission_overload(integer) rename to permission_renamed;',[...base,renamed,overloads[1]],execute);
 apply('drop function public.permission_renamed(integer),public.permission_overload(text);',base,execute);
 // Two independent sessions: uncommitted CREATE is absent to the observer.
 const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']);
 const complete=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Observer transaction failed')));});
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',data=>{if(data.toString().includes('observer-ready'))resolve();});child.on('error',reject);child.on('close',()=>reject(Error('Observer readiness missing')));});
 child.stdin.end('BEGIN;'+create('permission_visibility')+"select 'observer-ready'; select pg_sleep(3); ROLLBACK;");
 await ready;assert.equal(read().some(f=>f.signature.includes('permission_visibility')),false);await complete;
 assert.equal(read().some(f=>f.signature.includes('permission_visibility')),false);
 assert.deepEqual(compare(read(),base),[]);
});
