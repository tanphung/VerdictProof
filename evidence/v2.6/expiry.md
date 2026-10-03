# VerdictProof V2.6 expiry

OBL-001: Finalized escrow release
Transaction: https://explorer-bradbury.genlayer.com/tx/0x34c4694408e615fd952771ad1a5dd391fd1b720ef457c7bca8c01f638bcb9f4a
Sender: 0x04D9beb3ae05ca01C77C7252d0B4fDbf4485b2e8
Source contract: 0x9Fa296927b2E3922cEEe24aa05f63459046E0E1B
Method: release
task_identifier: VP26-expiry-20261002
deal_id: DEAL-expiry-20261002
recipient: 0xAE6b929dDDcDEb2207d6B7E1cFc9A74Ea580E579
amount_atto: 1000000000000000
kind: RELEASE
released: true
The escrow releases this funded amount to the beneficiary. The source contract and beneficiary are different addresses.

OBL-002: Immutable artifact verification
GitHub resolves this file at a full commit SHA. The contract decodes every byte, checks byte length and full SHA-256 against the declared submission, splits the UTF-8 text into ordered chunks of at most 1024 bytes, and records all chunk digests. Every validator independently retrieves and evaluates all chunks, including the final chunk; a matching prefix does not authenticate the rest of the document.

OBL-003: Reservation and settlement rules
Acceptance moves one reward from available to reserved. Approval consumes that submission's reservation even when available rewards are zero. The approved tester can claim exactly reward plus stake once. Rejection releases the reservation and slashes the stake; expiry refunds stake and releases the reservation. Closure requires no pending submissions and no reservations; approved claims remain payable after closure. These are contract rules, not a claim that this case has already been reviewed or paid.
