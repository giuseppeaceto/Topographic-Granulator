import type { EffectsParams } from '../effects/EffectsChain';
import { defaultEffects } from '../editor/PadParamStore';

export type FxVisualizer = {
	setParams: (p: Partial<EffectsParams>) => void;
	destroy: () => void;
};

type Vec3 = { x: number; y: number; z: number };
type Proj = { x: number; y: number; z: number; scale: number };

const BOX_EDGES: [number, number][] = [
	[0, 1], [1, 2], [2, 3], [3, 0],
	[4, 5], [5, 6], [6, 7], [7, 4],
	[0, 4], [1, 5], [2, 6], [3, 7],
];

const RAIN_COUNT = 28;

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

function clamp01(v: number) {
	return Math.max(0, Math.min(1, v));
}

function logCutoff(hz: number) {
	const min = Math.log(200);
	const max = Math.log(12000);
	return clamp01((Math.log(Math.max(200, hz)) - min) / (max - min));
}

function rotateY(v: Vec3, a: number): Vec3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

function rotateX(v: Vec3, a: number): Vec3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

function add(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function hexToRgba(hex: string, alpha: number): string {
	const m = hex.replace('#', '').trim();
	const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
	const n = parseInt(full, 16);
	if (Number.isNaN(n)) return `rgba(126, 184, 126, ${alpha})`;
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function readCss(name: string, fallback: string) {
	const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return v || fallback;
}

function boxVerts(cx: number, y0: number, cz: number, sx: number, h: number, sz: number): Vec3[] {
	const x0 = cx - sx;
	const x1 = cx + sx;
	const y1 = y0 + h;
	const z0 = cz - sz;
	const z1 = cz + sz;
	return [
		{ x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 },
		{ x: x1, y: y0, z: z1 }, { x: x0, y: y0, z: z1 },
		{ x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 },
		{ x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 },
	];
}

function streetLines(cols: number, rows: number, size: number, y: number): Array<[Vec3, Vec3]> {
	const lines: Array<[Vec3, Vec3]> = [];
	const x0 = -size;
	const z0 = -size * 0.85;
	const x1 = size;
	const z1 = size * 0.85;
	for (let c = 0; c <= cols; c++) {
		const t = c / cols;
		const x = x0 + (x1 - x0) * t;
		lines.push([{ x, y, z: z0 }, { x, y, z: z1 }]);
	}
	for (let r = 0; r <= rows; r++) {
		const t = r / rows;
		const z = z0 + (z1 - z0) * t;
		lines.push([{ x: x0, y, z }, { x: x1, y, z }]);
	}
	return lines;
}

type RainDrop = { x: number; y: number; z: number; speed: number; len: number };

function seedRain(): RainDrop[] {
	return Array.from({ length: RAIN_COUNT }, (_, i) => ({
		x: ((i * 0.618) % 1) * 2.2 - 1.1,
		y: ((i * 0.37) % 1) * 1.4 - 0.2,
		z: ((i * 0.754) % 1) * 2 - 1,
		speed: 0.18 + (i % 5) * 0.07,
		len: 0.08 + (i % 4) * 0.03
	}));
}

export function createFxVisualizer(canvas: HTMLCanvasElement): FxVisualizer {
	const maybeCtx = canvas.getContext('2d');
	if (!maybeCtx) {
		return { setParams: () => {}, destroy: () => {} };
	}
	const ctx: CanvasRenderingContext2D = maybeCtx;

	let target = defaultEffects();
	let shown = { ...target };
	const rotY = 0.38;
	const rotX = 0.78;
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
	const rain = seedRain();

	function setParams(p: Partial<EffectsParams>) {
		target = { ...target, ...p };
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

	function project(v: Vec3, cx: number, cy: number, radius: number, fov: number): Proj {
		const ry = rotateY(v, rotY + hoverX * 0.18);
		const rx = rotateX(ry, rotX + hoverY * 0.14);
		const persp = fov / (fov + rx.z);
		return {
			x: cx + rx.x * radius * persp,
			y: cy + rx.y * radius * persp,
			z: rx.z,
			scale: persp,
		};
	}

	function strokeSeg(
		a: Proj,
		b: Proj,
		color: string,
		alpha: number,
		width: number,
		fog: number,
	) {
		const depth = clamp01(((a.z + b.z) * 0.5 + 2.4) / 4.6);
		const fade = alpha * (0.28 + depth * 0.72) * (1 - fog * (1 - depth) * 0.85);
		if (fade < 0.02) return;
		ctx.beginPath();
		ctx.moveTo(a.x, a.y);
		ctx.lineTo(b.x, b.y);
		ctx.strokeStyle = hexToRgba(color, fade);
		ctx.lineWidth = width * (0.75 + depth * 0.5);
		ctx.lineCap = 'butt';
		ctx.lineJoin = 'miter';
		ctx.stroke();
	}

	function drawBox(verts: Vec3[], color: string, alpha: number, width: number, fog: number, cx: number, cy: number, radius: number, fov: number) {
		const proj = verts.map((v) => project(v, cx, cy, radius, fov));
		const sorted = BOX_EDGES.map(([i1, i2]) => {
			const n1 = proj[i1];
			const n2 = proj[i2];
			return { n1, n2, z: (n1.z + n2.z) * 0.5 };
		}).sort((a, b) => a.z - b.z);
		for (const { n1, n2 } of sorted) {
			strokeSeg(n1, n2, color, alpha, width, fog);
		}
	}

	function tick(now: number) {
		if (!running) return;
		const dt = Math.min((now - lastTime) / 1000, 0.08);
		lastTime = now;
		tSec += dt;
		hoverX += (hoverTX - hoverX) * (1 - Math.exp(-dt * 8));
		hoverY += (hoverTY - hoverY) * (1 - Math.exp(-dt * 8));

		const k = 1 - Math.exp(-dt * 9);
		shown.filterCutoffHz = lerp(shown.filterCutoffHz, target.filterCutoffHz, k);
		shown.filterQ = lerp(shown.filterQ ?? 0.707, target.filterQ ?? 0.707, k);
		shown.delayTimeSec = lerp(shown.delayTimeSec, target.delayTimeSec, k);
		shown.delayMix = lerp(shown.delayMix, target.delayMix, k);
		shown.delayFeedback = lerp(shown.delayFeedback ?? 0.3, target.delayFeedback ?? 0.3, k);
		shown.reverbMix = lerp(shown.reverbMix, target.reverbMix, k);
		shown.masterGain = lerp(shown.masterGain, target.masterGain, k);
		shown.reverbRoom = lerp(shown.reverbRoom ?? 0.5, target.reverbRoom ?? 0.5, k);

		const reverb = shown.reverbMix;
		const speed = 0.35 + reverb * 0.9;
		for (const drop of rain) {
			drop.y -= drop.speed * dt * speed;
			if (drop.y < -0.85) {
				drop.y = 0.75 + Math.random() * 0.25;
				drop.x = Math.random() * 2.2 - 1.1;
				drop.z = Math.random() * 2 - 1;
			}
		}

		render();
		raf = requestAnimationFrame(tick);
	}

	function render() {
		resize();
		const w = canvas.width;
		const h = canvas.height;
		if (w < 4 || h < 4) return;

		ctx.clearRect(0, 0, w, h);
		const cx = w * 0.5;
		const cy = h * 0.54;
		const radius = Math.min(w, h) * 0.42;
		const fov = 3.4;

		const cutoff = logCutoff(shown.filterCutoffHz);
		const q = shown.filterQ ?? 0.707;
		const delayT = shown.delayTimeSec;
		const delayMix = shown.delayMix;
		const feedback = shown.delayFeedback ?? 0.3;
		const reverb = shown.reverbMix;
		const roomAmt = shown.reverbRoom ?? 0.5;
		const gain = clamp01(shown.masterGain / 1.5);
		const fog = Math.max(0, (reverb - 0.12) / 0.88);

		const fxColor = readCss('--color-effects', '#7EB87E');
		const streetColor = readCss('--muted', '#9E9A92');
		const groundY = -0.62;

		const streets = streetLines(6, 5, 1.05 + roomAmt * 0.12, groundY);
		const streetProj = streets.map(([a, b]) => ({
			a: project(a, cx, cy, radius, fov),
			b: project(b, cx, cy, radius, fov),
			z: 0,
		}));
		for (const s of streetProj) s.z = (s.a.z + s.b.z) * 0.5;
		streetProj.sort((a, b) => a.z - b.z);
		for (const s of streetProj) {
			strokeSeg(s.a, s.b, streetColor, 0.22 + cutoff * 0.18, 1, fog * 0.7);
		}

		const roomH = 0.72 + roomAmt * 0.28 + reverb * 0.22;
		const roomS = 0.92 + roomAmt * 0.22 + reverb * 0.28;
		drawBox(
			boxVerts(0, groundY, 0, roomS, roomH, roomS * 0.88),
			fxColor,
			0.16 + reverb * 0.38,
			1.05,
			fog,
			cx, cy, radius, fov
		);
		if (reverb > 0.08) {
			drawBox(
				boxVerts(0, groundY, 0, roomS * 1.08, roomH * 1.06, roomS * 0.95),
				fxColor,
				reverb * 0.14,
				0.7,
				fog * 1.15,
				cx, cy, radius, fov
			);
		}

		const qAmt = Math.min(1, Math.max(0, (q - 0.5) / 12));
		const pulse = qAmt > 0.01
			? 1 + Math.sin(tSec * (2.4 + qAmt * 6)) * qAmt * 0.12
			: 1;
		const srcH = (0.22 + gain * 0.16) * pulse * (0.85 + cutoff * 0.2);
		const srcS = 0.18 + gain * 0.04;

		const ghostCount = delayMix < 0.02 ? 0 : 2 + Math.round(feedback * 2);
		for (let g = ghostCount; g >= 1; g--) {
			const lag = delayT * g * 0.95;
			const fade = (0.12 + delayMix * 0.5) / g * (0.65 + feedback * 0.35);
			drawBox(
				boxVerts(0.08 * g, groundY, -0.42 - lag * 0.85, srcS * (1 - g * 0.08), srcH * (1 - g * 0.1), srcS * (1 - g * 0.08)),
				fxColor,
				fade,
				0.9,
				fog,
				cx, cy, radius, fov
			);
		}

		drawBox(
			boxVerts(0, groundY, 0.12, srcS, srcH, srcS),
			fxColor,
			0.42 + gain * 0.5,
			1.15 + gain * 0.6,
			fog * 0.4,
			cx, cy, radius, fov
		);

		if (reverb > 0.05) {
			const rainAlpha = 0.12 + reverb * 0.38;
			for (const drop of rain) {
				const a = project({ x: drop.x, y: drop.y + drop.len, z: drop.z }, cx, cy, radius, fov);
				const b = project({ x: drop.x, y: drop.y, z: drop.z }, cx, cy, radius, fov);
				strokeSeg(a, b, fxColor, rainAlpha, 0.85, fog);
			}
		}
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

	return {
		setParams,
		destroy: () => {
			stop();
			io.disconnect();
			ro.disconnect();
		},
	};
}
