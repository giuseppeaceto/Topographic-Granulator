import * as THREE from 'three';
import type { MarkerSurveyState, XYPad } from './XYPad';

type CornerLabels = { tl?: string; tr?: string; bl?: string; br?: string };
type CornerKey = 'tl' | 'tr' | 'bl' | 'br';

const SCENE_TILT = -0.9;
const CORNER_DEFAULTS: Record<CornerKey, number> = {
	tl: 0x7EB4D8,
	tr: 0x7EB87E,
	bl: 0xA880C0,
	br: 0xC4703A
};
const CORNER_CSS_VARS: Record<CornerKey, string> = {
	tl: '--color-granular',
	tr: '--color-effects',
	bl: '--color-motion',
	br: '--accent'
};

function parseCssHex(value: string, fallback: number): number {
	const hex = value.trim().replace('#', '');
	if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
	return fallback;
}

export function createXYPadThree(canvas: HTMLCanvasElement): XYPad {
	let pos = { x: 0.5, y: 0.5 };
	let dragging = false;
	let labels: CornerLabels = {};
	let normalSpeed = 0.15;
	let shiftSpeed = 0.05;

	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: false,
		powerPreference: 'default'
	});

	const scene = new THREE.Scene();
	const pivot = new THREE.Group();
	const terrain = new THREE.Group();
	terrain.position.set(-0.5, -0.5, 0);
	pivot.add(terrain);
	pivot.rotation.x = SCENE_TILT;
	scene.add(pivot);

	const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
	const camLook = new THREE.Vector3(0, 0, 0);
	camera.position.set(0, 0.22, 1.4);
	camera.lookAt(camLook);
	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const tmpVec3 = new THREE.Vector3();

	const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
	scene.add(ambientLight);
	const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.5);
	directionalLight1.position.set(1, 1, 1);
	scene.add(directionalLight1);
	const directionalLight2 = new THREE.DirectionalLight(0xffeedd, 0.25);
	directionalLight2.position.set(-1, -1, 0.5);
	scene.add(directionalLight2);

	const cornerColors: Record<CornerKey, THREE.Color> = {
		tl: new THREE.Color(CORNER_DEFAULTS.tl),
		tr: new THREE.Color(CORNER_DEFAULTS.tr),
		bl: new THREE.Color(CORNER_DEFAULTS.bl),
		br: new THREE.Color(CORNER_DEFAULTS.br)
	};
	const tmpColor = new THREE.Color();
	const motionColor = new THREE.Color(0xA880C0);
	const fog = new THREE.Fog(0x0C0C0B, 1.4, 8);
	scene.fog = fog;

	let cornersReady = false;
	function readThemeColors() {
		const root = getComputedStyle(document.documentElement);
		const bgRaw = root.getPropertyValue('--xy-pad-bg').trim() || root.getPropertyValue('--waveform-bg').trim();
		const bg = parseCssHex(bgRaw, 0x0C0C0B);
		renderer.setClearColor(bg, 1);
		fog.color.setHex(bg);
		(Object.keys(CORNER_CSS_VARS) as CornerKey[]).forEach((key) => {
			const raw = root.getPropertyValue(CORNER_CSS_VARS[key]);
			cornerColors[key].setHex(parseCssHex(raw, CORNER_DEFAULTS[key]));
		});
		motionColor.setHex(parseCssHex(root.getPropertyValue('--color-motion'), 0xA880C0));
		if (cornersReady) syncCornerMaterials();
	}

	readThemeColors();

	// Street grid
	const gridCols = 18;
	const gridRows = 18;
	const normPositions: Float32Array = new Float32Array(gridCols * gridRows * 2);
	for (let r = 0; r < gridRows; r++) {
		for (let c = 0; c < gridCols; c++) {
			const i = r * gridCols + c;
			normPositions[i * 2 + 0] = c / (gridCols - 1);
			normPositions[i * 2 + 1] = r / (gridRows - 1);
		}
	}

	const segments: Array<[number, number]> = [];
	for (let r = 0; r < gridRows; r++) {
		for (let c = 0; c < gridCols; c++) {
			const i = r * gridCols + c;
			if (c + 1 < gridCols) segments.push([i, r * gridCols + (c + 1)]);
			if (r + 1 < gridRows) segments.push([i, (r + 1) * gridCols + c]);
		}
	}

	let linePositions = new Float32Array(segments.length * 2 * 3);
	const lineColors = new Float32Array(segments.length * 2 * 3);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
	const material = new THREE.LineBasicMaterial({
		vertexColors: true,
		transparent: true,
		opacity: 0.9,
		fog: true
	});
	const lines = new THREE.LineSegments(geometry, material);
	terrain.add(lines);

	// City lots: 9x9 wireframe boxes, inset so streets remain visible
	const blockN = 9;
	const blockCount = blockN * blockN;
	const edgesPerBox = 12;
	const floatsPerBox = edgesPerBox * 2 * 3;
	type Lot = { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; hash: number };
	const lots: Lot[] = [];
	const lotPitch = 1 / blockN;
	const lotGap = 0.018;
	function fract(n: number) { return n - Math.floor(n); }
	for (let br = 0; br < blockN; br++) {
		for (let bc = 0; bc < blockN; bc++) {
			const x0 = bc * lotPitch + lotGap;
			const y0 = br * lotPitch + lotGap;
			const x1 = (bc + 1) * lotPitch - lotGap;
			const y1 = (br + 1) * lotPitch - lotGap;
			const i = br * blockN + bc;
			lots.push({
				x0, y0, x1, y1,
				cx: (x0 + x1) * 0.5,
				cy: (y0 + y1) * 0.5,
				hash: fract(Math.sin(i * 127.1 + 311.7) * 43758.5453)
			});
		}
	}
	const blockPositions = new Float32Array(blockCount * floatsPerBox);
	const blockColors = new Float32Array(blockCount * floatsPerBox);
	const blockGeometry = new THREE.BufferGeometry();
	blockGeometry.setAttribute('position', new THREE.BufferAttribute(blockPositions, 3));
	blockGeometry.setAttribute('color', new THREE.BufferAttribute(blockColors, 3));
	const blockMaterial = new THREE.LineBasicMaterial({
		vertexColors: true,
		transparent: true,
		opacity: 0.85,
		fog: true
	});
	const blockLines = new THREE.LineSegments(blockGeometry, blockMaterial);
	terrain.add(blockLines);

	function writeBox(
		out: Float32Array,
		offset: number,
		x0: number, y0: number, x1: number, y1: number,
		z0: number, z1: number
	) {
		const v = [
			x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
			x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1
		];
		const edges: Array<[number, number]> = [
			[0, 1], [1, 2], [2, 3], [3, 0],
			[4, 5], [5, 6], [6, 7], [7, 4],
			[0, 4], [1, 5], [2, 6], [3, 7]
		];
		let p = offset;
		for (const [a, b] of edges) {
			out[p++] = v[a * 3]; out[p++] = v[a * 3 + 1]; out[p++] = v[a * 3 + 2];
			out[p++] = v[b * 3]; out[p++] = v[b * 3 + 1]; out[p++] = v[b * 3 + 2];
		}
	}

	function writeBoxColor(out: Float32Array, offset: number, r: number, g: number, b: number) {
		for (let i = 0; i < edgesPerBox * 2; i++) {
			const p = offset + i * 3;
			out[p] = r; out[p + 1] = g; out[p + 2] = b;
		}
	}

	// Construct rain: short falling dashes, colored by the morph field — not Matrix-green
	const rainCount = 56;
	type RainDrop = { x: number; y: number; z: number; speed: number; len: number };
	const rainDrops: RainDrop[] = [];
	for (let i = 0; i < rainCount; i++) {
		rainDrops.push({
			x: Math.random(),
			y: Math.random(),
			z: Math.random() * 0.32,
			speed: 0.07 + Math.random() * 0.16,
			len: 0.028 + Math.random() * 0.045
		});
	}
	const rainPositions = new Float32Array(rainCount * 2 * 3);
	const rainColors = new Float32Array(rainCount * 2 * 3);
	const rainGeometry = new THREE.BufferGeometry();
	rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
	rainGeometry.setAttribute('color', new THREE.BufferAttribute(rainColors, 3));
	const rainMaterial = new THREE.LineBasicMaterial({
		vertexColors: true,
		transparent: true,
		opacity: 0.55,
		fog: true
	});
	const rainLines = new THREE.LineSegments(rainGeometry, rainMaterial);
	rainLines.visible = false;
	terrain.add(rainLines);

	const knobGeom = new THREE.SphereGeometry(1, 16, 16);
	const knobMat = new THREE.MeshStandardMaterial({
		color: 0xd4855a,
		metalness: 0.3,
		roughness: 0.6,
		fog: true
	});
	const knob = new THREE.Mesh(knobGeom, knobMat);
	terrain.add(knob);
	knob.scale.set(0.04, 0.04, 0.04);

	const ghostsGroup = new THREE.Group();
	terrain.add(ghostsGroup);
	const ghostMeshes: THREE.Mesh[] = [];
	const ghostMaterials: THREE.MeshStandardMaterial[] = [];
	const PAD_COLORS_HEX = [0xA1E34B, 0x66D9EF, 0xFDBC40, 0xFF7AA2, 0x7C4DFF, 0x00E5A8, 0xF06292, 0xFFD54F];
	let lastGhosts: { x: number; y: number; colorIndex: number }[] = [];

	const MARKER_MAX = 16;
	const ORBIT_PTS = 48;
	let markerSurvey: MarkerSurveyState | null = null;
	const surveyGroup = new THREE.Group();
	surveyGroup.visible = false;
	terrain.add(surveyGroup);

	const moonGeom = new THREE.SphereGeometry(0.011, 8, 6);
	const moonMats: THREE.MeshStandardMaterial[] = [];
	const moons: THREE.Mesh[] = [];
	for (let i = 0; i < MARKER_MAX; i++) {
		const mat = new THREE.MeshStandardMaterial({
			color: motionColor,
			emissive: motionColor,
			emissiveIntensity: 0.25,
			metalness: 0.2,
			roughness: 0.4,
			transparent: true,
			opacity: 0.85,
			fog: true
		});
		const moon = new THREE.Mesh(moonGeom, mat);
		moon.visible = false;
		moonMats.push(mat);
		moons.push(moon);
		surveyGroup.add(moon);
	}

	const orbitPositions = new Float32Array(ORBIT_PTS * 3);
	const orbitGeom = new THREE.BufferGeometry();
	orbitGeom.setAttribute('position', new THREE.BufferAttribute(orbitPositions, 3));
	const orbitMat = new THREE.LineBasicMaterial({
		color: motionColor,
		transparent: true,
		opacity: 0.28,
		fog: true
	});
	const orbitRing = new THREE.LineLoop(orbitGeom, orbitMat);
	surveyGroup.add(orbitRing);

	const playheadGeom = new THREE.SphereGeometry(0.015, 10, 8);
	const playheadMat = new THREE.MeshStandardMaterial({
		color: motionColor,
		emissive: motionColor,
		emissiveIntensity: 0.7,
		metalness: 0.15,
		roughness: 0.35,
		transparent: true,
		opacity: 0.95,
		fog: true
	});
	const playhead = new THREE.Mesh(playheadGeom, playheadMat);
	playhead.visible = false;
	surveyGroup.add(playhead);

	function syncSurveyMaterials() {
		orbitMat.color.copy(motionColor);
		playheadMat.color.copy(motionColor);
		playheadMat.emissive.copy(motionColor);
		moonMats.forEach((mat) => {
			mat.color.copy(motionColor);
			mat.emissive.copy(motionColor);
		});
	}

	function surveyT(sec: number, region: { start: number; end: number } | null, markers: MarkerSurveyState['markers']): number {
		let lo = region ? Math.min(region.start, region.end) : 0;
		let hi = region ? Math.max(region.start, region.end) : 1;
		if (!region && markers.length > 0) {
			lo = Math.min(...markers.map(m => m.timeSec));
			hi = Math.max(...markers.map(m => m.timeSec));
		}
		if (hi - lo < 0.0008) return 0.5;
		return Math.max(0, Math.min(1, (sec - lo) / (hi - lo)));
	}

	function hash01(id: string): number {
		let h = 2166136261;
		for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
		return (h >>> 0) / 4294967295;
	}

	function clampPad(v: number) {
		return Math.max(0.03, Math.min(0.97, v));
	}

	function orbitPoint(cx: number, cy: number, angle: number, radius: number, kx: number, ky: number) {
		const x = clampPad(cx + Math.cos(angle) * radius);
		const y = clampPad(cy + Math.sin(angle) * radius);
		const lift = 0.024 + 0.01 * Math.sin(angle * 2);
		const z = heightAt(x, y, kx, ky) + lift;
		return { x, y, z };
	}

	function layoutSurvey() {
		const kx = pos.x;
		const ky = 1 - pos.y;
		const survey = markerSurvey;
		if (!survey || survey.markers.length === 0) {
			surveyGroup.visible = false;
			playhead.visible = false;
			return;
		}
		surveyGroup.visible = true;
		const count = Math.min(MARKER_MAX, survey.markers.length);
		const hit = Math.max(0, 1 - survey.hitAge / 0.35);
		const bloom = survey.bloom;
		const spin = survey.running ? tSec * 0.42 : 0;
		const radius = 0.09 + bloom * 0.045;

		for (let i = 0; i < ORBIT_PTS; i++) {
			const a = (i / ORBIT_PTS) * Math.PI * 2 + spin;
			const p = orbitPoint(kx, ky, a, radius, kx, ky);
			orbitPositions[i * 3] = p.x;
			orbitPositions[i * 3 + 1] = p.y;
			orbitPositions[i * 3 + 2] = p.z;
		}
		const oAttr = orbitGeom.getAttribute('position') as THREE.BufferAttribute;
		oAttr.set(orbitPositions);
		oAttr.needsUpdate = true;
		orbitGeom.computeBoundingSphere();
		orbitMat.opacity = survey.running ? 0.38 : 0.22;

		for (let i = 0; i < MARKER_MAX; i++) {
			const moon = moons[i];
			const mat = moonMats[i];
			if (i >= count) {
				moon.visible = false;
				continue;
			}
			const m = survey.markers[i];
			const t = surveyT(m.liveSec, survey.region, survey.markers);
			const seed = hash01(m.id);
			const drift = m.driftMs > 0 ? 0.012 * Math.sin(tSec * (1.2 + seed * 1.8) + seed * 6) : 0;
			const angle = t * Math.PI * 2 - Math.PI / 2 + spin + drift * 4;
			const r = radius + drift + (m.id === survey.playingId ? -0.012 : seed * 0.008);
			const p = orbitPoint(kx, ky, angle, r, kx, ky);
			const active = m.id === survey.playingId;
			moon.visible = true;
			moon.position.set(p.x, p.y, p.z + (active ? 0.008 : 0));
			moon.scale.setScalar(active ? 1.45 + bloom * 0.7 + hit * 0.4 : 0.85 + seed * 0.2);
			mat.opacity = active ? 1 : (survey.running ? 0.78 : 0.62);
			mat.emissiveIntensity = active ? 0.85 + bloom * 0.8 + hit * 0.4 : 0.22;
		}

		if (survey.playheadSec != null) {
			const t = surveyT(survey.playheadSec, survey.region, survey.markers);
			const angle = t * Math.PI * 2 - Math.PI / 2 + spin;
			const p = orbitPoint(kx, ky, angle, radius, kx, ky);
			playhead.visible = true;
			playhead.position.set(p.x, p.y, p.z + 0.01);
			playhead.scale.setScalar(1.05 + bloom * 0.7 + hit * 0.35);
			playheadMat.emissiveIntensity = 0.6 + bloom * 0.9 + hit * 0.45;
		} else {
			playhead.visible = false;
		}
	}

	function markerSurveyNeedsTick() {
		if (!markerSurvey || markerSurvey.markers.length === 0) return false;
		if (markerSurvey.running) return true;
		if (markerSurvey.bloom > 0.03) return true;
		if (markerSurvey.hitAge < 0.45) return true;
		if (markerSurvey.playheadSec != null) return true;
		return false;
	}

	function setMarkerSurvey(state: MarkerSurveyState | null) {
		markerSurvey = state;
		layoutSurvey();
		if (markerSurveyNeedsTick()) ensureAnimating();
		if (!animating) renderOnce();
	}

	let reverbMix = 0;
	let filterCutoffHz = 4000;
	let cutoffCornerWeight = 0;
	let density = 15;
	let densityCornerWeight = 0;

	let bufferW = 0;
	let bufferH = 0;
	let tStart = performance.now();
	let tSec = 0;
	let rippleOX = 0.5;
	let rippleOY = 0.5;
	let rippleT0 = -100;

	const influence = 0.25;
	const influenceSq = influence * influence;

	function cornerBlend(x: number, y: number, out: THREE.Color): THREE.Color {
		const wTL = (1 - x) * y;
		const wTR = x * y;
		const wBL = (1 - x) * (1 - y);
		const wBR = x * (1 - y);
		out.r = cornerColors.tl.r * wTL + cornerColors.tr.r * wTR + cornerColors.bl.r * wBL + cornerColors.br.r * wBR;
		out.g = cornerColors.tl.g * wTL + cornerColors.tr.g * wTR + cornerColors.bl.g * wBL + cornerColors.br.g * wBR;
		out.b = cornerColors.tl.b * wTL + cornerColors.tr.b * wTR + cornerColors.bl.b * wBL + cornerColors.br.b * wBR;
		return out;
	}

	function cursorWeight(x: number, y: number, kx: number, ky: number): number {
		const dx = x - kx;
		const dy = y - ky;
		const dSq = dx * dx + dy * dy;
		return dSq < influenceSq ? 1 - Math.sqrt(dSq / influenceSq) : 0;
	}

	function densityNorm(): number {
		return Math.max(0, Math.min(1, (density - 1) / 59));
	}

	function densityIntensity(): number {
		return densityNorm() * densityCornerWeight;
	}

	function densityRelief(x: number, y: number): number {
		const intensity = densityIntensity();
		if (intensity <= 0.001) return 0;
		const freq = 0.5 + densityNorm() * 1.4;
		const pulse = Math.sin(tSec * freq * Math.PI * 2);
		const spatial = Math.sin((x + y) * Math.PI * 3 + tSec * 0.7);
		return 0.04 * intensity * (0.55 * pulse + 0.45 * spatial);
	}

	function rippleHeight(x: number, y: number): number {
		const dx = x - rippleOX;
		const dy = y - rippleOY;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const elapsed = Math.max(0, tSec - rippleT0);
		const rippleWavelength = 0.18;
		const rippleSpeed = 0.6;
		const k = (Math.PI * 2) / rippleWavelength;
		const omega = (Math.PI * 2 * rippleSpeed) / rippleWavelength;
		const phase = k * dist - omega * elapsed;
		const decay = Math.exp(-dist * 3.0) * Math.exp(-elapsed * 1.2);
		return 0.04 * Math.sin(phase) * decay;
	}

	function heightAt(x: number, y: number, kx: number, ky: number): number {
		return 0.18 * cursorWeight(x, y, kx, ky) + rippleHeight(x, y) + densityRelief(x, y);
	}

	function cutoffBoost(): number {
		const cutoffNorm = Math.max(0, Math.min(1, (filterCutoffHz - 200) / (12000 - 200)));
		return 1 + 0.35 * cutoffNorm * cutoffCornerWeight;
	}

	function updateFog() {
		const threshold = 0.15;
		const amount = reverbMix < threshold ? 0 : (reverbMix - threshold) / (1 - threshold);
		fog.near = 0.95 - amount * 0.3;
		fog.far = 3.2 - amount * 1.6;
	}

	function updateRain(dt: number) {
		const densI = densityIntensity();
		const speedMul = 0.5 + densI * 1.6 + reverbMix * 0.4;
		const bright = 0.35 + densI * 0.45;
		for (let i = 0; i < rainDrops.length; i++) {
			const drop = rainDrops[i];
			drop.z -= drop.speed * dt * speedMul;
			if (drop.z + drop.len < 0) {
				drop.x = Math.random();
				drop.y = Math.random();
				drop.z = 0.18 + Math.random() * 0.2;
				drop.speed = 0.07 + Math.random() * 0.16;
				drop.len = 0.028 + Math.random() * 0.045;
			}
			const p = i * 6;
			rainPositions[p] = drop.x;
			rainPositions[p + 1] = drop.y;
			rainPositions[p + 2] = drop.z + drop.len;
			rainPositions[p + 3] = drop.x;
			rainPositions[p + 4] = drop.y;
			rainPositions[p + 5] = drop.z;
			cornerBlend(drop.x, drop.y, tmpColor);
			rainColors[p] = tmpColor.r * bright * 0.45;
			rainColors[p + 1] = tmpColor.g * bright * 0.45;
			rainColors[p + 2] = tmpColor.b * bright * 0.45;
			rainColors[p + 3] = Math.min(1, tmpColor.r * bright);
			rainColors[p + 4] = Math.min(1, tmpColor.g * bright);
			rainColors[p + 5] = Math.min(1, tmpColor.b * bright);
		}
		const posAttr = rainGeometry.getAttribute('position') as THREE.BufferAttribute;
		posAttr.set(rainPositions);
		posAttr.needsUpdate = true;
		const colAttr = rainGeometry.getAttribute('color') as THREE.BufferAttribute;
		colAttr.set(rainColors);
		colAttr.needsUpdate = true;
		rainMaterial.opacity = 0.35 + densI * 0.35 + Math.min(0.2, reverbMix * 0.25);
	}

	function updateGhosts(positions: { x: number; y: number; colorIndex: number }[]) {
		lastGhosts = positions;
		while (ghostMeshes.length < positions.length) {
			const mat = new THREE.MeshStandardMaterial({
				color: 0xffffff,
				transparent: true,
				opacity: 0.6,
				metalness: 0.2,
				roughness: 0.2,
				fog: true
			});
			const mesh = new THREE.Mesh(knobGeom, mat);
			mesh.scale.set(0.025, 0.025, 0.025);
			ghostMeshes.push(mesh);
			ghostMaterials.push(mat);
			ghostsGroup.add(mesh);
		}
		for (let i = positions.length; i < ghostMeshes.length; i++) {
			ghostMeshes[i].visible = false;
		}
		const kx = pos.x;
		const ky = 1 - pos.y;
		for (let i = 0; i < positions.length; i++) {
			const ghost = ghostMeshes[i];
			const data = positions[i];
			ghost.visible = true;
			ghost.position.x = data.x;
			ghost.position.y = 1 - data.y;
			ghost.position.z = heightAt(data.x, 1 - data.y, kx, ky) + 0.015;
			const colorHex = PAD_COLORS_HEX[data.colorIndex % PAD_COLORS_HEX.length];
			ghostMaterials[i].color.setHex(colorHex);
			ghostMaterials[i].emissive.setHex(colorHex);
			ghostMaterials[i].emissiveIntensity = 0.4;
		}
	}

	function rebuildLinePositions() {
		linePositions = new Float32Array(segments.length * 2 * 3);
		let p = 0;
		for (let s = 0; s < segments.length; s++) {
			const [a, b] = segments[s];
			linePositions[p++] = normPositions[a * 2 + 0];
			linePositions[p++] = normPositions[a * 2 + 1];
			linePositions[p++] = 0;
			linePositions[p++] = normPositions[b * 2 + 0];
			linePositions[p++] = normPositions[b * 2 + 1];
			linePositions[p++] = 0;
		}
		const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
		posAttr.set(linePositions);
		posAttr.needsUpdate = true;
		updateColorsAndKnob();
	}

	function updateColorsAndKnob() {
		const kx = pos.x;
		const ky = 1 - pos.y;
		const boost = cutoffBoost();
		const minI = 0.22;
		const maxI = 1.0;

		const knobZ = heightAt(kx, ky, kx, ky);
		knob.position.set(kx, ky, knobZ + 0.02);
		cornerBlend(kx, ky, tmpColor);
		knobMat.color.copy(tmpColor);
		const cutoffAmt = boost - 1;
		if (cutoffAmt > 0.001) {
			knobMat.emissive.setRGB(tmpColor.r * 0.5, tmpColor.g * 0.5, tmpColor.b * 0.5);
			knobMat.emissiveIntensity = cutoffAmt * 2.2;
		} else {
			knobMat.emissive.setRGB(0, 0, 0);
			knobMat.emissiveIntensity = 0;
		}

		let c = 0;
		let p = 0;
		for (let s = 0; s < segments.length; s++) {
			const x1 = linePositions[p + 0];
			const y1 = linePositions[p + 1];
			const w1 = cursorWeight(x1, y1, kx, ky);
			const i1 = (minI + (maxI - minI) * w1) * boost;
			linePositions[p + 2] = heightAt(x1, y1, kx, ky);

			const x2 = linePositions[p + 3];
			const y2 = linePositions[p + 4];
			const w2 = cursorWeight(x2, y2, kx, ky);
			const i2 = (minI + (maxI - minI) * w2) * boost;
			linePositions[p + 5] = heightAt(x2, y2, kx, ky);

			cornerBlend(x1, y1, tmpColor);
			lineColors[c++] = Math.min(1, tmpColor.r * i1);
			lineColors[c++] = Math.min(1, tmpColor.g * i1);
			lineColors[c++] = Math.min(1, tmpColor.b * i1);
			cornerBlend(x2, y2, tmpColor);
			lineColors[c++] = Math.min(1, tmpColor.r * i2);
			lineColors[c++] = Math.min(1, tmpColor.g * i2);
			lineColors[c++] = Math.min(1, tmpColor.b * i2);
			p += 6;
		}
		const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
		posAttr.set(linePositions);
		posAttr.needsUpdate = true;
		const colAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
		colAttr.set(lineColors);
		colAttr.needsUpdate = true;

		const densI = densityIntensity();
		for (let i = 0; i < lots.length; i++) {
			const lot = lots[i];
			const localW = cursorWeight(lot.cx, lot.cy, kx, ky);
			const restH = 0.03 + lot.hash * 0.08;
			const liveH = densI * (0.06 + 0.12 * localW);
			const h = restH + liveH;
			const z0 = heightAt(lot.cx, lot.cy, kx, ky);
			writeBox(blockPositions, i * floatsPerBox, lot.x0, lot.y0, lot.x1, lot.y1, z0, z0 + h);
			cornerBlend(lot.cx, lot.cy, tmpColor);
			const li = (minI + (maxI - minI) * localW) * boost;
			writeBoxColor(blockColors, i * floatsPerBox, Math.min(1, tmpColor.r * li), Math.min(1, tmpColor.g * li), Math.min(1, tmpColor.b * li));
		}
		const bPosAttr = blockGeometry.getAttribute('position') as THREE.BufferAttribute;
		bPosAttr.set(blockPositions);
		bPosAttr.needsUpdate = true;
		const bColAttr = blockGeometry.getAttribute('color') as THREE.BufferAttribute;
		bColAttr.set(blockColors);
		bColAttr.needsUpdate = true;

		Object.values(cornerNodes).forEach((node) => {
			node.group.position.z = heightAt(node.worldPos.x, node.worldPos.y, kx, ky) + 0.03;
		});

		if (lastGhosts.length > 0) {
			for (let i = 0; i < lastGhosts.length; i++) {
				const data = lastGhosts[i];
				ghostMeshes[i].position.z = heightAt(data.x, 1 - data.y, kx, ky) + 0.015;
			}
		}

		if (markerSurvey && markerSurvey.markers.length > 0) {
			layoutSurvey();
		}

		material.opacity = 0.9;
	}

	type CornerNode = {
		key: CornerKey;
		group: THREE.Group;
		mesh: THREE.Mesh;
		lines: THREE.LineSegments;
		mat: THREE.LineBasicMaterial;
		worldPos: THREE.Vector3;
	};
	const cornersGroup = new THREE.Group();
	terrain.add(cornersGroup);
	const cornerNodes: Record<CornerKey, CornerNode> = {} as Record<CornerKey, CornerNode>;

	function createPylonGeometry(): THREE.BufferGeometry {
		const s = 0.026;
		const h = 0.078;
		const positions = new Float32Array([
			-s, -s, 0,  s, -s, 0,
			 s, -s, 0,  s,  s, 0,
			 s,  s, 0, -s,  s, 0,
			-s,  s, 0, -s, -s, 0,
			-s, -s, 0,  0,  0, h,
			 s, -s, 0,  0,  0, h,
			 s,  s, 0,  0,  0, h,
			-s,  s, 0,  0,  0, h
		]);
		const geom = new THREE.BufferGeometry();
		geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		return geom;
	}

	const pylonGeom = createPylonGeometry();
	const hitGeom = new THREE.BoxGeometry(0.07, 0.07, 0.09);
	const hitMat = new THREE.MeshBasicMaterial({
		transparent: true,
		opacity: 0,
		depthWrite: false
	});
	const cornerConfigs: Array<{ key: CornerKey; x: number; y: number }> = [
		{ key: 'tl', x: 0, y: 1 },
		{ key: 'tr', x: 1, y: 1 },
		{ key: 'bl', x: 0, y: 0 },
		{ key: 'br', x: 1, y: 0 }
	];

	cornerConfigs.forEach(({ key, x, y }) => {
		const color = cornerColors[key];
		const mat = new THREE.LineBasicMaterial({
			color: color,
			transparent: true,
			opacity: 0.9,
			fog: true
		});
		const lines = new THREE.LineSegments(pylonGeom, mat);
		const mesh = new THREE.Mesh(hitGeom, hitMat);
		mesh.position.z = 0.04;
		const group = new THREE.Group();
		group.add(lines);
		group.add(mesh);
		const worldPos = new THREE.Vector3(x, y, 0.04);
		group.position.set(x, y, 0);
		cornersGroup.add(group);
		cornerNodes[key] = { key, group, mesh, lines, mat, worldPos };
	});
	cornersReady = true;
	syncCornerMaterials();

	function syncCornerMaterials() {
		(Object.keys(cornerNodes) as CornerKey[]).forEach((key) => {
			const node = cornerNodes[key];
			if (!node) return;
			node.mat.color.copy(cornerColors[key]);
		});
	}

	const padCorners = [
		new THREE.Vector3(0, 0, 0),
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(1, 1, 0)
	];
	const ndcTmp = new THREE.Vector3();
	const viewDir = new THREE.Vector3();

	function padProjectedBounds() {
		pivot.updateMatrixWorld(true);
		camera.updateMatrixWorld(true);
		let minY = Infinity, maxY = -Infinity;
		let minX = Infinity, maxX = -Infinity;
		for (const c of padCorners) {
			ndcTmp.copy(c);
			terrain.localToWorld(ndcTmp);
			ndcTmp.project(camera);
			minY = Math.min(minY, ndcTmp.y);
			maxY = Math.max(maxY, ndcTmp.y);
			minX = Math.min(minX, ndcTmp.x);
			maxX = Math.max(maxX, ndcTmp.x);
		}
		return {
			minY, maxY,
			midY: (minY + maxY) * 0.5,
			spanY: maxY - minY,
			spanX: maxX - minX
		};
	}

	function framePad() {
		camera.position.set(0, 0.22, 1.4);
		camLook.set(0, 0, 0);
		camera.lookAt(camLook);

		for (let i = 0; i < 12; i++) {
			const bounds = padProjectedBounds();
			const fill = Math.max(bounds.spanY, bounds.spanX * 0.92);
			if (fill > 0.05) {
				const zoom = Math.max(0.65, Math.min(1.55, 1.38 / fill));
				viewDir.subVectors(camera.position, camLook);
				camera.position.copy(camLook).addScaledVector(viewDir, 1 / zoom);
			}
			camera.lookAt(camLook);
			const { midY } = padProjectedBounds();
			camera.position.y += midY * 0.4;
			camLook.y += midY * 0.4;
			camera.lookAt(camLook);
		}
	}

	function hitPadPlane(ev: PointerEvent): THREE.Vector3 | null {
		const rect = canvas.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
		ndc.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
		raycaster.setFromCamera(ndc, camera);
		const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(pivot.quaternion);
		const planePoint = terrain.localToWorld(new THREE.Vector3(0.5, 0.5, 0));
		const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);
		const hit = raycaster.ray.intersectPlane(plane, tmpVec3);
		return hit ? terrain.worldToLocal(hit.clone()) : null;
	}

	function syncBufferToCss() {
		const rect = canvas.getBoundingClientRect();
		const widthCss = Math.max(1, rect.width);
		const heightCss = Math.max(1, rect.height);
		const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
		const targetW = Math.floor(widthCss * dpr);
		const targetH = Math.floor(heightCss * dpr);
		if (targetW !== bufferW || targetH !== bufferH) {
			bufferW = targetW;
			bufferH = targetH;
			renderer.setSize(bufferW, bufferH, false);
			camera.aspect = widthCss / heightCss;
			camera.updateProjectionMatrix();
			framePad();
			rebuildLinePositions();
			renderOnce();
		}
	}

	function renderOnce() {
		syncBufferToCss();
		updateCornerAnimations();
		updateCornerSelectPositions();
		renderer.render(scene, camera);
	}

	let animId: number | null = null;
	let animating = false;
	let lastFrame = performance.now();

	function rippleAlive() {
		const elapsed = Math.max(0, tSec - rippleT0);
		return elapsed < 4.2;
	}

	function needsContinuousAnimation() {
		if (document.hidden) return false;
		if (rippleAlive()) return true;
		if (densityIntensity() > 0.001) return true;
		if (markerSurveyNeedsTick()) return true;
		return false;
	}

	function syncTime() {
		tSec = (performance.now() - tStart) / 1000;
	}

	function ensureAnimating() {
		if (animating || !needsContinuousAnimation()) return;
		animating = true;
		lastFrame = performance.now();
		rainLines.visible = true;
		animId = requestAnimationFrame(animate) as unknown as number;
	}

	function animate() {
		animId = null;
		if (!needsContinuousAnimation()) {
			animating = false;
			rainLines.visible = false;
			updateColorsAndKnob();
			renderOnce();
			return;
		}
		const now = performance.now();
		const dt = Math.min(0.05, (now - lastFrame) / 1000);
		lastFrame = now;
		tSec = (now - tStart) / 1000;
		syncBufferToCss();
		updateColorsAndKnob();
		updateRain(dt);
		updateCornerAnimations();
		updateCornerSelectPositions();
		renderer.render(scene, camera);
		animId = requestAnimationFrame(animate) as unknown as number;
		animating = true;
	}

	function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

	function setPosition(x: number, y: number) {
		const nx = clamp(x, 0, 1);
		const ny = clamp(y, 0, 1);
		const moved = Math.abs(nx - pos.x) > 0.0004 || Math.abs(ny - pos.y) > 0.0004;
		pos.x = nx;
		pos.y = ny;
		if (moved && !animating) {
			updateColorsAndKnob();
			renderOnce();
		}
		emit();
	}
	function getPosition() { return { ...pos }; }

	function setPositionSilent(x: number, y: number) {
		const nx = clamp(x, 0, 1);
		const ny = clamp(y, 0, 1);
		if (Math.abs(nx - pos.x) <= 0.0004 && Math.abs(ny - pos.y) <= 0.0004) return;
		pos.x = nx;
		pos.y = ny;
		if (!animating) {
			updateColorsAndKnob();
			renderOnce();
		}
	}

	let cornerClickCb: ((cornerKey: CornerKey, ev: PointerEvent) => void) | null = null;
	function onCornerClick(cb: (cornerKey: CornerKey, ev: PointerEvent) => void) {
		cornerClickCb = cb;
	}

	let hoveredCorner: CornerKey | null = null;

	function checkCornerHover(ev: PointerEvent): CornerKey | null {
		const rect = canvas.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
		ndc.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
		raycaster.setFromCamera(ndc, camera);

		const cornerMeshes = Object.values(cornerNodes).map(n => n.mesh);
		const intersects = raycaster.intersectObjects(cornerMeshes, false);
		if (intersects.length > 0) {
			const hitMesh = intersects[0].object;
			for (const node of Object.values(cornerNodes)) {
				if (node.mesh === hitMesh) return node.key;
			}
		}

		const local = hitPadPlane(ev);
		if (local) {
			const threshold = 0.12;
			for (const node of Object.values(cornerNodes)) {
				const dx = local.x - node.worldPos.x;
				const dy = local.y - node.worldPos.y;
				if (Math.sqrt(dx * dx + dy * dy) < threshold) return node.key;
			}
		}
		return null;
	}

	function updateCornerAnimations() {
		Object.values(cornerNodes).forEach((node) => {
			const isHovered = hoveredCorner === node.key;
			node.group.scale.setScalar(isHovered ? 1.28 : 1.0);
			node.mat.opacity = isHovered ? 1 : 0.88;
		});
	}

	function pointerToPos(ev: PointerEvent) {
		const local = hitPadPlane(ev);
		if (!local) return { x: pos.x, y: pos.y };
		return { x: clamp(local.x, 0, 1), y: clamp(1 - local.y, 0, 1) };
	}

	let pointerDownCorner: CornerKey | null = null;

	function onPointerDown(ev: PointerEvent) {
		const corner = checkCornerHover(ev);
		if (corner) {
			pointerDownCorner = corner;
			return;
		}
		pointerDownCorner = null;
		dragging = true;
		(canvas as HTMLCanvasElement & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(ev.pointerId);
		const p = pointerToPos(ev);
		setPosition(p.x, p.y);
	}

	function onPointerMove(ev: PointerEvent) {
		const corner = checkCornerHover(ev);
		if (corner !== hoveredCorner) {
			hoveredCorner = corner;
			canvas.style.cursor = corner ? 'pointer' : 'crosshair';
			renderOnce();
		}
		if (!dragging) return;
		const p = pointerToPos(ev);
		setPosition(p.x, p.y);
	}

	function onPointerUp(ev: PointerEvent) {
		if (pointerDownCorner) {
			const corner = checkCornerHover(ev);
			if (corner === pointerDownCorner) {
				cornerClickCb?.(corner, ev);
			}
			pointerDownCorner = null;
			return;
		}

		if (!dragging) return;
		dragging = false;
		(canvas as HTMLCanvasElement & { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(ev.pointerId);
		syncTime();
		rippleOX = pos.x;
		rippleOY = 1 - pos.y;
		rippleT0 = tSec;
		ensureAnimating();
	}

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointerleave', (ev) => {
		hoveredCorner = null;
		canvas.style.cursor = 'crosshair';
		onPointerUp(ev);
	});

	const kbPressed = new Set<string>();
	let kbAnimId: number | null = null;
	let kbLastTs = 0;
	let kbMoved = false;
	function kbLoop(ts: number) {
		const hasArrow = kbPressed.has('ArrowLeft') || kbPressed.has('ArrowRight') || kbPressed.has('ArrowUp') || kbPressed.has('ArrowDown');
		if (!hasArrow) { kbAnimId = null; return; }
		const dt = Math.max(0, Math.min(0.05, (ts - kbLastTs) / 1000));
		kbLastTs = ts;
		const speed = kbPressed.has('Shift') ? shiftSpeed : normalSpeed;
		let dx = 0, dy = 0;
		if (kbPressed.has('ArrowLeft')) dx -= 1;
		if (kbPressed.has('ArrowRight')) dx += 1;
		if (kbPressed.has('ArrowUp')) dy -= 1;
		if (kbPressed.has('ArrowDown')) dy += 1;
		if (dx !== 0 || dy !== 0) {
			if (dx !== 0 && dy !== 0) { const inv = 1 / Math.sqrt(2); dx *= inv; dy *= inv; }
			setPosition(pos.x + dx * speed * dt, pos.y + dy * speed * dt);
			kbMoved = true;
		}
		kbAnimId = requestAnimationFrame(kbLoop) as unknown as number;
	}
	function onKeyDown(ev: KeyboardEvent) {
		if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'Shift') {
			ev.preventDefault();
			kbPressed.add(ev.key);
			if (kbAnimId == null) {
				kbMoved = false;
				kbLastTs = performance.now();
				kbAnimId = requestAnimationFrame(kbLoop) as unknown as number;
			}
		}
	}
	function onKeyUp(ev: KeyboardEvent) {
		if (kbPressed.has(ev.key)) kbPressed.delete(ev.key);
		const hasArrow = kbPressed.has('ArrowLeft') || kbPressed.has('ArrowRight') || kbPressed.has('ArrowUp') || kbPressed.has('ArrowDown');
		if (!hasArrow && kbAnimId != null) {
			cancelAnimationFrame(kbAnimId);
			kbAnimId = null;
			if (kbMoved) {
				syncTime();
				rippleOX = pos.x;
				rippleOY = 1 - pos.y;
				rippleT0 = tSec;
				ensureAnimating();
			}
		}
	}
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);

	let cb: ((p: { x: number; y: number }) => void) | null = null;
	function onChange(f: (p: { x: number; y: number }) => void) { cb = f; }
	function emit() { cb?.(getPosition()); }

	function updateCornerSelectPositions() {
		// Corner selectors live in the legend panel
	}

	function setCornerLabels(l: CornerLabels) {
		labels = { ...labels, ...l };
		updateCornerSelectPositions();
	}

	const ro = new ResizeObserver(() => {
		syncBufferToCss();
	});
	try { ro.observe(canvas); } catch {}

	function onVisibility() {
		if (document.hidden) {
			if (animId != null) {
				cancelAnimationFrame(animId);
				animId = null;
			}
			animating = false;
			rainLines.visible = false;
			return;
		}
		ensureAnimating();
		if (!animating) renderOnce();
	}
	document.addEventListener('visibilitychange', onVisibility);

	updateFog();
	syncBufferToCss();
	updateColorsAndKnob();
	renderOnce();
	ensureAnimating();

	function setSpeed(normal: number, shift: number) {
		normalSpeed = Math.max(0.01, Math.min(2.0, normal));
		shiftSpeed = Math.max(0.01, Math.min(1.0, shift));
	}

	function setReverbMix(mix: number) {
		reverbMix = Math.max(0, Math.min(1, mix));
		updateFog();
		if (!animating) renderOnce();
	}

	function setFilterCutoff(cutoff: number, cornerWeight: number) {
		filterCutoffHz = Math.max(200, Math.min(12000, cutoff));
		cutoffCornerWeight = Math.max(0, Math.min(1, cornerWeight));
		if (!animating) {
			updateColorsAndKnob();
			renderOnce();
		}
	}

	function setDensity(dens: number, cornerWeight: number) {
		density = Math.max(1, Math.min(60, dens));
		densityCornerWeight = Math.max(0, Math.min(1, cornerWeight));
		if (densityCornerWeight > 0) {
			ensureAnimating();
		}
		if (!animating) {
			updateColorsAndKnob();
			renderOnce();
		}
	}

	function updateTheme() {
		readThemeColors();
		syncSurveyMaterials();
		updateColorsAndKnob();
		renderOnce();
	}

	function ghostsChanged(positions: { x: number; y: number; colorIndex: number }[]) {
		if (positions.length !== lastGhosts.length) return true;
		for (let i = 0; i < positions.length; i++) {
			const a = positions[i];
			const b = lastGhosts[i];
			if (a.colorIndex !== b.colorIndex) return true;
			if (Math.abs(a.x - b.x) > 0.0008 || Math.abs(a.y - b.y) > 0.0008) return true;
		}
		return false;
	}

	function setGhostPositions(positions: { x: number; y: number; colorIndex: number }[]) {
		if (!ghostsChanged(positions)) return;
		updateGhosts(positions);
		if (!animating) renderOnce();
	}

	return { setPosition, getPosition, onChange, setCornerLabels, setSpeed, setReverbMix, setFilterCutoff, setDensity, updateTheme, setPositionSilent, setGhostPositions, setMarkerSurvey, onCornerClick };
}
