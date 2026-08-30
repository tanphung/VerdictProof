import pytest


AMOUNT = 10**16


@pytest.fixture
def escrow(direct_deploy):
    return direct_deploy("contracts/evidence_escrow.py")


def test_fund_and_release_real_deal(direct_vm, escrow, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    direct_vm.value = AMOUNT
    funded = escrow.fund_deal("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT)
    assert funded["status"] == "FUNDED"
    assert funded["amount_atto"] == str(AMOUNT)

    direct_vm.value = 0
    released = escrow.release("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT, "RELEASE", True)
    assert released["status"] == "RELEASED"


def test_funding_must_be_exact_and_unique(direct_vm, escrow, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    direct_vm.value = AMOUNT - 1
    with direct_vm.expect_revert("deal funding must exactly equal amount_atto"):
        escrow.fund_deal("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT)

    direct_vm.value = AMOUNT
    escrow.fund_deal("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT)
    with direct_vm.expect_revert("deal already exists"):
        escrow.fund_deal("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT)


def test_release_rejects_wrong_sponsor_or_facts(direct_vm, escrow, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    direct_vm.value = AMOUNT
    escrow.fund_deal("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT)
    direct_vm.value = 0

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only the deal sponsor can release"):
        escrow.release("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT, "RELEASE", True)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("release facts do not match the funded deal"):
        escrow.release("TASK-WRONG", "DEAL-001", direct_bob.as_hex, AMOUNT, "RELEASE", True)
    with direct_vm.expect_revert("release kind and state are invalid"):
        escrow.release("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT, "HOLD", False)


def test_release_cannot_execute_twice(direct_vm, escrow, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    direct_vm.value = AMOUNT
    escrow.fund_deal("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT)
    direct_vm.value = 0
    escrow.release("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT, "RELEASE", True)
    with direct_vm.expect_revert("deal is not funded"):
        escrow.release("TASK-001", "DEAL-001", direct_bob.as_hex, AMOUNT, "RELEASE", True)
