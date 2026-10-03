# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import datetime, timezone
import json

EXPECTED='[EXPECTED]';EXTERNAL='[EXTERNAL]'
BRADBURY_TX='https://explorer-bradbury.genlayer.com/tx/'
OPEN='OPEN';CLOSED='CLOSED';PENDING='PENDING';APPROVED='APPROVED';REJECTED='REJECTED';CLAIMED='CLAIMED';EXPIRED='EXPIRED'
RESERVED='RESERVED';CONSUMED='CONSUMED';RELEASED='RELEASED'
RUBRIC_VERSION='VERDICTPROOF_V2_6_STEWARD_REMEDIATION';VALIDATION_METHOD='INDEPENDENT_FULL_ARTIFACT_COMPARATIVE'
MIN_POOL=10**17;MAX_POOL=10**18;MAX_ARTIFACT=4096
REVIEW_TIMEOUT=86400
CONSENSUS_CHECKS='PROVENANCE_EXACT|FULL_SHA256_EXACT|ALL_CHUNKS_REVIEWED|ALL_OBLIGATIONS_EXACT|RECEIPT_FACTS_EXACT|THRESHOLD_SIDE_EXACT|SCORE_DELTA_12_8_5_4_3'
INJECTION=('ignore previous','ignore all previous','disregard previous','system override','<system','</system','you are now','new instructions','force output','act as')


def _now():return int(datetime.now(timezone.utc).timestamp())


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


def _hex(raw,length):
	return isinstance(raw,str)and len(raw)==length and all(ch in '0123456789abcdefABCDEF'for ch in raw)


def _address(raw,label):
	value=_exact(raw,label,42).lower()
	if not value.startswith('0x')or not _hex(value[2:],40):raise gl.vm.UserError(f'{EXPECTED} {label} must be a 20-byte hex address')
	return value


def _commit(raw):
	value=_exact(raw,'commit_sha',40).lower()
	if not _hex(value,40):raise gl.vm.UserError(f'{EXPECTED} commit_sha must be a full 40-character commit')
	return value


def _sha256(raw):
	value=_exact(raw,'hex or method',64).lower()
	if not _hex(value,64):raise gl.vm.UserError(f'{EXPECTED} artifact_sha256 must be 64 hex characters')
	return value


def _tx_hash(url):
	if not isinstance(url,str)or not url.startswith(BRADBURY_TX):return''
	value=url[len(BRADBURY_TX):].split('?',1)[0].split('#',1)[0].lower();return value if value.startswith('0x')and _hex(value[2:],64)else''


def _payable(declared,label):
	if int(gl.message.value)!=declared:raise gl.vm.UserError(f'{EXPECTED} {label} value mismatch')


def _manifest(artifact):return{key:artifact[key]for key in MANIFEST_FIELDS}

MANIFEST_FIELDS=('canonical_origin', 'repository_id', 'repository_node_id', 'owner_id', 'owner', 'repository', 'commit_sha', 'path', 'content_type', 'byte_length', 'blob_sha', 'sha256', 'total_chunks', 'chunk_digests')

class VerdictProof(gl.Contract):
	owner: Address
	provenance: Address
	receipt: Address
	reviewer: Address
	next_campaign_id: u256
	next_submission_id: u256
	campaigns: TreeMap[u256, str]
	submissions: TreeMap[u256, str]
	consumed_transaction_hashes: TreeMap[str, u256]
	consumed_artifact_keys: TreeMap[str, u256]
	campaign_submissions: TreeMap[u256, DynArray[u256]]
	tester_submissions: TreeMap[str, DynArray[u256]]

	def __init__(self, provenance: str, receipt: str, reviewer: str):
		self.owner = gl.message.sender_address
		self.provenance = Address(_address(provenance, 'provenance'))
		self.receipt = Address(_address(receipt, 'receipt'))
		self.reviewer = Address(_address(reviewer, 'reviewer'))
		for address, name in ((self.provenance, 'provenance'), (self.receipt, 'receipt'), (self.reviewer, 'review')):
			info = gl.get_contract_at(address).view().module_info()
			if info != {'module': name, 'rubric_version': RUBRIC_VERSION}:
				raise gl.vm.UserError(f'{EXPECTED} incompatible helper contract')
		self.next_campaign_id = u256(1)
		self.next_submission_id = u256(1)

	def _campaign(self, cid):
		if cid not in self.campaigns: raise gl.vm.UserError(f'{EXPECTED} campaign not found')
		return json.loads(self.campaigns[cid])

	def _submission(self, sid):
		if sid not in self.submissions: raise gl.vm.UserError(f'{EXPECTED} submission not found')
		return json.loads(self.submissions[sid])

	def _save(self, campaign, submission=None):
		self.campaigns[u256(campaign['campaign_id'])] = _compact(campaign)
		if submission is not None:
			self.submissions[u256(submission['submission_id'])] = _compact(submission)

	@gl.public.write.payable
	def create_campaign(self, title: str, product_url: str, task_instruction: str, proof_requirement: str, pool_amount_atto: u256, reward_per_approved_atto: u256, stake_required_atto: u256, minimum_score: u256, policy_json: str) -> u256:
		now = _now()
		title = _guard(title, 'title', 120)
		product_url = _exact(product_url, 'product_url', 500)
		task_instruction = _guard(task_instruction, 'task_instruction', 2400)
		proof_requirement = _guard(proof_requirement, 'proof_requirement', 2400)
		if not product_url.startswith(('https://', 'http://')): raise gl.vm.UserError(f'{EXPECTED} product_url must be http(s)')
		pool, reward, stake, threshold = int(pool_amount_atto), int(reward_per_approved_atto), int(stake_required_atto), int(minimum_score)
		_payable(pool, 'campaign pool')
		if not MIN_POOL <= pool <= MAX_POOL: raise gl.vm.UserError(f'{EXPECTED} reward pool must be between 0.1 and 1 GEN')
		if not 0 < reward <= pool: raise gl.vm.UserError(f'{EXPECTED} invalid reward amount')
		if stake <= 0: raise gl.vm.UserError(f'{EXPECTED} stake must be positive')
		if not 1 <= threshold <= 100: raise gl.vm.UserError(f'{EXPECTED} minimum_score must be 1..100')
		helper = gl.get_contract_at(self.provenance).view()
		policy = helper.parse_policy(policy_json, u256(now))
		repository = helper.repository(policy)
		cid = self.next_campaign_id
		campaign = dict(campaign_id=int(cid), owner=gl.message.sender_address.as_hex, title=title, product_url=product_url,
			task_instruction=task_instruction, proof_requirement=proof_requirement, reward_pool=str(pool), reward_per_approved=str(reward),
			stake_required=str(stake), minimum_score=threshold, status=OPEN, submission_count=0, approved_count=0, rejected_count=0,
			expired_count=0, reserved_reward_pool='0', revision=1, submission_deadline=policy['submission_deadline'],
			review_timeout_seconds=REVIEW_TIMEOUT, policy=policy, repository_identity=repository, close_settlement=None)
		self._save(campaign)
		self.next_campaign_id = u256(int(cid) + 1)
		return cid

	@gl.public.write
	def revise_campaign(self, campaign_id: u256, task_instruction: str, proof_requirement: str, policy_json: str) -> dict:
		c = self._campaign(campaign_id)
		if c['owner'].lower() != gl.message.sender_address.as_hex.lower(): raise gl.vm.UserError(f'{EXPECTED} only campaign owner can revise')
		if c['status'] != OPEN or c['submission_count'] != 0: raise gl.vm.UserError(f'{EXPECTED} campaign policy is immutable after first submission')
		helper = gl.get_contract_at(self.provenance).view()
		policy = helper.parse_policy(policy_json, u256(_now()))
		repository = helper.repository(policy)
		c.update(task_instruction=_guard(task_instruction, 'task_instruction', 2400), proof_requirement=_guard(proof_requirement, 'proof_requirement', 2400),
			revision=c['revision'] + 1, submission_deadline=policy['submission_deadline'], policy=policy, repository_identity=repository)
		self._save(c)
		return self.get_campaign(campaign_id)

	@gl.public.write.payable
	def submit_proof(self, campaign_id: u256, stake_amount_atto: u256, transaction_url: str, commit_sha: str, artifact_sha256: str, artifact_byte_length: u256, feedback_text: str) -> u256:
		c = self._campaign(campaign_id)
		now, stake = _now(), int(stake_amount_atto)
		if c['status'] != OPEN: raise gl.vm.UserError(f'{EXPECTED} campaign is not open')
		if now > c['submission_deadline']: raise gl.vm.UserError(f'{EXPECTED} campaign submission deadline has passed')
		_payable(stake, 'tester stake')
		if stake != int(c['stake_required']): raise gl.vm.UserError(f'{EXPECTED} exact tester stake required')
		reserved = int(c['reward_per_approved'])
		if int(c['reward_pool']) < reserved: raise gl.vm.UserError(f'{EXPECTED} campaign has no unreserved reward capacity')
		transaction_url = _exact(transaction_url, 'transaction_url', 500)
		tx_hash = _tx_hash(transaction_url)
		if not tx_hash: raise gl.vm.UserError(f'{EXPECTED} transaction_url must be a Bradbury explorer transaction')
		if tx_hash in self.consumed_transaction_hashes: raise gl.vm.UserError(f'{EXPECTED} transaction evidence has already been consumed')
		commit_sha, artifact_sha256 = _commit(commit_sha), _sha256(artifact_sha256)
		length = int(artifact_byte_length)
		feedback = _guard(feedback_text, 'feedback_text', 2400)
		if not 1 <= length <= MAX_ARTIFACT: raise gl.vm.UserError(f'{EXPECTED} artifact_byte_length must be 1..4096')
		artifact = gl.get_contract_at(self.provenance).view().artifact(c['repository_identity'], c['policy']['artifact'], commit_sha)
		if artifact['sha256'] != artifact_sha256 or artifact['byte_length'] != length: raise gl.vm.UserError(f'{EXPECTED} declared artifact digest or byte length mismatch')
		key = artifact['artifact_key']
		if key in self.consumed_artifact_keys: raise gl.vm.UserError(f'{EXPECTED} artifact evidence has already been consumed')
		sid = self.next_submission_id
		base = dict(submission_id=int(sid), campaign_id=int(campaign_id), campaign_revision=c['revision'], tester=gl.message.sender_address.as_hex,
            transaction_url=transaction_url, feedback_text=feedback, stake_amount=str(stake), submitted_at=now,
            review_deadline=now+c['review_timeout_seconds'], commit_sha=commit_sha, artifact_key=key,
            artifact_sha256=artifact_sha256, artifact_byte_length=length, reserved_reward_amount=str(reserved), evidence_transaction_hash=tx_hash)
		s = gl.get_contract_at(self.reviewer).view().pending(base, artifact)
		c['submission_count'] += 1
		c['reward_pool'] = str(int(c['reward_pool']) - reserved)
		c['reserved_reward_pool'] = str(int(c['reserved_reward_pool']) + reserved)
		self._save(c, s)
		self.consumed_transaction_hashes[tx_hash] = sid
		self.consumed_artifact_keys[key] = sid
		self.campaign_submissions.get_or_insert_default(campaign_id).append(sid)
		self.tester_submissions.get_or_insert_default(s['tester'].lower()).append(sid)
		self.next_submission_id = u256(int(sid) + 1)
		return sid

	@gl.public.write
	def evaluate_submission(self, submission_id: u256) -> dict:
		s = self._submission(submission_id)
		if s['status'] != PENDING: raise gl.vm.UserError(f'{EXPECTED} submission is not pending')
		if _now() > s['review_deadline']: raise gl.vm.UserError(f'{EXPECTED} review deadline passed; expire submission')
		c = self._campaign(u256(s['campaign_id']))
		receipt = gl.get_contract_at(self.receipt).view().verify(s['transaction_url'], s['tester'], c['policy'])
		artifact = gl.get_contract_at(self.provenance).view().artifact(c['repository_identity'], c['policy']['artifact'], s['commit_sha'])
		if _manifest(artifact) != s['provenance_manifest']: raise gl.vm.UserError(f'{EXTERNAL} immutable artifact no longer matches accepted provenance')
		review = gl.get_contract_at(self.reviewer).view().evaluate(c['task_instruction'], c['proof_requirement'], s['feedback_text'],
			c['policy']['obligations'], artifact, receipt['receipt_checks'], u256(c['minimum_score']))
		reserved = int(s['reserved_reward_amount'])
		if s['reservation_status'] != RESERVED or reserved != int(c['reward_per_approved']) or int(c['reserved_reward_pool']) < reserved:
			raise gl.vm.UserError(f'{EXPECTED} reward reservation invariant failed')
		c['reserved_reward_pool'] = str(int(c['reserved_reward_pool']) - reserved)
		if review['approved']:
			s.update(status=APPROVED, approved=True, reward_amount=str(reserved), reservation_status=CONSUMED,
				settlement_explanation='Reservation consumed; exact stake plus reward is claimable.',
				settlement_record={'status':'CLAIMABLE','kind':'CLAIM','recipient':s['tester'],'amount_atto':str(int(s['stake_amount'])+reserved),'released':False})
			c['approved_count'] += 1
		else:
			s.update(status=REJECTED, approved=False, reward_amount='0', reservation_status=RELEASED,
				settlement_explanation='Reservation released; rejected stake slashed into campaign pool.',
				settlement_record={'status':'SETTLED','kind':'REJECTION_SLASH','recipient':c['owner'],'amount_atto':s['stake_amount'],'released':True})
			c['reward_pool'] = str(int(c['reward_pool']) + reserved + int(s['stake_amount']))
			c['rejected_count'] += 1
		for name in ('score','proof_score','feedback_score','insight_score','originality_score','task_completed','usage_valid',
			'reason_summary','evidence_summary','improvement_recommendation','risk_flags','proof_reason','feedback_reason','insight_reason','originality_reason','task_analysis'):
			s[name] = review[name]
		s.update(receipt_checks=receipt['receipt_checks'], obligation_assessments=review['assessments'], reviewed_chunks=review['reviewed_chunks'])
		self._save(c, s)
		return s

	@gl.public.write
	def expire_submission(self, submission_id: u256) -> dict:
		s = self._submission(submission_id)
		if s['status'] != PENDING or s['reservation_status'] != RESERVED: raise gl.vm.UserError(f'{EXPECTED} only pending reserved submissions can expire')
		if _now() <= s['review_deadline']: raise gl.vm.UserError(f'{EXPECTED} review deadline has not passed')
		c = self._campaign(u256(s['campaign_id']))
		reserved = int(s['reserved_reward_amount'])
		if int(c['reserved_reward_pool']) < reserved: raise gl.vm.UserError(f'{EXPECTED} reward reservation invariant failed')
		c['reserved_reward_pool'] = str(int(c['reserved_reward_pool'])-reserved)
		c['reward_pool'] = str(int(c['reward_pool'])+reserved)
		c['expired_count'] += 1
		s.update(status=EXPIRED, reservation_status=RELEASED, settlement_explanation='Review expired; stake refunded and reservation released. Evidence remains consumed.',
			settlement_record={'status':'SETTLED','kind':'EXPIRY_REFUND','recipient':s['tester'],'amount_atto':s['stake_amount'],'released':True})
		self._save(c, s)
		gl.get_contract_at(Address(s['tester'])).emit_transfer(value=u256(int(s['stake_amount'])))
		return s

	@gl.public.write
	def claim_reward(self, submission_id: u256) -> dict:
		s = self._submission(submission_id)
		if s['tester'].lower() != gl.message.sender_address.as_hex.lower(): raise gl.vm.UserError(f'{EXPECTED} only tester can claim')
		if s['status'] != APPROVED or s['claimed']: raise gl.vm.UserError(f'{EXPECTED} submission is not claimable')
		payout = int(s['stake_amount'])+int(s['reward_amount'])
		s.update(claimed=True, status=CLAIMED, settlement_explanation='Exact stake plus reserved reward released.',
			settlement_record={'status':'SETTLED','kind':'CLAIM','recipient':s['tester'],'amount_atto':str(payout),'released':True})
		self.submissions[submission_id] = _compact(s)
		gl.get_contract_at(Address(s['tester'])).emit_transfer(value=u256(payout))
		return {'submission_id':int(submission_id),'status':CLAIMED,'recipient':s['tester'],'paid_atto':str(payout),'kind':'CLAIM','released':True}

	@gl.public.write
	def close_campaign(self, campaign_id: u256) -> dict:
		c = self._campaign(campaign_id)
		if c['owner'].lower() != gl.message.sender_address.as_hex.lower(): raise gl.vm.UserError(f'{EXPECTED} only campaign owner can close')
		if c['status'] != OPEN: raise gl.vm.UserError(f'{EXPECTED} campaign is not open')
		if c['submission_count'] != c['approved_count']+c['rejected_count']+c['expired_count']: raise gl.vm.UserError(f'{EXPECTED} pending submissions must be settled before closing')
		if int(c['reserved_reward_pool']) != 0: raise gl.vm.UserError(f'{EXPECTED} reserved rewards must be zero before closing')
		refund = int(c['reward_pool'])
		record = {'status':'SETTLED','kind':'CAMPAIGN_CLOSE_REFUND','recipient':c['owner'],'amount_atto':str(refund),'released':True}
		c.update(reward_pool='0', status=CLOSED, close_settlement=record)
		self._save(c)
		if refund: gl.get_contract_at(Address(c['owner'])).emit_transfer(value=u256(refund))
		return {'campaign_id':int(campaign_id), **record}

	@gl.public.view
	def get_campaign(self, campaign_id: u256) -> dict:
		c = self._campaign(campaign_id)
		return {**c, 'available_reward_slots':int(c['reward_pool'])//int(c['reward_per_approved']),
			'obligations':c['policy']['obligations'], 'artifact_policy':c['policy']['artifact'], 'receipt_policy':c['policy']['receipt'], 'rubric_version':RUBRIC_VERSION}

	@gl.public.view
	def get_submission(self, submission_id: u256) -> dict: return self._submission(submission_id)

	@gl.public.view
	def get_evidence_usage(self, campaign_id: u256, transaction_url: str, commit_sha: str) -> dict:
		c = self._campaign(campaign_id)
		tx_hash = _tx_hash(transaction_url)
		commit = commit_sha.lower()
		key = f"github://{c['repository_identity']['repository_id']}/{commit}/{c['policy']['artifact']['path']}" if _hex(commit,40) else ''
		tx_sid = int(self.consumed_transaction_hashes[tx_hash]) if tx_hash in self.consumed_transaction_hashes else 0
		artifact_sid = int(self.consumed_artifact_keys[key]) if key in self.consumed_artifact_keys else 0
		return {'transaction_hash':tx_hash,'artifact_key':key,'transaction_submission_id':tx_sid,'artifact_submission_id':artifact_sid,'available':bool(tx_hash and key and not tx_sid and not artifact_sid)}

	@gl.public.view
	def list_campaigns(self, offset: u256, limit: u256) -> dict:
		total = int(self.next_campaign_id)-1
		count = int(limit) if 1 <= int(limit) <= 50 else 50
		rows = [self.get_campaign(u256(i+1)) for i in range(int(offset),min(total,int(offset)+count))]
		return {'count':len(rows),'total':total,'campaigns':rows}

	@gl.public.view
	def list_campaign_submissions(self, campaign_id: u256) -> dict:
		ids = self.campaign_submissions[campaign_id] if campaign_id in self.campaign_submissions else []
		rows = [self.get_submission(sid) for sid in ids]
		return {'count':len(rows),'submissions':rows}

	@gl.public.view
	def list_tester_submissions(self, tester: str) -> dict:
		key = tester.lower()
		ids = self.tester_submissions[key] if key in self.tester_submissions else []
		rows = [self.get_submission(sid) for sid in ids]
		return {'count':len(rows),'submissions':rows}

	@gl.public.view
	def get_stats(self) -> dict:
		available, reserved, submissions = 0, 0, 0
		for cid in range(1,int(self.next_campaign_id)):
			c = self._campaign(u256(cid))
			available += int(c['reward_pool'])
			reserved += int(c['reserved_reward_pool'])
			submissions += c['submission_count']
		return {'owner':self.owner.as_hex,'campaign_count':int(self.next_campaign_id)-1,'submission_count':submissions,
			'total_reward_pool':str(available+reserved),'total_available_reward_pool':str(available),'total_reserved_reward_pool':str(reserved),'rubric_version':RUBRIC_VERSION}

	@gl.public.view
	def get_components(self) -> dict:
		return {'provenance':self.provenance.as_hex,'receipt':self.receipt.as_hex,'reviewer':self.reviewer.as_hex,'rubric_version':RUBRIC_VERSION}
