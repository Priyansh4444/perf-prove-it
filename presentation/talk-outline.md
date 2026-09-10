# perf-prove-it, a ten minute talk

Built on the five rules from the Death by PowerPoint article: tell a story, expect to lose people and earn them back, break the rhythm, do not dumb the material down, and treat the slides as props rather than the talk.

The props live in this folder. `slides.md` is the live deck. `cards/` holds the static code and evidence images. The whole thing is a story about one function, not a list of deliverables.

## The story in one sentence

I told an agent to make my search ranking faster and told it not to open a profiler. It read the bytecode V8 actually generated or it did not get to claim anything.

## Beats

**Beat 0, the hook. 30 seconds.**
Open on the cover slide.
"I asked the agent to make it faster. It never opened a profiler. It made the compiler show its work."
Do not say what the result was yet. That is the whole hook.

**Beat 1, the rule. 60 seconds.**
One screen, no bullets: profiles find local minima, the floor is what the machine must do. Credit Casey Muratori, say the number: about twenty instructions cover most function bodies.
Draw it live if you can. A horizontal line labeled "floor" and a jagged line above it labeled "the code". No slide needed for this.

**Beat 2, the problem. 2 minutes.**
The "The code" slide, or the `cards/rerank-before.png` card.
Show the real function. Then run the real command in a terminal:

```sh
node --allow-natives-syntax --print-bytecode --print-bytecode-filter='rerank' harness.cjs | node scripts/census.mjs
```

Let the room see `CreateClosure` before you explain it. Then explain it in one line: every call allocates a function object, and the dump says seven.

**Beat 3, the fix. 90 seconds.**
Click "The code" to morph it, then use the "Counted before and after" slide, or the before/after cards side by side.
Show the fused loop. Let the counter land on 1. Name the win in counts, not feelings: 7 closures and about 204 temporaries per call down to 1 closure and 3 output arrays.
Here is the re-entry point for anyone who drifted: the census strip at the bottom shows five functions going to zero.

**Beat 4, the proof. 90 seconds.**
The "Opt" slide, then the "Deopt" slide.
Run `--trace-opt` live if the room is with you. Maglev, then TurboFan, no deopts. Say why it matters: a deopt means you were measuring the interpreter and did not know it.
Then the deliberately wrong moment. Put the fake 16x number on screen as if it were the headline. Pause. Move to the deopt trace and `wrong map`. The first benchmark was two bundles deoptimizing each other. The 16x got thrown out. This is the slide people will remember, and it is the one that proves the method is honest.

**Beat 5, the same thing in Rust. 90 seconds.**
`cards/rust-runs.png`.
One function, one algorithmic change: repeated full ranking per page replaced with an early-exit probe. Three runs, 2.2x to 2.45x, exact output order asserted.
Then the part nobody presents: the experiments that lost. String caching, index-map grouping, Thin LTO. Numbers on screen. One sentence: a perf record that only contains wins is marketing.

**Beat 6, how it scales. 60 seconds.**
Explain the unit workflow without slides: one function per sandbox, an ideal sibling function next to it, a behavior lock captured before editing, one evidence row per increment, one subagent per unit, a second subagent to verify. The rule that matters: no subagent says optimized without pasting the bytecode.

**Beat 7, close. 30 seconds.**
The final "Count it. Compile it. Prove it." slide.
"Your code is 20 instructions. Read them."
Point at the install line. Stop talking.

## If you have five minutes instead

Beats 0, 2, 4, 7. The hook, the census, the fake 16x, the close.

## If the demo breaks

The cards are the backup. `cards/rerank-before.png`, `cards/census.png`, `cards/trace-opt.png`, `cards/phantom-16x.png`, `cards/rust-runs.png`, all rendered at 2x for projection.

## Rules for this deck

- One idea per scene. If a scene needs a second sentence to explain, split it.
- Numbers on screen, not in your mouth. Say the story.
- No jargon before the intuition. Explaining `CreateClosure` takes ten seconds; name it before you show the bytecode line.
- Leave the wrong result on screen longer than is comfortable. The pause is the lesson.
- Do not read the slides. If the audience can get everything by reading, there is no reason for you to be there.
