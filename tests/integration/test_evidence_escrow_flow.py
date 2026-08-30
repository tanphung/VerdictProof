"""Consensus integration for the real receipt-producing escrow."""

from gltest import get_accounts, get_contract_factory
from gltest.assertions import tx_execution_succeeded


AMOUNT = 10**15


def test_real_funded_release_receipt():
    sponsor, recipient = get_accounts()[:2]
    escrow = get_contract_factory(contract_name="EvidenceEscrow").deploy(args=[], account=sponsor)

    funded = escrow.fund_deal(
        args=["VP25-STUDIONET-TASK", "VP25-STUDIONET-DEAL", recipient.address, AMOUNT],
    ).transact(value=AMOUNT)
    assert tx_execution_succeeded(funded)

    released = escrow.release(
        args=["VP25-STUDIONET-TASK", "VP25-STUDIONET-DEAL", recipient.address, AMOUNT, "RELEASE", True]
    ).transact()
    assert tx_execution_succeeded(released)

    deal = escrow.get_deal(args=["VP25-STUDIONET-DEAL"]).call()
    assert deal["status"] == "RELEASED"
    assert deal["recipient"].lower() == recipient.address.lower()
    assert deal["amount_atto"] == str(AMOUNT)
