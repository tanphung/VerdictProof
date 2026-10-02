# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import datetime, timezone
import base64, hashlib, json, typing

EXPECTED='[EXPECTED]';EXTERNAL='[EXTERNAL]';TRANSIENT='[TRANSIENT]';LLM_ERROR='[LLM_ERROR]'
BRADBURY_RPC='https://rpc-bradbury.genlayer.com';BRADBURY_TX='https://explorer-bradbury.genlayer.com/tx/'
RUBRIC_VERSION='VERDICTPROOF_V2_6_STEWARD_REMEDIATION'
MAX_CALLDATA=24000
INJECTION=('ignore previous','ignore all previous','disregard previous','system override','<system','</system','you are now','new instructions','force output','act as')



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


def _tx_hash(url):
	if not isinstance(url,str)or not url.startswith(BRADBURY_TX):return''
	value=url[len(BRADBURY_TX):].split('?',1)[0].split('#',1)[0].lower();return value if value.startswith('0x')and _hex(value[2:],64)else''


def _uleb(data,index):
	value=0;shift=0
	while True:
		if index>=len(data)or shift>252:raise ValueError('invalid uleb128')
		byte=data[index];index+=1;value|=(byte&127)<<shift
		if byte<128:return value,index
		shift+=7


def _decode_value(data,index,depth=0):
	if depth>12:raise ValueError('nesting')
	current,index=_uleb(data,index)
	if current==0:return None,index
	if current==8:return False,index
	if current==16:return True,index
	if current==24:
		if index+20>len(data):raise ValueError('address')
		return'0x'+data[index:index+20].hex(),index+20
	type_id=current&7;rest=current>>3
	if type_id==1:return rest,index
	if type_id==2:return-1-rest,index
	if type_id in(3,4):
		if index+rest>len(data):raise ValueError('value')
		raw=data[index:index+rest];return(raw if type_id==3 else raw.decode('utf-8')),index+rest
	if type_id==5:
		values=[]
		for _ in range(rest):item,index=_decode_value(data,index,depth+1);values.append(item)
		return values,index
	if type_id==6:
		values={}
		for _ in range(rest):
			size,index=_uleb(data,index)
			if index+size>len(data):raise ValueError('key')
			key=data[index:index+size].decode('utf-8');index+=size;item,index=_decode_value(data,index,depth+1);values[key]=item
		return values,index
	raise ValueError('type')


def _rlp(data,index):
	if index>=len(data):raise ValueError('rlp')
	prefix=data[index]
	if prefix<=127:return False,index,index+1,index+1
	if prefix<=183:size=prefix-128;start=index+1;return False,start,start+size,start+size
	if prefix<=191:
		n=prefix-183;start=index+1
		if start+n>len(data):raise ValueError('size')
		size=int.from_bytes(data[start:start+n],'big');payload=start+n;return False,payload,payload+size,payload+size
	if prefix<=247:size=prefix-192;start=index+1;return True,start,start+size,start+size
	n=prefix-247;start=index+1
	if start+n>len(data):raise ValueError('list')
	size=int.from_bytes(data[start:start+n],'big');payload=start+n;return True,payload,payload+size,payload+size


def _decode_call(raw):
	empty={'method':'','args':[],'kwargs':{}};text=str(raw or'')
	if text.startswith('0x'):text=text[2:]
	if not text or len(text)>MAX_CALLDATA or len(text)%2:return empty
	try:
		data=bytes.fromhex(text);is_list,start,end,total=_rlp(data,0)
		if not is_list or total!=len(data):raise ValueError('envelope')
		inner,pstart,pend,_=_rlp(data,start)
		if inner or pend>end:raise ValueError('payload')
		call,offset=_decode_value(data[pstart:pend],0)
		if offset!=pend-pstart or not isinstance(call,dict):raise ValueError('call')
		method=call.get('method','');args=call.get('args',[]);kwargs=call.get('kwargs',{})
		if not isinstance(method,str)or not isinstance(args,list)or not isinstance(kwargs,dict):raise ValueError('fields')
		return{'method':method,'args':args,'kwargs':kwargs}
	except Exception:return empty


def _fetch_tx(url):
	hash_value=_tx_hash(url)
	if not hash_value:raise gl.vm.UserError(f'{EXTERNAL} invalid Bradbury transaction URL')
	try:
		request={'jsonrpc':'2.0','method':'gen_getTransactionReceipt','params':[{'txId':hash_value}],'id':1};response=gl.nondet.web.post(BRADBURY_RPC,body=json.dumps(request).encode('utf-8'),headers={'Content-Type':'application/json'});status=int(getattr(response,'status_code',getattr(response,'status',0)))
		if 300<=status<400:raise gl.vm.UserError(f'{EXTERNAL} Bradbury RPC redirected')
		if 400<=status<500:raise gl.vm.UserError(f'{EXTERNAL} Bradbury RPC returned HTTP {status}')
		if status<200 or status>=500:raise gl.vm.UserError(f'{TRANSIENT} Bradbury RPC temporarily unavailable')
		body=response.body
		if isinstance(body,bytes):body=body.decode('utf-8')
		payload=json.loads(str(body));receipt=payload.get('result')if isinstance(payload,dict)and not payload.get('error')else None
		if not isinstance(receipt,dict):raise gl.vm.UserError(f'{EXTERNAL} Bradbury receipt was not found')
		sender=str(receipt.get('sender','')).lower();recipient=str(receipt.get('recipient','')).lower()
		if not sender.startswith('0x')or not _hex(sender[2:],40)or not recipient.startswith('0x')or not _hex(recipient[2:],40):raise gl.vm.UserError(f'{EXTERNAL} Bradbury receipt address is malformed')
		call=_decode_call(receipt.get('txCallData',''));return{'transaction_hash':hash_value,'sender':sender,'recipient':recipient,'status':int(receipt.get('status',0)),'consensus_result':int(receipt.get('result',0)),'execution_result':int(receipt.get('txExecutionResult',0)),'method':call['method'],'args':call['args'],'kwargs':call['kwargs']}
	except gl.vm.UserError:raise
	except Exception:raise gl.vm.UserError(f'{TRANSIENT} Bradbury RPC request failed')


def _selected(call,selector):
	if selector.startswith('args.'):
		index=int(selector[5:]);args=call.get('args',[]);return args[index]if isinstance(args,list)and index<len(args)else None
	kwargs=call.get('kwargs',{});return kwargs.get(selector[7:])if isinstance(kwargs,dict)else None


def _same(actual,expected,kind):
	if kind=='address':return isinstance(actual,str)and actual.lower()==str(expected).lower()
	if kind=='u256':return isinstance(actual,int)and not isinstance(actual,bool)and actual>=0 and str(actual)==str(expected)
	if kind=='bool':return isinstance(actual,bool)and actual is expected
	return isinstance(actual,str)and actual==expected


def _receipt_checks(tx,tester,policy):
	receipt=policy['receipt'];checks={'finalized_success':int(tx['status'])==7 and int(tx['consensus_result'])==1 and int(tx['execution_result'])==1,'sender_match':str(tx['sender']).lower()==tester.lower(),'source_contract_match':str(tx['recipient']).lower()==receipt['source_contract'].lower(),'method_match':str(tx['method'])==receipt['method']}
	for name,kind in(('task_identifier','str'),('deal','str'),('recipient','address'),('amount_atto','u256'),('kind','str'),('released','bool')):
		entry=receipt[name];checks[f'{name}_match']=_same(_selected(tx,entry['selector']),entry['value'],kind)
	checks['all_match']=all(bool(value)for value in checks.values());return checks


class ProofReceipt(gl.Contract):
 def __init__(self):pass
 @gl.public.view
 def module_info(self)->dict:return {'module':'receipt','rubric_version':RUBRIC_VERSION}
 @gl.public.view
 def verify(self,url:str,tester:str,policy:dict)->dict:
  def run():
   tx=_fetch_tx(url)
   if int(tx['status'])!=7:raise gl.vm.UserError(f'{TRANSIENT} evidence transaction is not finalized')
   return tx
  def validate(result:gl.vm.Result):
   if not isinstance(result,gl.vm.Return):return _compare_error(result,run)
   try:return result.calldata==run()
   except Exception:return False
  tx=gl.vm.run_nondet_unsafe(run,validate)
  return {'transaction':tx,'receipt_checks':_receipt_checks(tx,tester,policy)}
