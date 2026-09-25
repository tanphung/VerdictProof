# Finalized escrow release evidence

## OBL-001: exact receipt facts

Bradbury transaction:
https://explorer-bradbury.genlayer.com/tx/0x52ab9f5256ce034ad2ba7c132f783ec1fcf4ee1d9eb89ed120efcd182790c738

The finalized transaction succeeded with consensus AGREE and successful execution.
Sender (tester): 0x04D9beb3ae05ca01C77C7252d0B4fDbf4485b2e8.
Transaction recipient (escrow contract): 0x465f33065C84A3C598E85801608d45F454D69bdF.
Decoded method: release.
Decoded positional arguments:

0. task_identifier = VP25-STUDIONET-2facfe26
1. deal_id = DEAL-STUDIONET-2facfe26
2. recipient = 0xAE6b929dDDcDEb2207d6B7E1cFc9A74Ea580E579
3. amount_atto = 1000000000000000 (0.001 GEN)
4. kind = RELEASE
5. released = true

The sender funded this deal and released its funds to the beneficiary above.
The receipt destination is the escrow contract; the recipient argument is the
beneficiary. They serve different purposes and must both match campaign policy.

## OBL-002: complete immutable artifact verification

This UTF-8 Markdown artifact is published at a fixed Git commit and path. The
contract retrieves all bytes through GitHub's repository, commit and contents
APIs, verifies the declared byte length and full SHA-256, and partitions every
byte into ordered chunks of at most 1024 bytes without splitting UTF-8 characters.
Every chunk is reviewed. Ordered chunk digests and the complete SHA-256 manifest
are stored with the submission and independently recomputed during review.

## OBL-003: reward reservation and settlement accounting

At acceptance, one full campaign reward moves from available pool to reserved
pool. Approval consumes that reservation and makes stake plus reward claimable,
even when the available pool is zero. Rejection releases the reservation and
adds the slashed stake to the available pool. Claim pays the tester once; campaign
close refunds only available funds and cannot confiscate approved unclaimed
rewards. These are contract rules, not a claim that this report's payout has
already occurred; its actual settlement is read from finalized contract state.
