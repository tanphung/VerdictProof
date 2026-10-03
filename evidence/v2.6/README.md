# V2.6 immutable verification fixtures

Primary artifact commit: `d4bc93899cd3cb19192f518d56d76e509ae6583c`.

This second commit preserves the exact bytes of `capacity.md`. The capacity
regression uses its distinct commit reference and a previously unused transaction
to show that a full reservation pool rejects a submission before either evidence
reference is consumed. Equal content hashes do not make distinct immutable
artifact references identical.

The other fixtures cover approval, task binding, missing obligations, transaction
reuse, artifact reuse, and a pending submission that must reach its real review
deadline before an expiry refund can be verified. These are fixture definitions;
the finalized verification report records their actual outcomes.
