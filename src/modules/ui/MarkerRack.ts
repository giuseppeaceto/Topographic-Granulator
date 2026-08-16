import type {
	MarkerGrainMode,
	MarkerOrder,
	MarkerPattern,
	MarkerRate,
	MarkerSeqParams
} from '../editor/MarkerStore';
import { isAbsoluteRate, patternUsesGridKnobs } from '../editor/MarkerStore';

const ORDER_VALUES: MarkerOrder[] = ['forward', 'reverse', 'pingpong', 'wander', 'random', 'shuffle'];
const ORDER_LABELS = ['Forward', 'Reverse', 'PingPong', 'Wander', 'Random', 'Shuffle'];
const RATE_VALUES: MarkerRate[] = ['16s', '8s', '4s', '2/1', '1/1', '1/2', '1/4', '1/8', '1/8T', '1/16', '1/16T'];
const PATTERN_VALUES: MarkerPattern[] = ['off', 'straight', 'euclidean', 'clave', 'thue', 'burst'];
const PATTERN_LABELS = ['Off', 'Straight', 'Euclid', 'Clave', 'Thue', 'Burst'];
const GRAIN_VALUES: MarkerGrainMode[] = ['cloud', 'pulse', 'glide', 'bloom', 'stutter', 'flam'];
const GRAIN_LABELS = ['Cloud', 'Pulse', 'Glide', 'Bloom', 'Stutter', 'Flam'];

export type MarkerRack = {
	sync: (params: MarkerSeqParams) => void;
	setPlaying: (playing: boolean) => void;
	setHoldEnabled: (enabled: boolean) => void;
};

export function createMarkerRack(config: {
	onChange: (patch: Partial<MarkerSeqParams>) => void;
	onPlayToggle: () => void;
	onClear: () => void;
}): MarkerRack {
	const playBtn = document.getElementById('markerPlayBtn') as HTMLButtonElement | null;
	const clearBtn = document.getElementById('markerClearBtn') as HTMLButtonElement | null;
	const euclidRow = document.getElementById('markerEuclidRow') as HTMLElement | null;
	const holdTile = document.getElementById('markerHoldTile') as HTMLElement | null;
	const bpmKnob = document.querySelector('.knob[data-knob="marker-bpm"]') as HTMLElement | null;

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
		const label = document.querySelector('.option-selector-label[data-label="marker-grain"]')?.textContent ?? '';
		const idx = Math.max(0, GRAIN_LABELS.indexOf(label));
		const next = GRAIN_VALUES[(idx + dir + GRAIN_VALUES.length) % GRAIN_VALUES.length];
		config.onChange({ grainMode: next });
	});

	playBtn?.addEventListener('click', () => config.onPlayToggle());
	clearBtn?.addEventListener('click', () => config.onClear());

	function sync(params: MarkerSeqParams) {
		setLabel('marker-order', ORDER_LABELS[ORDER_VALUES.indexOf(params.order)] ?? 'Forward');
		setLabel('marker-rate', params.rate);
		setLabel('marker-pattern', PATTERN_LABELS[PATTERN_VALUES.indexOf(params.pattern)] ?? 'Straight');
		setLabel('marker-grain', GRAIN_LABELS[GRAIN_VALUES.indexOf(params.grainMode)] ?? 'Cloud');
		syncEuclidVisibility(params.pattern);
		syncBpmTooltip(params.rate);
		setPlaying(params.enabled);
	}

	function setPlaying(playing: boolean) {
		playBtn?.classList.toggle('active', playing);
		const val = playBtn?.closest('.param-tile')?.querySelector('.tile-value') as HTMLElement | null;
		if (val) val.textContent = playing ? '1' : '0';
	}

	function setHoldEnabled(enabled: boolean) {
		holdTile?.classList.toggle('is-disabled', !enabled);
	}

	return { sync, setPlaying, setHoldEnabled };
}
