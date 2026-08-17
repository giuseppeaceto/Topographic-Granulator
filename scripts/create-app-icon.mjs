/**
 * Renders the in-app Logo3D wireframe cube to Electron packager icons
 * (build/icon.png, build/icon.icns, build/icon.ico, public/icons/icon.png).
 */
import { deflateSync } from 'zlib';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const toIco = require('to-ico');

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const buildDir = join(root, 'build');
const publicIcon = join(root, 'public', 'icons', 'icon.png');

const CUBE = [
	{ x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 },
	{ x: 1, y: -1, z: 1 }, { x: -1, y: -1, z: 1 },
	{ x: -1, y: 1, z: -1 }, { x: 1, y: 1, z: -1 },
	{ x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 },
];
const EDGES = [
	[0, 1], [1, 2], [2, 3], [3, 0],
	[4, 5], [5, 6], [6, 7], [7, 4],
	[0, 4], [1, 5], [2, 6], [3, 7],
];

const ROT_Y = 0.42;
const ROT_X = 0.55;
const FOV = 4.2;
const ACCENT = [0xc4, 0x70, 0x3a];
const BG = [0x0c, 0x0c, 0x0b];

function projectUnit(v, ry, rx) {
	const cY = Math.cos(ry), sY = Math.sin(ry);
	const x1 = v.x * cY + v.z * sY;
	const z1 = -v.x * sY + v.z * cY;
	const cX = Math.cos(rx), sX = Math.sin(rx);
	const y2 = v.y * cX - z1 * sX;
	const z2 = v.y * sX + z1 * cX;
	const persp = FOV / (FOV + z2);
	return { x: x1 * persp, y: y2 * persp, z: z2 };
}

function crc32(buf) {
	let c = ~0;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i];
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

function pngChunk(type, data) {
	const t = Buffer.from(type);
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
	return Buffer.concat([len, t, data, crc]);
}

function encodePng(width, height, rgba) {
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (width * 4 + 1)] = 0;
		rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', deflateSync(raw, { level: 9 })),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const l2 = dx * dx + dy * dy;
	if (l2 < 1e-8) return Math.hypot(px - x1, py - y1);
	let t = ((px - x1) * dx + (py - y1) * dy) / l2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function strokeCoverage(d, halfW) {
	const aa = 0.85;
	if (d <= halfW - aa) return 1;
	if (d >= halfW + aa) return 0;
	return Math.max(0, Math.min(1, (halfW + aa - d) / (aa * 2)));
}

function renderCube(size) {
	const rgba = Buffer.alloc(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		rgba[i * 4] = BG[0];
		rgba[i * 4 + 1] = BG[1];
		rgba[i * 4 + 2] = BG[2];
		rgba[i * 4 + 3] = 255;
	}

	const units = CUBE.map((v) => projectUnit(v, ROT_Y, ROT_X));
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const p of units) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	const spanX = Math.max(0.001, maxX - minX);
	const spanY = Math.max(0.001, maxY - minY);
	const inset = size * 0.2;
	const scale = Math.min((size - inset * 2) / spanX, (size - inset * 2) / spanY);
	const ox = size * 0.5 - (minX + maxX) * 0.5 * scale;
	const oy = size * 0.5 - (minY + maxY) * 0.5 * scale;
	const proj = units.map((p) => ({ x: ox + p.x * scale, y: oy + p.y * scale, z: p.z }));

	const lineW = Math.max(size * 0.058, 2.2);

	const strokes = EDGES.map(([i1, i2]) => {
		const n1 = proj[i1];
		const n2 = proj[i2];
		const depth = Math.max(0.4, Math.min(1, (n1.z + n2.z + 4) / 6.8));
		return { n1, n2, depth, z: (n1.z + n2.z) * 0.5 };
	}).sort((a, b) => a.z - b.z);

	const pad = Math.ceil(lineW + 3);
	for (const { n1, n2, depth } of strokes) {
		const x0 = Math.max(0, Math.floor(Math.min(n1.x, n2.x) - pad));
		const y0 = Math.max(0, Math.floor(Math.min(n1.y, n2.y) - pad));
		const x1 = Math.min(size - 1, Math.ceil(Math.max(n1.x, n2.x) + pad));
		const y1 = Math.min(size - 1, Math.ceil(Math.max(n1.y, n2.y) + pad));
		const halfCore = (lineW * (0.85 + depth * 0.2)) * 0.5;
		const coreA = 0.55 + depth * 0.45;

		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const d = distToSegment(x + 0.5, y + 0.5, n1.x, n1.y, n2.x, n2.y);
				const a = strokeCoverage(d, halfCore) * coreA;
				if (a <= 0.002) continue;
				const i = (y * size + x) * 4;
				const srcA = a;
				const dstA = rgba[i + 3] / 255;
				const outA = srcA + dstA * (1 - srcA);
				const mix = (ch, dst) => Math.round((ch * srcA + dst * dstA * (1 - srcA)) / outA);
				rgba[i] = mix(ACCENT[0], rgba[i]);
				rgba[i + 1] = mix(ACCENT[1], rgba[i + 1]);
				rgba[i + 2] = mix(ACCENT[2], rgba[i + 2]);
				rgba[i + 3] = Math.round(outA * 255);
			}
		}
	}

	applySquircleMask(rgba, size);
	return rgba;
}

/** macOS Big Sur+ dock mask: superellipse (n≈5), transparent outside. */
function applySquircleMask(rgba, size, n = 5) {
	const rx = size * 0.5 - 0.5;
	const ry = size * 0.5 - 0.5;
	const cx = size * 0.5;
	const cy = size * 0.5;
	const aa = 1.15 / rx;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const nx = (x + 0.5 - cx) / rx;
			const ny = (y + 0.5 - cy) / ry;
			const f = Math.pow(Math.abs(nx), n) + Math.pow(Math.abs(ny), n);
			let cover = 1;
			if (f >= 1 + aa) cover = 0;
			else if (f > 1 - aa) cover = (1 + aa - f) / (aa * 2);
			if (cover >= 0.999) continue;
			const i = (y * size + x) * 4;
			rgba[i + 3] = Math.round(rgba[i + 3] * cover);
			if (cover <= 0.002) {
				rgba[i] = 0;
				rgba[i + 1] = 0;
				rgba[i + 2] = 0;
				rgba[i + 3] = 0;
			}
		}
	}
}

function boxDownscale(src, srcSize, dstSize) {
	const dst = Buffer.alloc(dstSize * dstSize * 4);
	const scale = srcSize / dstSize;
	for (let y = 0; y < dstSize; y++) {
		for (let x = 0; x < dstSize; x++) {
			const x0 = Math.floor(x * scale);
			const y0 = Math.floor(y * scale);
			const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
			const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
			let r = 0, g = 0, b = 0, a = 0, n = 0;
			for (let sy = y0; sy < y1; sy++) {
				for (let sx = x0; sx < x1; sx++) {
					const i = (sy * srcSize + sx) * 4;
					r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
					n++;
				}
			}
			const di = (y * dstSize + x) * 4;
			dst[di] = Math.round(r / n);
			dst[di + 1] = Math.round(g / n);
			dst[di + 2] = Math.round(b / n);
			dst[di + 3] = Math.round(a / n);
		}
	}
	return dst;
}

function writePngFile(path, size, rgba) {
	writeFileSync(path, encodePng(size, size, rgba));
}

const MASTER = 1024;
const SSAA = 2;
console.log(`Rendering ${MASTER * SSAA}px cube…`);
const hi = renderCube(MASTER * SSAA);
const master = boxDownscale(hi, MASTER * SSAA, MASTER);

mkdirSync(buildDir, { recursive: true });
mkdirSync(join(root, 'public', 'icons'), { recursive: true });

const masterPng = join(buildDir, 'icon.png');
writePngFile(masterPng, MASTER, master);
execSync(`sips -s format png "${masterPng}" --out "${masterPng}"`, { stdio: 'pipe' });
writeFileSync(publicIcon, readFileSync(masterPng));
console.log(`Wrote ${masterPng}`);
console.log(`Wrote ${publicIcon}`);

const iconset = join(buildDir, 'icon.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

const icnsMap = [
	['icon_16x16.png', 16],
	['icon_16x16@2x.png', 32],
	['icon_32x32.png', 32],
	['icon_32x32@2x.png', 64],
	['icon_128x128.png', 128],
	['icon_128x128@2x.png', 256],
	['icon_256x256.png', 256],
	['icon_256x256@2x.png', 512],
	['icon_512x512.png', 512],
	['icon_512x512@2x.png', 1024],
];

const cache = new Map([[MASTER, master]]);
function rgbaAt(size) {
	if (cache.has(size)) return cache.get(size);
	const buf = boxDownscale(master, MASTER, size);
	cache.set(size, buf);
	return buf;
}

for (const [name, size] of icnsMap) {
	const out = join(iconset, name);
	writePngFile(out, size, rgbaAt(size));
	execSync(`sips -s format png "${out}" --out "${out}"`, { stdio: 'pipe' });
}

const icnsPath = join(buildDir, 'icon.icns');
execSync(`iconutil -c icns "${iconset}" -o "${icnsPath}"`, { stdio: 'inherit' });
rmSync(iconset, { recursive: true, force: true });
console.log(`Wrote ${icnsPath}`);

const icoSizes = [16, 32, 48, 256];
const icoBufs = icoSizes.map((size) => encodePng(size, size, rgbaAt(size)));
const icoPath = join(buildDir, 'icon.ico');
writeFileSync(icoPath, await toIco(icoBufs));
console.log(`Wrote ${icoPath}`);

console.log('App icons updated from Logo3D cube.');
