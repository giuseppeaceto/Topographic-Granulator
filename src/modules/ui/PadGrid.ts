import type { Region } from '../editor/RegionStore';

export const PAD_ICONS = [
	// 1. Activity (Pulse)
	'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
	// 2. Audio Lines
	'<path d="M12 3v18"/><path d="M8 9v6"/><path d="M4 11v2"/><path d="M16 9v6"/><path d="M20 11v2"/>',
	// 3. Layers
	'<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
	// 4. Hexagon
	'<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
	// 5. Wind
	'<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>',
	// 6. Zap
	'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
	// 7. Grid
	'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
	// 8. Disc
	'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>'
];

const PLUS_ICON = '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>';

type PadGridOptions = {
	colors?: string[];
	activeIndex?: number | null;
	maxPads?: number;
};

function svgMarkup(content: string, opacity = 0.6) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:${opacity}">${content}</svg>`;
}

export function createPadGrid(container: HTMLElement, regions: Array<Region | null>, opts: PadGridOptions = {}) {
	const pads: HTMLDivElement[] = [];
	let longPressTimer: number | null = null;
	const colors = opts.colors ?? [];
	const activeIndex = opts.activeIndex ?? null;
	const maxPads = opts.maxPads ?? Infinity;

	const callbacks: {
		onPadPress?: (index: number) => void;
		onPadLongPress?: (index: number) => void;
		onAdd?: () => void;
	} = {};

	function makeTile(kind: 'pad' | 'add' | 'locked', index: number) {
		const tile = document.createElement('div');
		const region = kind === 'pad' ? regions[index] : null;
		const isActive = kind === 'pad' && index === activeIndex;
		tile.className = 'param-tile pad-slot'
			+ (kind === 'pad' ? ' pad' : '')
			+ (region ? ' assigned' : '')
			+ (isActive ? ' active' : '')
			+ (kind === 'add' ? ' add-pad-btn' : '')
			+ (kind === 'locked' ? ' is-disabled' : '');
		tile.dataset.index = String(index);

		const visualIndex = region?.iconIndex !== undefined ? region.iconIndex : index;
		const color = colors.length ? colors[visualIndex % colors.length] : '';
		const header = `PAD ${index + 1}`;
		const value = kind === 'locked'
			? '—'
			: kind === 'add'
				? 'ADD'
				: (region?.name || (region ? 'SET' : 'EMPTY'));
		const icon = kind === 'locked'
			? ''
			: kind === 'add'
				? svgMarkup(PLUS_ICON, 0.45)
				: svgMarkup(PAD_ICONS[visualIndex % PAD_ICONS.length], region ? 0.85 : 0.4);

		tile.innerHTML = `<div class="tile-header">${header}</div><div class="pad-well">${icon}</div><div class="tile-value">${value}</div>`;

		if (color && kind === 'pad') {
			tile.style.borderColor = isActive ? color : '';
			const well = tile.querySelector('.pad-well') as HTMLElement | null;
			if (well) {
				well.style.borderColor = color;
				well.style.color = region ? color : '';
			}
			if (isActive) {
				tile.style.boxShadow = `inset 0 0 0 1px ${color}66`;
			}
		}

		if (region?.name) tile.title = region.name;
		else if (kind === 'add') tile.title = 'Add Pad';
		else if (kind === 'locked') tile.title = 'Locked slot';

		return tile;
	}

	function render() {
		const slotCount = Number.isFinite(maxPads) ? maxPads : regions.length + 1;
		for (let i = 0; i < slotCount; i++) {
			if (i < regions.length) {
				const tile = makeTile('pad', i);
				wire(tile, i);
				pads.push(tile);
				container.appendChild(tile);
			} else if (i === regions.length && regions.length < maxPads) {
				const addBtn = makeTile('add', i);
				addBtn.addEventListener('click', () => {
					if (regions.length < maxPads) callbacks.onAdd?.();
				});
				container.appendChild(addBtn);
			} else {
				container.appendChild(makeTile('locked', i));
			}
		}
	}

	function wire(pad: HTMLDivElement, index: number) {
		let pressed = false;
		let longPressed = false;
		pad.addEventListener('pointerdown', () => {
			pressed = true;
			longPressed = false;
			longPressTimer = window.setTimeout(() => {
				if (pressed) {
					longPressed = true;
					pressed = false;
					callbacks.onPadLongPress?.(index);
				}
			}, 500) as any as number;
		});
		pad.addEventListener('pointerup', () => {
			if (longPressTimer != null) { clearTimeout(longPressTimer); longPressTimer = null; }
			if (pressed && !longPressed) callbacks.onPadPress?.(index);
			pressed = false;
			longPressed = false;
		});
		pad.addEventListener('pointerleave', () => {
			if (longPressTimer != null) { clearTimeout(longPressTimer); longPressTimer = null; }
			pressed = false;
			longPressed = false;
		});
	}

	render();
	return Object.assign(callbacks, { pads });
}
