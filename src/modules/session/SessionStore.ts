import type { MidiMapping } from '../midi/MidiManager';
import type { PadParams } from '../editor/PadParamStore';
import type { Region } from '../editor/RegionStore';
import { defaultEffects, defaultGranular } from '../editor/PadParamStore';
import { defaultMarkerSeq, mergeMarkerSeq } from '../editor/MarkerStore';

export const SESSION_VERSION = 1 as const;
export const AUTOSAVE_KEY = 'undergrain-autosave-v1';

export type SessionXyCorners = { tl: string; tr: string; bl: string; br: string };
export type MidiPlayMode = 'pads' | 'keys';

export type SessionPad = {
	region: Region | null;
	params: PadParams;
	audioFile?: string | null;
	audioName?: string | null;
};

export type UndergrainSession = {
	version: typeof SESSION_VERSION;
	audio: { name: string; file: string } | null;
	scaleIndex: number;
	xyMode: 'params' | 'pads';
	xyCorners: SessionXyCorners;
	activePadIndex: number | null;
	midiMode: MidiPlayMode;
	midiMappings: MidiMapping[];
	pads: SessionPad[];
};

export function emptyPadParams(): PadParams {
	return {
		granular: defaultGranular(),
		effects: defaultEffects(),
		xy: { x: 0.5, y: 0.5 },
		motionMode: 'loop',
		motionSpeed: 1.0,
		xySpeed: 0.15,
		xyShift: 0.05,
		markerSeq: defaultMarkerSeq()
	};
}

export function clonePadParams(params: PadParams): PadParams {
	return JSON.parse(JSON.stringify(params)) as PadParams;
}

export function sanitizePadParams(raw: Partial<PadParams> | undefined): PadParams {
	const base = emptyPadParams();
	if (!raw) return base;
	return {
		granular: { ...base.granular, ...(raw.granular ?? {}) },
		effects: { ...base.effects, ...(raw.effects ?? {}) },
		xy: raw.xy ? { ...raw.xy } : base.xy,
		motionPath: raw.motionPath,
		motionMode: raw.motionMode ?? base.motionMode,
		motionSpeed: raw.motionSpeed ?? base.motionSpeed,
		xySpeed: raw.xySpeed ?? base.xySpeed,
		xyShift: raw.xyShift ?? base.xyShift,
		markerSeq: mergeMarkerSeq(base.markerSeq, raw.markerSeq ?? {})
	};
}

export function parseSession(raw: string): UndergrainSession {
	const data = JSON.parse(raw) as Partial<UndergrainSession>;
	if (!data || data.version !== SESSION_VERSION || !Array.isArray(data.pads)) {
		throw new Error('Invalid Undergrain session file');
	}
	return {
		version: SESSION_VERSION,
		audio: data.audio ?? null,
		scaleIndex: typeof data.scaleIndex === 'number' ? data.scaleIndex : 0,
		xyMode: data.xyMode === 'pads' ? 'pads' : 'params',
		xyCorners: {
			tl: data.xyCorners?.tl ?? 'filterCutoffHz',
			tr: data.xyCorners?.tr ?? 'density',
			bl: data.xyCorners?.bl ?? 'none',
			br: data.xyCorners?.br ?? 'none'
		},
		activePadIndex: data.activePadIndex ?? 0,
		midiMode: data.midiMode === 'keys' ? 'keys' : 'pads',
		midiMappings: Array.isArray(data.midiMappings) ? data.midiMappings : [],
		pads: data.pads.map((p) => ({
			region: p?.region ?? null,
			params: sanitizePadParams(p?.params),
			audioFile: p?.audioFile ?? null,
			audioName: p?.audioName ?? null
		}))
	};
}

export function stringifySession(session: UndergrainSession): string {
	return JSON.stringify(session, null, 2);
}

export function audioBasename(sessionPath: string, originalName: string): string {
	const stem = sessionPath.replace(/\\/g, '/').split('/').pop() ?? 'session';
	const base = stem.replace(/\.undergrain\.json$/i, '').replace(/\.json$/i, '');
	const ext = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')) : '.wav';
	return `${base}${ext}`;
}

export function padAudioBasename(sessionPath: string, padIndex: number, originalName: string): string {
	const stem = sessionPath.replace(/\\/g, '/').split('/').pop() ?? 'session';
	const base = stem.replace(/\.undergrain\.json$/i, '').replace(/\.json$/i, '');
	const ext = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')) : '.wav';
	return `${base}-pad${padIndex + 1}${ext}`;
}

export function joinDir(sessionPath: string, fileName: string): string {
	const norm = sessionPath.replace(/\\/g, '/');
	const dir = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '';
	const sep = sessionPath.includes('\\') ? '\\' : '/';
	return dir ? `${dir}${sep}${fileName}` : fileName;
}
