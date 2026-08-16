// 3D Wireframe Logo Renderer for Undergrain - Topographic Granulator
// Renders a true 3D wireframe polyhedron with perspective projection,
// depth sorting, vertex nodes, and periodic 3D rotation animation.

export type Logo3DOptions = {
	autoRotateIntervalMs?: number; // Time between 3D spins
};

export function createLogo3D(canvas: HTMLCanvasElement, options: Logo3DOptions = {}) {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const autoRotateIntervalMs = options.autoRotateIntervalMs ?? 10000;

	// 3D Geometry Definition (Geodesic / Topographic 3D Polyhedron Wireframe)
	// 12 Vertices in 3D Space (X, Y, Z)
	const vertices3D: { x: number; y: number; z: number }[] = [
		// Top and Bottom peaks
		{ x: 0, y: -1.3, z: 0 },
		{ x: 0, y: 1.3, z: 0 },
	];

	// Upper ring (5 vertices)
	for (let i = 0; i < 5; i++) {
		const angle = (i * 2 * Math.PI) / 5;
		vertices3D.push({
			x: Math.cos(angle) * 1.1,
			y: -0.45,
			z: Math.sin(angle) * 1.1,
		});
	}

	// Lower ring (5 vertices, offset phase)
	for (let i = 0; i < 5; i++) {
		const angle = ((i + 0.5) * 2 * Math.PI) / 5;
		vertices3D.push({
			x: Math.cos(angle) * 1.1,
			y: 0.45,
			z: Math.sin(angle) * 1.1,
		});
	}

	// 3D Wireframe Edges (pairs of vertex indices)
	const edges: [number, number][] = [
		// Top peak to upper ring
		[0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
		// Upper ring perimeter
		[2, 3], [3, 4], [4, 5], [5, 6], [6, 2],
		// Upper ring to lower ring triangles
		[2, 7], [3, 7], [3, 8], [4, 8], [4, 9], [5, 9], [5, 10], [6, 10], [6, 11], [2, 11],
		// Lower ring perimeter
		[7, 8], [8, 9], [9, 10], [10, 11], [11, 7],
		// Lower ring to bottom peak
		[1, 7], [1, 8], [1, 9], [1, 10], [1, 11],
		// Internal 3D axis struts to center (0,0,0)
		[0, 1], [2, 9], [4, 11]
	];

	// Node colors mapped to categories
	const nodeColors = [
		'#64b5f6', // Granular cyan
		'#ba68c8', // Motion purple
		'#ffb74d', // File orange
		'#81c784', // Effects green
		'#42a5f5', // Control blue
		'#ef5350', // Record red
	];

	// Animation state variables
	let currentRotY = 0;
	let currentRotX = 0.35; // Tilt for isometric depth perspective
	let targetRotY = 0;
	let isSpinning = false;
	let spinProgress = 0;
	let lastTime = performance.now();
	let animationFrameId: number | null = null;
	let lastSpinTime = performance.now();

	// Mouse hover interactive tilt effect
	let hoverOffsetX = 0;
	let hoverOffsetY = 0;

	canvas.addEventListener('mouseenter', () => {
		// Trigger a 3D spin on hover if not spinning
		if (!isSpinning) {
			startSpin();
		}
	});

	canvas.addEventListener('mousemove', (e) => {
		const rect = canvas.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		hoverOffsetX = ((e.clientX - cx) / (rect.width / 2)) * 0.4;
		hoverOffsetY = ((e.clientY - cy) / (rect.height / 2)) * 0.4;
	});

	canvas.addEventListener('mouseleave', () => {
		hoverOffsetX = 0;
		hoverOffsetY = 0;
	});

	function startSpin() {
		isSpinning = true;
		spinProgress = 0;
	}

	// Schedule periodic 3D rotation ("ruota ogni tanto")
	setInterval(() => {
		const now = performance.now();
		if (now - lastSpinTime >= autoRotateIntervalMs && !isSpinning) {
			lastSpinTime = now;
			startSpin();
		}
	}, 1000);

	function render() {
		const now = performance.now();
		const dt = Math.min((now - lastTime) / 1000, 0.1);
		lastTime = now;

		// Handle 3D rotation spin animation with organic acceleration and deceleration curve
		if (isSpinning) {
			spinProgress += dt * 0.75; // Smooth spin duration (~1.33 seconds)
			if (spinProgress >= 1) {
				spinProgress = 1;
				isSpinning = false;
				targetRotY += Math.PI * 2;
				currentRotY = targetRotY;
			} else {
				// Quintic Ease-In-Out curve: slow acceleration at start, fast mid-spin, gradual deceleration cushion at end
				const t = spinProgress;
				const ease = t < 0.5
					? 16 * Math.pow(t, 5)
					: 1 - Math.pow(-2 * t + 2, 5) / 2;
				currentRotY = targetRotY + ease * Math.PI * 2;
			}
		}

		// Smooth lerp for hover tilt
		const effectiveRotX = currentRotX + hoverOffsetY * 0.3;
		const effectiveRotY = currentRotY + hoverOffsetX * 0.3;

		// Clear canvas
		const width = canvas.width;
		const height = canvas.height;
		ctx.clearRect(0, 0, width, height);

		const centerX = width / 2;
		const centerY = height / 2;
		const radius = Math.min(width, height) * 0.32;
		const fov = 3.5; // Perspective depth field of view

		// Project 3D vertices to 2D screen coordinates with perspective
		const projectedNodes = vertices3D.map((v, index) => {
			// 1. Rotate around Y axis
			const cosY = Math.cos(effectiveRotY);
			const sinY = Math.sin(effectiveRotY);
			const x1 = v.x * cosY + v.z * sinY;
			const z1 = -v.x * sinY + v.z * cosY;
			const y1 = v.y;

			// 2. Rotate around X axis (isometric tilt)
			const cosX = Math.cos(effectiveRotX);
			const sinX = Math.sin(effectiveRotX);
			const y2 = y1 * cosX - z1 * sinX;
			const z2 = y1 * sinX + z1 * cosX;
			const x2 = x1;

			// 3. Perspective projection math
			const perspectiveScale = fov / (fov + z2);
			const screenX = centerX + x2 * radius * perspectiveScale;
			const screenY = centerY + y2 * radius * perspectiveScale;

			return {
				x: screenX,
				y: screenY,
				z: z2,
				scale: perspectiveScale,
				color: nodeColors[index % nodeColors.length],
			};
		});

		// Sort edges by average Z depth for 3D occlusion / z-buffering
		const sortedEdges = edges.map(([i1, i2]) => {
			const n1 = projectedNodes[i1];
			const n2 = projectedNodes[i2];
			const avgZ = (n1.z + n2.z) / 2;
			return { i1, i2, avgZ, n1, n2 };
		}).sort((a, b) => a.avgZ - b.avgZ);

		// Draw 3D Wireframe Lines
		sortedEdges.forEach(({ n1, n2, avgZ }) => {
			ctx.beginPath();
			ctx.moveTo(n1.x, n1.y);
			ctx.lineTo(n2.x, n2.y);

			// Depth-based opacity and line weight (front lines thicker & brighter)
			const depthAlpha = Math.max(0.2, Math.min(0.95, (avgZ + 1.8) / 3.2));
			const strokeWidth = 1.0 + depthAlpha * 1.2;

			// Gradient stroke between connected node colors
			const grad = ctx.createLinearGradient(n1.x, n1.y, n2.x, n2.y);
			grad.addColorStop(0, n1.color);
			grad.addColorStop(1, n2.color);

			ctx.strokeStyle = grad;
			ctx.globalAlpha = depthAlpha;
			ctx.lineWidth = strokeWidth;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.stroke();
		});

		ctx.globalAlpha = 1.0;

		// Sort nodes by Z depth and draw node vertices
		const sortedNodes = [...projectedNodes].sort((a, b) => a.z - b.z);
		sortedNodes.forEach((node) => {
			const nodeAlpha = Math.max(0.3, Math.min(1.0, (node.z + 1.8) / 3.2));
			const nodeRadius = Math.max(1.2, 2.2 * node.scale);

			// Glowing vertex circle
			ctx.save();
			ctx.globalAlpha = nodeAlpha;
			ctx.shadowColor = node.color;
			ctx.shadowBlur = 6 * node.scale;

			ctx.beginPath();
			ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
			ctx.fillStyle = node.color;
			ctx.fill();

			ctx.restore();
		});

		// Draw central glowing core node at origin (0,0,0)
		const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
		ctx.save();
		ctx.shadowColor = isDark ? '#ffffff' : '#1976d2';
		ctx.shadowBlur = 10;
		ctx.beginPath();
		ctx.arc(centerX, centerY, 2.8, 0, Math.PI * 2);
		ctx.fillStyle = isDark ? '#ffffff' : '#1d1d1f';
		ctx.fill();
		ctx.restore();

		animationFrameId = requestAnimationFrame(render);
	}

	render();

	return {
		destroy: () => {
			if (animationFrameId !== null) {
				cancelAnimationFrame(animationFrameId);
			}
		},
		triggerSpin: () => {
			startSpin();
		},
	};
}
