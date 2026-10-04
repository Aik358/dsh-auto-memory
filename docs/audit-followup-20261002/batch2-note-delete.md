# Follow-up groups 2/3: note ownership and deletion concurrency

Base: 2cb529408ebfe58b0b92d9a6d3158d77b565fb52. Upstream remains 131ca794b9f0d07f78b19bf6feee3312939854ed.

The note form now captures session and displayed notesPath with its snapshot, submits both, and refuses a stale form after a session switch. The server resolves the submitted session independently, rejects unknown owners and mismatched paths, reads the same target file for deduplication, and updates only that owner's runtime. Classic, current Iter5 and frozen legacy forms use this contract. Older unbound forms must reload; the route no longer guesses an owner from the globally mirrored state.

Storage deletion now supplies the SHA-256 of the exact buffer used to calculate the deletion to the document writer's existing compare-and-swap guard, even when callers omit a digest. A stale deletion explicitly returns conflict-external-edit and must be retried from a fresh list. Fact revocation and activation purging happen only for a successful deletion. Existing factStoreOf/activationHostOf factory wiring is retained.

## Evidence

- Actual host routes with isolated sessions A/B and real document writer: baseline 0/5, corrected 5/5. Covers A form after B runtime refresh, unknown/mismatched/missing owner binding, disk deduplication, concurrent delete/delete, and delete/GUI append. Losing operations preserve the winner's disk data and perform no cascade.
- Complete shipped client factory in a controlled VM hook/HTTP harness: all three form variants submit the captured owner and reject stale sessions (3 cases). This exercises rendered handlers, not an extracted component. It is not a browser DOM acceptance claim.
- Existing storage suite: 45/45. Existing Iter5 skin assertions pass, including retained draft behavior.
- Generator check --check --strict passes. Classic NotesTab's deliberate changes update the classic-source fingerprint; index API ownership changes update the existing route fingerprint without changing its 70-route count.
- Complete isolated smoke run: 262 PASS / 3 FAIL / 0 TIMEOUT, 138.5s; /tmp/dam-round2-group23-full.log. The three failures remain missing lib/policies, absent development Python venv, and absent skin artwork assets.

No model, QQ or external notification service was called. HOME/DSH_HOME are disposable test directories and the network side-effect guard is installed for host tests and the full suite.
