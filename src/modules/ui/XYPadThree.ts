import * as THREE from 'three';
import type { XYPad } from './XYPad';

type CornerLabels = { tl?: string; tr?: string; bl?: string; br?: string };

export function createXYPadThree(canvas: HTMLCanvasElement): XYPad {
	// Internal normalized position (0..1)
	let pos = { x: 0.5, y: 0.5 };
	let dragging = false;
	let labels: CornerLabels = {};
	// Configurable speeds
	let normalSpeed = 0.15;
	let shiftSpeed = 0.05;

	// Three.js renderer with the provided canvas
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: false,
		powerPreference: 'high-performance'
	});
	// Function to update clear color based on theme
	function updateClearColor() {
		const root = getComputedStyle(document.documentElement);
		const bgColor = root.getPropertyValue('--xy-pad-bg').trim() || root.getPropertyValue('--waveform-bg').trim() || '#111111';
		// Convert hex string to number (remove # if present)
		const hex = bgColor.replace('#', '');
		const color = parseInt(hex, 16);
		renderer.setClearColor(color, 1);
	}
	updateClearColor();

	// Scene and camera (perspective for 3D wireframe look)
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
	camera.position.set(0.5, 0.6, 1.6);
	camera.lookAt(0.5, 0.5, 0);
	// lift the whole scene slightly to better center inside the square box
	scene.position.y = 0.2;
	// enlarge slightly
	scene.scale.set(1.12, 1.12, 1);

	// Lighting for the 3D sphere - softer, more neumorphic lighting
	const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
	scene.add(ambientLight);
	// Multiple directional lights for softer, more diffused neumorphic effect
	const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
	directionalLight1.position.set(1, 1, 1);
	scene.add(directionalLight1);
	const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
	directionalLight2.position.set(-1, -1, 0.5);
	scene.add(directionalLight2);

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

	// Knob (3D sphere) rendered above the grid - neumorphic style
	const knobGeom = new THREE.SphereGeometry(1, 16, 16);
	const knobMat = new THREE.MeshStandardMaterial({ 
		color: 0xd0d0d0,
		metalness: 0.0, // No metallic look for neumorphic style
		roughness: 0.75, // More matte, less reflective for neumorphic look
		flatShading: false // Smooth shading but with high roughness
	});
	const knob = new THREE.Mesh(knobGeom, knobMat);
	scene.add(knob);
	knob.scale.set(0.04, 0.04, 0.04); // scale to world units (più grande)
	knob.position.z = 0.025; // Slightly higher for more prominent elevation effect

    // Ghost Cursors Group
    const ghostsGroup = new THREE.Group();
    scene.add(ghostsGroup);
    
    // Pool of ghost meshes
    const ghostMeshes: THREE.Mesh[] = [];
    const ghostMaterials: THREE.MeshStandardMaterial[] = [];
    const PAD_COLORS_HEX = [0xA1E34B, 0x66D9EF, 0xFDBC40, 0xFF7AA2, 0x7C4DFF, 0x00E5A8, 0xF06292, 0xFFD54F];

    function updateGhosts(positions: { x: number, y: number, colorIndex: number }[]) {
        // Ensure pool size
        while (ghostMeshes.length < positions.length) {
            const mat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.6,
                metalness: 0.2,
                roughness: 0.2
            });
            const mesh = new THREE.Mesh(knobGeom, mat);
            mesh.scale.set(0.025, 0.025, 0.025); // Slightly smaller than main knob
            ghostMeshes.push(mesh);
            ghostMaterials.push(mat);
            ghostsGroup.add(mesh);
        }
        
        // Hide unused
        for (let i = positions.length; i < ghostMeshes.length; i++) {
            ghostMeshes[i].visible = false;
        }
        
        // Update active
        for (let i = 0; i < positions.length; i++) {
            const ghost = ghostMeshes[i];
            const data = positions[i];
            ghost.visible = true;
            ghost.position.x = data.x;
            ghost.position.y = 1 - data.y; // Invert Y for display
            ghost.position.z = 0.02;
            
            const colorHex = PAD_COLORS_HEX[data.colorIndex % PAD_COLORS_HEX.length];
            ghostMaterials[i].color.setHex(colorHex);
            ghostMaterials[i].emissive.setHex(colorHex);
            ghostMaterials[i].emissiveIntensity = 0.4;
        }
    }

	// Symbol particles system - simboli strani vicino ai vertici influenzati
	const symbolsGroup = new THREE.Group();
	scene.add(symbolsGroup);
	
	// Array per tracciare i simboli attivi
	type SymbolData = {
		mesh: THREE.Mesh;
		vertexIndex: number;
		baseX: number;
		baseY: number;
	};
	const activeSymbols: SymbolData[] = [];
	const maxSymbolsWhenFull = 30; // numero massimo di simboli quando riverbero = 1
	let reverbMix = 0; // valore del riverbero (0..1) che controlla quanti simboli mostrare
	let filterCutoffHz = 4000; // valore del filtro cutoff (Hz)
	let cutoffCornerWeight = 0; // peso del vertice TL (0..1) per l'effetto radiale
	let density = 15; // valore della densità (1-60 grains/sec) per l'animazione della griglia
	let densityCornerWeight = 0; // peso del vertice TR (0..1) per l'effetto radiale della densità
	
	// Funzione per creare simboli geometrici interessanti (solo poligoni)
	function createSymbol(shapeType: number): THREE.Mesh {
		let geom: THREE.BufferGeometry;
		const size = 0.015;
		
		switch (shapeType % 4) {
			case 0: // Triangolo (prisma triangolare)
				geom = new THREE.CylinderGeometry(size * 0.6, size * 0.6, size * 0.8, 3);
				break;
			case 1: // Quadrato (prisma quadrato)
				geom = new THREE.BoxGeometry(size * 1.2, size * 1.2, size * 0.8);
				break;
			case 2: // Pentagono (prisma pentagonale)
				geom = new THREE.CylinderGeometry(size * 0.7, size * 0.7, size * 0.8, 5);
				break;
			default: // Esagono (prisma esagonale)
				geom = new THREE.CylinderGeometry(size * 0.8, size * 0.8, size * 0.8, 6);
		}
		
		const mat = new THREE.MeshStandardMaterial({
			color: 0x88ccff,
			emissive: 0x2244aa,
			emissiveIntensity: 0.3,
			metalness: 0.6,
			roughness: 0.3,
			transparent: true,
			opacity: 0.8
		});
		
		const mesh = new THREE.Mesh(geom, mat);
		mesh.rotation.z = Math.random() * Math.PI * 2;
		return mesh;
	}

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

		// Calcola il colore ciano per la sfera in base al cutoff e alla distanza dal vertice TL
		const cutoffMin = 200;
		const cutoffMax = 12000;
		const cutoffNorm = Math.max(0, Math.min(1, (filterCutoffHz - cutoffMin) / (cutoffMax - cutoffMin)));
		const cyanIntensity = cutoffNorm * cutoffCornerWeight;
		const cornerTL = { x: 0, y: 0 };
		const distTLKnob = Math.sqrt((kx - cornerTL.x) ** 2 + (ky - cornerTL.y) ** 2);
		const maxDist = Math.sqrt(2);
		const radialFactorKnob = 1 - Math.min(1, distTLKnob / maxDist);
		const cyanAmountKnob = cyanIntensity * radialFactorKnob;
		
		// Colore base grigio: 0xd0d0d0 = RGB(208, 208, 208) / 255
		const baseR = 0xd0 / 255;
		const baseG = 0xd0 / 255;
		const baseB = 0xd0 / 255;
		
		// Applica il ciano (molto più intenso e colorato)
		// Riduci il rosso completamente quando c'è ciano
		const knobR = Math.max(0, Math.min(1, baseR * (1 - cyanAmountKnob * 1.2)));
		// Aumenta verde e blu molto di più, con boost di luminosità
		const knobG = Math.max(0, Math.min(1, baseG + cyanAmountKnob * 1.0 + cyanAmountKnob * 0.3));
		const knobB = Math.max(0, Math.min(1, baseB + cyanAmountKnob * 1.2 + cyanAmountKnob * 0.4));
		
		// Aggiorna il colore della sfera
		knobMat.color.setRGB(knobR, knobG, knobB);
		// Aumenta l'emissività quando c'è ciano per renderla più luminosa
		if (cyanAmountKnob > 0) {
			knobMat.emissive.setRGB(knobR * 0.3, knobG * 0.5, knobB * 0.6);
			knobMat.emissiveIntensity = cyanAmountKnob * 0.8;
		} else {
			knobMat.emissive.setRGB(0, 0, 0);
			knobMat.emissiveIntensity = 0;
		}

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
		
		// Animazione basata sulla densità: pulsazione ritmica della griglia
		// La densità va da 1 a 60 grains/sec, normalizziamo per l'animazione
		const densityNorm = Math.max(0, Math.min(1, (density - 1) / (60 - 1)));
		const densityIntensity = densityNorm * densityCornerWeight;
		
		// Vertice TR (top-right) è a (1, 0) nello spazio normalizzato
		const cornerTR = { x: 1, y: 0 };
		
		function densityPulse(x: number, y: number): number {
			if (densityIntensity <= 0) return 0;
			
			// Calcola distanza dal vertice TR
			const dx = x - cornerTR.x;
			const dy = y - cornerTR.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const maxDist = Math.sqrt(2);
			const radialFactor = 1 - Math.min(1, dist / maxDist);
			
			// Frequenza di pulsazione basata sulla densità (più densità = più veloce)
			// Normalizza la densità per avere una frequenza ragionevole (0.5-3 Hz)
			const pulseFreq = 0.5 + densityNorm * 2.5;
			const pulsePhase = tSec * pulseFreq * Math.PI * 2;
			
			// Pulsazione con onda sinusoidale, più intensa vicino al vertice TR
			const pulse = Math.sin(pulsePhase) * 0.08 * densityIntensity * radialFactor;
			
			// Aggiungi anche onde multiple che si propagano dal vertice TR
			const waveSpeed = 0.8 + densityNorm * 1.2; // velocità onde basata sulla densità
			const waveLength = 0.15;
			const wavePhase = (dist / waveLength) - (tSec * waveSpeed);
			const wave = Math.sin(wavePhase * Math.PI * 2) * 0.04 * densityIntensity * radialFactor;
			
			return pulse + wave;
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

		// Raccogli informazioni sui vertici più influenzati per i simboli
		type VertexInfluence = { index: number; x: number; y: number; weight: number; z: number };
		const vertexInfluences: VertexInfluence[] = [];
		
		// Usa i vertici della griglia normalizzata
		for (let i = 0; i < totalPoints; i++) {
			const x = normPositions[i * 2 + 0];
			const y = normPositions[i * 2 + 1];
			const dx = x - kx;
			const dy = y - ky;
			const dSq = dx * dx + dy * dy;
			if (dSq < influenceSq) {
				const weight = 1 - Math.sqrt(dSq / influenceSq);
				const z = baseHeight(x, y) + rippleHeight(x, y) + densityPulse(x, y) + 0.18 * weight;
				vertexInfluences.push({ index: i, x, y, weight, z });
			}
		}
		
		// Ordina per peso (più influenzati prima) e calcola quanti simboli mostrare in base al riverbero
		vertexInfluences.sort((a, b) => b.weight - a.weight);
		// Soglia minima: i poligoni compaiono solo quando il riverbero supera questa soglia
		const reverbThreshold = 0.3; // soglia minima (0.3 = 30%)
		const effectiveMix = reverbMix < reverbThreshold 
			? 0 
			: (reverbMix - reverbThreshold) / (1 - reverbThreshold); // normalizza tra 0 e 1 dopo la soglia
		const maxSymbols = Math.floor(effectiveMix * maxSymbolsWhenFull);
		const topVertices = vertexInfluences.slice(0, maxSymbols);
		
		// Aggiorna o crea simboli per i vertici più influenzati
		while (activeSymbols.length < topVertices.length) {
			const shapeType = activeSymbols.length;
			const symbol = createSymbol(shapeType);
			symbolsGroup.add(symbol);
			activeSymbols.push({
				mesh: symbol,
				vertexIndex: -1,
				baseX: 0,
				baseY: 0
			});
		}
		
		// Hide unused symbols (Object Pooling: Don't destroy, just hide)
		for (let i = topVertices.length; i < activeSymbols.length; i++) {
            activeSymbols[i].mesh.visible = false;
        }
		
		// Aggiorna posizioni e proprietà dei simboli attivi
		for (let i = 0; i < topVertices.length; i++) {
			const vertex = topVertices[i];
			const symbol = activeSymbols[i];
            
            symbol.mesh.visible = true;
			
			// Posiziona il simbolo sopra il vertice
			symbol.mesh.position.x = vertex.x;
			symbol.mesh.position.y = vertex.y;
			symbol.mesh.position.z = vertex.z + 0.05; // leggermente sopra il vertice
			
			// Scala in base al peso (più influenzato = più grande)
			const scale = 0.5 + vertex.weight * 1.5;
			symbol.mesh.scale.set(scale, scale, scale);
			
			// Rotazione animata in base al tempo e al peso
			symbol.mesh.rotation.z = tSec * (0.5 + vertex.weight * 2) + i * 0.5;
			symbol.mesh.rotation.y = tSec * (0.3 + vertex.weight * 1.5);
			
			// Opacità e colore in base al peso
			const mat = symbol.mesh.material as THREE.MeshStandardMaterial;
			mat.opacity = 0.4 + vertex.weight * 0.6;
			
			// Colore che cambia in base al peso (da blu a ciano a bianco)
			const hue = 0.55 + vertex.weight * 0.15; // da blu a ciano
			const saturation = 0.6 + vertex.weight * 0.4;
			const lightness = 0.5 + vertex.weight * 0.5;
			mat.color.setHSL(hue, saturation, lightness);
			mat.emissive.setHSL(hue, saturation * 0.5, lightness * 0.3);
		}

		// For each vertex compute height and brightness based on distance to knob
		// Enhanced contrast for neumorphic effect
		let c = 0;
		let p = 0;
		
		for (let s = 0; s < segments.length; s++) {
			// endpoint 1
			const x1 = linePositions[p + 0];
			const y1 = linePositions[p + 1];
			const dx1 = x1 - kx, dy1 = y1 - ky;
			const d1 = dx1 * dx1 + dy1 * dy1;
			const w1 = d1 < influenceSq ? 1 - Math.sqrt(d1 / influenceSq) : 0;
			// Increased contrast range for more pronounced neumorphic depth (darker shadows, brighter highlights)
			const minI = 0.12, maxI = 0.95;
			const i1 = minI + (maxI - minI) * w1;
			const z1 = baseHeight(x1, y1) + rippleHeight(x1, y1) + densityPulse(x1, y1) + 0.18 * w1; // mountains + ripple + density pulse + interactive peak
			linePositions[p + 2] = z1;

			// endpoint 2
			const x2 = linePositions[p + 3];
			const y2 = linePositions[p + 4];
			const dx2 = x2 - kx, dy2 = y2 - ky;
			const d2 = dx2 * dx2 + dy2 * dy2;
			const w2 = d2 < influenceSq ? 1 - Math.sqrt(d2 / influenceSq) : 0;
			// Same enhanced contrast for endpoint 2
			const i2 = minI + (maxI - minI) * w2;
			const z2 = baseHeight(x2, y2) + rippleHeight(x2, y2) + densityPulse(x2, y2) + 0.18 * w2;
			linePositions[p + 5] = z2;

			// Calcola distanza radiale dal vertice TL per endpoint 1
			const distTL1 = Math.sqrt((x1 - cornerTL.x) ** 2 + (y1 - cornerTL.y) ** 2);
			const maxDist = Math.sqrt(2); // distanza massima (diagonale da TL a BR)
			const radialFactor1 = 1 - Math.min(1, distTL1 / maxDist); // 1 al vertice TL, 0 al vertice opposto
			const cyanAmount1 = cyanIntensity * radialFactor1;

			// Calcola distanza radiale dal vertice TL per endpoint 2
			const distTL2 = Math.sqrt((x2 - cornerTL.x) ** 2 + (y2 - cornerTL.y) ** 2);
			const radialFactor2 = 1 - Math.min(1, distTL2 / maxDist);
			const cyanAmount2 = cyanIntensity * radialFactor2;

			// Mescola il colore grigio con il ciano (ciano = RGB(0, 1, 1)) - molto più intenso e colorato
			// Riduci il rosso completamente quando c'è ciano, aumenta verde e blu con boost di luminosità
			const r1 = Math.max(0, Math.min(1, i1 * (1 - cyanAmount1 * 1.2))); // riduci rosso completamente
			const g1 = Math.max(0, Math.min(1, i1 + cyanAmount1 * 1.0 + cyanAmount1 * 0.3)); // aumenta verde molto di più con luminosità
			const b1 = Math.max(0, Math.min(1, i1 + cyanAmount1 * 1.2 + cyanAmount1 * 0.4)); // aumenta blu molto di più con luminosità
			
			const r2 = Math.max(0, Math.min(1, i2 * (1 - cyanAmount2 * 1.2)));
			const g2 = Math.max(0, Math.min(1, i2 + cyanAmount2 * 1.0 + cyanAmount2 * 0.3));
			const b2 = Math.max(0, Math.min(1, i2 + cyanAmount2 * 1.2 + cyanAmount2 * 0.4));

			// encode color with cyan tint
			lineColors[c++] = Math.max(0, Math.min(1, r1)); 
			lineColors[c++] = Math.max(0, Math.min(1, g1)); 
			lineColors[c++] = Math.max(0, Math.min(1, b1));
			lineColors[c++] = Math.max(0, Math.min(1, r2)); 
			lineColors[c++] = Math.max(0, Math.min(1, g2)); 
			lineColors[c++] = Math.max(0, Math.min(1, b2));
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
		// Continua l'animazione se c'è un ripple attivo O se c'è animazione della densità
		const hasDensityAnimation = densityCornerWeight > 0;
		if (elapsed < maxRippleDuration || hasDensityAnimation) {
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
    
    // Silent update (only visual, no emit) - for programmatic recall
    function setPositionSilent(x: number, y: number) {
		pos.x = clamp(x, 0, 1);
		pos.y = clamp(y, 0, 1);
		updateColorsAndKnob();
		renderOnce();
    }

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
		const speed = kbPressed.has('Shift') ? shiftSpeed : normalSpeed; // units per second
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

	function setSpeed(normal: number, shift: number) {
		normalSpeed = Math.max(0.01, Math.min(2.0, normal));
		shiftSpeed = Math.max(0.01, Math.min(1.0, shift));
	}

	function setReverbMix(mix: number) {
		reverbMix = Math.max(0, Math.min(1, mix));
		// Aggiorna i simboli quando cambia il riverbero
		updateColorsAndKnob();
		renderOnce();
	}

	function setFilterCutoff(cutoff: number, cornerWeight: number) {
		filterCutoffHz = Math.max(200, Math.min(12000, cutoff));
		cutoffCornerWeight = Math.max(0, Math.min(1, cornerWeight));
		// Aggiorna i colori quando cambia il cutoff
		updateColorsAndKnob();
		renderOnce();
	}

	function setDensity(dens: number, cornerWeight: number) {
		density = Math.max(1, Math.min(60, dens));
		densityCornerWeight = Math.max(0, Math.min(1, cornerWeight));
		// Aggiorna l'animazione quando cambia la densità
		updateColorsAndKnob();
		// Se l'animazione non è già attiva, avviala per mostrare l'effetto della densità
		if (!animating && densityCornerWeight > 0) {
			animating = true;
			animate();
		}
		renderOnce();
	}

	function updateTheme() {
		updateClearColor();
		renderOnce();
	}

    function setGhostPositions(positions: { x: number, y: number, colorIndex: number }[]) {
        updateGhosts(positions);
        renderOnce();
    }

	return { setPosition, getPosition, onChange, setCornerLabels, setSpeed, setReverbMix, setFilterCutoff, setDensity, updateTheme, setPositionSilent, setGhostPositions };
}


