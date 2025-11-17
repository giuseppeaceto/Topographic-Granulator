import * as THREE from 'three';
import type { XYPad } from './XYPad';

type CornerLabels = { tl?: string; tr?: string; bl?: string; br?: string };

export function createXYPadThree(canvas: HTMLCanvasElement): XYPad {
	// Internal normalized position (0..1)
	let pos = { x: 0.5, y: 0.5 };
	let dragging = false;
	let labels: CornerLabels = {};

	// Three.js renderer with the provided canvas
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: false,
		powerPreference: 'high-performance'
	});
	renderer.setClearColor(0x111111, 1);

	// Scene and camera (perspective for 3D wireframe look)
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
	camera.position.set(0.5, 0.6, 1.6);
	camera.lookAt(0.5, 0.5, 0);
	// lift the whole scene slightly to better center inside the square box
	scene.position.y = 0.2;
	// enlarge slightly
	scene.scale.set(1.12, 1.12, 1);

	// Wireframe grid geometry
	const gridCols = 18;
	const gridRows = 18;
	const totalPoints = gridCols * gridRows;
	const normPositions: Float32Array = new Float32Array(totalPoints * 2); // x,y in 0..1

	// Build normalized grid positions
	for (let r = 0; r < gridRows; r++) {
		for (let c = 0; c < gridCols; c++) {
			const i = r * gridCols + c;
			const x = c / (gridCols - 1);
			const y = r / (gridRows - 1);
			normPositions[i * 2 + 0] = x;
			normPositions[i * 2 + 1] = y;
		}
	}

	// Create line segments between right and bottom neighbors to avoid dupes
	const segments: Array<[number, number]> = [];
	for (let r = 0; r < gridRows; r++) {
		for (let c = 0; c < gridCols; c++) {
			const i = r * gridCols + c;
			if (c + 1 < gridCols) {
				const j = r * gridCols + (c + 1);
				segments.push([i, j]);
			}
			if (r + 1 < gridRows) {
				const j = (r + 1) * gridCols + c;
				segments.push([i, j]);
			}
		}
	}

	// Position buffer (world units 0..1 in x/y) and color buffer
	let linePositions = new Float32Array(segments.length * 2 * 3); // 3D coords
	const lineColors = new Float32Array(segments.length * 2 * 3); // RGB

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

	const material = new THREE.LineBasicMaterial({
		vertexColors: true,
		transparent: true,
		opacity: 1,
		linewidth: 1 // note: ignored on most platforms, but we keep it for completeness
	});

	const lines = new THREE.LineSegments(geometry, material);
	scene.add(lines);

	// Knob (small circle) rendered above the grid
	const knobGeom = new THREE.CircleGeometry(6, 32);
	const knobMat = new THREE.MeshBasicMaterial({ color: 0xd0d0d0 });
	const knob = new THREE.Mesh(knobGeom, knobMat);
	scene.add(knob);
	knob.scale.set(0.002, 0.002, 0.002); // scale to world units (since geometry is in px)
	knob.position.z = 0.02;

	let bufferW = 0;
	let bufferH = 0;
	let tStart = performance.now();
	let tSec = 0;
	// Ripple state (updated on each setPosition)
	let rippleOX = 0.5;
	let rippleOY = 0.5;
	let rippleT0 = 0; // seconds
	function syncBufferToCss() {
		const rect = canvas.getBoundingClientRect();
		const sideCss = Math.max(1, Math.min(rect.width, rect.height || rect.width));
		const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
		const target = Math.floor(sideCss * dpr);
		if (target !== bufferW || target !== bufferH) {
			bufferW = target;
			bufferH = target;
			renderer.setSize(bufferW, bufferH, false);
			// update camera aspect
			camera.aspect = 1; // canvas è quadrato
			camera.updateProjectionMatrix();
			rebuildLinePositions();
			renderOnce();
		}
	}

	function rebuildLinePositions() {
		linePositions = new Float32Array(segments.length * 2 * 3);
		let p = 0;
		for (let s = 0; s < segments.length; s++) {
			const [a, b] = segments[s];
			const ax = normPositions[a * 2 + 0];
			const ay = normPositions[a * 2 + 1];
			const bx = normPositions[b * 2 + 0];
			const by = normPositions[b * 2 + 1];
			linePositions[p++] = ax; linePositions[p++] = ay; linePositions[p++] = 0;
			linePositions[p++] = bx; linePositions[p++] = by; linePositions[p++] = 0;
		}
		const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
		posAttr.set(linePositions);
		posAttr.needsUpdate = true;
		updateColorsAndKnob();
	}

	function updateColorsAndKnob() {
		// knob position (world units)
		const kx = pos.x;
		const ky = 1 - pos.y; // invert Y so mouse direction matches screen space
		knob.position.x = kx;
		knob.position.y = ky;

		// attenuation radii
		const influence = 0.25; // in world units
		const influenceSq = influence * influence;

		// base terrain ("montagne") parameters
		const mountainAmp = 0.14;
		const freq1 = 8.0;
		const freq2 = 13.0;
		function baseHeight(x: number, y: number): number {
			// simple pseudo-fractal waves; centered to [0,1]
			const w1 = Math.sin((x) * Math.PI * 2 * (freq1 / 10)) * 0.5 + 0.5;
			const w2 = Math.sin((y) * Math.PI * 2 * (freq1 / 10)) * 0.5 + 0.5;
			const w3 = Math.sin((x + y) * Math.PI * 2 * (freq2 / 10)) * 0.5 + 0.5;
			const h = (w1 + w2 + w3) / 3;
			return (h - 0.5) * 2 * mountainAmp; // static mountains, no continuous motion
		}
		// ripple from knob movement
		const rippleAmp = 0.04;
		const rippleWavelength = 0.18; // world units between rings
		const rippleSpeed = 0.6; // units per second
		const k = (Math.PI * 2) / rippleWavelength; // spatial frequency
		const omega = (Math.PI * 2 * rippleSpeed) / rippleWavelength; // temporal frequency
		function rippleHeight(x: number, y: number): number {
			const dx = x - rippleOX;
			const dy = y - rippleOY;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const elapsed = Math.max(0, tSec - rippleT0);
			const phase = k * dist - omega * elapsed;
			// distance and time decay for a dissipating wave
			const decay = Math.exp(-dist * 3.0) * Math.exp(-elapsed * 1.2);
			return rippleAmp * Math.sin(phase) * decay;
		}

		// For each vertex compute height and brightness based on distance to knob
		let c = 0;
		let p = 0;
		for (let s = 0; s < segments.length; s++) {
			// endpoint 1
			const x1 = linePositions[p + 0];
			const y1 = linePositions[p + 1];
			const dx1 = x1 - kx, dy1 = y1 - ky;
			const d1 = dx1 * dx1 + dy1 * dy1;
			const w1 = d1 < influenceSq ? 1 - Math.sqrt(d1 / influenceSq) : 0;
			const minI = 0.18, maxI = 0.92;
			const i1 = minI + (maxI - minI) * w1;
			const z1 = baseHeight(x1, y1) + rippleHeight(x1, y1) + 0.18 * w1; // mountains + ripple + interactive peak
			linePositions[p + 2] = z1;

			// endpoint 2
			const x2 = linePositions[p + 3];
			const y2 = linePositions[p + 4];
			const dx2 = x2 - kx, dy2 = y2 - ky;
			const d2 = dx2 * dx2 + dy2 * dy2;
			const w2 = d2 < influenceSq ? 1 - Math.sqrt(d2 / influenceSq) : 0;
			const i2 = minI + (maxI - minI) * w2;
			const z2 = baseHeight(x2, y2) + rippleHeight(x2, y2) + 0.18 * w2;
			linePositions[p + 5] = z2;

			// encode brightness in RGB equally; material uses global opacity
			lineColors[c++] = i1; lineColors[c++] = i1; lineColors[c++] = i1;
			lineColors[c++] = i2; lineColors[c++] = i2; lineColors[c++] = i2;
			p += 6;
		}
		// push updated positions and colors
		const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
		posAttr.set(linePositions);
		posAttr.needsUpdate = true;
		const colAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
		colAttr.set(lineColors);
		colAttr.needsUpdate = true;

		(material as any).opacity = 0.9;
	}

	function renderOnce() {
		syncBufferToCss();
		// Tilt the whole scene slightly to get a horizon look
		scene.rotation.x = -0.9;
		renderer.render(scene, camera);
	}

	let animId: number | null = null;
	let animating = false;
	const maxRippleDuration = 3.0; // seconds
	function animate() {
		tSec = (performance.now() - tStart) / 1000;
		const elapsed = Math.max(0, tSec - rippleT0);
		syncBufferToCss();
		updateColorsAndKnob();
		scene.rotation.x = -0.9;
		renderer.render(scene, camera);
		if (elapsed < maxRippleDuration) {
			animId = requestAnimationFrame(animate) as any as number;
		} else {
			animId = null;
			animating = false;
		}
	}

	function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

	function setPosition(x: number, y: number) {
		pos.x = clamp(x, 0, 1);
		pos.y = clamp(y, 0, 1);
		updateColorsAndKnob();
		// Re-render immediately while dragging to keep the knob visually in sync
		renderOnce();
		emit();
	}
	function getPosition() { return { ...pos }; }

	// Raycasting helpers to map pointer to the tilted plane in perspective
	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const tmpVec3 = new THREE.Vector3();
	function pointerToPos(ev: PointerEvent) {
		const rect = canvas.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return { x: pos.x, y: pos.y };
		ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
		ndc.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
		raycaster.setFromCamera(ndc, camera);
		// world-space plane for grid's local z=0
		const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(scene.quaternion);
		const planePoint = scene.localToWorld(new THREE.Vector3(0, 0, 0));
		const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);
		const hit = raycaster.ray.intersectPlane(plane, tmpVec3);
		if (!hit) return { x: pos.x, y: pos.y };
		const local = scene.worldToLocal(hit.clone());
		const x = clamp(local.x, 0, 1);
		const y = clamp(1 - local.y, 0, 1); // invert Y to keep UI origin at top
		return { x, y };
	}

	function onPointerDown(ev: PointerEvent) {
		dragging = true;
		(canvas as any).setPointerCapture?.(ev.pointerId);
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
		(canvas as any).releasePointerCapture?.(ev.pointerId);
		// start ripple on release from current position
		rippleOX = pos.x;
		rippleOY = 1 - pos.y;
		rippleT0 = tSec;
		if (!animating) {
			animating = true;
			animate();
		}
	}

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointerleave', onPointerUp);

	// Smooth keyboard navigation: hold arrows to move continuously with RAF
	const kbPressed = new Set<string>();
	let kbAnimId: number | null = null;
	let kbLastTs = 0;
	let kbMoved = false;
	function kbLoop(ts: number) {
		const hasArrow = kbPressed.has('ArrowLeft') || kbPressed.has('ArrowRight') || kbPressed.has('ArrowUp') || kbPressed.has('ArrowDown');
		if (!hasArrow) { kbAnimId = null; return; }
		const dt = Math.max(0, Math.min(0.05, (ts - kbLastTs) / 1000));
		kbLastTs = ts;
		const speed = kbPressed.has('Shift') ? 0.25 : 0.7; // units per second
		let dx = 0, dy = 0;
		if (kbPressed.has('ArrowLeft')) dx -= 1;
		if (kbPressed.has('ArrowRight')) dx += 1;
		if (kbPressed.has('ArrowUp')) dy -= 1;
		if (kbPressed.has('ArrowDown')) dy += 1;
		if (dx !== 0 || dy !== 0) {
			// Normalize diagonal speed
			if (dx !== 0 && dy !== 0) { const inv = 1 / Math.sqrt(2); dx *= inv; dy *= inv; }
			const nx = pos.x + dx * speed * dt;
			const ny = pos.y + dy * speed * dt;
			setPosition(nx, ny);
			kbMoved = true;
		}
		kbAnimId = requestAnimationFrame(kbLoop) as any as number;
	}
	function onKeyDown(ev: KeyboardEvent) {
		if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'Shift') {
			ev.preventDefault();
			kbPressed.add(ev.key);
			if (kbAnimId == null) {
				kbMoved = false;
				kbLastTs = performance.now();
				kbAnimId = requestAnimationFrame(kbLoop) as any as number;
			}
		}
	}
	function onKeyUp(ev: KeyboardEvent) {
		if (kbPressed.has(ev.key)) kbPressed.delete(ev.key);
		const hasArrow = kbPressed.has('ArrowLeft') || kbPressed.has('ArrowRight') || kbPressed.has('ArrowUp') || kbPressed.has('ArrowDown');
		if (!hasArrow && kbAnimId != null) {
			// stop loop; optionally trigger ripple if there was movement
			cancelAnimationFrame(kbAnimId);
			kbAnimId = null;
			if (kbMoved) {
				rippleOX = pos.x;
				rippleOY = 1 - pos.y;
				rippleT0 = tSec;
				if (!animating) { animating = true; animate(); }
			}
		}
	}
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);

	let cb: ((p: { x: number; y: number }) => void) | null = null;
	function onChange(f: (p: { x: number; y: number }) => void) { cb = f; }
	function emit() { cb?.(getPosition()); }

	function setCornerLabels(l: CornerLabels) {
		labels = { ...labels, ...l };
		// Labels are currently not rendered in the Three.js layer; reserved for future overlay
	}

	const ro = new ResizeObserver(() => {
		syncBufferToCss();
	});
	try { ro.observe(canvas); } catch {}

	// Initial
	syncBufferToCss();
	updateColorsAndKnob();
	renderOnce();

	return { setPosition, getPosition, onChange, setCornerLabels };
}


