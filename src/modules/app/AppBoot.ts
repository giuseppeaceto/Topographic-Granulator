import type { AppContext } from './AppContext';
import { createLogo3D } from '../ui/Logo3D';
import { createUpdateManager } from '../utils/updateManager';
import { createBetaExpirationManager } from '../utils/betaExpirationManager';
import { initAllTooltips } from '../ui/TooltipManager';
import { loadAudioBuffer } from '../utils/audioLoader';
import { SCALES } from '../utils/ScaleQuantizer';
import { logger } from '../utils/logger';

const QUICKSTART_STORAGE_KEY = 'undergrain_quickstart_dont_show';

const THEME_ICON_DARK = '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 1v4M12 19v4M23 12h-4M5 12H1M19.07 4.93l-2.83 2.83M7.76 16.24l-2.83 2.83M19.07 19.07l-2.83-2.83M7.76 7.76L4.93 4.93" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
const THEME_ICON_LIGHT = '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor"/></svg>';

function getAssetPath(path: string): string {
	const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
	return './' + normalizedPath;
}

function updateLogo(theme: 'dark' | 'light') {
	const appLogo = document.getElementById('appLogo');
	if (appLogo && appLogo instanceof HTMLImageElement) {
		appLogo.src = theme === 'dark'
			? getAssetPath('/images/logo.png')
			: getAssetPath('/images/logo_dark.png');
	}
}

function initLogoAndTheme(ctx: AppContext) {
	const appLogo = document.getElementById('appLogo');
	if (appLogo && appLogo instanceof HTMLCanvasElement) {
		createLogo3D(appLogo);
	}

	const themeIcon = document.getElementById('themeIcon') as HTMLElement | null;
	const initialTheme = ctx.themeManager.getTheme();
	if (themeIcon) {
		themeIcon.innerHTML = initialTheme === 'dark' ? THEME_ICON_DARK : THEME_ICON_LIGHT;
	}
	updateLogo(initialTheme);

	if (ctx.themeToggleBtn && themeIcon) {
		ctx.themeToggleBtn.addEventListener('click', () => {
			const newTheme = ctx.themeManager.toggle();
			themeIcon.innerHTML = newTheme === 'dark' ? THEME_ICON_DARK : THEME_ICON_LIGHT;
			updateLogo(newTheme);
			const fill = ctx.themeToggleBtn!.querySelector('.knob-fill') as HTMLElement | null;
			const valEl = ctx.themeToggleBtn!.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
			if (fill) fill.style.height = newTheme === 'dark' ? '100%' : '0%';
			if (valEl) valEl.textContent = newTheme === 'dark' ? '1' : '0';
		});
	}

	const themeObserver = new MutationObserver(() => {
		const currentTheme = document.documentElement.getAttribute('data-theme') as 'dark' | 'light' | null;
		if (currentTheme) {
			updateLogo(currentTheme);
		}
		ctx.waveform.forceRedraw();
		ctx.xy.updateTheme?.();
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-theme']
	});
}

function initVersion() {
	const appVersionEl = document.querySelector('.app-version') as HTMLElement | null;
	if (!appVersionEl) return;
	const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
	if (isElectron && (window as any).electronAPI?.getVersion) {
		(window as any).electronAPI.getVersion().then((version: string) => {
			if (version) {
				appVersionEl.textContent = `v${version}`;
			}
		}).catch((err: any) => {
			console.warn('Failed to get app version:', err);
		});
	}
}

function initQuickStart() {
	const helpButton = document.getElementById('helpButton') as HTMLButtonElement | null;
	const quickStartModal = document.getElementById('quickStartModal') as HTMLDivElement | null;
	const quickStartClose = document.getElementById('quickStartClose') as HTMLButtonElement | null;
	const quickStartDontShow = document.getElementById('quickStartDontShow') as HTMLInputElement | null;

	function openQuickStartModal() {
		if (!quickStartModal) return;
		quickStartModal.style.display = 'flex';
		quickStartModal.setAttribute('aria-hidden', 'false');
		quickStartModal.classList.add('open');
	}

	function closeQuickStartModal() {
		if (!quickStartModal) return;
		quickStartModal.classList.remove('open');
		setTimeout(() => {
			quickStartModal.style.display = 'none';
			quickStartModal.setAttribute('aria-hidden', 'true');
		}, 150);
	}

	if (helpButton) {
		helpButton.addEventListener('click', () => {
			openQuickStartModal();
		});
	}

	if (quickStartClose) {
		quickStartClose.addEventListener('click', () => {
			if (quickStartDontShow && quickStartDontShow.checked) {
				try {
					localStorage.setItem(QUICKSTART_STORAGE_KEY, '1');
				} catch (e) {
					logger.warn('Failed to persist quickstart preference', e);
				}
			}
			closeQuickStartModal();
		});
	}

	if (quickStartModal) {
		quickStartModal.addEventListener('click', (evt) => {
			if (evt.target === quickStartModal) {
				closeQuickStartModal();
			}
		});
	}

	try {
		const dontShow = typeof localStorage !== 'undefined'
			? localStorage.getItem(QUICKSTART_STORAGE_KEY)
			: null;
		if (!dontShow) {
			openQuickStartModal();
		}
	} catch {
		// Ignore if localStorage is not available
	}
}

function isDroppedAudioFile(file: File) {
	return file.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|aif|aiff|m4a|aac)$/i.test(file.name);
}

function initDrop(ctx: AppContext) {
	window.addEventListener('dragover', (e) => {
		e.preventDefault();
	});
	window.addEventListener('drop', async (e) => {
		e.preventDefault();
		const file = e.dataTransfer?.files?.[0];
		if (!file || !isDroppedAudioFile(file)) return;
		await ctx.host.loadAudioFromFile(file);
	});
}

function createDefaultDemoBuffer(audioCtx: AudioContext): AudioBuffer {
	const sampleRate = audioCtx.sampleRate || 44100;
	const duration = 8;
	const numSamples = Math.floor(sampleRate * duration);
	const buffer = audioCtx.createBuffer(2, numSamples, sampleRate);
	const left = buffer.getChannelData(0);
	const right = buffer.getChannelData(1);

	const freqs = [110.0, 164.81, 196.0, 261.63, 329.63, 493.88];

	for (let i = 0; i < numSamples; i++) {
		const t = i / sampleRate;
		const env = Math.sin((t / duration) * Math.PI);

		let sampleL = 0;
		let sampleR = 0;

		for (let fIdx = 0; fIdx < freqs.length; fIdx++) {
			const f = freqs[fIdx];
			const lfo = Math.sin(2 * Math.PI * 0.25 * t + fIdx) * 0.7;
			const phase = 2 * Math.PI * (f + lfo) * t;
			const val = Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.25 + (Math.abs(((phase * 0.5) % (2 * Math.PI)) / Math.PI - 1) * 2 - 1) * 0.15;
			const pan = 0.5 + 0.35 * Math.sin(2 * Math.PI * 0.1 * t + fIdx * 1.1);

			sampleL += val * (1 - pan);
			sampleR += val * pan;
		}

		const gainScale = (env * 0.2) / freqs.length;
		left[i] = sampleL * gainScale;
		right[i] = sampleR * gainScale;
	}

	return buffer;
}

async function loadDefaultAudioBuffer(ctx: AppContext) {
	const bufferDurEl = document.getElementById('bufferDur') as HTMLElement | null;
	try {
		let loadedBuffer: AudioBuffer | null = null;
		let loadedName = 'Demo Pad.wav';

		const sampleNames = ['demo.wav', 'demo.mp3', 'default.wav'];
		const candidateUrls: string[] = [];

		const origin = (window.location.origin && window.location.origin !== 'null') ? window.location.origin : '';
		const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

		for (const name of sampleNames) {
			if (origin) {
				candidateUrls.push(`${origin}${base}/audio/${name}`);
				candidateUrls.push(`${origin}/audio/${name}`);
			}
			candidateUrls.push(`${base}/audio/${name}`);
			candidateUrls.push(`/audio/${name}`);
			candidateUrls.push(`./audio/${name}`);
			candidateUrls.push(`audio/${name}`);
		}

		const uniqueUrls = Array.from(new Set(candidateUrls));

		for (const url of uniqueUrls) {
			try {
				console.log('[DefaultAudio] Attempting to fetch sample at:', url);
				const res = await fetch(url);
				const contentType = res.headers.get('content-type') || '';
				if (res.ok && !contentType.includes('text/html')) {
					const data = await res.arrayBuffer();
					console.log('[DefaultAudio] ArrayBuffer fetched, decoding audio data...', data.byteLength, 'bytes');
					loadedBuffer = await loadAudioBuffer(ctx.state.contextMgr.audioContext, data);
					loadedName = url.split('/').pop() || 'demo.wav';
					console.log('[DefaultAudio] Successfully decoded audio sample:', loadedName, loadedBuffer.duration.toFixed(2), 's');
					break;
				} else {
					console.log('[DefaultAudio] Skip URL (status or content-type mismatch):', url, res.status, contentType);
				}
			} catch (fetchErr) {
				console.warn('[DefaultAudio] Failed fetching sample URL:', url, fetchErr);
			}
		}

		if (!loadedBuffer) {
			console.log('[DefaultAudio] No file loaded from public/audio/, using synthetic demo buffer fallback.');
			loadedBuffer = createDefaultDemoBuffer(ctx.state.contextMgr.audioContext);
		}

		ctx.state.buffer = loadedBuffer;

		const fileNameEl = document.getElementById('fileName');
		if (fileNameEl) fileNameEl.textContent = loadedName;

		const fileLabel = document.querySelector('label[for="fileInput"]') as HTMLElement | null;
		if (fileLabel) fileLabel.classList.add('file-loaded');

		await ctx.host.ensureEngine();
		ctx.host.ensureEffects();

		if (ctx.state.activePadIndex === null) {
			ctx.state.activePadIndex = 0;
		}
		if (!ctx.state.regions.get(0)) {
			ctx.state.regions.set(0, { start: 0, end: loadedBuffer.duration, name: 'Full' });
		}
		ctx.host.recallPadParams(0, 0);

		ctx.waveform.setBuffer(loadedBuffer);
		ctx.session!.lastShownWaveformBuffer = loadedBuffer;
		if (bufferDurEl) bufferDurEl.textContent = `Duration: ${loadedBuffer.duration.toFixed(2)}s`;

		if (ctx.state.voiceManager) {
			await ctx.state.voiceManager.setBuffer(loadedBuffer);
		}

		ctx.host.updatePadGrid();
		ctx.host.updateSelPosUI();
		ctx.session!.syncDelayLabel();
		ctx.host.setEmptyState(false);
		await ctx.session!.maybeRestoreAutosave();
	} catch (err) {
		console.error('[DefaultAudio] Failed to initialize default audio buffer:', err);
	}
}

function initUpdater() {
	const recordStatusEl = document.getElementById('recordStatus') as HTMLElement | null;
	const updateManager = createUpdateManager();

	if (updateManager.onCheckingForUpdateManual) {
		updateManager.onCheckingForUpdateManual(() => {
			logger.log('Checking for updates...');
			if (recordStatusEl) {
				recordStatusEl.textContent = 'Verifica aggiornamenti in corso...';
			}
		});
	}

	updateManager.onUpdateAvailable((info) => {
		logger.log('Update available:', info.version);
		if (recordStatusEl) {
			recordStatusEl.textContent = `Aggiornamento disponibile: v${info.version}`;
			setTimeout(() => {
				recordStatusEl.textContent = '';
			}, 8000);
		}
	});

	if (updateManager.onUpdateNotAvailable) {
		updateManager.onUpdateNotAvailable((info) => {
			logger.log('No update available:', info.version);
			if (recordStatusEl) {
				recordStatusEl.textContent = 'Hai già la versione più recente';
				setTimeout(() => {
					recordStatusEl.textContent = '';
				}, 3000);
			}
		});
	}

	if (updateManager.onUpdateError) {
		updateManager.onUpdateError((error) => {
			const errorMessage = error?.message || error?.toString() || 'Errore sconosciuto';
			const errorCode = error?.code || error?.errno || '';
			const errorStack = error?.stack || '';

			logger.error('Update check error:', {
				message: errorMessage,
				code: errorCode,
				stack: errorStack,
				fullError: error
			});

			let userMessage = 'Errore verifica aggiornamenti: ';
			if (errorCode) {
				userMessage += `${errorMessage} (codice: ${errorCode})`;
			} else {
				userMessage += errorMessage;
			}

			if (recordStatusEl) {
				recordStatusEl.textContent = userMessage;
				setTimeout(() => {
					recordStatusEl.textContent = '';
				}, 8000);
			}

			console.error('[Update Manager] Full error details:', error);
		});
	}

	updateManager.onDownloadProgress((progress) => {
		const percent = Math.round(progress.percent || 0);
		if (recordStatusEl && percent > 0 && percent < 100) {
			recordStatusEl.textContent = `Downloading update: ${percent}%`;
		}
	});

	let updateRestartHandler: (() => Promise<void>) | null = null;
	let updateKeyboardHandler: ((e: KeyboardEvent) => void) | null = null;

	function clearUpdateNotification() {
		if (recordStatusEl && updateRestartHandler) {
			recordStatusEl.textContent = '';
			recordStatusEl.style.cursor = 'default';
			recordStatusEl.removeEventListener('click', updateRestartHandler);
			if (updateKeyboardHandler) {
				document.removeEventListener('keydown', updateKeyboardHandler);
			}
			updateRestartHandler = null;
			updateKeyboardHandler = null;
		}
	}

	updateManager.onUpdateDownloaded((info) => {
		logger.log('Update downloaded:', info.version);

		if (recordStatusEl) {
			clearUpdateNotification();

			recordStatusEl.textContent = `⚠️ Update v${info.version} ready! Click to install`;
			recordStatusEl.style.cursor = 'pointer';
			recordStatusEl.style.color = '#ffa500';
			recordStatusEl.title = 'Click to open installer (restart may be required)';
			recordStatusEl.classList.add('update-ready');

			updateRestartHandler = async () => {
				if (updateManager.restartAndInstallUpdate && recordStatusEl) {
					recordStatusEl.textContent = 'Installing...';
					recordStatusEl.style.cursor = 'default';

					try {
						const result = await updateManager.restartAndInstallUpdate();

						if (result && !result.success && result.requiresManualInstall) {
							logger.log('Manual restart required for update installation');
						} else if (result && result.success) {
							recordStatusEl.textContent = 'Restarting...';
							recordStatusEl.style.color = '';
						} else {
							recordStatusEl.textContent = 'Restart the app to complete update';
							recordStatusEl.style.color = '#ffa500';
							recordStatusEl.style.cursor = 'default';
						}
					} catch (err: any) {
						logger.error('Error installing update:', err);
						recordStatusEl.textContent = 'Chiudi l\'app e riavviala manualmente per completare l\'aggiornamento';
						recordStatusEl.style.color = '#ffa500';
						recordStatusEl.style.cursor = 'default';
					}
				}
			};

			recordStatusEl.addEventListener('click', updateRestartHandler);

			updateKeyboardHandler = async (e: KeyboardEvent) => {
				const target = e.target as HTMLElement;
				if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target.isContentEditable !== true) {
					return;
				}
				if (e.key === 'r' || e.key === 'R') {
					if (updateRestartHandler) {
						updateRestartHandler();
					}
				}
			};
			document.addEventListener('keydown', updateKeyboardHandler);
		}
	});

	if (updateManager.onUpdateInstallError) {
		updateManager.onUpdateInstallError((error) => {
			logger.log('Update install info:', error);

			if (recordStatusEl) {
				const message = error?.message || 'Restart the app to complete update';
				const dmgOpened = error?.dmgOpened === true;

				if (dmgOpened) {
					recordStatusEl.textContent = `📦 ${message}`;
					recordStatusEl.style.color = '#4CAF50';
				} else {
					recordStatusEl.textContent = `⚠️ ${message}`;
					recordStatusEl.style.color = '#ffa500';
				}
				recordStatusEl.style.cursor = 'default';
				recordStatusEl.title = message;

				setTimeout(() => {
					if (recordStatusEl && (recordStatusEl.textContent.includes('Restart') || recordStatusEl.textContent.includes('Install'))) {
						recordStatusEl.textContent = '';
						recordStatusEl.style.color = '';
					}
				}, 600000);
			}
		});
	}
}

function initScaleSelector(ctx: AppContext) {
	const prevBtn = document.getElementById('scalePrev') as HTMLButtonElement | null;
	const nextBtn = document.getElementById('scaleNext') as HTMLButtonElement | null;
	const nameEl = document.getElementById('scaleNameDisplay') as HTMLElement | null;

	if (!prevBtn || !nextBtn || !nameEl) return;

	function updateScaleUI() {
		ctx.host.applyScaleIndex(ctx.state.activeScaleIndex);
		if (ctx.state.activePadIndex != null) {
			const pos = ctx.xy.getPosition();
			ctx.host.updateVisualsFromXY(pos.x, pos.y);
		}
	}

	prevBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		ctx.state.activeScaleIndex = (ctx.state.activeScaleIndex - 1 + SCALES.length) % SCALES.length;
		updateScaleUI();
	});

	nextBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		ctx.state.activeScaleIndex = (ctx.state.activeScaleIndex + 1) % SCALES.length;
		updateScaleUI();
	});

	updateScaleUI();
}

export function initAppBoot(ctx: AppContext) {
	initLogoAndTheme(ctx);
	initVersion();
	initQuickStart();
	initDrop(ctx);
	initUpdater();
	createBetaExpirationManager().init();
	initScaleSelector(ctx);
	setTimeout(() => {
		initAllTooltips('button, .knob, [data-tooltip], [title]', { delay: 1500 });
	}, 100);
	void loadDefaultAudioBuffer(ctx);
}
