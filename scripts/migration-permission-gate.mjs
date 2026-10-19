import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const baselineVersion='20261015090053';
export const inventory=fs.readFileSync(path.join(root,'scripts/function-permissions.sql'),'utf8');
export const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export function verifyBaseline(){
 const frozen=JSON.parse(fs.readFileSync(path.join(root,'supabase/permissions/baseline.json'),'utf8'));
 if(frozen.length!==163)throw Error('Reviewed RC2 baseline must contain163 migrations');
 for(const item of frozen){if(!/^\d{14}_[a-z0-9_]+\.sql$/.test(item.file)||crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/migrations',item.file))).digest('hex')!==item.sha256)throw Error(`Historical migration changed: ${item.file}; append a new migration instead`);}
}

// Tokenize SQL boundaries, not SQL bodies. Database inspection is the authority.
export function assertAtomic(sql){
 let i=0,plain='';
 while(i<sql.length){
  if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i);i=end<0?sql.length:end;continue;}
  if(sql.startsWith('/*',i)){let depth=1;i+=2;while(depth&&i<sql.length){if(sql.startsWith('/*',i)){depth++;i+=2;}else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}if(depth)throw Error('Unterminated SQL comment');continue;}
  const dollar=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
  if(dollar){const end=sql.indexOf(dollar[0],i+dollar[0].length);if(end<0)throw Error('Unterminated dollar body');i=end+dollar[0].length;plain+=' body ';continue;}
  if(sql[i]==="'"||sql[i]==='"'){const escaped=sql[i]==="'"&&/[eE]/.test(sql[i-1]??'')&&!/[A-Za-z_0-9]/.test(sql[i-2]??'');const quote=sql[i++];let ended=false;while(i<sql.length){if(sql[i]===quote){i++;if(sql[i]===quote){i++;continue;}ended=true;break;}if(escaped&&sql[i]==='\\'){i+=2;}else i++;}if(!ended)throw Error('Unterminated SQL string');plain+=' quoted ';continue;}
  plain+=sql[i++];
 }
 if(/\\/.test(plain)||/\b(begin|commit|rollback|abort|end|standard_conforming_strings|start\s+transaction|prepare\s+transaction)\b/i.test(plain))throw Error('Migration must contain no transaction control, string-parser settings or psql commands; the permission runner owns BEGIN/COMMIT');
}

export function compare(actual,expected){
 const errors=[],want=new Map(expected.map(f=>[f.signature,f]));
 for(const f of actual){const e=want.get(f.signature);if(!e){errors.push(`${f.signature}: unreviewed function signature (add an exact reviewed contract, never a wildcard)`);continue;}want.delete(f.signature);
  for(const k of ['kind','owner','definer','config','grants','effective','schemaUsage'])if(stable(f[k])!==stable(e[k]))errors.push(`${f.signature}: incorrect ${k}; expected ${stable(e[k])}, actual ${stable(f[k])}`);
 }
 for(const s of want.keys())errors.push(`${s}: reviewed function missing or renamed`);
 return errors;
}

export const latestContractVersion=()=>fs.readdirSync(path.join(root,'supabase/permissions')).filter(f=>/^\d{14}\.json$/.test(f)).sort().at(-1).slice(0,14);
export function contract(version=latestContractVersion()){
 const file=path.join(root,'supabase/permissions',`${version}.json`);
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(value.version!==version||!Array.isArray(value.functions)||new Set(value.functions.map(f=>f.signature)).size!==value.functions.length)throw Error('Invalid exact permission contract');
 if(!value.publicRPCs.length||new Set(value.publicRPCs).size!==value.publicRPCs.length||value.publicRPCs.some(s=>!value.functions.some(f=>f.signature===s&&f.effective.anon)))throw Error('Public RPC allowlist does not match reviewed contract');
 for(const f of value.functions)if(f.signature.startsWith('public.')&&f.effective.anon&&!value.publicRPCs.includes(f.signature))throw Error(`Broad anonymous allowlisting prohibited: ${f.signature}`);
 return value.functions;
}

export function client(container,database='postgres'){
 if(!(/^supabase_db_aladdin_r2_rc2_(upgrade|fresh)$/.test(container)||(process.env.CI==='true'&&container==='supabase_db_aladdin'))||! /^(postgres|permission_[a-z0-9_]+)$/.test(database))throw Error('Only named RC2 local test Docker databases are supported');
 if(process.env.DOCKER_HOST&&!/^(unix:|npipe:)/.test(process.env.DOCKER_HOST))throw Error('Remote Docker host prohibited');
 const run=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout||'Docker command failed');return r.stdout.trim();};
 const host=process.env.DOCKER_HOST||run(['context','inspect','--format','{{.Endpoints.docker.Host}}']);
 if(!/^(unix:|npipe:)/.test(host))throw Error('Remote Docker context prohibited');
 const image=run(['inspect',container,'--format','{{.Config.Image}}']);
 if(!image.includes('supabase/postgres:17.'))throw Error('Unexpected database image');
 return sql=>run(['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],sql);
}

export function assertion(expected){
 const query=inventory.replace('set local search_path=pg_catalog;','').trim().replace(/;$/,'');
 const literal=JSON.stringify(expected).replaceAll("'","''");
 let tag='$permission_gate$';
 while(literal.includes(tag)||query.includes(tag))tag=tag.replace('$permission_','$permission_x');
 return `set local search_path=pg_catalog;
DO ${tag}
DECLARE
 actual jsonb;
 expected jsonb := '${literal}'::jsonb;
 f jsonb; e jsonb; k text; problems text := '';
BEGIN
 SELECT permissions INTO actual FROM (${query}) q;
 FOR f IN SELECT value FROM jsonb_array_elements(actual) LOOP
  SELECT value INTO e FROM jsonb_array_elements(expected)
   WHERE value->>'signature'=f->>'signature';
  IF e IS NULL THEN
   problems:=problems||E'\n'||(f->>'signature')||': unreviewed signature';
  ELSE
   FOREACH k IN ARRAY ARRAY['kind','owner','definer','config','grants','effective','schemaUsage'] LOOP
    IF f->k IS DISTINCT FROM e->k THEN
     problems:=problems||E'\n'||(f->>'signature')||': incorrect '||k||
      ' expected '||(e->k)::text||' actual '||(f->k)::text;
    END IF;
   END LOOP;
  END IF;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(expected) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(actual) a
   WHERE a->>'signature'=e->>'signature') THEN
   problems:=problems||E'\n'||(e->>'signature')||': missing/renamed';
  END IF;
 END LOOP;
 IF problems<>'' THEN RAISE EXCEPTION 'Permission gate failed:%',problems; END IF;
END ${tag};`;
}

export function apply(sql,expected,execute){assertAtomic(sql);return execute(`BEGIN; SET LOCAL standard_conforming_strings=on;\n${sql}\n${assertion(expected)}\nCOMMIT;`);}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  verifyBaseline();const [container,database='postgres',mode='check']=process.argv.slice(2);const execute=client(container,database);
  if(mode==='upgrade'){
   const history=JSON.parse(execute('select coalesce(json_agg(version order by version),\'[]\') from supabase_migrations.schema_migrations;'));
   const files=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
   const original=files.filter(f=>f.slice(0,14)<=baselineVersion).map(f=>f.slice(0,14));
   if(stable(history)!==stable(original))throw Error('Upgrade requires the exact163-migration RC2 baseline');
   const baseline=compare(JSON.parse(execute('BEGIN READ ONLY;'+inventory+'ROLLBACK;')),contract(baselineVersion));if(baseline.length)throw Error(baseline.join('\n'));
   let expected=contract(baselineVersion);
   for(const f of files.filter(f=>f.slice(0,14)>baselineVersion)){
    const version=f.slice(0,14);if(fs.existsSync(path.join(root,'supabase/permissions',`${version}.json`)))expected=contract(version);
    const sql=fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8');
    const name=f.slice(15,-4).replaceAll("'","''");const body=sql.replaceAll("'","''");
    apply(sql+`\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('${version}','${name}',ARRAY['${body}']);`,expected,execute);
    console.log(`PASS atomic migration ${f}`);
   }
  }else if(mode==='check'){
   const expected=contract();
   const errors=compare(JSON.parse(execute('BEGIN READ ONLY;'+inventory+'ROLLBACK;')),expected);if(errors.length)throw Error(errors.join('\n'));console.log(`PASS ${expected.length} exact function permission contracts`);
  }else throw Error('Unknown mode');
 }catch(e){console.error(e.message);process.exitCode=1;}
}
