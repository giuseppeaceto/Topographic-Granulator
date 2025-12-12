import { logger } from '../utils/logger';

export type AudioRecorder = {
	start: (withVideo?: boolean) => Promise<void>;
	stop: () => Promise<Blob | null>;
	isRecording: () => boolean;
	getDuration: () => number;
	getVideoMimeType: () => string;
};

export function createAudioRecorder(
	audioContext: AudioContext,
	audioNode: AudioNode
): AudioRecorder {
	let scriptProcessor: ScriptProcessorNode | null = null;
	let silentGain: GainNode | null = null;
	let recordedChannels: Float32Array[] = [];
	let startTime: number = 0;
	let isActive = false;
	let isVideoMode = false;
	let mediaRecorder: MediaRecorder | null = null;
	let videoStream: MediaStream | null = null;
	let audioStreamDestination: MediaStreamAudioDestinationNode | null = null;
	let recordedChunks: Blob[] = [];
	let videoMimeType: string = 'video/webm'; // Track the mime type used
	let videoTrackEndedHandler: (() => void) | null = null; // Store handler reference for cleanup
	
	function pickMimeType(): string | null {
		// Prefer explicit audio+video codecs; fall back to generic webm
		const candidates = [
			'video/webm;codecs=vp9,opus',
			'video/webm;codecs=vp8,opus',
			'video/webm;codecs=vp9',
			'video/webm;codecs=vp8',
			'video/webm'
		];
		for (const m of candidates) {
			if (MediaRecorder.isTypeSupported(m)) return m;
		}
		return null;
	}
	
	function tryCreateMediaRecorder(stream: MediaStream): { recorder: MediaRecorder, mime: string } {
		// Try known good mime types; if none, try without specifying
		const mime = pickMimeType();
		if (mime) {
			try {
				const rec = new MediaRecorder(stream, { mimeType: mime });
				logger.log('[Recorder] Created with mime', mime);
				return { recorder: rec, mime };
			} catch (err) {
				logger.warn('[Recorder] Failed with mime', mime, err);
			}
		}
		// Fallback: let browser pick
		const fallbackMime = 'video/webm';
		try {
			const rec = new MediaRecorder(stream, { mimeType: fallbackMime });
			logger.log('[Recorder] Created with fallback mime', fallbackMime);
			return { recorder: rec, mime: fallbackMime };
		} catch (err) {
			logger.warn('[Recorder] Failed with fallback webm', err);
		}
		// Last resort: no options
		logger.log('[Recorder] Trying without mime options');
		return { recorder: new MediaRecorder(stream), mime: '' };
	}
	const sampleRate = audioContext.sampleRate;
	const numberOfChannels = 2; // Stereo

	// Convert Float32Array to 16-bit PCM
	function floatTo16BitPCM(float32Array: Float32Array): Int16Array {
		const int16Array = new Int16Array(float32Array.length);
		for (let i = 0; i < float32Array.length; i++) {
			const s = Math.max(-1, Math.min(1, float32Array[i]));
			int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
		}
		return int16Array;
	}

	// Convert interleaved PCM data to WAV format
	function encodeWAV(samples: Float32Array[], sampleRate: number, numChannels: number): ArrayBuffer {
		const length = samples[0].length;
		const buffer = new ArrayBuffer(44 + length * numChannels * 2);
		const view = new DataView(buffer);

		// WAV header
		const writeString = (offset: number, string: string) => {
			for (let i = 0; i < string.length; i++) {
				view.setUint8(offset + i, string.charCodeAt(i));
			}
		};

		writeString(0, 'RIFF');
		view.setUint32(4, 36 + length * numChannels * 2, true);
		writeString(8, 'WAVE');
		writeString(12, 'fmt ');
		view.setUint32(16, 16, true); // fmt chunk size
		view.setUint16(20, 1, true); // audio format (1 = PCM)
		view.setUint16(22, numChannels, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
		view.setUint16(32, numChannels * 2, true); // block align
		view.setUint16(34, 16, true); // bits per sample
		writeString(36, 'data');
		view.setUint32(40, length * numChannels * 2, true);

		// Interleave and convert to 16-bit PCM
		const pcmData = new Int16Array(buffer, 44);
		for (let i = 0; i < length; i++) {
			for (let ch = 0; ch < numChannels; ch++) {
				const sample = samples[ch]?.[i] ?? 0;
				const clamped = Math.max(-1, Math.min(1, sample));
				pcmData[i * numChannels + ch] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
			}
		}

		return buffer;
	}

	async function getScreenStream(): Promise<MediaStream> {
		// Check if running in Electron
		const isElectron = 'electronAPI' in window;
		
		if (isElectron) {
			try {
				const sources = await (window as any).electronAPI.getDesktopSources();
				if (sources.length === 0) {
					throw new Error('No desktop sources found');
				}
				// Use the first source (usually the main screen)
				const sourceId = sources[0].id;
				
				const constraints = {
					audio: false, // Cannot get system audio this way easily, handled by fallback or separate audio track
					video: {
						mandatory: {
							chromeMediaSource: 'desktop',
							chromeMediaSourceId: sourceId,
							maxWidth: 1920,
							maxHeight: 1080,
							frameRate: 30
						}
					}
				};
				
				return await navigator.mediaDevices.getUserMedia(constraints as any);
			} catch (err) {
				logger.warn('[Recorder] Electron capture failed, falling back to getDisplayMedia');
				// Fallback to standard API if Electron specific method fails
			}
		}

		const videoConstraints: MediaTrackConstraints = {
			displaySurface: 'browser',
			width: { ideal: 1920 },
			height: { ideal: 1080 },
			frameRate: { ideal: 30 }
		};

		try {
			logger.log('[Recorder] Requesting display media with audio…');
			return await navigator.mediaDevices.getDisplayMedia({
				video: videoConstraints,
				audio: true
			});
		} catch (err) {
			logger.warn('[Recorder] Failed to get display media with audio, retrying without audio...', err);
			return await navigator.mediaDevices.getDisplayMedia({
				video: videoConstraints,
				audio: false
			});
		}
	}

	async function start(withVideo = false) {
		if (isActive) return;

		isVideoMode = withVideo;
		startTime = Date.now();

		if (withVideo) {
			// Video recording mode: capture screen (video) + app audio (preferito), fallback a system audio o solo video
			try {
				videoStream = await getScreenStream();
				logger.log('[Recorder] Display media acquired',
					{ videoTracks: videoStream.getVideoTracks().length, audioTracks: videoStream.getAudioTracks().length });

				const videoTrack = videoStream.getVideoTracks()[0];
				if (!videoTrack) {
					throw new Error('Nessuna traccia video dal display.');
				}

				// Stop video stream when user stops sharing
				// Store handler reference for cleanup
				videoTrackEndedHandler = () => {
					if (isActive) {
						stop();
					}
				};
				videoTrack.addEventListener('ended', videoTrackEndedHandler);

				// Create app-audio stream
				audioStreamDestination = audioContext.createMediaStreamDestination();
				audioNode.connect(audioStreamDestination);

				const appAudioTrack = audioStreamDestination.stream.getAudioTracks()[0] || null;
				const systemAudioTrack = videoStream.getAudioTracks()[0] || null;

				// Varianti: preferisci app audio, poi system audio, infine solo video
				const variants: { video: MediaStreamTrack; audio: MediaStreamTrack | null; label: string }[] = [];
				if (appAudioTrack) variants.push({ video: videoTrack, audio: appAudioTrack, label: 'video + app-audio' });
				if (systemAudioTrack) variants.push({ video: videoTrack, audio: systemAudioTrack, label: 'video + system-audio' });
				variants.push({ video: videoTrack, audio: null, label: 'video only' });

				// Log support
				logger.log('[Recorder] MIME support', {
					'video/webm;codecs=vp9,opus': MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus'),
					'video/webm;codecs=vp8,opus': MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus'),
					'video/webm;codecs=vp9': MediaRecorder.isTypeSupported('video/webm;codecs=vp9'),
					'video/webm;codecs=vp8': MediaRecorder.isTypeSupported('video/webm;codecs=vp8'),
					'video/webm': MediaRecorder.isTypeSupported('video/webm'),
					'video/mp4': MediaRecorder.isTypeSupported('video/mp4')
				});

				let created = false;
				for (const variant of variants) {
					const combinedStream = new MediaStream();
					combinedStream.addTrack(variant.video);
					if (variant.audio) combinedStream.addTrack(variant.audio);
					logger.log('[Recorder] Trying variant', variant.label, {
						video: combinedStream.getVideoTracks().length,
						audio: combinedStream.getAudioTracks().length
					});
					try {
						const { recorder, mime } = tryCreateMediaRecorder(combinedStream);
						mediaRecorder = recorder;
						videoMimeType = mime || recorder.mimeType || 'video/webm';
						logger.log('[Recorder] Created MediaRecorder with mime', videoMimeType, 'variant', variant.label);
						created = true;
						break;
					} catch (err) {
						logger.warn('[Recorder] MediaRecorder failed for variant', variant.label, err);
					}
				}

				if (!created || !mediaRecorder) {
					throw new Error('MediaRecorder non supportato per le tracce disponibili (provati: app-audio, system-audio, video-only).');
				}

				mediaRecorder.ondataavailable = (event) => {
					if (event.data.size > 0) {
						recordedChunks.push(event.data);
					}
				};

				mediaRecorder.start(100); // Collect data every 100ms
				isActive = true;
			} catch (error) {
				logger.error('Errore avvio registrazione video:', error);
				// Cleanup on error
				if (videoStream) {
					// Remove event listener before stopping tracks
					if (videoTrackEndedHandler) {
						videoStream.getVideoTracks()[0]?.removeEventListener('ended', videoTrackEndedHandler);
						videoTrackEndedHandler = null;
					}
					videoStream.getTracks().forEach(track => track.stop());
					videoStream = null;
				}
				if (audioStreamDestination) {
					try { audioNode.disconnect(audioStreamDestination); } catch {}
					audioStreamDestination = null;
				}
				isActive = false;
				throw error;
			}
		} else {
			// Audio-only mode: use ScriptProcessorNode for WAV
			recordedChannels = [];
			for (let i = 0; i < numberOfChannels; i++) {
				recordedChannels.push(new Float32Array(0));
			}

			// Use ScriptProcessorNode to capture audio data
			// Note: ScriptProcessorNode is deprecated but still widely supported
			// For better performance, AudioWorklet could be used, but requires more setup
			const bufferSize = 4096;
			scriptProcessor = audioContext.createScriptProcessor(bufferSize, numberOfChannels, numberOfChannels);
			
			scriptProcessor.onaudioprocess = (event) => {
				if (!isActive) return;

				const inputBuffer = event.inputBuffer;
				for (let ch = 0; ch < numberOfChannels; ch++) {
					const inputData = inputBuffer.getChannelData(ch);
					const currentLength = recordedChannels[ch].length;
					const newLength = currentLength + inputData.length;
					const newArray = new Float32Array(newLength);
					newArray.set(recordedChannels[ch], 0);
					newArray.set(inputData, currentLength);
					recordedChannels[ch] = newArray;
				}
			};

			// Connect audio node to script processor for recording
			// ScriptProcessor needs to be connected to a destination, but we use a silent gain node
			// to avoid duplicating audio (audioNode is already connected to destination)
			silentGain = audioContext.createGain();
			silentGain.gain.value = 0;
			silentGain.connect(audioContext.destination);
			
			audioNode.connect(scriptProcessor);
			scriptProcessor.connect(silentGain);
			isActive = true;
		}
	}

	async function stop(): Promise<Blob | null> {
		if (!isActive) return null;

		isActive = false;

		if (isVideoMode) {
			// Video recording mode
			if (!mediaRecorder) return null;
			const rec = mediaRecorder;

			return new Promise((resolve) => {
				rec.onstop = () => {
					if (recordedChunks.length === 0) {
						resolve(null);
						return;
					}
					const blob = new Blob(recordedChunks, { type: rec.mimeType || videoMimeType || 'video/webm' });
					recordedChunks = [];
					
					// Cleanup
					if (videoStream) {
						// Remove event listener before stopping tracks
						if (videoTrackEndedHandler && videoStream.getVideoTracks()[0]) {
							videoStream.getVideoTracks()[0].removeEventListener('ended', videoTrackEndedHandler);
							videoTrackEndedHandler = null;
						}
						videoStream.getTracks().forEach(track => track.stop());
						videoStream = null;
					}
					if (audioStreamDestination) {
						audioNode.disconnect(audioStreamDestination);
						audioStreamDestination = null;
					}
					mediaRecorder = null;
					
					resolve(blob);
				};

				rec.stop();
			});
		} else {
			// Audio-only mode
			if (!scriptProcessor) return null;

			// Disconnect nodes
			scriptProcessor.disconnect();
			if (silentGain) {
				silentGain.disconnect();
			}
			audioNode.disconnect(scriptProcessor);

			// Wait a bit to ensure all audio data is captured
			await new Promise(resolve => setTimeout(resolve, 100));

			if (recordedChannels.length === 0 || recordedChannels[0].length === 0) {
				return null;
			}

			// Convert to WAV
			const wavBuffer = encodeWAV(recordedChannels, sampleRate, numberOfChannels);
			const blob = new Blob([wavBuffer], { type: 'audio/wav' });

			// Cleanup
			scriptProcessor = null;
			silentGain = null;
			recordedChannels = [];

			return blob;
		}
	}

	function isRecording(): boolean {
		return isActive;
	}

	function getDuration(): number {
		if (!isActive || startTime === 0) return 0;
		return (Date.now() - startTime) / 1000; // Return duration in seconds
	}

	function getVideoMimeType(): string {
		return videoMimeType;
	}

	return { start, stop, isRecording, getDuration, getVideoMimeType };
}

