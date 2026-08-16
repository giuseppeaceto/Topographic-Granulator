export type PadVisualizerSlot = {
	assigned: boolean;
	playing: boolean;
	color: string;
};

export type PadVisualizer = {
	setState: (state: {
		slots?: PadVisualizerSlot[];
		activeIndex?: number | null;
		buffer?: AudioBuffer | null;
		region?: { start: number; end: number } | null;
	}) => void;
	destroy: () => void;
};

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

function hexToRgba(hex: string, alpha: number): string {
	const m = hex.replace('#', '').trim();
	const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
	const n = parseInt(full, 16);
	if (Number.isNaN(n)) return `rgba(196, 112, 58, ${alpha})`;
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function readCss(name: string, fallback: string) {
	const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return v || fallback;
}

function resampleRegion(buffer: AudioBuffer, start: number, end: number, bins: number): Float32Array {
	const ch = buffer.getChannelData(0);
	const sr = buffer.sampleRate;
	const i0 = Math.max(0, Math.floor(start * sr));
	const i1 = Math.min(ch.length, Math.floor(end * sr));
	const peaks = new Float32Array(bins);
	const span = Math.max(1, i1 - i0);
	for (let b = 0; b < bins; b++) {
		const a = i0 + Math.floor((b * span) / bins);
		const z = i0 + Math.floor(((b + 1) * span) / bins);
		let peak = 0;
		for (let i = a; i < z; i++) {
			const v = Math.abs(ch[i] ?? 0);
			if (v > peak) peak = v;
		}
		peaks[b] = peak;
	}
	return peaks;
}

function formatTime(sec: number) {
	return sec.toFixed(2) + 's';
}

export function createPadVisualizer(canvas: HTMLCanvasElement, metaEl?: HTMLElement | null): PadVisualizer {
	const maybeCtx = canvas.getContext('2d');
	if (!maybeCtx) {
		return { setState: () => {}, destroy: () => {} };
	}
	const ctx: CanvasRenderingContext2D = maybeCtx;

	let slots: PadVisualizerSlot[] = [
		{ assigned: false, playing: false, color: '#C4703A' },
		{ assigned: false, playing: false, color: '#C4703A' },
		{ assigned: false, playing: false, color: '#C4703A' },
	];
	let activeIndex: number | null = null;
	let buffer: AudioBuffer | null = null;
	let region: { start: number; end: number } | null = null;
	let peaks: Float32Array | null = null;
	let peakKey = '';

	let hoverX = 0;
	let hoverY = 0;
	let hoverTX = 0;
	let hoverTY = 0;
	let lastTime = performance.now();
	let tSec = 0;
	let raf = 0;
	let running = false;
	let bufferW = 0;
	let bufferH = 0;
	let playPulse = [0, 0, 0];

	function rebuildPeaks() {
		const key = buffer && region
			? `${buffer.duration}:${region.start}:${region.end}:${buffer.length}`
			: '';
		if (key === peakKey) return;
		peakKey = key;
		if (!buffer || !region || region.end <= region.start) {
			peaks = null;
			return;
		}
		peaks = resampleRegion(buffer, region.start, region.end, 96);
	}

	function setState(next: {
		slots?: PadVisualizerSlot[];
		activeIndex?: number | null;
		buffer?: AudioBuffer | null;
		region?: { start: number; end: number } | null;
	}) {
		if (next.slots) slots = next.slots;
		if (next.activeIndex !== undefined) activeIndex = next.activeIndex;
		if (next.buffer !== undefined) buffer = next.buffer;
		if (next.region !== undefined) region = next.region;
		rebuildPeaks();
		updateMeta();
	}

	function updateMeta() {
		if (!metaEl) return;
		if (activeIndex == null) {
			metaEl.textContent = 'NO PAD';
			return;
		}
		const slot = slots[activeIndex];
		const label = `PAD ${activeIndex + 1}`;
		if (!slot?.assigned || !region) {
			metaEl.textContent = `${label} · EMPTY`;
			return;
		}
		metaEl.textContent = `${label} · ${formatTime(region.start)} – ${formatTime(region.end)}`;
	}

	function resize() {
		const rect = canvas.getBoundingClientRect();
		const cssW = Math.max(1, rect.width);
		const cssH = Math.max(1, rect.height);
		const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
		const w = Math.floor(cssW * dpr);
		const h = Math.floor(cssH * dpr);
		if (w === bufferW && h === bufferH) return;
		bufferW = w;
		bufferH = h;
		canvas.width = w;
		canvas.height = h;
	}

	function drawContours(w: number, h: number, color: string, assigned: boolean) {
		const muted = readCss('--muted', '#9E9A92');
		const top = h * 0.1;
		const bot = h * 0.62;
		const left = w * 0.08;
		const right = w * 0.92;
		const levels = 7;

		ctx.lineCap = 'butt';
		ctx.lineJoin = 'miter';

		if (!peaks || !assigned) {
			ctx.strokeStyle = hexToRgba(muted, 0.18);
			ctx.lineWidth = 1;
			for (let i = 0; i < 5; i++) {
				const y = top + ((bot - top) * (i + 1)) / 6;
				ctx.beginPath();
				ctx.moveTo(left, y);
				ctx.lineTo(right, y);
				ctx.stroke();
			}
			return;
		}

		let maxPeak = 0.04;
		for (let i = 0; i < peaks.length; i++) maxPeak = Math.max(maxPeak, peaks[i]);

		for (let L = 0; L < levels; L++) {
			const t = (L + 1) / (levels + 1);
			const alpha = 0.12 + t * 0.5;
			ctx.beginPath();
			for (let i = 0; i < peaks.length; i++) {
				const x = left + (i / (peaks.length - 1)) * (right - left) + hoverX * 6;
				const amp = (peaks[i] / maxPeak) * (0.25 + t * 0.75);
				const y = bot - amp * (bot - top)
					+ Math.sin(tSec * 1.4 + i * 0.08) * (assigned ? 0.6 : 0)
					+ hoverY * 4;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.strokeStyle = hexToRgba(color, alpha);
			ctx.lineWidth = L === levels - 1 ? 1.6 : 1;
			ctx.stroke();
		}
	}

	function drawPadWells(w: number, h: number) {
		const count = Math.max(1, slots.length);
		const rowY = h * 0.78;
		const well = Math.min(w * 0.16, h * 0.22);
		const gap = well * 0.45;
		const total = count * well + (count - 1) * gap;
		const x0 = (w - total) / 2;

		for (let i = 0; i < count; i++) {
			const slot = slots[i];
			const x = x0 + i * (well + gap);
			const y = rowY - well / 2;
			const active = i === activeIndex;
			const pulse = playPulse[i] ?? 0;
			const lift = (active ? 3 : 0) + pulse * 4;
			const color = slot?.color || readCss('--color-file', '#C4703A');
			const alpha = slot?.assigned ? 0.85 : 0.28;

			ctx.save();
			ctx.translate(0, -lift);
			ctx.beginPath();
			ctx.rect(x, y, well, well);
			ctx.strokeStyle = hexToRgba(color, active ? 0.95 : alpha);
			ctx.lineWidth = active ? 2 : 1;
			ctx.stroke();
			if (slot?.assigned) {
				ctx.fillStyle = hexToRgba(color, 0.08 + pulse * 0.18);
				ctx.fill();
			}
			if (active) {
				ctx.beginPath();
				ctx.rect(x + 3, y + 3, well - 6, well - 6);
				ctx.strokeStyle = hexToRgba(color, 0.45);
				ctx.lineWidth = 1;
				ctx.stroke();
			}
			ctx.restore();
		}
	}

	function render() {
		resize();
		const w = canvas.width;
		const h = canvas.height;
		if (w < 4 || h < 4) return;

		ctx.clearRect(0, 0, w, h);
		const activeColor = (activeIndex != null && slots[activeIndex]?.color)
			? slots[activeIndex].color
			: readCss('--color-file', '#C4703A');
		const assigned = activeIndex != null ? !!slots[activeIndex]?.assigned : false;
		drawContours(w, h, activeColor, assigned);
		drawPadWells(w, h);
	}

	function tick(now: number) {
		if (!running) return;
		const dt = Math.min((now - lastTime) / 1000, 0.08);
		lastTime = now;
		tSec += dt;
		hoverX += (hoverTX - hoverX) * (1 - Math.exp(-dt * 8));
		hoverY += (hoverTY - hoverY) * (1 - Math.exp(-dt * 8));
		for (let i = 0; i < slots.length; i++) {
			const target = slots[i]?.playing ? 1 : 0;
			playPulse[i] = lerp(playPulse[i] ?? 0, target, 1 - Math.exp(-dt * 8));
		}
		render();
		raf = requestAnimationFrame(tick);
	}

	function start() {
		if (running) return;
		running = true;
		lastTime = performance.now();
		raf = requestAnimationFrame(tick);
	}

	function stop() {
		running = false;
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
	}

	canvas.addEventListener('pointermove', (e) => {
		const rect = canvas.getBoundingClientRect();
		hoverTX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
		hoverTY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
	});
	canvas.addEventListener('pointerleave', () => {
		hoverTX = 0;
		hoverTY = 0;
	});

	const io = new IntersectionObserver((entries) => {
		const vis = entries.some((e) => e.isIntersecting && e.intersectionRatio > 0);
		if (vis) start();
		else stop();
	}, { threshold: 0.02 });
	io.observe(canvas);

	const ro = new ResizeObserver(() => {
		if (running) resize();
	});
	ro.observe(canvas);

	updateMeta();

	return {
		setState,
		destroy: () => {
			stop();
			io.disconnect();
			ro.disconnect();
		}
	};
}
