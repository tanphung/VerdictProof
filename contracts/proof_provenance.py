# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import datetime, timezone
import base64, hashlib, json, typing

EXPECTED='[EXPECTED]';EXTERNAL='[EXTERNAL]';TRANSIENT='[TRANSIENT]';LLM_ERROR='[LLM_ERROR]'
GITHUB_API='https://api.github.com/repos/'
RUBRIC_VERSION='VERDICTPROOF_V2_6_STEWARD_REMEDIATION'
POLICY_SCHEMA='VERDICTPROOF_POLICY_V1'
MAX_POLICY=12000;MAX_ARTIFACT=4096;MAX_CHUNK=1024
MIN_DEADLINE=86400;MAX_DEADLINE=30*86400
INJECTION=('ignore previous','ignore all previous','disregard previous','system override','<system','</system','you are now','new instructions','force output','act as')


MANIFEST_FIELDS=('canonical_origin', 'repository_id', 'repository_node_id', 'owner_id', 'owner', 'repository', 'commit_sha', 'path', 'content_type', 'byte_length', 'blob_sha', 'sha256', 'total_chunks', 'chunk_digests')

def _clean(raw,limit):
	if not isinstance(raw,str):raw=str(raw)
	return ''.join(ch for ch in raw if ch in('\n','\t')or ord(ch)>=32).strip()[:limit]


def _exact(raw,label,limit):
	if not isinstance(raw,str)or len(raw)>limit or any(ord(ch)<32 for ch in raw):raise gl.vm.UserError(f'{EXPECTED} {label} has invalid length or characters')
	return raw.strip()


def _guard(raw,label,limit):
	if not isinstance(raw,str)or len(raw)>limit:raise gl.vm.UserError(f'{EXPECTED} {label} exceeds its length limit')
	value=_clean(raw,limit)
	if not value:raise gl.vm.UserError(f'{EXPECTED} {label} cannot be empty')
	low=value.lower()
	for token in INJECTION:
		if token in low:raise gl.vm.UserError(f'{EXPECTED} {label} contains unsafe instruction text')
	return value


def _compact(value):return json.dumps(value,sort_keys=True,separators=(',',':'))


def _keys(value,keys,label):
	if not isinstance(value,dict)or set(value.keys())!=set(keys):raise gl.vm.UserError(f'{EXPECTED} {label} has invalid fields')
	return value


def _hex(raw,length):
	return isinstance(raw,str)and len(raw)==length and all(ch in '0123456789abcdefABCDEF'for ch in raw)


def _error_message(result):return str(getattr(result,'message',''))


def _compare_error(leader_result,rerun):
	leader=_error_message(leader_result)
	if leader.startswith(LLM_ERROR):return False
	try:rerun();return False
	except gl.vm.UserError as error:
		validator=str(getattr(error,'message',str(error)))
		if leader.startswith(TRANSIENT)and validator.startswith(TRANSIENT):return True
		if leader.startswith(EXPECTED)or leader.startswith(EXTERNAL):return validator==leader
		return False
	except Exception:return False


def _address(raw,label):
	value=_exact(raw,label,42).lower()
	if not value.startswith('0x')or not _hex(value[2:],40):raise gl.vm.UserError(f'{EXPECTED} {label} must be a 20-byte hex address')
	return value


def _method(raw):
	value=_exact(raw,'hex or method',64)
	if not value or not(value[0].isalpha()or value[0]=='_')or any(not(ch.isalnum()or ch=='_')for ch in value):raise gl.vm.UserError(f'{EXPECTED} method is invalid')
	return value


def _slug(raw,label):
	value=_exact(raw,label,100)
	if not value or any(not(ch.isalnum()or ch in'._-')for ch in value):raise gl.vm.UserError(f'{EXPECTED} {label} is invalid')
	return value


def _artifact_path(raw,content_type):
	value=_exact(raw,'artifact path',300).strip('/')
	if not value or'//'in value or any(part in('','.','..')for part in value.split('/'))or any(not(ch.isalnum()or ch in'._-/')for ch in value):raise gl.vm.UserError(f'{EXPECTED} artifact path is invalid')
	extension='.'+value.rsplit('.',1)[-1].lower()if'.'in value else'';allowed={'.md':'text/markdown','.txt':'text/plain','.json':'application/json'}
	if extension not in allowed or allowed[extension]!=content_type:raise gl.vm.UserError(f'{EXPECTED} artifact content type does not match extension')
	return value


def _selector(raw):
	value=_exact(raw,'receipt selector',80)
	if value.startswith('args.')and value[5:].isdigit()and len(value[5:])<=3:return value
	if value.startswith('kwargs.'):
		key=value[7:]
		if key and(key[0].isalpha()or key[0]=='_')and all(ch.isalnum()or ch=='_'for ch in key):return value
	raise gl.vm.UserError(f'{EXPECTED} receipt selector is invalid')


def _receipt_entry(raw,label,kind):
	entry=_keys(raw,('selector','value'),f'receipt.{label}');value=entry['value']
	if kind=='address':value=_address(value,f'receipt.{label}.value')
	elif kind=='u256':
		value=_exact(value,f'receipt.{label}.value',80)
		if not value.isdigit():raise gl.vm.UserError(f'{EXPECTED} receipt.{label}.value must be atto integer')
		value=str(int(value))
	elif kind=='bool':
		if not isinstance(value,bool):raise gl.vm.UserError(f'{EXPECTED} receipt.{label}.value must be boolean')
	else:value=_guard(str(value),f'receipt.{label}.value',160)
	return{'selector':_selector(entry['selector']),'value':value}


def _parse_policy(raw,now):
	if not isinstance(raw,str)or not raw or len(raw)>MAX_POLICY:raise gl.vm.UserError(f'{EXPECTED} policy_json is invalid')
	try:value=json.loads(raw)
	except Exception:raise gl.vm.UserError(f'{EXPECTED} policy_json must be valid JSON')
	policy=_keys(value,('schema','submission_deadline','obligations','artifact','receipt'),'policy')
	if policy['schema']!=POLICY_SCHEMA:raise gl.vm.UserError(f'{EXPECTED} unsupported policy schema')
	deadline=policy['submission_deadline']
	if not isinstance(deadline,int)or isinstance(deadline,bool)or deadline<now+MIN_DEADLINE or deadline>now+MAX_DEADLINE:raise gl.vm.UserError(f'{EXPECTED} submission_deadline must be 1..30 days from creation')
	raw_obligations=policy['obligations']
	if not isinstance(raw_obligations,list)or not 1<=len(raw_obligations)<=8:raise gl.vm.UserError(f'{EXPECTED} obligations must contain 1..8 entries')
	obligations=[];seen=set()
	for item in raw_obligations:
		item=_keys(item,('id','text'),'obligation');oid=_exact(item['id'],'obligation id',32).upper()
		if not oid or any(not(ch.isalnum()or ch in'_-')for ch in oid)or oid in seen:raise gl.vm.UserError(f'{EXPECTED} obligation ids must be valid and unique')
		seen.add(oid);obligations.append({'id':oid,'text':_guard(item['text'],'obligation text',300)})
	artifact=_keys(policy['artifact'],('provider','auth_mode','owner','repository','path','content_type'),'artifact')
	if artifact['provider']!='GITHUB'or artifact['auth_mode']!='GITHUB_API':raise gl.vm.UserError(f'{EXPECTED} only GITHUB/GITHUB_API provenance is supported')
	content_type=_clean(artifact['content_type'],40);artifact={'provider':'GITHUB','auth_mode':'GITHUB_API','owner':_slug(artifact['owner'],'artifact owner'),'repository':_slug(artifact['repository'],'artifact repository'),'path':_artifact_path(artifact['path'],content_type),'content_type':content_type}
	receipt=_keys(policy['receipt'],('source_contract','method','task_identifier','deal','recipient','amount_atto','kind','released'),'receipt')
	receipt={'source_contract':_address(receipt['source_contract'],'receipt.source_contract'),'method':_method(receipt['method']),'task_identifier':_receipt_entry(receipt['task_identifier'],'task_identifier','str'),'deal':_receipt_entry(receipt['deal'],'deal','str'),'recipient':_receipt_entry(receipt['recipient'],'recipient','address'),'amount_atto':_receipt_entry(receipt['amount_atto'],'amount_atto','u256'),'kind':_receipt_entry(receipt['kind'],'kind','str'),'released':_receipt_entry(receipt['released'],'released','bool')}
	return{'schema':POLICY_SCHEMA,'submission_deadline':deadline,'obligations':obligations,'artifact':artifact,'receipt':receipt}


def _web_json(url,label):
	try:
		response=gl.nondet.web.get(url);status=int(getattr(response,'status_code',getattr(response,'status',0)))
		body=response.body
		if isinstance(body,bytes):body=body.decode('utf-8')
		if 300<=status<400:raise gl.vm.UserError(f'{EXTERNAL} {label} redirected')
		if status in(408,429)or(status==403 and'rate limit'in str(body).lower()):raise gl.vm.UserError(f'{TRANSIENT} {label} rate limited')
		if 400<=status<500:raise gl.vm.UserError(f'{EXTERNAL} {label} returned HTTP {status}')
		if status<200 or status>=500:raise gl.vm.UserError(f'{TRANSIENT} {label} temporarily unavailable')
		value=json.loads(str(body))
		if not isinstance(value,dict):raise gl.vm.UserError(f'{EXTERNAL} {label} returned invalid JSON')
		return value
	except gl.vm.UserError:raise
	except Exception:raise gl.vm.UserError(f'{TRANSIENT} {label} request failed')


def _fetch_repository(owner,repository):
	value=_web_json(f'{GITHUB_API}{owner}/{repository}','GitHub repository API');owner_value=value.get('owner')
	if not isinstance(owner_value,dict):raise gl.vm.UserError(f'{EXTERNAL} GitHub repository owner is missing')
	login=str(owner_value.get('login',''));name=str(value.get('name',''));full_name=str(value.get('full_name',''));repo_id=str(value.get('id',''));node_id=str(value.get('node_id',''));owner_id=str(owner_value.get('id',''))
	if not repo_id or not node_id or not owner_id or login.lower()!=owner.lower()or name.lower()!=repository.lower()or full_name.lower()!=f'{owner}/{repository}'.lower():raise gl.vm.UserError(f'{EXTERNAL} GitHub repository identity mismatch')
	return{'repository_id':repo_id,'repository_node_id':node_id,'owner_id':owner_id,'owner':login,'repository':name,'full_name':full_name}


def _commit(raw):
	value=_exact(raw,'commit_sha',40).lower()
	if not _hex(value,40):raise gl.vm.UserError(f'{EXPECTED} commit_sha must be a full 40-character commit')
	return value


def _sha256(raw):
	value=_exact(raw,'hex or method',64).lower()
	if not _hex(value,64):raise gl.vm.UserError(f'{EXPECTED} artifact_sha256 must be 64 hex characters')
	return value


def _chunks(text):
	chunks=[];current='';size=0
	for char in text:
		encoded=char.encode('utf-8')
		if current and size+len(encoded)>MAX_CHUNK:chunks.append(current);current='';size=0
		current+=char;size+=len(encoded)
	if current or not chunks:chunks.append(current)
	return chunks,[hashlib.sha256(chunk.encode('utf-8')).hexdigest()for chunk in chunks]


def _fetch_artifact(repository_identity,artifact_policy,commit_sha):
	owner=str(repository_identity['owner']);repository=str(repository_identity['repository'])
	current_identity=_fetch_repository(owner,repository)
	if any(current_identity[key]!=repository_identity[key]for key in ('repository_id','repository_node_id','owner_id')):raise gl.vm.UserError(f'{EXTERNAL} GitHub repository identity changed')
	commit=_web_json(f'{GITHUB_API}{owner}/{repository}/commits/{commit_sha}','GitHub commit API')
	if str(commit.get('sha','')).lower()!=commit_sha:raise gl.vm.UserError(f'{EXTERNAL} GitHub commit identity mismatch')
	path=str(artifact_policy['path']);content=_web_json(f'{GITHUB_API}{owner}/{repository}/contents/{path}?ref={commit_sha}','GitHub contents API')
	if str(content.get('type',''))!='file'or str(content.get('path',''))!=path or str(content.get('encoding',''))!='base64':raise gl.vm.UserError(f'{EXTERNAL} GitHub artifact identity or encoding mismatch')
	blob_sha=str(content.get('sha','')).lower();encoded=content.get('content');api_size=content.get('size')
	if not _hex(blob_sha,40)or not isinstance(encoded,str)or not isinstance(api_size,int)or isinstance(api_size,bool):raise gl.vm.UserError(f'{EXTERNAL} GitHub artifact metadata is invalid')
	try:data=base64.b64decode(''.join(encoded.split()),validate=True)
	except Exception:raise gl.vm.UserError(f'{EXTERNAL} GitHub artifact base64 is invalid')
	if api_size!=len(data)or not 1<=len(data)<=MAX_ARTIFACT:raise gl.vm.UserError(f'{EXTERNAL} GitHub artifact must contain 1..4096 bytes')
	try:text=data.decode('utf-8')
	except UnicodeDecodeError:raise gl.vm.UserError(f'{EXTERNAL} GitHub artifact must be UTF-8 text')
	if artifact_policy['content_type']=='application/json':
		try:json.loads(text)
		except Exception:raise gl.vm.UserError(f'{EXTERNAL} JSON artifact is malformed')
	chunks,digests=_chunks(text)
	if ''.join(chunks).encode('utf-8')!=data:raise gl.vm.UserError(f'{EXTERNAL} artifact chunk reconstruction failed')
	origin=f"github://{repository_identity['repository_id']}/{commit_sha}/{path}"
	return{'canonical_origin':origin,'artifact_key':origin,'repository_id':str(repository_identity['repository_id']),'repository_node_id':str(repository_identity['repository_node_id']),'owner_id':str(repository_identity['owner_id']),'owner':owner,'repository':repository,'commit_sha':commit_sha,'path':path,'content_type':str(artifact_policy['content_type']),'byte_length':len(data),'blob_sha':blob_sha,'sha256':hashlib.sha256(data).hexdigest(),'total_chunks':len(chunks),'chunk_digests':digests,'chunks':chunks}


def _manifest(artifact):return{key:artifact[key]for key in MANIFEST_FIELDS}


def _artifact_equal(left,right):
	try:return isinstance(left,dict)and isinstance(right,dict)and _manifest(left)==_manifest(right)and left['chunks']==right['chunks']
	except Exception:return False


class ProofProvenance(gl.Contract):
 def __init__(self):pass
 @gl.public.view
 def module_info(self)->dict:return {'module':'provenance','rubric_version':RUBRIC_VERSION}
 @gl.public.view
 def parse_policy(self,raw:str,now:u256)->dict:return _parse_policy(raw,int(now))
 @gl.public.view
 def repository(self,policy:dict)->dict:
  artifact=policy['artifact']
  def run():return _fetch_repository(artifact['owner'],artifact['repository'])
  def validate(result:gl.vm.Result):
   if not isinstance(result,gl.vm.Return):return _compare_error(result,run)
   try:return result.calldata==run()
   except Exception:return False
  return gl.vm.run_nondet_unsafe(run,validate)
 @gl.public.view
 def artifact(self,repository:dict,policy:dict,commit:str)->dict:
  commit=_commit(commit)
  def run():return _fetch_artifact(repository,policy,commit)
  def validate(result:gl.vm.Result):
   if not isinstance(result,gl.vm.Return):return _compare_error(result,run)
   try:return _artifact_equal(result.calldata,run())
   except Exception:return False
  return gl.vm.run_nondet_unsafe(run,validate)
