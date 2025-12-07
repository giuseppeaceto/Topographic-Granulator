import type { GranularParams } from '../granular/GranularWorkletEngine';
import type { EffectsParams } from '../effects/EffectsChain';

export type PadParams = {
	granular: GranularParams;
	effects: EffectsParams;
	xy: { x: number, y: number };
};

export function defaultGranular(): GranularParams {
	return { grainSizeMs: 80, density: 15, randomStartMs: 40, pitchSemitones: 0 };
}

export function defaultEffects(): EffectsParams {
	return { filterCutoffHz: 4000, filterQ: 0.707, delayTimeSec: 0.25, delayMix: 0.15, delayFeedback: 0.3, reverbMix: 0.2, masterGain: 0.9, reverbRoom: 0.5, reverbDamp: 0.5 };
}

export function createPadParamStore(size: number) {
	const store: PadParams[] = new Array(size).fill(0).map(() => ({
		granular: defaultGranular(),
		effects: defaultEffects(),
		xy: { x: 0.5, y: 0.5 }
	}));

	function get(index: number): PadParams {
		return store[index];
	}
	function set(index: number, params: Partial<PadParams>) {
		const current = store[index];
		store[index] = {
			granular: { ...current.granular, ...(params.granular ?? {}) },
			effects: { ...current.effects, ...(params.effects ?? {}) },
			xy: params.xy ? { ...params.xy } : current.xy
		};
	}
	function setGranular(index: number, granular: Partial<GranularParams>) {
		set(index, { granular: granular as GranularParams });
	}
	function setEffects(index: number, fx: Partial<EffectsParams>) {
		set(index, { effects: fx as EffectsParams });
	}
	function setXY(index: number, pos: { x: number, y: number }) {
		set(index, { xy: pos });
	}
	function add() {
		store.push({
			granular: defaultGranular(),
			effects: defaultEffects(),
			xy: { x: 0.5, y: 0.5 }
		});
	}
	return { get, set, setGranular, setEffects, setXY, add };
}


