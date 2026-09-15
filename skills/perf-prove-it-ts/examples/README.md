# Worked examples: what the census found, in plain words

Each example is one real case from the original study or a worked pipeline. Same shape every time: the source, the census numbers, the one bytecode line that changed, what the machine was doing, the measured outcome, how behavior was proved identical, and, where a verifier ran, what it corrected. Numbers are from one run on one machine; reproduce before quoting.

- `rerank-closures.md`: seven closures down to one, and the bytecode line that was misread the first time.
- `search-sorts-switch.md`: an allocation and an iterator walk replaced by strict compares.
- `scanemotes-closures.md`: `matchAll` clones, per-message closures, and a falsified heap claim.
- `decodeentities-dom-guard.md`: a DOM parse replaced by a string scan, and why the function got bigger.
- `default-param-closure.md`: a `() => null` default that allocates on every omitted argument.
- `default-param-pipeline/`: the same case as a full notebook: harness files, every command, every raw tool output, and what each line means. Regenerate with `bash default-param-pipeline/harness/run.sh`.
