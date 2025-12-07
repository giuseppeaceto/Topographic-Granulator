export type XYPad = {
	setPosition: (x: number, y: number) => void; // 0..1
	setPositionSilent?: (x: number, y: number) => void; // 0..1, update visual but don't emit
	getPosition: () => { x: number; y: number };
	onChange: (cb: (pos: { x: number; y: number }) => void) => void;
	setCornerLabels: (labels: { tl?: string; tr?: string; bl?: string; br?: string }) => void;
	setSpeed?: (normal: number, shift: number) => void; // Optional method for setting keyboard speeds
	setReverbMix?: (reverbMix: number) => void; // Optional method for setting reverb mix (0..1) to control symbol count
	setFilterCutoff?: (cutoffHz: number, cornerWeight: number) => void; // Optional method for setting filter cutoff to control color tint (radial from TL corner)
	setDensity?: (density: number, cornerWeight: number) => void; // Optional method for setting density (1-60) to control grid animation (radial from TR corner)
	updateTheme?: () => void; // Optional method for updating theme colors
    setGhostPositions?: (positions: { x: number, y: number, colorIndex: number }[]) => void; // Optional method for multi-cursor visualization
};

export function createXYPad(canvas: HTMLCanvasElement): XYPad {
	const ctx = canvas.getContext('2d')!;
	let pos = { x: 0.5, y: 0.5 };
	const pad = { x: 0, y: 0, w: canvas.width, h: canvas.height };
	const knobR = 8;
	let dragging = false;
	const cornerLabels = { tl: '', tr: '', bl: '', br: '' };
	let showCornerLabels = false;

	let lastBufferW = 0;
	let lastBufferH = 0;
	function syncBufferSizeToCss() {
		// Do NOT change CSS sizes here (avoid feedback loops)
		const rect = canvas.getBoundingClientRect();
		// Rect may have height 0 if layout not settled; fallback to width
		const sideCss = Math.max(1, Math.min(rect.width, rect.height || rect.width));
		const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
		const targetW = Math.floor(sideCss * dpr);
		const targetH = Math.floor(sideCss * dpr);
		if (targetW !== lastBufferW || targetH !== lastBufferH) {
			canvas.width = targetW;
			canvas.height = targetH;
			pad.w = targetW;
			pad.h = targetH;
			lastBufferW = targetW;
			lastBufferH = targetH;
		}
	}

	function draw() {
		// Ensure the drawing buffer matches current CSS size before drawing
		syncBufferSizeToCss();
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		// background grid (grayscale)
		ctx.fillStyle = '#111111';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.strokeStyle = '#2b2b2b';
		ctx.lineWidth = 1;
		for (let i = 1; i < 4; i++) {
			const x = (canvas.width * i) / 4;
			const y = (canvas.height * i) / 4;
			ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
		}
		// corners (neutral dots)
		ctx.fillStyle = '#bdbdbd';
		const corners = [
			{ x: 0, y: 0 },
			{ x: canvas.width, y: 0 },
			{ x: 0, y: canvas.height },
			{ x: canvas.width, y: canvas.height }
		];
		for (const c of corners) {
			ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.fill();
		}
		// optional corner labels (disabled by default)
		if (showCornerLabels) {
			ctx.fillStyle = '#9aa3b2';
			ctx.font = '12px sans-serif';
			ctx.textBaseline = 'top';
			ctx.fillText(cornerLabels.tl, 6, 6);
			ctx.textAlign = 'right';
			ctx.fillText(cornerLabels.tr, canvas.width - 6, 6);
			ctx.textAlign = 'left';
			ctx.textBaseline = 'bottom';
			ctx.fillText(cornerLabels.bl, 6, canvas.height - 6);
			ctx.textAlign = 'right';
			ctx.fillText(cornerLabels.br, canvas.width - 6, canvas.height - 6);
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
		}
		// knob (neutral)
		const kx = pad.x + pos.x * pad.w;
		const ky = pad.y + pos.y * pad.h;
		ctx.fillStyle = '#d0d0d0';
		ctx.beginPath(); ctx.arc(kx, ky, knobR, 0, Math.PI * 2); ctx.fill();
		ctx.strokeStyle = '#bdbdbd';
		ctx.stroke();
	}

	function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

	function setPosition(x: number, y: number) {
		pos.x = clamp(x, 0, 1);
		pos.y = clamp(y, 0, 1);
		draw();
		emit();
	}
	function getPosition() { return { ...pos }; }

	function pointerToPos(ev: PointerEvent) {
		const rect = canvas.getBoundingClientRect();
		const scaleX = rect.width > 0 ? (canvas.width / rect.width) : 1;
		const scaleY = rect.height > 0 ? (canvas.height / rect.height) : 1;
		const x = (ev.clientX - rect.left) * scaleX;
		const y = (ev.clientY - rect.top) * scaleY;
		return { x: clamp((x - pad.x) / pad.w, 0, 1), y: clamp((y - pad.y) / pad.h, 0, 1) };
	}

	function onPointerDown(ev: PointerEvent) {
		dragging = true;
		canvas.setPointerCapture(ev.pointerId);
		const p = pointerToPos(ev);
		setPosition(p.x, p.y);
	}
	function onPointerMove(ev: PointerEvent) {
		if (!dragging) return;
		const p = pointerToPos(ev);
		setPosition(p.x, p.y);
	}
	function onPointerUp(ev: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		canvas.releasePointerCapture(ev.pointerId);
	}

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointerleave', onPointerUp);

	function onKey(ev: KeyboardEvent) {
		const step = ev.shiftKey ? 0.05 : 0.02;
		if (ev.key === 'ArrowLeft') { setPosition(pos.x - step, pos.y); }
		else if (ev.key === 'ArrowRight') { setPosition(pos.x + step, pos.y); }
		else if (ev.key === 'ArrowUp') { setPosition(pos.x, pos.y - step); }
		else if (ev.key === 'ArrowDown') { setPosition(pos.x, pos.y + step); }
	}
	window.addEventListener('keydown', onKey);

	let cb: ((p: { x: number; y: number }) => void) | null = null;
	function onChange(f: (p: { x: number; y: number }) => void) { cb = f; }
	function emit() { cb?.(getPosition()); }

	function setCornerLabels(labels: { tl?: string; tr?: string; bl?: string; br?: string }) {
		if (labels.tl != null) cornerLabels.tl = labels.tl;
		if (labels.tr != null) cornerLabels.tr = labels.tr;
		if (labels.bl != null) cornerLabels.bl = labels.bl;
		if (labels.br != null) cornerLabels.br = labels.br;
		draw();
	}

	// react to container resize to avoid stretching
	const ro = new ResizeObserver(() => {
		// First sync buffer size, then draw, without altering CSS
		syncBufferSizeToCss();
		draw();
	});
	try { ro.observe(canvas); } catch {}
	draw();
	return { setPosition, getPosition, onChange, setCornerLabels };
}


