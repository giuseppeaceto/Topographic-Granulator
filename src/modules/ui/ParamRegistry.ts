import { GRAIN_SIZE_CLASSIC_MAX_MS, GRAIN_SIZE_MIN_MS, RANDOM_START_MIN_MS } from '../utils/grainLimits';

export type ParamId =
	| 'grainSizeMs' | 'density' | 'randomStartMs' | 'pitchSemitones'
	| 'filterCutoffHz' | 'delayTimeSec' | 'delayMix' | 'reverbMix' | 'masterGain'
	| 'selectionPos';

export type ParamMeta = {
	id: ParamId;
	label: string;
	min: number;
	max: number;
	kind: 'granular' | 'fx' | 'selection';
};

export type ParamRangeOverride = Partial<Record<ParamId, { min?: number; max?: number }>>;

export const PARAMS: ParamMeta[] = [
	{ id: 'grainSizeMs', label: 'Grain Size', min: GRAIN_SIZE_MIN_MS, max: GRAIN_SIZE_CLASSIC_MAX_MS, kind: 'granular' },
	{ id: 'density', label: 'Density', min: 1, max: 60, kind: 'granular' },
	{ id: 'randomStartMs', label: 'Random Start', min: RANDOM_START_MIN_MS, max: GRAIN_SIZE_CLASSIC_MAX_MS, kind: 'granular' },
	{ id: 'pitchSemitones', label: 'Pitch', min: -12, max: 12, kind: 'granular' },
	{ id: 'filterCutoffHz', label: 'Filter Cutoff', min: 200, max: 12000, kind: 'fx' },
	{ id: 'delayTimeSec', label: 'Delay Time', min: 0, max: 1.2, kind: 'fx' },
	{ id: 'delayMix', label: 'Delay Mix', min: 0, max: 1, kind: 'fx' },
	{ id: 'reverbMix', label: 'Reverb Mix', min: 0, max: 1, kind: 'fx' },
	{ id: 'masterGain', label: 'Master Gain', min: 0, max: 1.5, kind: 'fx' },
	// normalized 0..1 along timeline (0 = start, 1 = end possible based on selection length)
	{ id: 'selectionPos', label: 'Selection Position', min: 0, max: 1, kind: 'selection' }
];


