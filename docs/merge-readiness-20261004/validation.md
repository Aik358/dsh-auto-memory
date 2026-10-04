# PR #215: PLAN migration coordination

The independent delegate reproduced a real integration interaction at f518edd3e949e2ef368bfc0a874da3cc9ea4006f: the main PLAN writer could wait for PLAN.lock while settings migrated and published the new root. After lock release, its acknowledged new revision was written only to the inactive old root.

Register PLAN flights before the first await. Root migration drains existing note and PLAN flights before copying; incoming PLAN writes fail explicitly while migration is active. Keep the native lock/CAS and recheck both root bindings inside that lock. Finally removes/resolves every flight; invalid path arguments fail before registration.

Targeted Windows validation: actual MemoryEngine migration/native-lock regression 4 PASS, existing PLAN CAS and two-process CAS PASS, settings routes and migration boundaries PASS, R26 23/0 with the exact updated fingerprint. All four regression cases exercise production source. No UI source changed. Final full fork/upstream CI evidence is recorded in the PR description after push.

This coordinates participating writes on the same engine. Independent engines/processes do not share a configuration migration transaction. Installed DSH, real models/providers and hardware acceptance remain unperformed.
