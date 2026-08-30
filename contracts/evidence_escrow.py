# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass


EXPECTED = "[EXPECTED]"
FUNDED = "FUNDED"
RELEASED = "RELEASED"


def _text(raw: str, label: str, limit: int = 120) -> str:
	value = str(raw).strip()
	if not value or len(value) > limit:
		raise gl.vm.UserError(f"{EXPECTED} {label} is invalid")
	if any(ord(ch) < 32 for ch in value):
		raise gl.vm.UserError(f"{EXPECTED} {label} is invalid")
	return value


def _address(raw: str) -> Address:
	value = str(raw).strip().lower()
	if len(value) != 42 or not value.startswith("0x"):
		raise gl.vm.UserError(f"{EXPECTED} recipient is invalid")
	try:
		int(value[2:], 16)
	except ValueError:
		raise gl.vm.UserError(f"{EXPECTED} recipient is invalid")
	return Address(value)


@allow_storage
@dataclass
class Deal:
	deal_id: str
	task_identifier: str
	sponsor: Address
	recipient: Address
	amount_atto: u256
	status: str


class EvidenceEscrow(gl.Contract):
	deals: TreeMap[str, Deal]

	def __init__(self):
		pass

	@gl.public.write.payable
	def fund_deal(self, task_identifier: str, deal_id: str, recipient: str, amount_atto: u256) -> dict:
		task = _text(task_identifier, "task_identifier")
		deal = _text(deal_id, "deal_id")
		to = _address(recipient)
		amount = int(amount_atto)
		if amount <= 0 or int(gl.message.value) != amount:
			raise gl.vm.UserError(f"{EXPECTED} deal funding must exactly equal amount_atto")
		if deal in self.deals:
			raise gl.vm.UserError(f"{EXPECTED} deal already exists")
		self.deals[deal] = Deal(
			deal_id=deal,
			task_identifier=task,
			sponsor=gl.message.sender_address,
			recipient=to,
			amount_atto=u256(amount),
			status=FUNDED,
		)
		return self.get_deal(deal)

	@gl.public.write
	def release(self, task_identifier: str, deal_id: str, recipient: str, amount_atto: u256, kind: str, released: bool) -> dict:
		task = _text(task_identifier, "task_identifier")
		deal_id = _text(deal_id, "deal_id")
		to = _address(recipient)
		if deal_id not in self.deals:
			raise gl.vm.UserError(f"{EXPECTED} deal does not exist")
		deal = self.deals[deal_id]
		if deal.sponsor != gl.message.sender_address:
			raise gl.vm.UserError(f"{EXPECTED} only the deal sponsor can release")
		if deal.status != FUNDED:
			raise gl.vm.UserError(f"{EXPECTED} deal is not funded")
		if task != deal.task_identifier or to != deal.recipient or int(amount_atto) != int(deal.amount_atto):
			raise gl.vm.UserError(f"{EXPECTED} release facts do not match the funded deal")
		if kind != "RELEASE" or released is not True:
			raise gl.vm.UserError(f"{EXPECTED} release kind and state are invalid")
		deal.status = RELEASED
		gl.get_contract_at(deal.recipient).emit_transfer(value=deal.amount_atto)
		return self.get_deal(deal_id)

	@gl.public.view
	def get_deal(self, deal_id: str) -> dict:
		deal_id = str(deal_id).strip()
		if deal_id not in self.deals:
			raise gl.vm.UserError(f"{EXPECTED} deal does not exist")
		deal = self.deals[deal_id]
		return {
			"deal_id": str(deal.deal_id),
			"task_identifier": str(deal.task_identifier),
			"sponsor": deal.sponsor.as_hex,
			"recipient": deal.recipient.as_hex,
			"amount_atto": str(int(deal.amount_atto)),
			"status": str(deal.status),
		}
