
export interface MotionPanelConfig {
	canvas: HTMLCanvasElement;
	cursor: HTMLElement;
	recordBtn: HTMLButtonElement;
	playBtn: HTMLButtonElement;
	clearBtn: HTMLButtonElement;
	loopModeSelect: HTMLSelectElement;
	speedInput: HTMLInputElement;
	onPosition: (x: number, y: number) => void;
}

export interface Point {
	x: number;
	y: number;
	time: number; // relative time in ms from start
}

export function createMotionPanel(config: MotionPanelConfig) {
	const { canvas, cursor, recordBtn, playBtn, clearBtn, loopModeSelect, speedInput, onPosition } = config;
	const ctx = canvas.getContext('2d')!;

	let path: Point[] = [];
	let isRecording = false;
	let isPlaying = false;
	let startTime = 0;
	let playStartTime = 0;
	let animationFrame: number | null = null;
	let speed = 1.0;
	let mode: 'loop' | 'pingpong' | 'oneshot' | 'reverse' = 'loop';
	
	// Canvas sizing
	function resize() {
		const rect = canvas.getBoundingClientRect();
		// Match pixel density
		const dpr = window.devicePixelRatio || 1;
		canvas.width = rect.width * dpr;
		canvas.height = rect.height * dpr;
		ctx.scale(dpr, dpr);
		drawPath();
	}
	
	const resizeObserver = new ResizeObserver(() => resize());
	resizeObserver.observe(canvas);

	// Drawing Logic
	function drawPath() {
		const width = canvas.width / (window.devicePixelRatio || 1);
		const height = canvas.height / (window.devicePixelRatio || 1);
		
		ctx.clearRect(0, 0, width, height);
		
		// Grid
		ctx.strokeStyle = '#333';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
		ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
		ctx.stroke();

		if (path.length > 0) {
			ctx.strokeStyle = '#4CAF50';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(path[0].x * width, (1 - path[0].y) * height); // invert Y for display
			for (let i = 1; i < path.length; i++) {
				ctx.lineTo(path[i].x * width, (1 - path[i].y) * height);
			}
			ctx.stroke();
			
			// Draw start/end points
			ctx.fillStyle = '#81C784';
			ctx.beginPath();
			const startX = path[0].x * width;
			const startY = (1 - path[0].y) * height;
			ctx.arc(startX, startY, 4, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// Recording interaction
	function startRecording(e: PointerEvent) {
		if (isPlaying) stopPlayback();
		isRecording = true;
		path = [];
		startTime = performance.now();
		recordBtn.textContent = 'Recording...';
		recordBtn.classList.add('active');
		canvas.setPointerCapture(e.pointerId);
		addPoint(e);
	}

	function addPoint(e: PointerEvent) {
		const rect = canvas.getBoundingClientRect();
		const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)); // 0 at bottom
		
		path.push({
			x,
			y,
			time: performance.now() - startTime
		});
		
		drawPath();
		// Immediate feedback
		// Invert Y for output (0 at Top -> 0 output)
		// Internal Y: 0=Bottom, 1=Top.
		// Desired output: Top -> 0, Bottom -> 1.
		// So output = 1 - internalY.
		onPosition(x, 1 - y);
		updateCursor(x, y);
	}

	function stopRecording(e: PointerEvent) {
		if (!isRecording) return;
		isRecording = false;
		recordBtn.textContent = 'Draw';
		recordBtn.classList.remove('active');
		canvas.releasePointerCapture(e.pointerId);
		// Optimize path if needed?
	}

	canvas.addEventListener('pointerdown', (e) => {
		// Only start recording if "Draw" mode is effectively active (or just always allow drawing?)
		// Let's toggle drawing with the button or just hold to draw? 
		// "Draw" button suggests a mode. 
		// Let's implement: Click Draw to enter "armed" mode? Or just hold mouse on canvas?
		// The requirement said "l'utente può disegnare". Usually this means dragging.
		// Let's make it so you can always draw, but it overwrites the path.
		startRecording(e);
	});
	
	canvas.addEventListener('pointermove', (e) => {
		if (isRecording) {
			addPoint(e);
		}
	});

	canvas.addEventListener('pointerup', stopRecording);
	canvas.addEventListener('pointerleave', stopRecording);

	// Playback
	function startPlayback() {
		if (path.length < 2) return;
		isPlaying = true;
		playBtn.textContent = 'Stop';
		playBtn.classList.add('active');
		playStartTime = performance.now();
		
		const totalDuration = path[path.length - 1].time;
		
		const animate = () => {
			if (!isPlaying) return;
			
			const now = performance.now();
			let elapsed = (now - playStartTime) * speed;
			
			// Handle looping logic
			let t = 0;
			if (mode === 'oneshot') {
				if (elapsed > totalDuration) {
					stopPlayback();
					return;
				}
				t = elapsed;
			} else if (mode === 'loop') {
				t = elapsed % totalDuration;
			} else if (mode === 'reverse') {
				t = totalDuration - (elapsed % totalDuration);
			} else if (mode === 'pingpong') {
				const cycle = totalDuration * 2;
				const phase = elapsed % cycle;
				if (phase < totalDuration) {
					t = phase;
				} else {
					t = 2 * totalDuration - phase;
				}
			}

			// Find interpolated position
			// Naive search, optimize later if needed
			let prev = path[0];
			let next = path[path.length - 1];
			
			for (let i = 0; i < path.length - 1; i++) {
				if (t >= path[i].time && t <= path[i + 1].time) {
					prev = path[i];
					next = path[i + 1];
					break;
				}
			}
			
			const segmentDuration = next.time - prev.time;
			const segmentProgress = segmentDuration > 0 ? (t - prev.time) / segmentDuration : 0;
			
			const x = prev.x + (next.x - prev.x) * segmentProgress;
			const y = prev.y + (next.y - prev.y) * segmentProgress;
			
			// Invert Y for output
			onPosition(x, 1 - y);
			updateCursor(x, y);
			
			animationFrame = requestAnimationFrame(animate);
		};
		
		animationFrame = requestAnimationFrame(animate);
	}

	function stopPlayback() {
		isPlaying = false;
		playBtn.textContent = 'Play';
		playBtn.classList.remove('active');
		if (animationFrame) cancelAnimationFrame(animationFrame);
	}

	function updateCursor(x: number, y: number) {
		cursor.style.display = 'block';
		cursor.style.left = `${x * 100}%`;
		cursor.style.top = `${(1 - y) * 100}%`; // invert Y for CSS top
	}

	// Controls
	recordBtn.addEventListener('click', () => {
		// Just visual feedback or toggle? 
		// If we draw by dragging, this button might just be a clear indicator
		// Or maybe it toggles "Record Mode" where dragging records, otherwise dragging just moves cursor?
		// For simplicity: Dragging on canvas ALWAYS records a new path.
		// The button can just focus/highlight.
	});

	playBtn.addEventListener('click', () => {
		if (isPlaying) stopPlayback();
		else startPlayback();
	});

	clearBtn.addEventListener('click', () => {
		stopPlayback();
		path = [];
		drawPath();
		cursor.style.display = 'none';
	});

	loopModeSelect.addEventListener('change', () => {
		mode = loopModeSelect.value as any;
	});

	speedInput.addEventListener('input', () => {
		speed = parseFloat(speedInput.value);
	});
	
	// Init
	resize();
	
	return {
		setPath: (newPath: Point[]) => {
			path = newPath;
			drawPath();
		},
		getPath: () => path,
		setCursor: (x: number, y: number) => {
			if (!isPlaying && !isRecording) {
				// Invert Y for input display (0 input -> Top -> 1 internal)
				updateCursor(x, 1 - y);
			}
		},
        isRecording: () => isRecording,
        isPlaying: () => isPlaying,
        stop: () => stopPlayback()
	};
}

