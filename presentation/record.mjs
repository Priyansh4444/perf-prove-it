// Record each Animotion slide to MP4 and GIF.
//
//   node record.mjs
//
// Builds the deck, serves it with vite preview, records one clip per slide
// with Playwright's recordVideo (webm), then converts to MP4 and GIF with
// ffmpeg. This is the same approach used by puppeteer-screen-recorder and
// playwright-screen-recorder, but with Playwright's built-in recorder.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'animations');
const videoDir = join(here, '.video-tmp');
const chrome = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const port = 4173;
const base = `http://localhost:${port}`;

rmSync(videoDir, { recursive: true, force: true });
mkdirSync(videoDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

function run(cmd, args, cwd = here) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
	});
}

function runQuiet(cmd, args, cwd = here) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { cwd, stdio: 'ignore' });
		child.on('error', reject);
		child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
	});
}

async function waitForServer(url, timeoutMs = 30000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error(`server did not start at ${url}`);
}

// One entry per slide. `steps` pause, then optionally press ArrowRight to
// trigger the next Animotion action. Durations cover the slide transitions.
const SETTLE_MS = 2400;
const TRIM_SECONDS = 2;

const scenarios = [
	{ name: '01-code', slide: 0, steps: [{ pause: SETTLE_MS }, { next: true, pause: 4000 }] },
	{ name: '02-bytecode-before', slide: 1, steps: [{ pause: SETTLE_MS }, { next: true, pause: 1800 }, { next: true, pause: 3600 }] },
	{ name: '03-bytecode-after', slide: 2, steps: [{ pause: SETTLE_MS }, { next: true, pause: 1800 }, { next: true, pause: 3600 }] },
	{ name: '04-opt-deopt', slide: 3, steps: [{ pause: SETTLE_MS }, { next: true, pause: 1800 }, { next: true, pause: 3600 }] },
	{ name: '05-metrics', slide: 4, selector: '.present .text-7xl', steps: [{ pause: SETTLE_MS + 3200 }] }
];

console.log('building...');
await runQuiet('node_modules/.bin/vite', ['build']);

console.log('starting preview server...');
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(port), '--strictPort'], {
	cwd: here,
	stdio: 'ignore'
});
server.on('error', (err) => {
	console.error(err);
	process.exit(1);
});

try {
	await waitForServer(base);

	const browser = await chromium.launch({ executablePath: chrome, headless: true });

	for (const scenario of scenarios) {
		const context = await browser.newContext({
			viewport: { width: 1600, height: 900 },
			recordVideo: { dir: videoDir, size: { width: 1600, height: 900 } }
		});
		const page = await context.newPage();
		await page.goto(`${base}/#/${scenario.slide}`, { waitUntil: 'networkidle' });
		await page.waitForSelector(scenario.selector ?? '.present .shiki-magic-move-container');
		await page.evaluate(() => document.fonts.ready);
		await page.addStyleTag({
			content:
				'.recorder, .reveal .controls, .reveal .progress, .reveal .slide-number { display: none !important; }'
		});
		await page.click('body', { position: { x: 8, y: 8 } });
		const video = page.video();

		for (const step of scenario.steps) {
			if (step.next) await page.keyboard.press('ArrowRight');
			await page.waitForTimeout(step.pause);
		}

		await context.close();
		const recorded = await video.path();
		renameSync(recorded, join(outDir, `${scenario.name}.webm`));
		console.log(`recorded ${scenario.name}.webm`);
	}

	await browser.close();
} finally {
	server.kill('SIGTERM');
}

console.log('converting to mp4 and gif...');
for (const scenario of scenarios) {
	const webm = join(outDir, `${scenario.name}.webm`);
	if (!existsSync(webm)) continue;
	await run('ffmpeg', [
		'-y',
		'-i',
		webm,
		'-ss',
		String(TRIM_SECONDS),
		'-c:v',
		'libx264',
		'-pix_fmt',
		'yuv420p',
		'-crf',
		'18',
		'-movflags',
		'+faststart',
		join(outDir, `${scenario.name}.mp4`)
	]);
	await run('ffmpeg', [
		'-y',
		'-i',
		webm,
		'-ss',
		String(TRIM_SECONDS),
		'-vf',
		'fps=12,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
		'-loop',
		'0',
		join(outDir, `${scenario.name}.gif`)
	]);
	await runQuiet('rm', ['-f', webm]);
	console.log(`converted ${scenario.name}`);
}

rmSync(videoDir, { recursive: true, force: true });
console.log(`done. outputs in ${outDir}`);
