<script lang="ts">
	import '../styles/app.css';
	import { Recorder } from '@animotion/core';

	let { children } = $props();
</script>

<svelte:head>
	<title>perf-prove-it</title>
</svelte:head>

{@render children()}

<Recorder />
