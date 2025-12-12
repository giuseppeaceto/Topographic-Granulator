import { createGranularWorkletEngine, type GranularWorkletEngine, type GranularParams } from '../granular/GranularWorkletEngine';
import type { EffectsParams } from '../effects/EffectsChain';
import type { Region } from '../editor/RegionStore';
import type { MotionPoint, PadParams } from '../editor/PadParamStore';
import { PARAMS, type ParamId } from '../ui/ParamRegistry';
import { ParameterMapper } from '../utils/ParameterMapper';

export type Voice = {
	id: number;
	engine: GranularWorkletEngine;
	active: boolean;
	padIndex: number | null;
	startTime: number;
	
    // Motion / Automation State
	motionPath: MotionPoint[] | null;
    motionMode: 'loop' | 'pingpong' | 'oneshot' | 'reverse';
	motionStartTime: number;
    motionSpeed: number;
    
    // Position State
    currentX: number;
    currentY: number;
    isManualOverride: boolean; // True if user is manually dragging XY

	baseParams: { granular: GranularParams; effects: EffectsParams; xy: { x: number; y: number }; selectionPos?: number } | null;
    // Cache last sent params to avoid flooding the audio thread
    lastSentGranular: Partial<GranularParams> | null;
    lastSentFx: Partial<EffectsParams> | null;
    lastSelectionPos: number | null;

	cornerMapping: { tl: string; tr: string; bl: string; br: string } | null;
    
    // Store region for selectionPos calculation
    region: Region | null;
    
    // Store indices for real-time lookup (Pads Mode)
    padMorphIndices?: {
        tl: number | null;
        tr: number | null;
        bl: number | null;
        br: number | null;
    };
};

export class VoiceManager {
	private voices: Voice[] = [];
	private context: AudioContext;
	private buffer: AudioBuffer | null = null;
	private maxVoices: number;
	private nextVoiceId = 0;
	private animationFrame: number | null = null;
    private paramProvider: ((index: number) => PadParams | null) | null = null;

	constructor(context: AudioContext, maxVoices: number = 4) {
		this.context = context;
		this.maxVoices = maxVoices;
	}

	async init(destination: AudioNode, paramProvider: (index: number) => PadParams | null) {
        this.paramProvider = paramProvider;
		// Create pool of engines
		for (let i = 0; i < this.maxVoices; i++) {
			const engine = await createGranularWorkletEngine(this.context);
			engine.connect(destination); 
			this.voices.push({
				id: i,
				engine,
				active: false,
				padIndex: null,
				startTime: 0,
				motionPath: null,
                motionMode: 'loop',
				motionStartTime: 0,
                motionSpeed: 1.0,
                currentX: 0.5,
                currentY: 0.5,
                isManualOverride: false,
				baseParams: null,
                lastSentGranular: null,
                lastSentFx: null,
                lastSelectionPos: null,
				cornerMapping: null,
                region: null
			});
		}
        // Start the internal automation loop
		this.startAnimationLoop();
	}

    // --- AUTOMATION ENGINE ---

    private startAnimationLoop() {
        let lastAudioUpdate = 0;
        const AUDIO_UPDATE_INTERVAL = 33; // ~30fps for audio updates (throttle to reduce CPU)
        
        const loop = () => {
            const now = performance.now();
            const shouldUpdateAudio = (now - lastAudioUpdate) >= AUDIO_UPDATE_INTERVAL;
            
            this.updateVoices(shouldUpdateAudio);
            
            if (shouldUpdateAudio) {
                lastAudioUpdate = now;
            }
            
            this.animationFrame = requestAnimationFrame(loop);
        };
        this.animationFrame = requestAnimationFrame(loop);
    }

    private updateVoices(updateAudio: boolean = true) {
        const now = performance.now();

        this.voices.forEach(voice => {
            if (!voice.active || !voice.baseParams) return;

            // Early exit: if no motion path and not manual override, skip calculation
            // 1. Calculate Position (XY)
            // If manual override is active, we skip path calculation (currentX/Y are set by setVoiceXY)
            if (!voice.isManualOverride && voice.motionPath && voice.motionPath.length >= 2) {
                const motionPath = voice.motionPath; // Type guard for TypeScript
                const elapsed = (now - voice.motionStartTime) * voice.motionSpeed;
                const totalDuration = motionPath[motionPath.length - 1].time;
                
                if (totalDuration > 0) {
                    let t = 0;
                    // Handle Loop Modes
                    if (voice.motionMode === 'oneshot') {
                        if (elapsed > totalDuration) {
                            // Stay at end or stop? usually stay at end for automation
                            t = totalDuration; 
                        } else {
                            t = elapsed;
                        }
                    } else if (voice.motionMode === 'loop') {
                        t = elapsed % totalDuration;
                    } else if (voice.motionMode === 'reverse') {
                        t = totalDuration - (elapsed % totalDuration);
                    } else if (voice.motionMode === 'pingpong') {
                        const cycle = totalDuration * 2;
                        const phase = elapsed % cycle;
                        t = phase < totalDuration ? phase : (2 * totalDuration - phase);
                    }

                    // Interpolate Position
                    const pos = this.interpolatePath(motionPath, t);
                    voice.currentX = pos.x;
                    voice.currentY = pos.y;
                }
            }

            // 2. Map XY to Parameters (Bilinear Interpolation)
            // Only update audio thread if updateAudio is true (throttled to ~30fps)
            // This reduces CPU load significantly when multiple pads are active
            if (updateAudio) {
                this.applyXYToParams(voice);
            }
        });
    }

    private interpolatePath(path: MotionPoint[], t: number): { x: number, y: number } {
        // Optimized binary search for path interpolation (better performance with long paths)
        if (path.length === 0) return { x: 0.5, y: 0.5 };
        if (path.length === 1) return { x: path[0].x, y: path[0].y };
        
        // Clamp t to valid range
        const lastTime = path[path.length - 1].time;
        if (t <= 0) return { x: path[0].x, y: path[0].y };
        if (t >= lastTime) return { x: path[path.length - 1].x, y: path[path.length - 1].y };

        // Binary search for the segment containing t
        let left = 0;
        let right = path.length - 1;
        
        while (right - left > 1) {
            const mid = Math.floor((left + right) / 2);
            if (path[mid].time <= t) {
                left = mid;
            } else {
                right = mid;
            }
        }

        const prev = path[left];
        const next = path[right];
        const duration = next.time - prev.time;
        const progress = duration > 0 ? (t - prev.time) / duration : 0;
        
        return {
            x: prev.x + (next.x - prev.x) * progress,
            y: prev.y + (next.y - prev.y) * progress
        };
    }

    private applyXYToParams(voice: Voice) {
        if (!voice.baseParams || !voice.cornerMapping) return;

        // 1. Calculate Weights
        const weights = ParameterMapper.calculateWeights(voice.currentX, voice.currentY);

        // 2. Map Parameters using shared logic
        const { granular: granularUpdate, effects: fxUpdate, selectionPos: selectionPosUpdate } = ParameterMapper.mapParams(
            weights,
            voice.baseParams,
            voice.cornerMapping
        );

        // Apply to Engine with Dirty Checking
        // Increased EPSILON to reduce update frequency and CPU load
        // 0.01 = 1% change threshold (was 0.001 = 0.1%)
        // This significantly reduces audio thread updates when multiple pads are active
        const EPSILON = 0.01; // Significant change threshold (1% of parameter range)

        // Helper to check diff
        const hasChanged = (newP: any, oldP: any | null) => {
            if (!oldP) return true;
            for (const k in newP) {
                if (Math.abs((newP[k] as number) - (oldP[k] as number)) > EPSILON) return true;
            }
            return false;
        };

        if (Object.keys(granularUpdate).length > 0) {
            if (hasChanged(granularUpdate, voice.lastSentGranular)) {
                voice.engine.setParams(granularUpdate);
                voice.lastSentGranular = { ...voice.lastSentGranular, ...granularUpdate };
            }
        }
        if (Object.keys(fxUpdate).length > 0) {
            if (hasChanged(fxUpdate, voice.lastSentFx)) {
                voice.engine.setEffectParams(fxUpdate);
                voice.lastSentFx = { ...voice.lastSentFx, ...fxUpdate };
            }
        }
        
        // Apply selectionPos to region if calculated and changed
        if (selectionPosUpdate !== undefined && this.buffer && voice.region) {
            if (voice.lastSelectionPos === null || Math.abs(selectionPosUpdate - voice.lastSelectionPos) > EPSILON) {
                const width = voice.region.end - voice.region.start;
                const movable = Math.max(0, this.buffer.duration - width);
                if (movable > 0) {
                    const newStart = selectionPosUpdate * movable;
                    const newEnd = newStart + width;
                    // Clamp to buffer bounds
                    const clampedStart = Math.max(0, Math.min(newStart, this.buffer.duration - width));
                    const clampedEnd = Math.min(this.buffer.duration, clampedStart + width);
                    
                    voice.engine.setRegion(clampedStart, clampedEnd);
                    voice.lastSelectionPos = selectionPosUpdate;
                }
            }
        }
    }

    // --- INTERFACE METHODS ---

	async setBuffer(buffer: AudioBuffer) {
		this.buffer = buffer;
		// Update all voices (even inactive ones, so they are ready)
		await Promise.all(this.voices.map(v => v.engine.setBuffer(buffer)));
	}

	// Trigger a voice for a specific pad
	trigger(
		padIndex: number, 
		region: Region, 
		granular: GranularParams, 
		effects: EffectsParams, 
		xy: { x: number, y: number },
		motionPath?: MotionPoint[],
        motionMode: 'loop' | 'pingpong' | 'oneshot' | 'reverse' = 'loop',
        motionSpeed: number = 1.0,
		cornerMapping?: { tl: string; tr: string; bl: string; br: string },
        padMorphIndices?: { tl: number | null; tr: number | null; bl: number | null; br: number | null }
	) {
        // Voice Reservation Logic:
        // 1. Try to find an existing voice for this pad (active or inactive) to reuse
        let voice = this.voices.find(v => v.padIndex === padIndex);
        
        // 2. If no voice assigned to this pad, look for a completely free voice
        if (!voice) {
            voice = this.voices.find(v => !v.active && v.padIndex === null);
        }
        
        // 3. If still no voice, find a free voice that was assigned to another pad but is now inactive
        if (!voice) {
            voice = this.voices.find(v => !v.active);
        }

        // 4. Hard stealing (should rarely happen if maxVoices >= maxPads)
        // Steal the oldest voice, but prefer stealing one that is NOT the current pad if possible
		if (!voice) {
			voice = this.voices.reduce((prev, curr) => (curr.startTime < prev.startTime ? curr : prev));
		}

		voice.active = true;
		voice.padIndex = padIndex;
		voice.startTime = performance.now();
        
        // Setup Motion
		voice.motionPath = (motionPath && motionPath.length >= 2 && motionPath[motionPath.length-1].time > 0) ? motionPath : null;
        voice.motionMode = motionMode;
		voice.motionStartTime = performance.now();
        voice.motionSpeed = motionSpeed;
        
        // Reset Override
        voice.isManualOverride = false;
        voice.currentX = xy.x;
        voice.currentY = xy.y;

        // Deep copy base params to avoid reference issues
        // Calculate initial selectionPos from region
        const regionWidth = region.end - region.start;
        const movable = this.buffer ? Math.max(0, this.buffer.duration - regionWidth) : 0;
        const initialSelectionPos = movable > 0 ? region.start / movable : 0;
        
		voice.baseParams = { granular: { ...granular }, effects: { ...effects }, xy: { ...xy }, selectionPos: initialSelectionPos };
		voice.cornerMapping = cornerMapping ? { ...cornerMapping } : null;
        voice.padMorphIndices = padMorphIndices ? { ...padMorphIndices } : undefined;
        voice.region = { ...region };

        // Reset dirty check cache on new trigger
        voice.lastSentGranular = null;
        voice.lastSentFx = null;
        voice.lastSelectionPos = null;

		// Set initial params
        voice.engine.setParams(granular);
        voice.engine.setEffectParams(effects);
        voice.engine.setRegion(region.start, region.end);
        
		voice.engine.trigger();

		return voice;
	}

    // Allow UI to override automation (e.g., dragging XY pad)
    setVoiceManualOverride(padIndex: number, active: boolean, x?: number, y?: number) {
        const voice = this.getActiveVoiceForPad(padIndex);
        if (voice) {
            voice.isManualOverride = active;
            if (active && x !== undefined && y !== undefined) {
                voice.currentX = x;
                voice.currentY = y;
                // Force immediate update
                this.applyXYToParams(voice);
            } else if (!active) {
                // When releasing override, we need to resync the motion time?
                // Option A: Jump back to where automation SHOULD be (keep sync) -> Do nothing, loop handles it
                // Option B: Restart automation from here? -> Keep simple (Option A)
            }
        }
    }

    // Helper to get current XY for UI visualization
    getVoiceCurrentXY(padIndex: number): { x: number, y: number } | null {
        const voice = this.getActiveVoiceForPad(padIndex);
        if (voice && voice.active) {
            return { x: voice.currentX, y: voice.currentY };
        }
        return null;
    }

    // Get positions of ALL active voices for "Ghost Cursors"
    getAllVoicePositions(): { x: number; y: number; colorIndex: number }[] {
        return this.voices
            .filter(v => v.active && v.padIndex != null)
            .map(v => ({
                x: v.currentX,
                y: v.currentY,
                colorIndex: v.padIndex!
            }));
    }


	stopAll() {
		this.voices.forEach(v => {
			v.engine.stop();
			v.active = false;
		});
	}

	getActiveVoiceForPad(padIndex: number): Voice | undefined {
		// Find the most recently triggered voice for this pad
		return this.voices
			.filter(v => v.active && v.padIndex === padIndex)
			.sort((a, b) => b.startTime - a.startTime)[0];
	}

    // Check if a pad is already playing
    isPadPlaying(padIndex: number): boolean {
        return this.voices.some(v => v.active && v.padIndex === padIndex);
    }

    // Get current motion path progress for a pad (in ms)
    getVoiceMotionProgress(padIndex: number): number | null {
        const voice = this.getActiveVoiceForPad(padIndex);
        if (!voice || !voice.motionPath || !voice.active) return null;
        
        const now = performance.now();
        const elapsed = now - voice.motionStartTime;
        const totalDuration = voice.motionPath[voice.motionPath.length - 1].time;
        if (totalDuration <= 0) return 0;
        
        // Return phase in loop (0..duration)
        return elapsed % totalDuration;
    }

    // Stop all voices for a specific pad
    stopPad(padIndex: number) {
        this.voices.forEach(v => {
            if (v.active && v.padIndex === padIndex) {
                v.engine.stop();
                v.active = false;
            }
        });
    }

    // Update the motion path for a specific pad's active voice (live update)
    setVoiceMotionPath(padIndex: number, path: MotionPoint[] | null, mode: 'loop' | 'pingpong' | 'oneshot' | 'reverse' = 'loop', speed: number = 1.0) {
        // No longer needed - logic moved to main loop via MotionPanel events
        return;
    }

    // Update motion speed for a specific pad's active voice (live update without retrigger)
    setVoiceMotionSpeed(padIndex: number, speed: number) {
        const voice = this.getActiveVoiceForPad(padIndex);
        if (voice && voice.active) {
            voice.motionSpeed = speed;
            // Don't reset manual override - allow user to continue controlling if they are
        }
    }

    // Update motion mode for a specific pad's active voice (live update without retrigger)
    setVoiceMotionMode(padIndex: number, mode: 'loop' | 'pingpong' | 'oneshot' | 'reverse') {
        const voice = this.getActiveVoiceForPad(padIndex);
        if (voice && voice.active) {
            voice.motionMode = mode;
            // Don't reset manual override - allow user to continue controlling if they are
        }
    }

    /**
     * Cleanup method to stop animation loop and release resources
     * Should be called when VoiceManager is no longer needed (e.g., app shutdown)
     */
    destroy() {
        // Stop animation loop to prevent memory leak
        if (this.animationFrame !== null) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Stop all voices
        this.stopAll();

        // Clear references
        this.voices = [];
        this.buffer = null;
        this.paramProvider = null;
    }

    /*
	// Main animation loop for motion paths
    // REMOVED: Motion logic is now driven by MotionPanel -> xy.onChange -> voice.setParams
    // This ensures perfect sync between visual cursor and audio parameters.
	private startAnimationLoop() {
        // ... (removed loop)
	}

	private applyMotionToVoice(voice: Voice, x: number, y: number) {
        // ... (removed logic)
	}
    */
}
