export type EffectsParams = {
	filterCutoffHz: number;
	filterQ?: number;
	delayTimeSec: number;
	delayMix: number; // 0..1
	reverbMix: number; // 0..1
	masterGain: number; // 0.. ~1.5
};

export type EffectsChain = {
	input: GainNode;
	output: GainNode;
	setParams: (p: Partial<EffectsParams>) => void;
};

export function createEffectsChain(ctx: AudioContext): EffectsChain {
	const input = ctx.createGain();
	const output = ctx.createGain();

	// Filter
	const filter = ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 4000;
	filter.Q.value = 0;

	// Delay with mix
	const delay = ctx.createDelay(2.0);
	delay.delayTime.value = 0.25;
	const delayWet = ctx.createGain();
	const delayDry = ctx.createGain();
	delayWet.gain.value = 0.15;
	delayDry.gain.value = 1 - delayWet.gain.value;

	// Simple reverb: small generated impulse
	const convolver = ctx.createConvolver();
	convolver.buffer = generateImpulseResponse(ctx, 1.8, 2.0);
	const reverbWet = ctx.createGain();
	const reverbDry = ctx.createGain();
	reverbWet.gain.value = 0.2;
	reverbDry.gain.value = 1 - reverbWet.gain.value;

	// Master
	const master = ctx.createGain();
	master.gain.value = 0.9;

	// Routing
	input.connect(filter);

	// Split for delay
	filter.connect(delayDry);
	filter.connect(delay);
	delay.connect(delayWet);

	// Mix delay back
	const delayMixNode = ctx.createGain();
	delayDry.connect(delayMixNode);
	delayWet.connect(delayMixNode);

	// Split for reverb
	delayMixNode.connect(reverbDry);
	delayMixNode.connect(convolver);
	convolver.connect(reverbWet);

	// Mix reverb to master
	const reverbMixNode = ctx.createGain();
	reverbDry.connect(reverbMixNode);
	reverbWet.connect(reverbMixNode);
	reverbMixNode.connect(master);
	master.connect(output);

	function setParams(p: Partial<EffectsParams>) {
		const t = ctx.currentTime + 0.01;
		if (p.filterCutoffHz != null) filter.frequency.linearRampToValueAtTime(p.filterCutoffHz, t);
		if (p.filterQ != null) filter.Q.linearRampToValueAtTime(p.filterQ, t);
		if (p.delayTimeSec != null) delay.delayTime.linearRampToValueAtTime(p.delayTimeSec, t);
		if (p.delayMix != null) {
			const wet = Math.max(0, Math.min(1, p.delayMix));
			delayWet.gain.linearRampToValueAtTime(wet, t);
			delayDry.gain.linearRampToValueAtTime(1 - wet, t);
		}
		if (p.reverbMix != null) {
			const wet = Math.max(0, Math.min(1, p.reverbMix));
			reverbWet.gain.linearRampToValueAtTime(wet, t);
			reverbDry.gain.linearRampToValueAtTime(1 - wet, t);
		}
		if (p.masterGain != null) master.gain.linearRampToValueAtTime(p.masterGain, t);
	}

	return { input, output, setParams };
}

function generateImpulseResponse(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
	const rate = ctx.sampleRate;
	const length = Math.floor(rate * durationSec);
	const impulse = ctx.createBuffer(2, length, rate);
	for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
		const data = impulse.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			// simple noise decay
			data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
		}
	}
	return impulse;
}


