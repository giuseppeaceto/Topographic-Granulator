
export interface MotionPanelConfig {
	canvas: HTMLCanvasElement;
	cursor: HTMLElement;
	recordBtn?: HTMLButtonElement; // Optional - drawing can be done by dragging on canvas
	playBtn: HTMLButtonElement;
	clearBtn: HTMLButtonElement;
	loopModeSelect: HTMLSelectElement;
	speedInput: HTMLInputElement;
    externalClock?: boolean; // If true, internal animation loop is disabled, play button just toggles state
    color?: string; // Optional color for path and points
	onPosition: (x: number, y: number) => void;
	onPathChange?: (path: Point[]) => void;
	onPlayStateChange?: (isPlaying: boolean) => void;
    onSpeedChange?: (speed: number) => void;
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
    let currentColor = config.color || '#4CAF50';
	
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
			ctx.strokeStyle = currentColor;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(path[0].x * width, path[0].y * height); 
			for (let i = 1; i < path.length; i++) {
				ctx.lineTo(path[i].x * width, path[i].y * height);
			}
			ctx.stroke();
			
			// Draw start/end points
			ctx.fillStyle = currentColor;
			ctx.beginPath();
			const startX = path[0].x * width;
			const startY = path[0].y * height;
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
		if (recordBtn) {
			recordBtn.textContent = 'Recording...';
			recordBtn.classList.add('active');
		}
		canvas.setPointerCapture(e.pointerId);
		addPoint(e);
	}

	function addPoint(e: PointerEvent) {
		const rect = canvas.getBoundingClientRect();
		const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)); // 0 at Top (Screen Coords)
		
		path.push({
			x,
			y,
			time: performance.now() - startTime
		});
		
		drawPath();
		// Immediate feedback
		onPosition(x, y);
		updateCursor(x, y);
	}

	function stopRecording(e: PointerEvent) {
		if (!isRecording) return;
		isRecording = false;
		if (recordBtn) {
			recordBtn.textContent = 'Draw';
			recordBtn.classList.remove('active');
		}
		canvas.releasePointerCapture(e.pointerId);
		// Optimize path if needed?
		if (config.onPathChange) config.onPathChange(path);
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
	function startPlayback(offsetMs: number = 0) {
		if (path.length < 2) return;
		isPlaying = true;
		config.onPlayStateChange?.(true);
		playBtn.classList.add('active');
        playBtn.setAttribute('aria-pressed', 'true');

        if (config.externalClock) return; // Don't start internal loop

		playStartTime = performance.now() - (offsetMs / speed);
		
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
			
			onPosition(x, y);
			updateCursor(x, y);
			
			animationFrame = requestAnimationFrame(animate);
		};
		
		animationFrame = requestAnimationFrame(animate);
	}

	function stopPlayback() {
		isPlaying = false;
		config.onPlayStateChange?.(false);
		playBtn.classList.remove('active');
        playBtn.setAttribute('aria-pressed', 'false');
		if (animationFrame) cancelAnimationFrame(animationFrame);
	}

	function updateCursor(x: number, y: number) {
		cursor.style.display = 'block';
		cursor.style.left = `${x * 100}%`;
		cursor.style.top = `${y * 100}%`; 
	}

	// Controls
	if (recordBtn) {
		recordBtn.addEventListener('click', () => {
			// Just visual feedback or toggle? 
			// If we draw by dragging, this button might just be a clear indicator
			// Or maybe it toggles "Record Mode" where dragging records, otherwise dragging just moves cursor?
			// For simplicity: Dragging on canvas ALWAYS records a new path.
			// The button can just focus/highlight.
		});
	}

	playBtn.addEventListener('click', () => {
		if (isPlaying) stopPlayback();
		else startPlayback();
	});

	clearBtn.addEventListener('click', () => {
		stopPlayback();
		path = [];
		drawPath();
		cursor.style.display = 'none';
		if (config.onPathChange) config.onPathChange(path);
	});

	loopModeSelect.addEventListener('change', () => {
		mode = loopModeSelect.value as any;
        // Restart playback to apply mode change immediately if playing
        if (isPlaying) {
            config.onPlayStateChange?.(true);
        }
	});

	speedInput.addEventListener('input', () => {
		const oldSpeed = speed;
		speed = parseFloat(speedInput.value);
		
		// Adjust playStartTime to keep current elapsed time consistent
		// elapsed = (now - start) * oldSpeed
		// elapsed = (now - newStart) * newSpeed
		// => (now - start) * oldSpeed = (now - newStart) * newSpeed
		// => newStart = now - (now - start) * (oldSpeed / newSpeed)
		if (isPlaying) {
			const now = performance.now();
			playStartTime = now - (now - playStartTime) * (oldSpeed / speed);
		}
		
        config.onSpeedChange?.(speed);
	});
    
    // Initial speed emit
    setTimeout(() => config.onSpeedChange?.(speed), 0);
	
	// Init
	resize();
	
	return {
		setPath: (newPath: Point[]) => {
			path = newPath;
			drawPath();
		},
		getPath: () => path,
		setCursor: (x: number, y: number) => {
			if ((!isPlaying && !isRecording) || config.externalClock) {
				updateCursor(x, y);
			}
		},
        setPlaybackState: (playing: boolean) => {
            // Force UI update without triggering callbacks
            if (playing !== isPlaying) {
                isPlaying = playing;
                if (playing) {
                    playBtn.classList.add('active');
                    playBtn.setAttribute('aria-pressed', 'true');
                } else {
                    playBtn.classList.remove('active');
                    playBtn.setAttribute('aria-pressed', 'false');
                }
                // If internal clock, handle loop start/stop? 
                // For now assuming this is used mainly for external sync
                if (!config.externalClock) {
                    if (playing) startPlayback(); else stopPlayback();
                }
            }
        },
        isRecording: () => isRecording,
        isPlaying: () => isPlaying,
        play: (offsetMs?: number) => startPlayback(offsetMs),
        stop: () => stopPlayback(),
        getMode: () => mode,
        setColor: (color: string) => {
            currentColor = color;
            drawPath();
        }
	};
}

