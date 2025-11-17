import type { GranularParams } from '../granular/GranularWorkletEngine';
import type { EffectsParams } from '../effects/EffectsChain';

export type PadParams = {
	granular: GranularParams;
	effects: EffectsParams;
};

export function defaultGranular(): GranularParams {
	return { grainSizeMs: 80, density: 15, randomStartMs: 40, pitchSemitones: 0 };
}

export function defaultEffects(): EffectsParams {
	return { filterCutoffHz: 4000, filterQ: 0, delayTimeSec: 0.25, delayMix: 0.15, reverbMix: 0.2, masterGain: 0.9 };
}

export function createPadParamStore(size: number) {
	const store: PadParams[] = new Array(size).fill(0).map(() => ({
		granular: defaultGranular(),
		effects: defaultEffects()
	}));

	function get(index: number): PadParams {
		return store[index];
	}
	function set(index: number, params: Partial<PadParams>) {
		const current = store[index];
		store[index] = {
			granular: { ...current.granular, ...(params.granular ?? {}) },
			effects: { ...current.effects, ...(params.effects ?? {}) }
		};
	}
	function setGranular(index: number, granular: Partial<GranularParams>) {
		set(index, { granular: granular as GranularParams });
	}
	function setEffects(index: number, fx: Partial<EffectsParams>) {
		set(index, { effects: fx as EffectsParams });
	}
	return { get, set, setGranular, setEffects };
}


