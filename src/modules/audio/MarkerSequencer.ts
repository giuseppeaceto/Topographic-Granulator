import {
	BLOOM_SHAPES,
	burstPattern,
	clavePattern,
	driftedMarkerTime,
	euclideanPattern,
	isDiscreteGrainMode,
	markerDriftMs,
	markerHold,
	markersInRegion,
	rateToSeconds,
	thueMorsePattern,
	type BloomShape,
	type Marker,
	type MarkerGrainMode,
	type MarkerOrder,
	type MarkerSeqParams
} from '../editor/MarkerStore';

export type MarkerTickEvent = {
	padIndex: number;
	marker: Marker;
	grainMode: MarkerGrainMode;
	density: number;
};

export type MarkerLaneInput = {
	enabled: boolean;
	playing: boolean;
	params: MarkerSeqParams;
	region: { start: number; end: number } | null;
	density: number;
	duration: number;
};

type LaneState = {
	padIndex: number;
	nextTime: number;
	step: number;
	markerCursor: number;
	pingpongDir: 1 | -1;
	shuffleBag: number[];
	params: MarkerSeqParams;
	region: { start: number; end: number } | null;
	density: number;
	duration: number;
	runningClock: boolean;
	pending: { at: number; marker: Marker }[];
	glideFrom: number;
	glideTo: number;
	glideStart: number;
	glideDur: number;
	lastMarkerTime: number | null;
	holdLeft: number;
	needsPick: boolean;
	bloomActive: boolean;
	bloomStart: number;
	bloomDur: number;
	bloomPeak: number;
	bloomFloor: number;
	bloomAttack: number;
	bloomMemory: number;
	bloomShape: BloomShape;
	bloomShapeExtra: number;
	bloomShapeBag: BloomShape[];
	bloomPicked: boolean;
	playingId: string | null;
	playingIndex: number;
	fromIndex: number;
	hitTime: number;
	visitTrail: number[];
};

export type MarkerLaneVisual = {
	running: boolean;
	progress: number;
	bloom: number;
	grainMode: MarkerGrainMode;
	bloomShape: BloomShape | null;
	markers: { id: string; timeSec: number; hold: number; liveSec: number; driftMs: number }[];
	playingId: string | null;
	playingIndex: number;
	fromIndex: number;
	playheadSec: number | null;
	trail: number[];
	holdLeft: number;
	hitAge: number;
};

export type MarkerSequencer = {
	syncLane: (padIndex: number, input: MarkerLaneInput) => void;
	jumpToMarker: (padIndex: number, markerId: string) => void;
	stopLane: (padIndex: number) => void;
	stopAll: () => void;
	isLaneRunning: (padIndex: number) => boolean;
	getLaneVisual: (padIndex: number) => MarkerLaneVisual | null;
	destroy: () => void;
};

export function createMarkerSequencer(config: {
	getAudioContext: () => AudioContext;
	onTick: (evt: MarkerTickEvent) => void;
	onActiveMarker: (padIndex: number, markerId: string | null) => void;
	onLaneStop?: (padIndex: number) => void;
	onDensity?: (padIndex: number, density: number | null) => void;
}): MarkerSequencer {
	const lanes = new Map<number, LaneState>();
	let timer: number | null = null;
	const LOOKAHEAD = 0.012;
	const INTERVAL_MS = 10;

	function inRegionMarkers(lane: LaneState): Marker[] {
		return markersInRegion(lane.params.markers, lane.region);
	}

	function timeBounds(lane: LaneState): { lo: number; hi: number } {
		const dur = Math.max(0, lane.duration);
		let lo = 0;
		let hi = dur > 0 ? dur : Number.POSITIVE_INFINITY;
		if (lane.region) {
			lo = Math.min(lane.region.start, lane.region.end);
			hi = Math.max(lane.region.start, lane.region.end);
		}
		if (!Number.isFinite(hi) || hi <= lo) {
			hi = lo + 0.001;
		}
		return { lo, hi };
	}

	function liveTime(lane: LaneState, marker: Marker, now: number): number {
		const { lo, hi } = timeBounds(lane);
		return driftedMarkerTime(marker, now, lo, hi);
	}

	function liveCopy(lane: LaneState, marker: Marker, now: number): Marker {
		return { ...marker, timeSec: liveTime(lane, marker, now) };
	}

	function refillShuffle(count: number): number[] {
		const bag = Array.from({ length: count }, (_, i) => i);
		for (let i = bag.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[bag[i], bag[j]] = [bag[j], bag[i]];
		}
		return bag;
	}

	function currentIndex(lane: LaneState, count: number): number {
		if (count <= 0) return 0;
		return ((lane.markerCursor % count) + count) % count;
	}

	function wanderNext(idx: number, count: number): number {
		if (count <= 1) return 0;
		if (Math.random() < 0.7) {
			if (idx <= 0) return 1;
			if (idx >= count - 1) return count - 2;
			return idx + (Math.random() < 0.5 ? -1 : 1);
		}
		if (count === 2) return 1 - idx;
		let next = Math.floor(Math.random() * (count - 1));
		if (next >= idx) next += 1;
		return next;
	}

	function advanceCursor(lane: LaneState, count: number) {
		if (count <= 0) return;
		const order: MarkerOrder = lane.params.order;
		const idx = currentIndex(lane, count);

		if (order === 'random') {
			lane.markerCursor = Math.floor(Math.random() * count);
			return;
		}

		if (order === 'shuffle') {
			if (lane.shuffleBag.length === 0) {
				lane.shuffleBag = refillShuffle(count);
			}
			lane.markerCursor = lane.shuffleBag.shift() ?? 0;
			return;
		}

		if (order === 'wander') {
			lane.markerCursor = wanderNext(idx, count);
			return;
		}

		if (order === 'pingpong') {
			if (count === 1) {
				lane.markerCursor = 0;
				return;
			}
			let next = idx + lane.pingpongDir;
			if (next >= count || next < 0) {
				lane.pingpongDir = (lane.pingpongDir * -1) as 1 | -1;
				next = idx + lane.pingpongDir;
			}
			lane.markerCursor = Math.max(0, Math.min(count - 1, next));
			return;
		}

		if (order === 'reverse') {
			lane.markerCursor = (idx - 1 + count) % count;
			return;
		}

		lane.markerCursor = (idx + 1) % count;
	}

	function isPickOrder(order: MarkerOrder): boolean {
		return order === 'random' || order === 'shuffle';
	}

	function nowSec(): number {
		try {
			return config.getAudioContext().currentTime;
		} catch {
			return 0;
		}
	}

	function refillBloomShapes(): BloomShape[] {
		const bag = BLOOM_SHAPES.slice();
		for (let i = bag.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[bag[i], bag[j]] = [bag[j], bag[i]];
		}
		return bag;
	}

	function pickBloomShape(lane: LaneState): BloomShape {
		if (lane.bloomShapeBag.length === 0) {
			lane.bloomShapeBag = refillBloomShapes();
		}
		if (Math.random() < 0.18) {
			return BLOOM_SHAPES[Math.floor(Math.random() * BLOOM_SHAPES.length)];
		}
		return lane.bloomShapeBag.shift() ?? 'swell';
	}

	function easeSmooth(t: number): number {
		const x = Math.max(0, Math.min(1, t));
		return x * x * (3 - 2 * x);
	}

	function bloomShapeAmount(shape: BloomShape, p: number, attack: number, extra: number): number {
		const t = Math.max(0, Math.min(1, p));
		switch (shape) {
			case 'bell': {
				const mu = 0.32 + extra * 0.28;
				const s = 0.14 + extra * 0.12;
				return Math.exp(-0.5 * ((t - mu) / s) ** 2);
			}
			case 'late': {
				const start = 0.42 + extra * 0.32;
				if (t < start) return (t / start) * 0.1;
				return easeSmooth((t - start) / Math.max(0.001, 1 - start));
			}
			case 'crash': {
				const a = 0.05 + extra * 0.08;
				if (t < a) return easeSmooth(t / a);
				return Math.exp(-((t - a) / Math.max(0.001, 1 - a)) * (2.6 + extra * 2.2));
			}
			case 'plateau': {
				const a = 0.1 + extra * 0.16;
				const b = 0.48 + extra * 0.28;
				if (t < a) return easeSmooth(t / a);
				if (t < b) return 1;
				return 1 - easeSmooth((t - b) / Math.max(0.001, 1 - b));
			}
			case 'double': {
				const p1 = 0.18 + extra * 0.12;
				const p2 = 0.58 + extra * 0.18;
				const g1 = Math.exp(-0.5 * ((t - p1) / 0.11) ** 2);
				const g2 = (0.55 + extra * 0.35) * Math.exp(-0.5 * ((t - p2) / 0.14) ** 2);
				return Math.max(g1, g2);
			}
			case 'terrace': {
				const steps = extra > 0.45 ? 4 : 3;
				const upEnd = 0.68 + extra * 0.12;
				if (t >= upEnd) return 1 - easeSmooth((t - upEnd) / Math.max(0.001, 1 - upEnd));
				const u = t / upEnd;
				const f = u * steps;
				const i = Math.min(steps - 1, Math.floor(f));
				const frac = f - i;
				const a = i / steps;
				const b = (i + 1) / steps;
				return a + (b - a) * easeSmooth(frac);
			}
			case 'reverse': {
				const drop = Math.exp(-t * (1.6 + extra * 1.8));
				const late = extra > 0.35
					? extra * 0.7 * Math.exp(-0.5 * ((t - (0.62 + extra * 0.18)) / 0.1) ** 2)
					: 0;
				return Math.max(drop, late);
			}
			case 'pulse': {
				const w = 0.07 + extra * 0.1;
				if (t < w) return Math.sin((t / w) * Math.PI);
				return Math.exp(-(t - w) * (5 + extra * 4)) * 0.22;
			}
			case 'undulate': {
				const a = Math.max(0.08, Math.min(0.5, attack));
				const base = t < a
					? easeSmooth(t / a)
					: 1 - easeSmooth((t - a) / Math.max(0.001, 1 - a));
				const wobble = (0.12 + extra * 0.16) * Math.sin(t * Math.PI * (2.5 + extra * 3.5));
				return Math.max(0, Math.min(1, base + wobble * Math.max(0.2, base)));
			}
			case 'saw': {
				const cut = 0.62 + extra * 0.28;
				if (t < cut) return Math.pow(t / cut, 0.85 + extra * 0.7);
				return Math.exp(-(t - cut) * (14 + extra * 10));
			}
			case 'inhale': {
				return Math.pow(t, 0.45 + extra * 0.7);
			}
			case 'swell':
			default: {
				const a = Math.max(0.06, Math.min(0.55, attack));
				if (t < a) return easeSmooth(t / a);
				return 1 - easeSmooth((t - a) / Math.max(0.001, 1 - a));
			}
		}
	}

	function startBloom(lane: LaneState) {
		const interval = Math.max(0.08, rateToSeconds(lane.params.bpm, lane.params.rate));
		const last = lane.bloomMemory;
		const missed = Math.random() < 0.12;

		let peak: number;
		if (missed) {
			peak = 0.32 + Math.random() * 0.28;
		} else if (Math.random() < 0.7) {
			peak = last + (Math.random() * 2 - 1) * 0.3;
		} else {
			peak = 0.55 + Math.random() * 1.3;
		}
		peak = Math.max(0.35, Math.min(1.85, peak));
		lane.bloomMemory = last * 0.4 + peak * 0.6;

		let floor = 0.16 + Math.random() * 0.18;
		if (floor > peak - 0.12) floor = Math.max(0.12, peak - 0.22);

		lane.bloomPeak = peak;
		lane.bloomFloor = floor;
		lane.bloomAttack = missed
			? 0.06 + Math.random() * 0.12
			: 0.08 + Math.random() * 0.32;
		const mode = lane.params.bloomShapeMode ?? 'random';
		if (mode !== 'random') {
			lane.bloomShape = mode;
			lane.bloomPicked = true;
		} else if (!lane.bloomPicked || Math.random() < (lane.params.bloomChange ?? 1)) {
			lane.bloomShape = pickBloomShape(lane);
			lane.bloomPicked = true;
		}
		lane.bloomShapeExtra = Math.random();
		const durScale = missed
			? 0.32 + Math.random() * 0.4
			: 0.45 + Math.random() * 1.45;
		lane.bloomStart = nowSec();
		lane.bloomDur = Math.max(0.08, interval * durScale);
		lane.bloomActive = true;
		config.onDensity?.(lane.padIndex, bloomDensity(lane, lane.bloomStart));
	}

	function clearBloom(lane: LaneState) {
		if (!lane.bloomActive) return;
		lane.bloomActive = false;
		config.onDensity?.(lane.padIndex, null);
	}

	function bloomDensity(lane: LaneState, now: number): number {
		const dur = Math.max(0.05, lane.bloomDur);
		const p = Math.max(0, Math.min(1, (now - lane.bloomStart) / dur));
		const amt = bloomShapeAmount(lane.bloomShape, p, lane.bloomAttack, lane.bloomShapeExtra);
		const env = lane.bloomFloor + (lane.bloomPeak - lane.bloomFloor) * Math.max(0, Math.min(1, amt));
		return Math.max(1, Math.min(60, lane.density * env));
	}

	function recordPlay(lane: LaneState, marker: Marker) {
		if (marker.id === 'glide') return;
		const list = inRegionMarkers(lane);
		const idx = list.findIndex(m => m.id === marker.id);
		if (idx < 0) return;
		if (lane.playingIndex !== idx) {
			lane.fromIndex = lane.playingIndex;
			const last = lane.visitTrail[lane.visitTrail.length - 1];
			if (last !== idx) {
				lane.visitTrail.push(idx);
				if (lane.visitTrail.length > 8) lane.visitTrail.shift();
			}
		}
		lane.playingIndex = idx;
		lane.playingId = marker.id;
		lane.hitTime = nowSec();
	}

	function fire(lane: LaneState, marker: Marker, extras: boolean) {
		recordPlay(lane, marker);
		const now = nowSec();
		const live = liveCopy(lane, marker, now);
		if (lane.params.grainMode === 'glide') {
			const interval = rateToSeconds(lane.params.bpm, lane.params.rate);
			lane.glideFrom = lane.lastMarkerTime ?? live.timeSec;
			lane.glideTo = live.timeSec;
			lane.glideStart = now;
			lane.glideDur = Math.max(0.05, interval);
			lane.lastMarkerTime = live.timeSec;
			config.onActiveMarker(lane.padIndex, marker.id);
			return;
		}

		if (lane.params.grainMode === 'bloom') {
			startBloom(lane);
		} else {
			clearBloom(lane);
		}

		config.onTick({
			padIndex: lane.padIndex,
			marker: live,
			grainMode: lane.params.grainMode,
			density: lane.density
		});
		config.onActiveMarker(lane.padIndex, marker.id);
		lane.lastMarkerTime = live.timeSec;

		if (!extras) return;
		const interval = rateToSeconds(lane.params.bpm, lane.params.rate);
		const t0 = lane.nextTime;
		if (lane.params.grainMode === 'stutter') {
			lane.pending.push({ at: t0 + interval / 3, marker });
			lane.pending.push({ at: t0 + (2 * interval) / 3, marker });
		} else if (lane.params.grainMode === 'flam') {
			lane.pending.push({ at: t0 + 0.018, marker });
		}
	}

	function fireCurrent(lane: LaneState, advance: boolean) {
		const list = inRegionMarkers(lane);
		if (list.length === 0) return;
		const count = list.length;
		if (lane.markerCursor >= count) lane.markerCursor = 0;

		if (advance && lane.needsPick && isPickOrder(lane.params.order)) {
			advanceCursor(lane, count);
			lane.needsPick = false;
		}

		const idx = currentIndex(lane, count);
		const marker = list[idx];
		if (marker) fire(lane, marker, advance);
		if (!advance) {
			lane.needsPick = false;
			return;
		}

		if (lane.holdLeft > 0) {
			lane.holdLeft -= 1;
			if (lane.holdLeft === 0) {
				advanceCursor(lane, count);
			}
			return;
		}

		lane.holdLeft = marker ? markerHold(marker) : 0;
		if (lane.holdLeft === 0) {
			advanceCursor(lane, count);
		}
	}

	function shouldHit(lane: LaneState): boolean {
		const { pattern, euclidHits, euclidSteps } = lane.params;
		if (pattern === 'off') return false;
		let patternHit = true;
		if (pattern !== 'straight') {
			const steps = Math.max(2, euclidSteps);
			const hits = Math.max(0, euclidHits);
			let grid: boolean[];
			if (pattern === 'clave') {
				grid = clavePattern(hits, steps);
			} else if (pattern === 'thue') {
				grid = thueMorsePattern(hits, steps);
			} else if (pattern === 'burst') {
				grid = burstPattern(hits, steps);
			} else {
				grid = euclideanPattern(Math.max(1, Math.min(hits, steps)), steps);
			}
			if (grid.length === 0) return false;
			patternHit = grid[lane.step % grid.length] === true;
		}
		if (!patternHit) return false;
		const chance = Math.max(0, Math.min(1, lane.params.chance ?? 1));
		if (chance >= 1) return true;
		if (chance <= 0) return false;
		return Math.random() < chance;
	}

	function updateGlide(lane: LaneState, now: number) {
		if (lane.params.grainMode !== 'glide' || lane.glideDur <= 0) return;
		const p = Math.max(0, Math.min(1, (now - lane.glideStart) / lane.glideDur));
		const ease = p * p * (3 - 2 * p);
		const timeSec = lane.glideFrom + (lane.glideTo - lane.glideFrom) * ease;
		config.onTick({
			padIndex: lane.padIndex,
			marker: { id: 'glide', timeSec },
			grainMode: 'glide',
			density: lane.density
		});
	}

	function updateBloom(lane: LaneState, now: number) {
		if (lane.params.grainMode !== 'bloom' || !lane.bloomActive) return;
		config.onDensity?.(lane.padIndex, bloomDensity(lane, now));
	}

	function updateDrift(lane: LaneState, now: number) {
		if (isDiscreteGrainMode(lane.params.grainMode)) return;
		if (lane.params.grainMode === 'glide') return;
		if (!lane.playingId) return;
		const marker = inRegionMarkers(lane).find(m => m.id === lane.playingId);
		if (!marker || markerDriftMs(marker) <= 0) return;
		const timeSec = liveTime(lane, marker, now);
		lane.lastMarkerTime = timeSec;
		config.onTick({
			padIndex: lane.padIndex,
			marker: { id: 'drift', timeSec },
			grainMode: lane.params.grainMode,
			density: lane.density
		});
	}

	function schedulerTick() {
		let ctx: AudioContext;
		try {
			ctx = config.getAudioContext();
		} catch {
			return;
		}
		const now = ctx.currentTime;

		lanes.forEach((lane) => {
			if (!lane.runningClock) return;
			const interval = rateToSeconds(lane.params.bpm, lane.params.rate);
			if (interval <= 0) return;

			if (lane.pending.length > 0) {
				const due = lane.pending.filter(p => p.at <= now);
				lane.pending = lane.pending.filter(p => p.at > now);
				due.forEach(p => fire(lane, p.marker, false));
			}

			updateGlide(lane, now);
			updateBloom(lane, now);
			updateDrift(lane, now);

			let guard = 0;
			while (lane.nextTime < now + LOOKAHEAD && guard < 8) {
				if (shouldHit(lane)) {
					fireCurrent(lane, true);
				}
				lane.step += 1;
				lane.nextTime += interval;
				guard += 1;
			}

			updateGlide(lane, now);
			updateBloom(lane, now);
			updateDrift(lane, now);
		});
	}

	function ensureTimer() {
		if (timer != null) return;
		timer = window.setInterval(schedulerTick, INTERVAL_MS);
	}

	function maybeStopTimer() {
		const anyClock = Array.from(lanes.values()).some(l => l.runningClock);
		if (!anyClock && timer != null) {
			clearInterval(timer);
			timer = null;
		}
	}

	function stopLane(padIndex: number) {
		const lane = lanes.get(padIndex);
		if (lane) clearBloom(lane);
		if (!lanes.has(padIndex)) return;
		lanes.delete(padIndex);
		config.onActiveMarker(padIndex, null);
		config.onLaneStop?.(padIndex);
		maybeStopTimer();
	}

	function createLane(padIndex: number, input: MarkerLaneInput): LaneState {
		return {
			padIndex,
			nextTime: 0,
			step: 0,
			markerCursor: 0,
			pingpongDir: 1,
			shuffleBag: [],
			params: input.params,
			region: input.region,
			density: input.density,
			duration: Math.max(0, input.duration),
			runningClock: false,
			pending: [],
			glideFrom: 0,
			glideTo: 0,
			glideStart: 0,
			glideDur: 0,
			lastMarkerTime: null,
			holdLeft: 0,
			needsPick: true,
			bloomActive: false,
			bloomStart: 0,
			bloomDur: 0,
			bloomPeak: 1.3,
			bloomFloor: 0.25,
			bloomAttack: 0.15,
			bloomMemory: 1.05,
			bloomShape: 'swell',
			bloomShapeExtra: 0.5,
			bloomShapeBag: [],
			bloomPicked: false,
			playingId: null,
			playingIndex: -1,
			fromIndex: -1,
			hitTime: 0,
			visitTrail: []
		};
	}

	function syncLane(padIndex: number, input: MarkerLaneInput) {
		const inRegion = markersInRegion(input.params.markers, input.region);
		const canRun = input.enabled && input.playing && inRegion.length > 0;

		if (!canRun) {
			if (lanes.has(padIndex)) stopLane(padIndex);
			return;
		}

		let lane = lanes.get(padIndex);
		const isNew = !lane;
		if (!lane) {
			lane = createLane(padIndex, input);
			lanes.set(padIndex, lane);
		}

		lane.params = input.params;
		lane.region = input.region;
		lane.density = input.density;
		lane.duration = Math.max(0, input.duration);
		if (lane.params.grainMode !== 'bloom') {
			clearBloom(lane);
		}

		if (input.params.pattern === 'off') {
			lane.runningClock = false;
			clearBloom(lane);
			if (isNew) fireCurrent(lane, false);
			maybeStopTimer();
			return;
		}

		if (isNew || !lane.runningClock) {
			const ctx = config.getAudioContext();
			lane.nextTime = ctx.currentTime;
			lane.step = 0;
			lane.runningClock = true;
			fireCurrent(lane, true);
			lane.nextTime = ctx.currentTime + rateToSeconds(input.params.bpm, input.params.rate);
		}

		ensureTimer();
	}

	function jumpToMarker(padIndex: number, markerId: string) {
		const lane = lanes.get(padIndex);
		if (!lane) return;
		const list = inRegionMarkers(lane);
		const idx = list.findIndex(m => m.id === markerId);
		if (idx < 0) return;
		lane.markerCursor = idx;
		lane.holdLeft = 0;
		lane.needsPick = false;
		fireCurrent(lane, false);
	}

	function stopAll() {
		const ids = Array.from(lanes.keys());
		ids.forEach(stopLane);
	}

	function isLaneRunning(padIndex: number) {
		return lanes.has(padIndex);
	}

	function getLaneVisual(padIndex: number): MarkerLaneVisual | null {
		const lane = lanes.get(padIndex);
		if (!lane) return null;
		const now = nowSec();
		const list = inRegionMarkers(lane);
		const interval = rateToSeconds(lane.params.bpm, lane.params.rate);
		let progress = 0;
		if (lane.runningClock && interval > 0) {
			progress = 1 - (lane.nextTime - now) / interval;
			progress = Math.max(0, Math.min(1, progress));
		}

		let playheadSec: number | null = null;
		if (lane.params.grainMode === 'glide' && lane.glideDur > 0) {
			const p = Math.max(0, Math.min(1, (now - lane.glideStart) / lane.glideDur));
			const ease = p * p * (3 - 2 * p);
			playheadSec = lane.glideFrom + (lane.glideTo - lane.glideFrom) * ease;
		} else if (lane.playingId) {
			const marker = list.find(m => m.id === lane.playingId);
			playheadSec = marker ? liveTime(lane, marker, now) : lane.lastMarkerTime;
		} else {
			playheadSec = lane.lastMarkerTime;
		}

		let bloom = 0;
		if (lane.bloomActive && lane.params.grainMode === 'bloom') {
			const env = bloomDensity(lane, now) / Math.max(1, lane.density);
			const span = Math.max(0.08, lane.bloomPeak - lane.bloomFloor);
			bloom = Math.max(0, Math.min(1, (env - lane.bloomFloor) / span));
		}

		return {
			running: lane.runningClock,
			progress,
			bloom,
			grainMode: lane.params.grainMode,
			bloomShape: lane.params.grainMode === 'bloom' ? lane.bloomShape : null,
			markers: list.map(m => ({
				id: m.id,
				timeSec: m.timeSec,
				hold: markerHold(m),
				liveSec: liveTime(lane, m, now),
				driftMs: markerDriftMs(m)
			})),
			playingId: lane.playingId,
			playingIndex: lane.playingIndex,
			fromIndex: lane.fromIndex,
			playheadSec,
			trail: lane.visitTrail.slice(),
			holdLeft: lane.holdLeft,
			hitAge: Math.max(0, now - lane.hitTime)
		};
	}

	function destroy() {
		stopAll();
		if (timer != null) {
			clearInterval(timer);
			timer = null;
		}
	}

	return { syncLane, jumpToMarker, stopLane, stopAll, isLaneRunning, getLaneVisual, destroy };
}
