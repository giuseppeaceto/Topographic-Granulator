export type Logo3DOptions = {
	autoRotateIntervalMs?: number;
};

type Vec3 = { x: number; y: number; z: number };
type Proj = { x: number; y: number; z: number };

const CUBE: Vec3[] = [
	{ x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 },
	{ x: 1, y: -1, z: 1 }, { x: -1, y: -1, z: 1 },
	{ x: -1, y: 1, z: -1 }, { x: 1, y: 1, z: -1 },
	{ x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 },
];

const EDGES: [number, number][] = [
	[0, 1], [1, 2], [2, 3], [3, 0],
	[4, 5], [5, 6], [6, 7], [7, 4],
	[0, 4], [1, 5], [2, 6], [3, 7],
];

function hexToRgba(hex: string, alpha: number): string {
	const m = hex.replace('#', '').trim();
	const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
	const n = parseInt(full, 16);
	if (Number.isNaN(n)) return `rgba(196, 112, 58, ${alpha})`;
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function readCss(name: string, fallback: string) {
	const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return v || fallback;
}

export function createLogo3D(canvas: HTMLCanvasElement, _options: Logo3DOptions = {}) {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const rotY = 0.42;
	const rotX = 0.55;
	const fov = 4.2;
	let hoverX = 0;
	let hoverY = 0;
	let hoverTX = 0;
	let hoverTY = 0;
	let lastTime = performance.now();
	let animationFrameId: number | null = null;
	let bufferW = 0;
	let bufferH = 0;

	canvas.addEventListener('mousemove', (e) => {
		const rect = canvas.getBoundingClientRect();
		hoverTX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
		hoverTY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
	});
	canvas.addEventListener('mouseleave', () => {
		hoverTX = 0;
		hoverTY = 0;
	});

	function syncBuffer() {
		const rect = canvas.getBoundingClientRect();
		const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
		const w = Math.max(1, Math.round(rect.width * dpr));
		const h = Math.max(1, Math.round(rect.height * dpr));
		if (w === bufferW && h === bufferH) return;
		bufferW = w;
		bufferH = h;
		canvas.width = w;
		canvas.height = h;
	}

	function projectUnit(v: Vec3, ry: number, rx: number): Proj {
		const cY = Math.cos(ry), sY = Math.sin(ry);
		const x1 = v.x * cY + v.z * sY;
		const z1 = -v.x * sY + v.z * cY;
		const cX = Math.cos(rx), sX = Math.sin(rx);
		const y2 = v.y * cX - z1 * sX;
		const z2 = v.y * sX + z1 * cX;
		const persp = fov / (fov + z2);
		return { x: x1 * persp, y: y2 * persp, z: z2 };
	}

	function render() {
		const now = performance.now();
		const dt = Math.min((now - lastTime) / 1000, 0.1);
		lastTime = now;
		hoverX += (hoverTX - hoverX) * (1 - Math.exp(-dt * 8));
		hoverY += (hoverTY - hoverY) * (1 - Math.exp(-dt * 8));
		syncBuffer();

		const width = canvas.width;
		const height = canvas.height;
		ctx.clearRect(0, 0, width, height);

		const ry = rotY + hoverX * 0.16;
		const rx = rotX + hoverY * 0.1;
		const color = readCss('--accent', '#C4703A');
		const lineW = Math.max(1.25, Math.min(width, height) * 0.07);

		const units = CUBE.map((v) => projectUnit(v, ry, rx));
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (const p of units) {
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
		}
		const spanX = Math.max(0.001, maxX - minX);
		const spanY = Math.max(0.001, maxY - minY);
		const pad = lineW * 0.5 + 1.5;
		const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
		const ox = width * 0.5 - (minX + maxX) * 0.5 * scale;
		const oy = height * 0.5 - (minY + maxY) * 0.5 * scale;

		const proj = units.map((p) => ({ x: ox + p.x * scale, y: oy + p.y * scale, z: p.z }));
		const sorted = EDGES.map(([i1, i2]) => {
			const n1 = proj[i1];
			const n2 = proj[i2];
			return { n1, n2, z: (n1.z + n2.z) * 0.5 };
		}).sort((a, b) => a.z - b.z);

		ctx.lineCap = 'square';
		ctx.lineJoin = 'miter';
		ctx.miterLimit = 2;
		for (const { n1, n2, z } of sorted) {
			const depth = Math.max(0.4, Math.min(1, (z + 2) / 3.4));
			ctx.beginPath();
			ctx.moveTo(n1.x, n1.y);
			ctx.lineTo(n2.x, n2.y);
			ctx.strokeStyle = hexToRgba(color, 0.5 + depth * 0.45);
			ctx.lineWidth = lineW * (0.85 + depth * 0.2);
			ctx.stroke();
		}

		animationFrameId = requestAnimationFrame(render);
	}

	render();

	return {
		destroy: () => {
			if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
		},
		triggerSpin: () => {},
	};
}
