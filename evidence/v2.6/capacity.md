# VerdictProof V2.6 capacity

OBL-001: Finalized escrow release
Transaction: https://explorer-bradbury.genlayer.com/tx/0x201c1cfd736fd3e232c2d7f491f569740b9743b0468fb405a9565b37e55ea617
Sender: 0x04D9beb3ae05ca01C77C7252d0B4fDbf4485b2e8
Source contract: 0x9Fa296927b2E3922cEEe24aa05f63459046E0E1B
Method: release
task_identifier: VP26-capacity-20261002
deal_id: DEAL-capacity-20261002
recipient: 0xAE6b929dDDcDEb2207d6B7E1cFc9A74Ea580E579
amount_atto: 1000000000000000
kind: RELEASE
released: true
The escrow releases this funded amount to the beneficiary. The source contract and beneficiary are different addresses.

OBL-002: Immutable artifact verification
GitHub resolves this file at a full commit SHA. The contract decodes every byte, checks byte length and full SHA-256 against the declared submission, splits the UTF-8 text into ordered chunks of at most 1024 bytes, and records all chunk digests. Every validator independently retrieves and evaluates all chunks, including the final chunk; a matching prefix does not authenticate the rest of the document.

This negative fixture deliberately contains no explanation of reward reservation or settlement accounting.
