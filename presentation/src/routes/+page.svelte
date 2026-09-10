<script lang="ts">
	import { Presentation, Slide, Code, Action } from '@animotion/core';
	import { codeBefore, codeAfter } from '$lib/snippets';
	import {
		rerankBefore,
		rerankAfter,
		optAfter,
		beforeClosureLines,
		afterClosureLines,
		turboFanLines,
		firstBeforeClosure,
		firstAfterClosure,
		deoptWrongMap,
		metrics
	} from '$lib/data';

	let code: Code;
	let bytecodeBefore: Code;
	let bytecodeAfter: Code;
	let opt: Code;
	let deopt: Code;
</script>

<Presentation
	options={{
		history: true,
		transition: 'slide',
		controls: true,
		progress: true,
		width: 1600,
		height: 900,
		margin: 0.03
	}}
>
	<Slide>
		<div class="flex h-full min-h-0 flex-col">
			<Code
				bind:this={code}
				lang="ts"
				theme="vesper"
				code={codeBefore}
				options={{ duration: 900, stagger: 0.4, lineNumbers: true, containerStyle: false }}
				class="flex-1 min-h-0 overflow-auto rounded-xl border border-zinc-800 bg-[#101010] p-6"
			/>
			<Action do={() => code.update`${codeAfter}`} />
		</div>
	</Slide>

	<Slide>
		<div class="flex h-full min-h-0 flex-col">
			<Code
				bind:this={bytecodeBefore}
				lang="text"
				theme="vesper"
				code={rerankBefore}
				options={{ duration: 500, lineNumbers: true, containerStyle: false }}
				class="code-sm flex-1 min-h-0 overflow-auto rounded-xl border border-zinc-800 bg-[#101010] p-5"
			/>
			<Action do={() => bytecodeBefore.scrollToLine`${firstBeforeClosure}`} />
			<Action do={() => bytecodeBefore.selectLines`${beforeClosureLines}`} />
		</div>
	</Slide>

	<Slide>
		<div class="flex h-full min-h-0 flex-col">
			<Code
				bind:this={bytecodeAfter}
				lang="text"
				theme="vesper"
				code={rerankAfter}
				options={{ duration: 500, lineNumbers: true, containerStyle: false }}
				class="code-sm flex-1 min-h-0 overflow-auto rounded-xl border border-zinc-800 bg-[#101010] p-5"
			/>
			<Action do={() => bytecodeAfter.scrollToLine`${firstAfterClosure}`} />
			<Action do={() => bytecodeAfter.selectLines`${afterClosureLines}`} />
		</div>
	</Slide>

	<Slide>
		<div class="grid h-full min-h-0 grid-cols-2 gap-4">
			<div class="flex min-h-0 flex-col">
				<Code
					bind:this={opt}
					lang="text"
					theme="vesper"
					code={optAfter}
					options={{ duration: 400, lineNumbers: true, containerStyle: false }}
					class="code-sm flex-1 min-h-0 overflow-auto rounded-xl border border-zinc-800 bg-[#101010] p-4"
				/>
				<Action do={() => opt.selectLines`${turboFanLines}`} />
			</div>
			<div class="flex min-h-0 flex-col">
				<Code
					bind:this={deopt}
					lang="text"
					theme="vesper"
					code={deoptWrongMap}
					options={{ duration: 400, lineNumbers: true, containerStyle: false }}
					class="code-sm flex-1 min-h-0 overflow-auto rounded-xl border border-zinc-800 bg-[#101010] p-4"
				/>
				<Action do={() => deopt.selectLines`*`} />
			</div>
		</div>
	</Slide>

	<Slide>
		<div class="grid h-full grid-cols-2 content-center gap-x-16 gap-y-14 px-20 font-mono">
			<div>
				<div class="text-7xl text-[#ffc799]">{metrics.closuresBefore} &rarr; {metrics.closuresAfter}</div>
				<div class="mt-3 text-xl text-zinc-500">closures per rerank call</div>
			</div>
			<div>
				<div class="text-7xl text-[#ffc799]">{metrics.temporariesBefore} &rarr; {metrics.temporariesAfter}</div>
				<div class="mt-3 text-xl text-zinc-500">temporaries per rerank call</div>
			</div>
			<div>
				<div class="text-7xl text-[#ffc799]">{metrics.bytecodeBefore} &rarr; {metrics.bytecodeAfter}</div>
				<div class="mt-3 text-xl text-zinc-500">bytecode bytes</div>
			</div>
			<div>
				<div class="text-7xl text-[#ffc799]">{metrics.censusBefore} &rarr; {metrics.censusAfter}</div>
				<div class="mt-3 text-xl text-zinc-500">closures across six functions</div>
			</div>
		</div>
	</Slide>
</Presentation>
