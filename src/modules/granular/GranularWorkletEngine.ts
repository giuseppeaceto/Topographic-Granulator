export type GranularParams = {
	grainSizeMs: number;
	density: number;
	randomStartMs: number;
	pitchSemitones: number;
};

export type GranularWorkletEngine = {
	connect: (dest: AudioNode) => void;
	disconnect: () => void;
	setBuffer: (buffer: AudioBuffer) => Promise<void>;
	setRegion: (startSec: number, endSec: number) => void;
	setParams: (params: Partial<GranularParams>) => void;
	trigger: () => void;
	stop: () => void;
};

export async function createGranularWorkletEngine(ctx: AudioContext): Promise<GranularWorkletEngine> {
	if (!('audioWorklet' in ctx)) {
		throw new Error('AudioWorklet non supportato nel browser');
	}
	// load processor
	await ctx.audioWorklet.addModule('/worklets/granular-processor.js');
	const node = new AudioWorkletNode(ctx, 'granular-processor', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });

	let buffer: AudioBuffer | null = null;
	let region: { start: number; end: number } = { start: 0, end: 0 };
	let params: GranularParams = { grainSizeMs: 80, density: 15, randomStartMs: 40, pitchSemitones: 0 };

	function connect(dest: AudioNode) { node.connect(dest); }
	function disconnect() { node.disconnect(); }
	async function setBuffer(b: AudioBuffer) {
		buffer = b;
		region = { start: 0, end: b.duration };
		// copy channel data
		const channels: Float32Array[] = [];
		for (let ch = 0; ch < b.numberOfChannels; ch++) {
			const src = b.getChannelData(ch);
			// transfer a copy (AWP cannot access SAB by default)
			channels.push(src.slice(0));
		}
		// Transfer underlying ArrayBuffers, not the typed arrays themselves
		const transfers = channels.map((arr) => arr.buffer);
		node.port.postMessage({ type: 'setBuffer', channels }, transfers);
		node.port.postMessage({ type: 'setRegion', startSample: 0, endSample: b.length });
	}
	function setRegion(startSec: number, endSec: number) {
		if (!buffer) return;
		const start = Math.max(0, Math.min(startSec, endSec));
		const end = Math.max(start, endSec);
		region = { start, end };
		const startSample = Math.floor(start * buffer.sampleRate);
		const endSample = Math.floor(end * buffer.sampleRate);
		node.port.postMessage({ type: 'setRegion', startSample, endSample });
	}
	function setParams(p: Partial<GranularParams>) {
		params = { ...params, ...p };
		node.port.postMessage({ type: 'setParams', params });
	}
	function trigger() {
		node.port.postMessage({ type: 'trigger', on: true });
	}
	function stop() {
		node.port.postMessage({ type: 'trigger', on: false });
	}

	return { connect, disconnect, setBuffer, setRegion, setParams, trigger, stop };
}


