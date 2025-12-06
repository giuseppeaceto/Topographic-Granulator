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

	const PAD_ICONS = [
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

	const callbacks: {
		onPadPress?: (index: number) => void;
		onPadLongPress?: (index: number) => void;
		onAdd?: () => void;
	} = {};

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
			if (regions[i]?.name) {
				pad.textContent = regions[i]!.name;
			} else {
				const iconContent = PAD_ICONS[i % PAD_ICONS.length];
				pad.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6">${iconContent}</svg>`;
			}
			pad.dataset.index = String(i);
			wire(pad, i);
			pads.push(pad);
			container.appendChild(pad);
		}

		// Add button
		const addBtn = document.createElement('div');
		addBtn.className = 'pad add-pad-btn';
		addBtn.title = 'Add Pad';
		addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
		addBtn.style.borderStyle = 'dashed';
		addBtn.style.opacity = '0.7';
		addBtn.addEventListener('click', () => {
			callbacks.onAdd?.();
		});
		container.appendChild(addBtn);
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

	render();
	return Object.assign(callbacks, { pads });
}


