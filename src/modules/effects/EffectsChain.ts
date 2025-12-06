export type EffectsParams = {
	filterCutoffHz: number;
	filterQ?: number;
	delayTimeSec: number;
	delayMix: number; // 0..1
	delayFeedback?: number; // 0..1
	reverbMix: number; // 0..1
	masterGain: number; // 0.. ~1.5
	reverbRoom?: number;
	reverbDamp?: number;
};

export type EffectsChain = {
	input: GainNode;
	output: GainNode;
	setParams: (p: Partial<EffectsParams>) => void;
};

// JS effects chain now acts as a pass-through bus.
// All DSP (filter/delay/reverb/master) is handled in Rust WASM.
export function createEffectsChain(ctx: AudioContext): EffectsChain {
	const input = ctx.createGain();
	const output = ctx.createGain();
	input.connect(output);

	function setParams(_p: Partial<EffectsParams>) {
		// No-op: effects live in the Rust engine now.
	}

	return { input, output, setParams };
}
