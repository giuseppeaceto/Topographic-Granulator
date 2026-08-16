import type { Marker } from '../editor/MarkerStore';
import { MAX_MARKERS, createMarkerId, sortMarkers } from '../editor/MarkerStore';

export type WaveformSelection = { start: number; end: number };

export function createWaveformView(canvas: HTMLCanvasElement) {
	const ctx2d = canvas.getContext('2d')!;
	let buffer: AudioBuffer | null = null;
	let selection: WaveformSelection | null = null;
	let dragging = false;
	let dragStartX = 0;
	let dragMode: 'create' | 'move' | 'resize-left' | 'resize-right' | 'marker' | null = null;
	let moveOffset = 0; // seconds offset used for moving
	let selectionColor = '#a1e34b';
	let selectionFill = 'rgba(161, 227, 75, 0.18)';
	let drawScale = 1; // default scale factor
	const HANDLE_PX_DRAW = 8;
	const HANDLE_PX_HIT = 10;
	const MARKER_HIT_PX = 8;

	let markers: Marker[] = [];
	let activeMarkerId: string | null = null;
	let selectedMarkerId: string | null = null;
	let markerColor = '#C4703A';
	let regionRange: { start: number; end: number } | null = null;
	let dragMarkerId: string | null = null;

	let cachedResample: Float32Array | null = null;
	let cachedWidth = 0;
	let cachedBuffer: AudioBuffer | null = null;

	function setBuffer(b: AudioBuffer | null) {
		buffer = b;
		cachedResample = null;
		cachedBuffer = null;
		cachedWidth = 0;
		// no auto-selection: user must select first
		selection = null;
		markers = [];
		activeMarkerId = null;
		selectedMarkerId = null;
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

	function getThemeColors() {
		const root = getComputedStyle(document.documentElement);
		const isLight = document.documentElement.getAttribute('data-theme') === 'light';
		return {
			isLight,
			bg: root.getPropertyValue('--waveform-bg').trim() || (isLight ? '#FAFAF8' : '#0C0C0B'),
			muted: root.getPropertyValue('--muted').trim() || (isLight ? '#6A6660' : '#9E9A92'),
			waveformFill: isLight ? 'rgba(30, 30, 30, 0.2)' : 'rgba(179, 179, 179, 0.3)',
			waveformStroke: isLight ? '#424245' : '#b3b3b3'
		};
	}

	function draw() {
		const w = canvas.width;
		const h = canvas.height;
		ctx2d.clearRect(0, 0, w, h);
		
		const themeColors = getThemeColors();
		const isLight = themeColors.isLight;
		
		ctx2d.fillStyle = themeColors.bg;
		ctx2d.fillRect(0, 0, w, h);

		if (!buffer) {
			ctx2d.fillStyle = themeColors.muted;
			ctx2d.font = '14px Inter, sans-serif';
			ctx2d.fillText('Load an audio file…', 12, 25);
			return;
		}

		// selection overlay (drawn behind dots for better visibility of data)
		if (selection) {
			const x1 = timeToX(selection.start);
			const x2 = timeToX(selection.end);
			const sx = Math.min(x1, x2);
			const sw = Math.abs(x2 - x1);
			
			// Subtle selection background
			ctx2d.fillStyle = isLight ? 'rgba(161, 227, 75, 0.1)' : 'rgba(161, 227, 75, 0.08)';
			ctx2d.fillRect(sx, 0, sw, h);
			
			// Selection borders
			ctx2d.strokeStyle = selectionColor;
			ctx2d.lineWidth = 1;
			ctx2d.beginPath();
			ctx2d.moveTo(sx, 0);
			ctx2d.lineTo(sx, h);
			ctx2d.moveTo(sx + sw, 0);
			ctx2d.lineTo(sx + sw, h);
			ctx2d.stroke();
		}

		if (!cachedResample || cachedWidth !== w || cachedBuffer !== buffer) {
			cachedResample = resampleForDraw(buffer, w);
			cachedWidth = w;
			cachedBuffer = buffer;
		}
		const samples = cachedResample;
		const mid = h / 2;
		const verticalScale = h * 0.9 * drawScale;
		
		// Neumorphic continuous waveform with smooth curves and depth
		// Create gradient for waveform fill (vertical gradient for depth)
		const fillGradient = ctx2d.createLinearGradient(0, 0, 0, h);
		const strokeGradient = ctx2d.createLinearGradient(0, 0, 0, h);
		
		if (isLight) {
			// Light theme: subtle neumorphic gradient
			fillGradient.addColorStop(0, 'rgba(66, 66, 69, 0.12)');
			fillGradient.addColorStop(0.5, 'rgba(66, 66, 69, 0.22)');
			fillGradient.addColorStop(1, 'rgba(66, 66, 69, 0.12)');
			strokeGradient.addColorStop(0, 'rgba(66, 66, 69, 0.35)');
			strokeGradient.addColorStop(0.5, 'rgba(66, 66, 69, 0.55)');
			strokeGradient.addColorStop(1, 'rgba(66, 66, 69, 0.35)');
		} else {
			// Dark theme: brighter neumorphic gradient
			fillGradient.addColorStop(0, 'rgba(179, 179, 179, 0.18)');
			fillGradient.addColorStop(0.5, 'rgba(179, 179, 179, 0.32)');
			fillGradient.addColorStop(1, 'rgba(179, 179, 179, 0.18)');
			strokeGradient.addColorStop(0, 'rgba(179, 179, 179, 0.45)');
			strokeGradient.addColorStop(0.5, 'rgba(179, 179, 179, 0.65)');
			strokeGradient.addColorStop(1, 'rgba(179, 179, 179, 0.45)');
		}
		
		// Helper function to create smooth curve using quadratic bezier
		const drawSmoothWaveform = (samples: Float32Array, invert: boolean = false) => {
			ctx2d.beginPath();
			ctx2d.moveTo(0, mid);
			
			// Use quadratic curves for smooth waveform
			for (let x = 0; x < w; x++) {
				const amp = samples[x] || 0;
				const height = amp * verticalScale;
				const y = invert ? mid + height : mid - height;
				
				if (x === 0) {
					ctx2d.lineTo(x, y);
				} else {
					// Use previous point as control point for smooth curve
					const prevAmp = samples[Math.max(0, x - 1)] || 0;
					const prevHeight = prevAmp * verticalScale;
					const prevY = invert ? mid + prevHeight : mid - prevHeight;
					const controlX = x - 0.5;
					const controlY = (prevY + y) / 2;
					ctx2d.quadraticCurveTo(controlX, controlY, x, y);
				}
			}
			
			// Complete the path for fill
			ctx2d.lineTo(w, mid);
			ctx2d.lineTo(0, mid);
			ctx2d.closePath();
		};
		
		// Draw top waveform (positive values) with shadow
		drawSmoothWaveform(samples, false);
		
		// Draw shadow for depth (neumorphic effect)
		ctx2d.save();
		ctx2d.shadowColor = isLight ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 0, 0, 0.4)';
		ctx2d.shadowBlur = 4;
		ctx2d.shadowOffsetX = 2;
		ctx2d.shadowOffsetY = 2;
		ctx2d.fillStyle = fillGradient;
		ctx2d.fill();
		ctx2d.restore();
		
		// Draw main fill
		ctx2d.fillStyle = fillGradient;
		ctx2d.fill();
		
		// Draw top stroke with gradient
		drawSmoothWaveform(samples, false);
		ctx2d.strokeStyle = strokeGradient;
		ctx2d.lineWidth = 2;
		ctx2d.lineCap = 'round';
		ctx2d.lineJoin = 'round';
		ctx2d.stroke();
		
		// Draw bottom waveform (negative values, mirrored) with shadow
		drawSmoothWaveform(samples, true);
		
		// Draw shadow for depth
		ctx2d.save();
		ctx2d.shadowColor = isLight ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 0, 0, 0.4)';
		ctx2d.shadowBlur = 4;
		ctx2d.shadowOffsetX = 2;
		ctx2d.shadowOffsetY = -2;
		ctx2d.fillStyle = fillGradient;
		ctx2d.fill();
		ctx2d.restore();
		
		// Draw main fill
		ctx2d.fillStyle = fillGradient;
		ctx2d.fill();
		
		// Draw bottom stroke with gradient
		drawSmoothWaveform(samples, true);
		ctx2d.strokeStyle = strokeGradient;
		ctx2d.lineWidth = 2;
		ctx2d.lineCap = 'round';
		ctx2d.lineJoin = 'round';
		ctx2d.stroke();
		
		// Add subtle center line for reference (neumorphic style)
		ctx2d.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
		ctx2d.lineWidth = 1;
		ctx2d.setLineDash([2, 4]);
		ctx2d.beginPath();
		ctx2d.moveTo(0, mid);
		ctx2d.lineTo(w, mid);
		ctx2d.stroke();
		ctx2d.setLineDash([]);
		
		ctx2d.globalAlpha = 1.0;

		// Resize handles (if selection exists)
		if (selection) {
			const x1 = timeToX(selection.start);
			const x2 = timeToX(selection.end);
			const lx = Math.min(x1, x2);
			const rx = Math.max(x1, x2);
			
			ctx2d.fillStyle = selectionColor;
			// Small handle indicators at top/bottom instead of full bars to keep it clean
			const handleH = 12;
			ctx2d.fillRect(lx - 1, 0, 2, handleH);
			ctx2d.fillRect(lx - 1, h - handleH, 2, handleH);
			
			ctx2d.fillRect(rx - 1, 0, 2, handleH);
			ctx2d.fillRect(rx - 1, h - handleH, 2, handleH);
		}

		drawMarkers();
	}

	function hexToRgba(hex: string, alpha: number): string {
		const m = hex.replace('#', '');
		const bigint = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
		const r = (bigint >> 16) & 255;
		const g = (bigint >> 8) & 255;
		const b = bigint & 255;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function drawMarkers() {
		if (!buffer || markers.length === 0) return;
		const h = canvas.height;
		const themeColors = getThemeColors();
		const sorted = sortMarkers(markers);

		sorted.forEach((m, i) => {
			const x = timeToX(m.timeSec);
			const inRegion = !regionRange
				|| (m.timeSec >= Math.min(regionRange.start, regionRange.end)
					&& m.timeSec <= Math.max(regionRange.start, regionRange.end));
			const isActive = m.id === activeMarkerId;
			const isSelected = m.id === selectedMarkerId;

			ctx2d.save();
			ctx2d.globalAlpha = inRegion ? 1 : 0.32;
			ctx2d.strokeStyle = markerColor;
			ctx2d.lineWidth = isActive ? 2 : 1.25;
			ctx2d.beginPath();
			ctx2d.moveTo(x, 0);
			ctx2d.lineTo(x, h);
			ctx2d.stroke();

			const capY = 7;
			const hold = Math.max(0, m.hold ?? 0);
			const capR = isActive ? 5 : (hold > 0 ? 4.2 : 3.5);
			if (isActive) {
				ctx2d.fillStyle = hexToRgba(markerColor, 0.28);
				ctx2d.beginPath();
				ctx2d.arc(x, capY, 10, 0, Math.PI * 2);
				ctx2d.fill();
			}
			ctx2d.fillStyle = markerColor;
			ctx2d.beginPath();
			ctx2d.arc(x, capY, capR, 0, Math.PI * 2);
			ctx2d.fill();

			if (isSelected) {
				ctx2d.strokeStyle = themeColors.isLight ? '#111' : '#fff';
				ctx2d.lineWidth = 1;
				ctx2d.stroke();
			}

			ctx2d.fillStyle = markerColor;
			ctx2d.font = '8px "DM Mono", monospace';
			ctx2d.textAlign = 'center';
			ctx2d.textBaseline = 'top';
			ctx2d.fillText(String(i + 1), x, 14);

			if (hold > 0) {
				const hh = 3 + hold * 1.5;
				ctx2d.fillRect(x - 1.5, h - hh, 3, hh);
			}
			ctx2d.restore();
		});
	}

	function hitTestMarker(x: number): Marker | null {
		if (!buffer || markers.length === 0) return null;
		let best: Marker | null = null;
		let bestDist = MARKER_HIT_PX;
		for (const m of markers) {
			const dist = Math.abs(x - timeToX(m.timeSec));
			if (dist <= bestDist) {
				bestDist = dist;
				best = m;
			}
		}
		return best;
	}

	function onPointerDown(ev: PointerEvent) {
		if (!buffer) return;
		const x = getCanvasXFromEvent(ev);
		const t = xToTime(x);
		const markerHit = hitTestMarker(x);

		if (ev.altKey && markerHit) {
			markers = markers.filter(m => m.id !== markerHit.id);
			if (selectedMarkerId === markerHit.id) selectedMarkerId = null;
			if (activeMarkerId === markerHit.id) activeMarkerId = null;
			draw();
			events.onMarkersChange?.(markers);
			events.onMarkerSelect?.(selectedMarkerId);
			return;
		}

		if (ev.shiftKey && !markerHit) {
			if (markers.length >= MAX_MARKERS) return;
			const created: Marker = { id: createMarkerId(), timeSec: t };
			markers = sortMarkers([...markers, created]);
			selectedMarkerId = created.id;
			draw();
			events.onMarkersChange?.(markers);
			events.onMarkerSelect?.(created.id);
			return;
		}

		if (markerHit) {
			dragging = true;
			dragMode = 'marker';
			dragMarkerId = markerHit.id;
			selectedMarkerId = markerHit.id;
			canvas.setPointerCapture(ev.pointerId);
			canvas.style.cursor = 'ew-resize';
			draw();
			events.onMarkerSelect?.(markerHit.id);
			return;
		}

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
			if (hitTestMarker(x)) {
				canvas.style.cursor = 'ew-resize';
				return;
			}
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
			case 'marker': {
				if (!dragMarkerId || !buffer) break;
				const clamped = Math.max(0, Math.min(t, buffer.duration));
				markers = sortMarkers(markers.map(m => m.id === dragMarkerId ? { ...m, timeSec: clamped } : m));
				draw();
				events.onMarkersChange?.(markers);
				break;
			}
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
			dragMarkerId = null;
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
		onMarkersChange?: (markers: Marker[]) => void;
		onMarkerSelect?: (id: string | null) => void;
	} = {};

	return {
		setBuffer,
		setSelection,
		clearSelection,
		getSelection: () => selection,
		onSelection: (cb: (sel: WaveformSelection | null) => void) => (events.onSelection = cb),
		forceRedraw: draw,
		setScale: (scale: number) => {
			drawScale = scale;
			draw();
		},
		setColor: (stroke: string, fill?: string) => {
			selectionColor = stroke;
			selectionFill = fill ?? selectionFill;
			markerColor = stroke;
			draw();
		},
		setMarkers: (next: Marker[]) => {
			markers = sortMarkers(next);
			draw();
		},
		setActiveMarkerId: (id: string | null) => {
			activeMarkerId = id;
			draw();
		},
		setSelectedMarkerId: (id: string | null) => {
			selectedMarkerId = id;
			draw();
		},
		getSelectedMarkerId: () => selectedMarkerId,
		setRegionRange: (range: { start: number; end: number } | null) => {
			regionRange = range;
			draw();
		},
		onMarkersChange: (cb: (markers: Marker[]) => void) => (events.onMarkersChange = cb),
		onMarkerSelect: (cb: (id: string | null) => void) => (events.onMarkerSelect = cb),
		removeSelectedMarker: () => {
			if (!selectedMarkerId) return false;
			markers = markers.filter(m => m.id !== selectedMarkerId);
			selectedMarkerId = null;
			draw();
			events.onMarkersChange?.(markers);
			events.onMarkerSelect?.(null);
			return true;
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


