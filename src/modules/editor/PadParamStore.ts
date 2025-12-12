import type { GranularParams } from '../granular/GranularWorkletEngine';
import type { EffectsParams } from '../effects/EffectsChain';

export type MotionPoint = {
	x: number;
	y: number;
	time: number;
};

export type MotionMode = 'loop' | 'pingpong' | 'oneshot' | 'reverse';

export type PadParams = {
	granular: GranularParams;
	effects: EffectsParams;
	xy: { x: number, y: number };
	motionPath?: MotionPoint[];
    motionMode?: MotionMode;
    motionSpeed?: number;
    xySpeed?: number; // Speed for keyboard arrow movement (normal)
    xyShift?: number; // Speed for keyboard arrow movement with Shift key
};

export function defaultGranular(): GranularParams {
	return {
		grainSizeMs: 100,
		density: 15,
		randomStartMs: 50,
		pitchSemitones: 0
	};
}

export function defaultEffects(): EffectsParams {
	return { filterCutoffHz: 4000, filterQ: 0.707, delayTimeSec: 0.25, delayMix: 0.15, delayFeedback: 0.3, reverbMix: 0.2, masterGain: 0.9, reverbRoom: 0.5, reverbDamp: 0.5 };
}

export function createPadParamStore(size: number) {
	const store: PadParams[] = new Array(size).fill(0).map(() => ({
		granular: defaultGranular(),
		effects: defaultEffects(),
		xy: { x: 0.5, y: 0.5 },
        motionMode: 'loop',
        motionSpeed: 1.0,
        xySpeed: 0.15, // Default normal speed
        xyShift: 0.05  // Default shift speed
	}));

	function get(index: number): PadParams {
		return store[index];
	}
	function set(index: number, params: Partial<PadParams>) {
		const current = store[index];
		store[index] = {
			granular: { ...current.granular, ...(params.granular ?? {}) },
			effects: { ...current.effects, ...(params.effects ?? {}) },
			xy: params.xy ? { ...params.xy } : current.xy,
			motionPath: params.motionPath !== undefined ? params.motionPath : current.motionPath,
            motionMode: params.motionMode !== undefined ? params.motionMode : current.motionMode,
            motionSpeed: params.motionSpeed !== undefined ? params.motionSpeed : current.motionSpeed,
            xySpeed: params.xySpeed !== undefined ? params.xySpeed : (current.xySpeed ?? 0.15),
            xyShift: params.xyShift !== undefined ? params.xyShift : (current.xyShift ?? 0.05)
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
	function setMotionPath(index: number, path: MotionPoint[]) {
		set(index, { motionPath: path });
	}
    function setMotionParams(index: number, mode: MotionMode, speed: number) {
        set(index, { motionMode: mode, motionSpeed: speed });
    }
	function add() {
		store.push({
			granular: defaultGranular(),
			effects: defaultEffects(),
			xy: { x: 0.5, y: 0.5 },
            motionMode: 'loop',
            motionSpeed: 1.0,
            xySpeed: 0.15,
            xyShift: 0.05
		});
	}
	function remove(index: number) {
		store.splice(index, 1);
	}
	function size() {
		return store.length;
	}
	return { get, set, setGranular, setEffects, setXY, setMotionPath, setMotionParams, add, remove, size };
}
