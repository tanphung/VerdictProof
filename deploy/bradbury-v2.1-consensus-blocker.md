# VerdictProof V2.1 Bradbury Consensus Blocker

Recorded on 2026-08-11 after finalized-state verification through `genlayer-js`.

## Deployment

- Contract: `0xDe0bf3732FaB463f5DA46D09c303a3D3d4390DA0`
- Rubric: `VERDICTPROOF_V2_1`
- Validation method: `INDEPENDENT_COMPARATIVE`
- Deployment transaction: `0xbea5dbc078c0cc84ed8696f3254ebfb8c75e6cbecd3be5c21f69d55a0d4dcd41`
- Local/deployed source SHA-256: `3f18b1efc1cac4f5e428958d96922aecdea78e6f73d8bbefb65cf9fb351af22a`

## Successful control review

- Transaction: `0x29ca4b56306c7ba89cfee728cc71125f7338823735d6904fd9e4692be933039e`
- Final lifecycle: `FINALIZED / AGREE / FINISHED_WITH_RETURN`
- Validator votes: `TIMEOUT, AGREE, AGREE, AGREE, AGREE`
- Persisted result: submission `1`, `APPROVED`, score `86`

This confirms that the deployed contract and its independent comparative validator path can
reach consensus and persist a complete V2.1 report.

## Identity-mismatch attempt 1

- Transaction: `0x39e045b6829a442a14245950fe6e3753f53c460b4cbb07151bab5a7fdac0c233`
- Final lifecycle: `FINALIZED / TIMEOUT / FINISHED_WITH_RETURN`
- Final validator votes: `TIMEOUT, DETERMINISTIC_VIOLATION, TIMEOUT, DETERMINISTIC_VIOLATION, TIMEOUT`
- Rotations remaining: `0`
- Persisted result: submission `2` remained `PENDING`

## Identity-mismatch retry

- Transaction: `0xf554f46e0c52a7e38af26b9024502b9ed07792ebdc7cdd119a37eef0bd5b746a`
- Final lifecycle: `FINALIZED / IDLE / NOT_VOTED`
- Final validator set: `11`
- Final round: `6` commits, `0` reveals, all vote names `NOT_VOTED`
- Rotations remaining: `0`
- Persisted result: submission `2` remained `PENDING`

Earlier retry rounds reached leader `FINISHED_WITH_RETURN`, then repeatedly stalled below full
validator participation before the network expanded the validator set. The final round did not
produce a consensus result or state change.

## Rollout decision

The multi-wallet verification gate requires one approved review, one identity rejection, one
semantic rejection, a claim, and a close/refund transaction. Because two identity-review
attempts finalized without accepted consensus, VerdictProof does not submit a third attempt,
does not overwrite the last complete public verification artifact, and does not switch
production from the previously verified contract.

The remaining semantic review, claim, close/refund, V2.1 production switch, and Portal
submission stay blocked until the Bradbury validator execution issue is resolved or the team
provides a supported remediation path.

