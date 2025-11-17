import type { Region } from '../editor/RegionStore';

type PadGridOptions = {
	colors?: string[];
	activeIndex?: number | null;
};

export function createPadGrid(container: HTMLElement, regions: Array<Region | null>, opts: PadGridOptions = {}) {
	const pads: HTMLDivElement[] = [];
	let longPressTimer: number | null = null;
	const colors = opts.colors ?? [];
	const activeIndex = opts.activeIndex ?? null;

	function render() {
		for (let i = 0; i < regions.length; i++) {
			const pad = document.createElement('div');
			pad.className = 'pad' + (regions[i] ? ' assigned' : '') + (i === activeIndex ? ' active' : '');
			const color = colors[i % colors.length] || '';
			if (color) {
				pad.style.borderColor = color;
				pad.style.color = regions[i] ? color : pad.style.color;
				pad.style.boxShadow = i === activeIndex ? `0 0 0 2px ${color}66 inset` : '';
			}
			pad.textContent = regions[i]?.name || `Pad ${i + 1}`;
			pad.dataset.index = String(i);
			wire(pad, i);
			pads.push(pad);
			container.appendChild(pad);
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
					// prevent subsequent short press on release
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

	const callbacks: {
		onPadPress?: (index: number) => void;
		onPadLongPress?: (index: number) => void;
	} = {};

	render();
	return Object.assign(callbacks, { pads });
}


