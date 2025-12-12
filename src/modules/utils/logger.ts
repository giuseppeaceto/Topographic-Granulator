/**
 * Logger utility for conditional logging in development/production
 * In production, console.log/warn are disabled to improve performance
 */

const isDev = import.meta.env.DEV;

export const logger = {
	/**
	 * Log message (only in development)
	 */
	log: (...args: any[]) => {
		if (isDev) {
			console.log(...args);
		}
	},

	/**
	 * Log warning (only in development)
	 */
	warn: (...args: any[]) => {
		if (isDev) {
			console.warn(...args);
		}
	},

	/**
	 * Log error (always logged, even in production)
	 * Errors should always be visible for debugging production issues
	 */
	error: (...args: any[]) => {
		console.error(...args);
	},

	/**
	 * Log debug info (only in development)
	 */
	debug: (...args: any[]) => {
		if (isDev) {
			console.debug(...args);
		}
	},
};

