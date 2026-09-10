import rerankBefore from '../../bytecode/rerank-before.txt?raw';
import rerankAfter from '../../bytecode/rerank-after.txt?raw';
import censusBefore from '../../bytecode/census-before.txt?raw';
import censusAfter from '../../bytecode/census-after.txt?raw';
import optAfter from '../../bytecode/opt-after.txt?raw';
import deoptAb from '../../bytecode/deopt-ab.txt?raw';

export { rerankBefore, rerankAfter, censusBefore, censusAfter, optAfter };

function lineNumbers(text: string, needle: string): string {
	return text
		.split('\n')
		.map((line, index) => (line.includes(needle) ? index + 1 : null))
		.filter((n): n is number => n !== null)
		.join(',');
}

export const beforeClosureLines = lineNumbers(rerankBefore, 'CreateClosure');
export const afterClosureLines = lineNumbers(rerankAfter, 'CreateClosure');
export const turboFanLines = lineNumbers(optAfter, 'TURBOFAN_JS');

export const firstBeforeClosure = beforeClosureLines.split(',')[0];
export const firstAfterClosure = afterClosureLines.split(',')[0];

export const deoptWrongMap = deoptAb
	.split('\n')
	.filter((line) => line.includes('wrong map'))
	.slice(0, 4)
	.map((line) =>
		line
			.replace(/0x[0-9a-f]+/g, '')
			.replace(/\(sfi = \)/g, '')
			.replace(/, caller SP , pc \]/g, ']')
			.replace(/\s{2,}/g, ' ')
			.replace(/JSFunction\s+>/g, 'JSFunction>')
			.replace(/\s+>/g, '>')
			.trim()
	)
	.join('\n');

const bytecodeLength = (text: string) => Number(text.match(/Bytecode length: (\d+)/)?.[1] ?? 0);
const censusTotal = (text: string) => Number(text.match(/(\d+) closure\/context/)?.[1] ?? 0);
const countLines = (text: string, needle: string) =>
	text.split('\n').filter((line) => line.includes(needle)).length;

export const metrics = {
	closuresBefore: countLines(rerankBefore, 'CreateClosure'),
	closuresAfter: countLines(rerankAfter, 'CreateClosure'),
	bytecodeBefore: bytecodeLength(rerankBefore),
	bytecodeAfter: bytecodeLength(rerankAfter),
	censusBefore: censusTotal(censusBefore),
	censusAfter: censusTotal(censusAfter),
	temporariesBefore: 204,
	temporariesAfter: 3
};

// Measured with the bench harness on 2026-09-10, Intel Core Ultra 7 255H,
// load ~2.5, 5 alternating reps of 100k rerank calls, each process verified
// at %GetOptimizationStatus 41 with TurboFan. Medians below.
export const measured = {
	speedBefore: 42.8,
	speedAfter: 38.9,
	rssBefore: 154,
	rssAfter: 122,
	gcBefore: 58.2,
	gcAfter: 58.1
};
