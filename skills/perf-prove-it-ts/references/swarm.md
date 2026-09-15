# Battle testing

Read this only when multiple agents or a verifier are requested.

Slice one unit per worker and freeze the target contract, corpus, identity envelope, and build ID. Workers return a patch, predicted count delta, compiled artifact hash, bytecode/tier evidence, behavior output, and costs. A verifier rebuilds from source, checks hashes, reruns A/A and A/B, fuzzes edge cases, checks memory/deopts, and attempts to falsify the win. One falsified unit gets one corrected rerun; a second stays open. No verifier report, no landing.
