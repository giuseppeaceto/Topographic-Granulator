import wasmUrl from '../../wasm/granular-core_bg.wasm?url';
import type { EffectsParams } from '../effects/EffectsChain';

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
	setEffectParams: (params: Partial<EffectsParams>) => void;
	trigger: () => void;
	stop: () => void;
};

// Helper to get correct worklet path for Electron and browser
function getWorkletPath(): string {
	// Check if running in Electron
	const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
	
	// In Electron dev mode (with Vite), use absolute path
	// In Electron production, use relative path
	// In browser, use absolute path
	if (isElectron && window.location.protocol === 'file:') {
		// Production Electron - use relative path
		return './worklets/granular-processor.js';
	} else {
		// Dev mode or browser - use absolute path
		return '/worklets/granular-processor.js';
	}
}

export async function createGranularWorkletEngine(ctx: AudioContext): Promise<GranularWorkletEngine> {
	if (!('audioWorklet' in ctx)) {
		throw new Error('AudioWorklet non supportato nel browser');
	}
	// load processor with correct path
	const workletPath = getWorkletPath();
	console.log('Loading worklet from:', workletPath);
	try {
		await ctx.audioWorklet.addModule(workletPath);
		console.log('Worklet loaded successfully from:', workletPath);
	} catch (error) {
		console.error('Failed to load worklet from:', workletPath, error);
		// Try fallback path logic
		let fallbackPath = '';
		if (workletPath.startsWith('./')) {
			fallbackPath = workletPath.substring(1); // ./foo -> /foo (absolute for dev)
		} else if (workletPath.startsWith('/')) {
			fallbackPath = '.' + workletPath; // /foo -> ./foo (relative for prod)
		} else {
			fallbackPath = '/' + workletPath;
		}
		
		console.log('Trying fallback path:', fallbackPath);
		try {
			await ctx.audioWorklet.addModule(fallbackPath);
			console.log('Worklet loaded successfully from fallback:', fallbackPath);
		} catch (fallbackError) {
			console.error('Failed to load worklet from fallback:', fallbackPath, fallbackError);
			// Don't throw immediately, let's see if we can still create the node (sometimes addModule fails spuriously but works)
			// But usually if this fails, the next step fails.
			throw new Error(`Failed to load audio worklet from ${workletPath} and ${fallbackPath}: ${fallbackError}`);
		}
	}
	
	try {
		const node = new AudioWorkletNode(ctx, 'granular-processor', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
		node.onprocessorerror = (err) => {
			console.error('AudioWorkletProcessor error:', err);
		};

		// --- WASM LOADING ---
		try {
			console.log('Fetching WASM from:', wasmUrl);
			const response = await fetch(wasmUrl);
			const wasmBytes = await response.arrayBuffer();
			console.log('Sending WASM bytes to worklet, size:', wasmBytes.byteLength);
			node.port.postMessage({ type: 'loadWasm', wasmBytes });
		} catch (wasmErr) {
			console.error('Failed to load WASM module:', wasmErr);
		}
		// --------------------
		
		let buffer: AudioBuffer | null = null;
		let region: { start: number; end: number } = { start: 0, end: 0 };
		let params: GranularParams = { grainSizeMs: 80, density: 15, randomStartMs: 40, pitchSemitones: 0 };
		let fxParams: EffectsParams = {
			filterCutoffHz: 4000,
			filterQ: 0.707,
			delayTimeSec: 0.25,
			delayMix: 0.15,
			delayFeedback: 0.3,
			reverbMix: 0.2,
			masterGain: 0.9
		};
		// ... closures ...
		function connect(dest: AudioNode) { node.connect(dest); }
		function disconnect() { node.disconnect(); }
		async function setBuffer(b: AudioBuffer) {
			buffer = b;
			region = { start: 0, end: b.duration };
			
			// Safety check: decode failures or empty buffers
			if (!b.numberOfChannels) {
				console.error('Buffer has no channels');
				return;
			}

			// copy channel data; avoid transfer list (some Electron builds can crash with large transfers)
			const channels: Float32Array[] = [];
			for (let ch = 0; ch < b.numberOfChannels; ch++) {
				const src = b.getChannelData(ch);
				// Create a copy.
				const copy = new Float32Array(src);
				channels.push(copy);
			}
			
			try {
				node.port.postMessage({ type: 'setBuffer', channels });
			} catch (msgError) {
				console.error('Failed to postMessage to worklet:', msgError);
			}
			
			// Initialize region
			const startSample = 0;
			const endSample = b.length;
			node.port.postMessage({ type: 'setRegion', startSample, endSample });
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
		function setEffectParams(p: Partial<EffectsParams>) {
			fxParams = { ...fxParams, ...p };
			// Convert seconds to ms for delay time
			const delayTimeMs = fxParams.delayTimeSec * 1000;
			node.port.postMessage({
				type: 'setEffectParams',
				params: {
					filterCutoffHz: fxParams.filterCutoffHz,
					filterQ: fxParams.filterQ,
					delayTimeMs,
					delayFeedback: fxParams.delayFeedback,
					delayMix: fxParams.delayMix,
					reverbMix: fxParams.reverbMix,
					masterGain: fxParams.masterGain
				}
			});
		}
		function trigger() {
			node.port.postMessage({ type: 'trigger', on: true });
		}
		function stop() {
			node.port.postMessage({ type: 'trigger', on: false });
		}

		return { connect, disconnect, setBuffer, setRegion, setParams, setEffectParams, trigger, stop };
	} catch (nodeError) {
		console.error('Error creating AudioWorkletNode:', nodeError);
		throw nodeError;
	}
}


