export type AudioRecorder = {
	start: (withVideo?: boolean) => Promise<void>;
	stop: () => Promise<Blob | null>;
	isRecording: () => boolean;
	getDuration: () => number;
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

	async function start(withVideo = false) {
		if (isActive) return;

		isVideoMode = withVideo;
		startTime = Date.now();

		if (withVideo) {
			// Video recording mode: capture screen + audio
			try {
				// Request screen capture with audio (system audio if available)
				videoStream = await navigator.mediaDevices.getDisplayMedia({
					video: { 
						displaySurface: 'browser',
						width: { ideal: 1920 },
						height: { ideal: 1080 }
					} as any,
					audio: {
						echoCancellation: false,
						noiseSuppression: false,
						autoGainControl: false
					} as any // Try to get system audio if available
				});

				// Stop video stream when user stops sharing
				videoStream.getVideoTracks()[0].addEventListener('ended', () => {
					if (isActive) {
						stop();
					}
				});

				// Create audio stream from audio node (app audio)
				audioStreamDestination = audioContext.createMediaStreamDestination();
				audioNode.connect(audioStreamDestination);

				// Combine video and audio streams
				const combinedStream = new MediaStream();
				// Add video track
				videoStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));
				// Add app audio track (from audio node)
				audioStreamDestination.stream.getAudioTracks().forEach(track => combinedStream.addTrack(track));
				// Also add system audio if available from screen capture
				videoStream.getAudioTracks().forEach(track => combinedStream.addTrack(track));

				// Setup MediaRecorder for video
				recordedChunks = [];
				const options: MediaRecorderOptions = {};
				// Prioritize MP4 if supported (Safari, some browsers)
				if (MediaRecorder.isTypeSupported('video/mp4')) {
					options.mimeType = 'video/mp4';
					videoMimeType = 'video/mp4';
				} else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
					options.mimeType = 'video/webm;codecs=vp9';
					videoMimeType = 'video/webm';
				} else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
					options.mimeType = 'video/webm;codecs=vp8';
					videoMimeType = 'video/webm';
				} else if (MediaRecorder.isTypeSupported('video/webm')) {
					options.mimeType = 'video/webm';
					videoMimeType = 'video/webm';
				} else {
					videoMimeType = 'video/webm'; // fallback
				}

				mediaRecorder = new MediaRecorder(combinedStream, options);
				mediaRecorder.ondataavailable = (event) => {
					if (event.data.size > 0) {
						recordedChunks.push(event.data);
					}
				};

				mediaRecorder.start(100); // Collect data every 100ms
				isActive = true;
			} catch (error) {
				console.error('Errore avvio registrazione video:', error);
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

			return new Promise((resolve) => {
				mediaRecorder!.onstop = () => {
					if (recordedChunks.length === 0) {
						resolve(null);
						return;
					}
					const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'video/webm' });
					recordedChunks = [];
					
					// Cleanup
					if (videoStream) {
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

				mediaRecorder.stop();
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

