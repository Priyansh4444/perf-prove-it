# Rendering evidence

Read this only for React, Solid, JSX, HTML, or browser rendering work.

Trace: state/projection → reconciliation → parser/sanitizer → highlighting or measurement → DOM mutation → style/layout/paint. V8 bytecode proves JavaScript instruction shape; source maps identify the original component; React/Solid profiles show component work; browser traces and mutation counters prove DOM and pipeline work. For `D` streamed updates with lengths `Lᵢ`, start with `Σ parse(Lᵢ)` unless the artifact demonstrates prefix reuse. Preserve keys, identity, focus, ARIA, ordering, and scroll behavior in the behavior envelope.
