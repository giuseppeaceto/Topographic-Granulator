export type GranularParams = {
	grainSizeMs: number;   // duration per grain
	density: number;       // grains per second
	randomStartMs: number; // random offset around region start
	pitchSemitones: number;
};

export type GranularEngine = {
	connect: (dest: AudioNode) => void;
	disconnect: () => void;
	setBuffer: (buffer: AudioBuffer) => void;
	setRegion: (startSec: number, endSec: number) => void;
	setParams: (params: Partial<GranularParams>) => void;
	trigger: () => void;
	stop: () => void;
};

export function createGranularEngine(ctx: AudioContext): GranularEngine {
	const output = ctx.createGain();
	let buffer: AudioBuffer | null = null;
	let regionStart = 0;
	let regionEnd = 0;
	let isRunning = false;
	let intervalId: number | null = null;
	let params: GranularParams = {
		grainSizeMs: 80,
		density: 15,
		randomStartMs: 40,
		pitchSemitones: 0
	};

	function connect(dest: AudioNode) { output.connect(dest); }
	function disconnect() { output.disconnect(); }
	function setBuffer(b: AudioBuffer) { buffer = b; }
	function setRegion(startSec: number, endSec: number) {
		regionStart = Math.max(0, Math.min(startSec, endSec));
		regionEnd = Math.max(regionStart, endSec);
	}
	function setParams(p: Partial<GranularParams>) {
		params = { ...params, ...p };
	}

	function trigger() {
		if (!buffer) return;
		stop();
		isRunning = true;
		const grainsPerSecond = Math.max(1, params.density);
		const intervalMs = 1000 / grainsPerSecond;
		intervalId = window.setInterval(scheduleGrain, intervalMs) as any as number;
		// schedule an immediate grain to reduce perceived latency
		scheduleGrain();
	}

	function scheduleGrain() {
		if (!buffer || !isRunning) return;
		const now = ctx.currentTime;
		const grainDur = params.grainSizeMs / 1000;
		const playbackRate = Math.pow(2, params.pitchSemitones / 12);

		// pick a start within region (with randomness near regionStart)
		const regionLen = Math.max(0.001, regionEnd - regionStart);
		const randOffset = (Math.random() * 2 - 1) * (params.randomStartMs / 1000);
		let startSec = regionStart + randOffset;
		// clamp
		if (startSec < regionStart) startSec = regionStart;
		if (startSec > regionEnd - grainDur) startSec = Math.max(regionStart, regionEnd - grainDur);

		const src = ctx.createBufferSource();
		src.buffer = buffer;
		src.playbackRate.value = playbackRate;

		// per-grain envelope
		const gain = ctx.createGain();
		gain.gain.value = 0.0;
		const attack = Math.min(0.01, grainDur * 0.2);
		const release = Math.min(0.02, grainDur * 0.25);
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(1, now + attack);
		gain.gain.setValueAtTime(1, now + grainDur - release);
		gain.gain.linearRampToValueAtTime(0, now + grainDur);

		src.connect(gain).connect(output);
		try {
			src.start(now, startSec, grainDur);
			src.stop(now + grainDur + 0.01);
		} catch {
			// ignore scheduling errors if buffer/region changed mid-flight
		}
	}

	function stop() {
		isRunning = false;
		if (intervalId != null) {
			clearInterval(intervalId);
			intervalId = null;
		}
	}

	return { connect, disconnect, setBuffer, setRegion, setParams, trigger, stop };
}


