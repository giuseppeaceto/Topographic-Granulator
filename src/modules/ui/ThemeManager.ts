export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'undergrain-theme';

export function createThemeManager() {
	let currentTheme: Theme = 'dark';

	// Load theme from localStorage or detect system preference
	function init() {
		const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
		if (saved && (saved === 'dark' || saved === 'light')) {
			currentTheme = saved;
		} else {
			// Detect system preference
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			currentTheme = prefersDark ? 'dark' : 'light';
		}
		applyTheme(currentTheme);
	}

	function applyTheme(theme: Theme) {
		currentTheme = theme;
		document.documentElement.setAttribute('data-theme', theme);
		localStorage.setItem(STORAGE_KEY, theme);
	}

	function toggle() {
		const newTheme: Theme = currentTheme === 'dark' ? 'light' : 'dark';
		applyTheme(newTheme);
		return newTheme;
	}

	function getTheme(): Theme {
		return currentTheme;
	}

	function setTheme(theme: Theme) {
		applyTheme(theme);
	}

	return {
		init,
		toggle,
		getTheme,
		setTheme
	};
}

