import type {
	BloomShapeMode,
	MarkerGrainMode,
	MarkerOrder,
	MarkerPattern,
	MarkerRate,
	MarkerSeqParams
} from '../editor/MarkerStore';
import {
	BLOOM_SHAPE_MODES,
	bloomShapeModeLabel,
	bloomUsesChangeKnob,
	isAbsoluteRate,
	markerDriftMs,
	markerHold,
	patternUsesGridKnobs,
	sortMarkers,
	usesBloomControls
} from '../editor/MarkerStore';
import type { MarkerLaneVisual } from '../audio/MarkerSequencer';

const ORDER_VALUES: MarkerOrder[] = ['forward', 'reverse', 'pingpong', 'wander', 'random', 'shuffle'];
const ORDER_LABELS = ['Forward', 'Reverse', 'PingPong', 'Wander', 'Random', 'Shuffle'];
const RATE_VALUES: MarkerRate[] = ['16s', '8s', '4s', '2/1', '1/1', '1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T'];
const PATTERN_VALUES: MarkerPattern[] = ['off', 'straight', 'euclidean', 'clave', 'thue', 'burst'];
const PATTERN_LABELS = ['Off', 'Straight', 'Euclid', 'Clave', 'Thue', 'Burst'];

type GrainChoice = {
	grain: MarkerGrainMode;
	bloom?: BloomShapeMode;
	label: string;
};

const GRAIN_CYCLE: GrainChoice[] = [
	{ grain: 'cloud', label: 'Cloud' },
	{ grain: 'pulse', label: 'Pulse' },
	{ grain: 'glide', label: 'Glide' },
	...BLOOM_SHAPE_MODES.map(mode => ({
		grain: 'bloom' as const,
		bloom: mode,
		label: bloomShapeModeLabel(mode)
	})),
	{ grain: 'stutter', label: 'Stutter' },
	{ grain: 'flam', label: 'Flam' }
];

export type MarkerRack = {
	sync: (params: MarkerSeqParams) => void;
	setPlaying: (playing: boolean) => void;
	setHoldEnabled: (enabled: boolean) => void;
	updateLive: (visual: MarkerLaneVisual | null) => void;
};

export function createMarkerRack(config: {
	onChange: (patch: Partial<MarkerSeqParams>) => void;
	onPlayToggle: () => void;
	onClear: () => void;
}): MarkerRack {
	const playBtn = document.getElementById('markerPlayBtn') as HTMLButtonElement | null;
	const clearBtn = document.getElementById('markerClearBtn') as HTMLButtonElement | null;
	const euclidRow = document.getElementById('markerEuclidRow') as HTMLElement | null;
	const bloomRow = document.getElementById('markerBloomRow') as HTMLElement | null;
	const holdTile = document.getElementById('markerHoldTile') as HTMLElement | null;
	const driftTile = document.getElementById('markerDriftTile') as HTMLElement | null;
	const driftSpeedTile = document.getElementById('markerDriftSpeedTile') as HTMLElement | null;
	const bpmKnob = document.querySelector('.knob[data-knob="marker-bpm"]') as HTMLElement | null;
	const canvas = document.getElementById('markerTransportCanvas') as HTMLCanvasElement | null;
	const metaEl = document.getElementById('markerTransportMeta');
	const ctx = canvas?.getContext('2d') ?? null;

	let lastParams: MarkerSeqParams | null = null;
	let lastVisual: MarkerLaneVisual | null = null;

	function cycle<T>(values: T[], current: T, dir: 1 | -1): T {
		const idx = values.indexOf(current);
		const start = idx < 0 ? 0 : idx;
		return values[(start + dir + values.length) % values.length];
	}

	function bindSelector(selector: string, onDir: (dir: 1 | -1) => void) {
		const el = document.querySelector(`.option-selector[data-selector="${selector}"]`);
		if (!el) return;
		el.querySelector('[data-direction="prev"]')?.addEventListener('click', (e) => {
			e.stopPropagation();
			onDir(-1);
		});
		el.querySelector('[data-direction="next"]')?.addEventListener('click', (e) => {
			e.stopPropagation();
			onDir(1);
		});
	}

	function setLabel(selector: string, text: string) {
		const label = document.querySelector(`.option-selector-label[data-label="${selector}"]`) as HTMLElement | null;
		if (label) label.textContent = text;
	}

	function syncEuclidVisibility(pattern: MarkerPattern) {
		if (euclidRow) {
			euclidRow.hidden = !patternUsesGridKnobs(pattern);
		}
	}

	function syncBloomVisibility(grainMode: MarkerGrainMode, shapeMode: BloomShapeMode) {
		if (bloomRow) {
			bloomRow.hidden = !(usesBloomControls(grainMode) && bloomUsesChangeKnob(shapeMode));
		}
	}

	function grainChoiceIndex(params: MarkerSeqParams): number {
		if (params.grainMode === 'bloom') {
			const mode = params.bloomShapeMode ?? 'random';
			const idx = GRAIN_CYCLE.findIndex(c => c.grain === 'bloom' && (c.bloom ?? 'random') === mode);
			if (idx >= 0) return idx;
			return GRAIN_CYCLE.findIndex(c => c.grain === 'bloom' && c.bloom === 'random');
		}
		const idx = GRAIN_CYCLE.findIndex(c => c.grain === params.grainMode);
		return idx >= 0 ? idx : 0;
	}

	function syncBpmTooltip(rate: MarkerRate) {
		if (!bpmKnob) return;
		bpmKnob.setAttribute(
			'data-tooltip',
			isAbsoluteRate(rate)
				? 'Tempo unused while RATE is in seconds (4s / 8s / 16s)'
				: 'Marker sequencer tempo (40-200 BPM)'
		);
	}

	bindSelector('marker-order', (dir) => {
		const label = document.querySelector('.option-selector-label[data-label="marker-order"]')?.textContent ?? '';
		const idx = Math.max(0, ORDER_LABELS.indexOf(label));
		const next = ORDER_VALUES[(idx + dir + ORDER_VALUES.length) % ORDER_VALUES.length];
		config.onChange({ order: next });
	});

	bindSelector('marker-rate', (dir) => {
		const label = document.querySelector('.option-selector-label[data-label="marker-rate"]')?.textContent ?? '1/16';
		const current = (RATE_VALUES.includes(label as MarkerRate) ? label : '1/16') as MarkerRate;
		config.onChange({ rate: cycle(RATE_VALUES, current, dir) });
	});

	bindSelector('marker-pattern', (dir) => {
		const label = document.querySelector('.option-selector-label[data-label="marker-pattern"]')?.textContent ?? '';
		const idx = Math.max(0, PATTERN_LABELS.indexOf(label));
		const next = PATTERN_VALUES[(idx + dir + PATTERN_VALUES.length) % PATTERN_VALUES.length];
		config.onChange({ pattern: next });
	});

	bindSelector('marker-grain', (dir) => {
		const current = lastParams ?? null;
		const idx = current ? grainChoiceIndex(current) : 0;
		const next = GRAIN_CYCLE[(idx + dir + GRAIN_CYCLE.length) % GRAIN_CYCLE.length];
		if (next.grain === 'bloom') {
			config.onChange({ grainMode: 'bloom', bloomShapeMode: next.bloom ?? 'random' });
		} else {
			config.onChange({ grainMode: next.grain });
		}
	});

	playBtn?.addEventListener('click', () => config.onPlayToggle());
	clearBtn?.addEventListener('click', () => config.onClear());

	function cssVar(name: string, fallback: string): string {
		if (!canvas) return fallback;
		const value = getComputedStyle(canvas).getPropertyValue(name).trim();
		return value || fallback;
	}

	function hexToRgba(hex: string, alpha: number): string {
		const m = hex.replace('#', '');
		const raw = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
		const bigint = parseInt(raw, 16);
		if (!Number.isFinite(bigint)) return `rgba(168, 128, 192, ${alpha})`;
		const r = (bigint >> 16) & 255;
		const g = (bigint >> 8) & 255;
		const b = bigint & 255;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function resizeCanvas() {
		if (!canvas || !ctx) return;
		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(rect.width * dpr));
		const h = Math.max(1, Math.round(rect.height * dpr));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	function markerXs(markers: { timeSec: number }[], width: number, pad: number): number[] {
		if (markers.length === 0) return [];
		if (markers.length === 1) return [width / 2];
		const times = markers.map(m => m.timeSec);
		const lo = Math.min(...times);
		const hi = Math.max(...times);
		const inner = Math.max(1, width - pad * 2);
		if (hi - lo < 0.05) {
			return markers.map((_, i) => pad + (i / (markers.length - 1)) * inner);
		}
		return times.map(t => pad + ((t - lo) / (hi - lo)) * inner);
	}

	function playheadX(
		sec: number,
		markers: { timeSec: number }[],
		xs: number[],
		width: number,
		pad: number
	): number {
		if (markers.length === 0) return width / 2;
		if (markers.length === 1) return xs[0] ?? width / 2;
		const times = markers.map(m => m.timeSec);
		const lo = Math.min(...times);
		const hi = Math.max(...times);
		const inner = Math.max(1, width - pad * 2);
		if (hi - lo < 0.05) return xs[0] ?? width / 2;
		return pad + ((Math.max(lo, Math.min(hi, sec)) - lo) / (hi - lo)) * inner;
	}

	function drawTransport() {
		if (!canvas || !ctx) return;
		resizeCanvas();
		const dpr = window.devicePixelRatio || 1;
		const width = canvas.width / dpr;
		const height = canvas.height / dpr;
		ctx.clearRect(0, 0, width, height);

		const motion = cssVar('--color-motion', '#A880C0');
		const muted = cssVar('--muted', '#9E9A92');
		const visual = lastVisual;
		const source = visual?.markers.length
			? visual.markers
			: sortMarkers(lastParams?.markers ?? []).map(m => ({
				id: m.id,
				timeSec: m.timeSec,
				hold: markerHold(m),
				liveSec: m.timeSec,
				driftMs: markerDriftMs(m)
			}));

		if (source.length === 0) {
			ctx.fillStyle = muted;
			ctx.globalAlpha = 0.55;
			ctx.font = '8px "DM Mono", monospace';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText('Shift-click waveform to place markers', width / 2, height / 2);
			ctx.globalAlpha = 1;
			return;
		}

		const pad = 12;
		const xs = markerXs(source, width, pad);
		const running = !!visual?.running;
		const progress = visual?.progress ?? 0;
		const bloom = visual?.bloom ?? 0;
		const hitPulse = visual ? Math.exp(-visual.hitAge * 8) : 0;
		const barY = 6;
		const barH = 3;
		const barW = width - pad * 2;

		ctx.fillStyle = hexToRgba(motion, 0.18);
		if (typeof ctx.roundRect === 'function') {
			ctx.beginPath();
			ctx.roundRect(pad, barY, barW, barH, 1.5);
			ctx.fill();
		} else {
			ctx.fillRect(pad, barY, barW, barH);
		}

		if (running || progress > 0) {
			const fill = Math.max(0.02, progress) * barW;
			const glow = running ? 0.55 + bloom * 0.4 + hitPulse * 0.25 : 0.28;
			ctx.fillStyle = hexToRgba(motion, glow);
			if (typeof ctx.roundRect === 'function') {
				ctx.beginPath();
				ctx.roundRect(pad, barY, fill, barH, 1.5);
				ctx.fill();
			} else {
				ctx.fillRect(pad, barY, fill, barH);
			}
		}

		const pathY = height * 0.58;
		const trail = visual?.trail ?? [];
		if (trail.length >= 2) {
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			for (let i = 1; i < trail.length; i++) {
				const a = xs[trail[i - 1]];
				const b = xs[trail[i]];
				if (a == null || b == null) continue;
				ctx.strokeStyle = hexToRgba(motion, 0.12 + (i / trail.length) * 0.35);
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.moveTo(a, pathY);
				const mid = (a + b) / 2;
				ctx.quadraticCurveTo(mid, pathY - 8, b, pathY);
				ctx.stroke();
			}
		}

		source.forEach((m, i) => {
			const x = xs[i];
			if (x == null) return;
			const isPlaying = visual?.playingId === m.id;
			const hold = m.hold;
			const drifting = (m.driftMs ?? 0) > 0 && Math.abs((m.liveSec ?? m.timeSec) - m.timeSec) > 0.0005;
			const liveX = drifting
				? playheadX(m.liveSec, source, xs, width, pad)
				: x;
			const r = isPlaying ? 4.2 + hitPulse * 3 + bloom * 2.2 : (hold > 0 ? 3.2 : 2.6);
			if (drifting) {
				ctx.beginPath();
				ctx.strokeStyle = hexToRgba(motion, 0.28);
				ctx.lineWidth = 1;
				ctx.moveTo(x, pathY);
				ctx.lineTo(liveX, pathY);
				ctx.stroke();
				ctx.beginPath();
				ctx.fillStyle = hexToRgba(motion, 0.28);
				ctx.arc(x, pathY, 2, 0, Math.PI * 2);
				ctx.fill();
			}
			const drawX = drifting ? liveX : x;
			ctx.beginPath();
			ctx.fillStyle = hexToRgba(motion, isPlaying ? 0.22 + bloom * 0.25 : 0.1);
			ctx.arc(drawX, pathY, r + 4, 0, Math.PI * 2);
			ctx.fill();
			ctx.beginPath();
			ctx.fillStyle = isPlaying ? motion : hexToRgba(motion, running ? 0.7 : 0.45);
			ctx.arc(drawX, pathY, r, 0, Math.PI * 2);
			ctx.fill();
			if (isPlaying) {
				ctx.strokeStyle = hexToRgba(motion, 0.85);
				ctx.lineWidth = 1.25;
				ctx.beginPath();
				ctx.arc(drawX, pathY, r + 3.5 + hitPulse * 4, 0, Math.PI * 2);
				ctx.stroke();
			}
			if (hold > 0) {
				ctx.fillStyle = hexToRgba(motion, 0.7);
				ctx.fillRect(drawX - 1, pathY + r + 3, 2, 2 + hold * 1.1);
			}
		});

		if (visual?.playheadSec != null) {
			const px = playheadX(visual.playheadSec, source, xs, width, pad);
			ctx.fillStyle = motion;
			ctx.beginPath();
			ctx.moveTo(px, pathY - 11);
			ctx.lineTo(px + 3.5, pathY - 5);
			ctx.lineTo(px - 3.5, pathY - 5);
			ctx.closePath();
			ctx.fill();
			ctx.globalAlpha = 0.45;
			ctx.fillRect(px - 0.5, pathY - 4, 1, 10);
			ctx.globalAlpha = 1;
		}
	}

	function updateMeta() {
		if (!metaEl) return;
		const visual = lastVisual;
		const count = visual?.markers.length ?? lastParams?.markers.length ?? 0;
		if (count === 0) {
			metaEl.textContent = '';
			return;
		}
		if (!visual) {
			metaEl.textContent = `${count} mk`;
			return;
		}
		const parts: string[] = [];
		if (visual.running) parts.push('RUN');
		if (visual.playingIndex >= 0) parts.push(`${visual.playingIndex + 1}/${count}`);
		if (visual.holdLeft > 0) parts.push(`HOLD ${visual.holdLeft}`);
		if (visual.markers.some(m => m.driftMs > 0)) parts.push('DRIFT');
		if (visual.grainMode === 'bloom' && visual.bloom > 0.05) {
			parts.push(visual.bloomShape ? bloomShapeModeLabel(visual.bloomShape).toUpperCase() : 'BLOOM');
		}
		if (visual.grainMode === 'glide') parts.push('GLIDE');
		metaEl.textContent = parts.join('  ·  ');
	}

	if (canvas) {
		const ro = new ResizeObserver(() => drawTransport());
		ro.observe(canvas);
	}

	function sync(params: MarkerSeqParams) {
		lastParams = params;
		setLabel('marker-order', ORDER_LABELS[ORDER_VALUES.indexOf(params.order)] ?? 'Forward');
		setLabel('marker-rate', params.rate);
		setLabel('marker-pattern', PATTERN_LABELS[PATTERN_VALUES.indexOf(params.pattern)] ?? 'Straight');
		setLabel('marker-grain', GRAIN_CYCLE[grainChoiceIndex(params)]?.label ?? 'Cloud');
		const shapeMode = params.bloomShapeMode ?? 'random';
		syncEuclidVisibility(params.pattern);
		syncBloomVisibility(params.grainMode, shapeMode);
		syncBpmTooltip(params.rate);
		setPlaying(params.enabled);
		drawTransport();
		updateMeta();
	}

	function setPlaying(playing: boolean) {
		playBtn?.classList.toggle('active', playing);
		const val = playBtn?.closest('.param-tile')?.querySelector('.tile-value') as HTMLElement | null;
		if (val) val.textContent = playing ? '1' : '0';
	}

	function setHoldEnabled(enabled: boolean) {
		holdTile?.classList.toggle('is-disabled', !enabled);
		driftTile?.classList.toggle('is-disabled', !enabled);
		driftSpeedTile?.classList.toggle('is-disabled', !enabled);
	}

	function updateLive(visual: MarkerLaneVisual | null) {
		lastVisual = visual;
		drawTransport();
		updateMeta();
	}

	return { sync, setPlaying, setHoldEnabled, updateLive };
}
