export type WaveformSelection = { start: number; end: number };

export function createWaveformView(canvas: HTMLCanvasElement) {
	const ctx2d = canvas.getContext('2d')!;
	let buffer: AudioBuffer | null = null;
	let selection: WaveformSelection | null = null;
	let dragging = false;
	let dragStartX = 0;
	let dragMode: 'create' | 'move' | 'resize-left' | 'resize-right' | null = null;
	let moveOffset = 0; // seconds offset used for moving
	let selectionColor = '#a1e34b';
	let selectionFill = 'rgba(161, 227, 75, 0.18)';
	const HANDLE_PX_DRAW = 8;
	const HANDLE_PX_HIT = 10;

	function setBuffer(b: AudioBuffer | null) {
		buffer = b;
		// no auto-selection: user must select first
		selection = null;
		draw();
	}

	function setSelection(start: number, end: number) {
		if (!buffer) return;
		const s = Math.max(0, Math.min(start, buffer.duration));
		const e = Math.max(0, Math.min(end, buffer.duration));
		selection = { start: Math.min(s, e), end: Math.max(s, e) };
		draw();
		events.onSelection?.(selection);
	}
	function clearSelection() {
		selection = null;
		draw();
		events.onSelection?.(null as any);
	}

	function timeToX(t: number) {
		if (!buffer) return 0;
		return (t / buffer.duration) * canvas.width;
	}
	function xToTime(x: number) {
		if (!buffer) return 0;
		const clamped = Math.max(0, Math.min(x, canvas.width));
		return (clamped / canvas.width) * buffer.duration;
	}
	function getCanvasXFromEvent(ev: PointerEvent) {
		const rect = canvas.getBoundingClientRect();
		const scaleX = canvas.width / rect.width;
		return (ev.clientX - rect.left) * scaleX;
	}

	function clampSelection(start: number, end: number) {
		if (!buffer) return { start: 0, end: 0 };
		const s = Math.max(0, Math.min(start, buffer.duration));
		const e = Math.max(0, Math.min(end, buffer.duration));
		return { start: Math.min(s, e), end: Math.max(s, e) };
	}

	function draw() {
		const w = canvas.width;
		const h = canvas.height;
		ctx2d.clearRect(0, 0, w, h);
		// background
		ctx2d.fillStyle = '#0f1320';
		ctx2d.fillRect(0, 0, w, h);

		if (!buffer) {
			ctx2d.fillStyle = '#57607a';
			ctx2d.fillText('Load an audio file…', 12, 20);
			return;
		}

		// waveform (mono mix) - improved visibility with filled shape
		const samples = resampleForDraw(buffer, w);
		const mid = h / 2;
		const verticalScale = h * 0.9; // Increased from 0.45 to 0.9 for better visibility
		
		// Draw filled waveform shape for better visibility
		ctx2d.fillStyle = 'rgba(179, 179, 179, 0.3)';
		ctx2d.beginPath();
		ctx2d.moveTo(0, mid);
		for (let x = 0; x < w; x++) {
			const v = samples[x] || 0;
			const y = mid - v * verticalScale;
			ctx2d.lineTo(x, y);
		}
		ctx2d.lineTo(w, mid);
		ctx2d.closePath();
		ctx2d.fill();
		
		// Draw waveform outline
		ctx2d.strokeStyle = '#b3b3b3';
		ctx2d.lineWidth = 1.5;
		ctx2d.beginPath();
		for (let x = 0; x < w; x++) {
			const v = samples[x] || 0;
			const y = mid - v * verticalScale;
			if (x === 0) ctx2d.moveTo(x, y);
			else ctx2d.lineTo(x, y);
		}
		ctx2d.stroke();

		// selection overlay
		if (selection) {
			const x1 = timeToX(selection.start);
			const x2 = timeToX(selection.end);
			ctx2d.fillStyle = selectionFill;
			ctx2d.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), h);
			ctx2d.strokeStyle = selectionColor;
			ctx2d.lineWidth = 2;
			ctx2d.strokeRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), h);

			// resize handles
			ctx2d.fillStyle = selectionColor;
			const lx = Math.min(x1, x2);
			const rx = Math.max(x1, x2);
			ctx2d.fillRect(lx - HANDLE_PX_DRAW / 2, 0, HANDLE_PX_DRAW, h);
			ctx2d.fillRect(rx - HANDLE_PX_DRAW / 2, 0, HANDLE_PX_DRAW, h);
		}
	}

	function onPointerDown(ev: PointerEvent) {
		if (!buffer) return;
		const x = getCanvasXFromEvent(ev);
		const t = xToTime(x);

		// Determine hit area
		let overLeft = false, overRight = false, inside = false;
		if (selection) {
			const selX1 = timeToX(selection.start);
			const selX2 = timeToX(selection.end);
			const lx = Math.min(selX1, selX2);
			const rx = Math.max(selX1, selX2);
			overLeft = Math.abs(x - lx) <= HANDLE_PX_HIT;
			overRight = Math.abs(x - rx) <= HANDLE_PX_HIT;
			inside = x > lx + HANDLE_PX_HIT && x < rx - HANDLE_PX_HIT;
		}

		dragging = true;
		dragStartX = x;
		if (selection && overLeft) {
			dragMode = 'resize-left';
		} else if (selection && overRight) {
			dragMode = 'resize-right';
		} else if (selection && inside) {
			dragMode = 'move';
			moveOffset = t - selection.start;
		} else {
			dragMode = 'create';
			setSelection(t, t);
		}
		canvas.setPointerCapture(ev.pointerId);
	}
	function onPointerMove(ev: PointerEvent) {
		const x = getCanvasXFromEvent(ev);
		if (!buffer) return;

		// cursor hints when not dragging
		if (!dragging) {
			if (selection) {
				const selX1 = timeToX(selection.start);
				const selX2 = timeToX(selection.end);
				const lx = Math.min(selX1, selX2);
				const rx = Math.max(selX1, selX2);
				const overLeft = Math.abs(x - lx) <= HANDLE_PX_HIT;
				const overRight = Math.abs(x - rx) <= HANDLE_PX_HIT;
				const inside = x > lx + HANDLE_PX_HIT && x < rx - HANDLE_PX_HIT;
				if (overLeft || overRight) {
					canvas.style.cursor = 'ew-resize';
				} else if (inside) {
					canvas.style.cursor = 'grab';
				} else {
					canvas.style.cursor = 'crosshair';
				}
			} else {
				canvas.style.cursor = 'crosshair';
			}
			return;
		}

		const t = xToTime(x);
		switch (dragMode) {
			case 'create': {
				const t0 = xToTime(dragStartX);
				setSelection(t0, t);
				break;
			}
			case 'resize-left': {
				if (!selection) break;
				const { end } = selection;
				const next = clampSelection(t, end);
				selection = next;
				draw();
				events.onSelection?.(selection);
				break;
			}
			case 'resize-right': {
				if (!selection) break;
				const { start } = selection;
				const next = clampSelection(start, t);
				selection = next;
				draw();
				events.onSelection?.(selection);
				break;
			}
			case 'move': {
				if (!selection) break;
				const width = selection.end - selection.start;
				let newStart = t - moveOffset;
				let newEnd = newStart + width;
				// clamp move within buffer
				if (newStart < 0) {
					newEnd -= newStart;
					newStart = 0;
				}
				if (buffer && newEnd > buffer.duration) {
					const overflow = newEnd - buffer.duration;
					newStart -= overflow;
					newEnd = buffer.duration;
				}
				selection = clampSelection(newStart, newEnd);
				draw();
				events.onSelection?.(selection);
				break;
			}
		}
	}
	function onPointerUp(ev: PointerEvent) {
		if (!buffer) return;
		if (dragging) {
			dragging = false;
			dragMode = null;
			canvas.releasePointerCapture(ev.pointerId);
			canvas.style.cursor = 'default';
		}
	}

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointerleave', onPointerUp);

	const events: {
		onSelection?: (sel: WaveformSelection | null) => void;
	} = {};

	return {
		setBuffer,
		setSelection,
		clearSelection,
		getSelection: () => selection,
		onSelection: (cb: (sel: WaveformSelection | null) => void) => (events.onSelection = cb),
		forceRedraw: draw,
		setColor: (stroke: string, fill?: string) => {
			selectionColor = stroke;
			selectionFill = fill ?? selectionFill;
			draw();
		}
	};
}

function resampleForDraw(buffer: AudioBuffer, width: number): Float32Array {
	const out = new Float32Array(width);
	const ch0 = buffer.getChannelData(0);
	const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
	const len = ch0.length;
	const block = len / width;
	for (let i = 0; i < width; i++) {
		const start = Math.floor(i * block);
		const end = Math.floor((i + 1) * block);
		let maxPeak = 0;
		// Use peak detection instead of averaging to preserve dynamics
		for (let j = start; j < end; j++) {
			const v0 = ch0[j];
			const v1 = ch1 ? ch1[j] : v0;
			const mixed = 0.5 * (v0 + v1);
			const peak = Math.abs(mixed);
			if (peak > maxPeak) {
				maxPeak = peak;
			}
		}
		// Preserve sign by using the original sign of the peak value
		// For centered waveform display, use absolute peak value
		out[i] = maxPeak;
	}
	return out;
}


