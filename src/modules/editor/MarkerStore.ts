export const MAX_MARKERS = 16;
export const MAX_MARKER_HOLD = 8;
export const MAX_MARKER_DRIFT_MS = 400;
export const MIN_MARKER_DRIFT_HZ = 0.03;
export const MAX_MARKER_DRIFT_HZ = 0.4;
export const DEFAULT_MARKER_DRIFT_HZ = 0.08;

export type Marker = {
	id: string;
	timeSec: number;
	hold?: number;
	driftMs?: number;
	driftHz?: number;
};

export type MarkerOrder = 'forward' | 'reverse' | 'pingpong' | 'random' | 'shuffle' | 'wander';
export type MarkerGrainMode = 'cloud' | 'pulse' | 'glide' | 'stutter' | 'flam' | 'bloom';
export type MarkerRate = '16s' | '8s' | '4s' | '2/1' | '1/1' | '1/2' | '1/4' | '1/8' | '1/8T' | '1/16' | '1/16T';
export type MarkerPattern = 'off' | 'straight' | 'euclidean' | 'clave' | 'thue' | 'burst';
export type BloomShape =
	| 'swell'
	| 'bell'
	| 'late'
	| 'crash'
	| 'plateau'
	| 'double'
	| 'terrace'
	| 'reverse'
	| 'pulse'
	| 'undulate'
	| 'saw'
	| 'inhale';
export type BloomShapeMode = 'random' | BloomShape;

export const BLOOM_SHAPES: BloomShape[] = [
	'swell', 'bell', 'late', 'crash', 'plateau', 'double',
	'terrace', 'reverse', 'pulse', 'undulate', 'saw', 'inhale'
];
export const BLOOM_SHAPE_MODES: BloomShapeMode[] = ['random', ...BLOOM_SHAPES];
export const BLOOM_SHAPE_LABELS = [
	'Random', 'Swell', 'Bell', 'Late', 'Crash', 'Plateau', 'Double',
	'Terrace', 'Reverse', 'Spike', 'Undulate', 'Saw', 'Inhale'
];

export function bloomShapeModeLabel(mode: BloomShapeMode): string {
	if (mode === 'random') return 'Bloom';
	const idx = BLOOM_SHAPE_MODES.indexOf(mode);
	return BLOOM_SHAPE_LABELS[idx] ?? mode;
}

export type MarkerSeqParams = {
	enabled: boolean;
	markers: Marker[];
	order: MarkerOrder;
	grainMode: MarkerGrainMode;
	bpm: number;
	rate: MarkerRate;
	pattern: MarkerPattern;
	euclidHits: number;
	euclidSteps: number;
	chance: number;
	bloomShapeMode: BloomShapeMode;
	bloomChange: number;
};

let markerIdSeq = 0;

export function createMarkerId(): string {
	markerIdSeq += 1;
	return `mk-${Date.now().toString(36)}-${markerIdSeq}`;
}

export function defaultMarkerSeq(): MarkerSeqParams {
	return {
		enabled: false,
		markers: [],
		order: 'forward',
		grainMode: 'cloud',
		bpm: 120,
		rate: '1/16',
		pattern: 'straight',
		euclidHits: 5,
		euclidSteps: 8,
		chance: 1,
		bloomShapeMode: 'random',
		bloomChange: 1
	};
}

export function clampChance(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.max(0, Math.min(1, value));
}

export function markerHold(marker: Marker): number {
	const hold = marker.hold ?? 0;
	if (!Number.isFinite(hold)) return 0;
	return Math.max(0, Math.min(MAX_MARKER_HOLD, Math.round(hold)));
}

export function isAbsoluteRate(rate: MarkerRate): boolean {
	return rate === '16s' || rate === '8s' || rate === '4s';
}

export function mergeMarkerSeq(current: MarkerSeqParams, patch: Partial<MarkerSeqParams>): MarkerSeqParams {
	const next: MarkerSeqParams = {
		...current,
		...patch,
		markers: patch.markers !== undefined ? patch.markers : current.markers
	};
	next.chance = clampChance(next.chance ?? 1);
	next.bloomChange = clampChance(next.bloomChange ?? 1);
	next.bloomShapeMode = next.bloomShapeMode ?? 'random';
	return next;
}

export function setMarkerHold(seq: MarkerSeqParams, id: string, hold: number): MarkerSeqParams {
	const nextHold = Math.max(0, Math.min(MAX_MARKER_HOLD, Math.round(hold)));
	return {
		...seq,
		markers: seq.markers.map(m => (m.id === id ? { ...m, hold: nextHold } : m))
	};
}

export function markerDriftMs(marker: Marker): number {
	const v = marker.driftMs ?? 0;
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(MAX_MARKER_DRIFT_MS, v));
}

export function markerDriftHz(marker: Marker): number {
	const v = marker.driftHz ?? DEFAULT_MARKER_DRIFT_HZ;
	if (!Number.isFinite(v)) return DEFAULT_MARKER_DRIFT_HZ;
	return Math.max(MIN_MARKER_DRIFT_HZ, Math.min(MAX_MARKER_DRIFT_HZ, v));
}

export function setMarkerDrift(
	seq: MarkerSeqParams,
	id: string,
	patch: { driftMs?: number; driftHz?: number }
): MarkerSeqParams {
	return {
		...seq,
		markers: seq.markers.map(m => {
			if (m.id !== id) return m;
			const next = { ...m };
			if (patch.driftMs !== undefined) {
				next.driftMs = Math.max(0, Math.min(MAX_MARKER_DRIFT_MS, patch.driftMs));
			}
			if (patch.driftHz !== undefined) {
				next.driftHz = Math.max(MIN_MARKER_DRIFT_HZ, Math.min(MAX_MARKER_DRIFT_HZ, patch.driftHz));
			}
			return next;
		})
	};
}

function markerPhase(id: string): number {
	let h = 0;
	for (let i = 0; i < id.length; i++) {
		h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
	}
	return ((h >>> 0) % 1000) / 1000 * Math.PI * 2;
}

export function driftedMarkerTime(
	marker: Marker,
	nowSec: number,
	lo: number,
	hi: number
): number {
	const depth = markerDriftMs(marker) / 1000;
	const home = marker.timeSec;
	if (depth <= 0) return Math.max(lo, Math.min(hi, home));
	const hz = markerDriftHz(marker);
	const offset = depth * Math.sin((Math.PI * 2) * hz * nowSec + markerPhase(marker.id));
	return Math.max(lo, Math.min(hi, home + offset));
}

export function sortMarkers(markers: Marker[]): Marker[] {
	return markers.slice().sort((a, b) => a.timeSec - b.timeSec);
}

export function markersInRegion(markers: Marker[], region: { start: number; end: number } | null): Marker[] {
	const sorted = sortMarkers(markers);
	if (!region) return sorted;
	const lo = Math.min(region.start, region.end);
	const hi = Math.max(region.start, region.end);
	return sorted.filter(m => m.timeSec >= lo && m.timeSec <= hi);
}

export function addMarker(seq: MarkerSeqParams, timeSec: number, duration: number): MarkerSeqParams {
	if (seq.markers.length >= MAX_MARKERS) return seq;
	const t = Math.max(0, Math.min(timeSec, Math.max(0, duration)));
	const next = sortMarkers([...seq.markers, { id: createMarkerId(), timeSec: t }]);
	return { ...seq, markers: next };
}

export function moveMarker(seq: MarkerSeqParams, id: string, timeSec: number, duration: number): MarkerSeqParams {
	const t = Math.max(0, Math.min(timeSec, Math.max(0, duration)));
	const next = sortMarkers(seq.markers.map(m => (m.id === id ? { ...m, timeSec: t } : m)));
	return { ...seq, markers: next };
}

export function removeMarker(seq: MarkerSeqParams, id: string): MarkerSeqParams {
	return { ...seq, markers: seq.markers.filter(m => m.id !== id) };
}

export function clearMarkers(seq: MarkerSeqParams): MarkerSeqParams {
	return { ...seq, markers: [] };
}

/** Slide markers with a region window. No-op on resize (width change). */
export function shiftMarkersWithRegion(
	markers: Marker[],
	from: { start: number; end: number } | null | undefined,
	to: { start: number; end: number } | null | undefined,
	duration: number
): Marker[] {
	if (!from || !to || markers.length === 0) return markers;
	const fromW = from.end - from.start;
	const toW = to.end - to.start;
	if (Math.abs(fromW - toW) > 0.0005) return markers;
	const delta = to.start - from.start;
	if (Math.abs(delta) < 1e-6) return markers;
	const dur = Math.max(0, duration);
	return sortMarkers(markers.map(m => ({
		...m,
		timeSec: Math.max(0, Math.min(m.timeSec + delta, dur))
	})));
}

export function rateToSeconds(bpm: number, rate: MarkerRate): number {
	if (rate === '16s') return 16;
	if (rate === '8s') return 8;
	if (rate === '4s') return 4;
	const beat = 60 / Math.max(20, bpm);
	switch (rate) {
		case '2/1': return beat * 8;   // 2 bars in 4/4
		case '1/1': return beat * 4;   // whole note
		case '1/2': return beat * 2;   // half note
		case '1/4': return beat;
		case '1/8': return beat / 2;
		case '1/8T': return beat / 3;
		case '1/16': return beat / 4;
		case '1/16T': return beat / 6;
		default: return beat / 4;
	}
}

/** Simple Euclidean / Bjorklund-style distribution. */
export function euclideanPattern(hits: number, steps: number): boolean[] {
	const n = Math.max(1, Math.round(steps));
	const k = Math.max(0, Math.min(Math.round(hits), n));
	if (k === 0) return Array(n).fill(false);
	if (k >= n) return Array(n).fill(true);
	const pattern: boolean[] = [];
	let bucket = 0;
	for (let i = 0; i < n; i++) {
		bucket += k;
		if (bucket >= n) {
			bucket -= n;
			pattern.push(true);
		} else {
			pattern.push(false);
		}
	}
	return pattern;
}

function rotatePattern(pattern: boolean[], rot: number): boolean[] {
	const n = pattern.length;
	if (n === 0) return pattern;
	const r = ((Math.round(rot) % n) + n) % n;
	if (r === 0) return pattern;
	return pattern.slice(r).concat(pattern.slice(0, r));
}

/** 3-2 son clave. STEPS picks 8 vs 16; HITS rotates the clave. */
export function clavePattern(hits: number, steps: number): boolean[] {
	const n = Math.max(8, Math.round(steps));
	const clave16 = [true, false, false, true, false, false, true, false, false, false, true, false, true, false, false, false];
	const clave8 = [true, false, false, true, false, false, true, false];
	const base = n >= 16 ? clave16 : clave8;
	if (base.length === n) return rotatePattern(base, hits);
	const stretched = Array.from({ length: n }, (_, i) => base[Math.floor((i * base.length) / n)]);
	return rotatePattern(stretched, hits);
}

/** Thue-Morse: structured, never-quite-looping. STEPS = cycle; HITS rotates. */
export function thueMorsePattern(hits: number, steps: number): boolean[] {
	const n = Math.max(2, Math.round(steps));
	const base = Array.from({ length: n }, (_, i) => {
		let x = i;
		let parity = 0;
		while (x > 0) {
			parity ^= x & 1;
			x >>= 1;
		}
		return parity === 1;
	});
	return rotatePattern(base, hits);
}

/** k hits, then rest, looping. Very stutter/granular. */
export function burstPattern(hits: number, steps: number): boolean[] {
	const n = Math.max(2, Math.round(steps));
	const k = Math.max(1, Math.min(Math.round(hits), n));
	return Array.from({ length: n }, (_, i) => (i % n) < k);
}

export function patternUsesGridKnobs(pattern: MarkerPattern): boolean {
	return pattern === 'euclidean' || pattern === 'clave' || pattern === 'thue' || pattern === 'burst';
}

export function isDiscreteGrainMode(mode: MarkerGrainMode): boolean {
	return mode === 'pulse' || mode === 'stutter' || mode === 'flam';
}

export function usesBloomControls(mode: MarkerGrainMode): boolean {
	return mode === 'bloom';
}

export function bloomUsesChangeKnob(shapeMode: BloomShapeMode): boolean {
	return shapeMode === 'random';
}
