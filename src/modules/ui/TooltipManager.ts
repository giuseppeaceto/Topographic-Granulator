/**
 * Tooltip Manager - Shows tooltips with delay on hover
 */

export interface TooltipConfig {
	delay?: number; // Delay in milliseconds before showing tooltip (default: 1500)
	position?: 'top' | 'bottom' | 'left' | 'right'; // Tooltip position relative to element
}

const DEFAULT_DELAY = 1500; // 1.5 seconds
const DEFAULT_POSITION = 'top';

let tooltipElement: HTMLElement | null = null;
let showTimeout: number | null = null;
let hideTimeout: number | null = null;
let currentTarget: HTMLElement | null = null;

function createTooltipElement(): HTMLElement {
	if (tooltipElement) return tooltipElement;
	
	const tooltip = document.createElement('div');
	tooltip.className = 'custom-tooltip';
	tooltip.setAttribute('role', 'tooltip');
	document.body.appendChild(tooltip);
	tooltipElement = tooltip;
	return tooltip;
}

function getTooltipText(element: HTMLElement): string | null {
	// Check for data-tooltip attribute first
	const dataTooltip = element.getAttribute('data-tooltip');
	if (dataTooltip) return dataTooltip;
	
	// Fallback to title attribute
	const title = element.getAttribute('title');
	if (title) return title;
	
	// Check for aria-label
	const ariaLabel = element.getAttribute('aria-label');
	if (ariaLabel) return ariaLabel;
	
	return null;
}

function positionTooltip(tooltip: HTMLElement, target: HTMLElement, position: string) {
	const rect = target.getBoundingClientRect();
	const tooltipRect = tooltip.getBoundingClientRect();
	const scrollX = window.scrollX || window.pageXOffset;
	const scrollY = window.scrollY || window.pageYOffset;
	
	let top = 0;
	let left = 0;
	
	switch (position) {
		case 'top':
			top = rect.top + scrollY - tooltipRect.height - 8;
			left = rect.left + scrollX + (rect.width / 2) - (tooltipRect.width / 2);
			break;
		case 'bottom':
			top = rect.bottom + scrollY + 8;
			left = rect.left + scrollX + (rect.width / 2) - (tooltipRect.width / 2);
			break;
		case 'left':
			top = rect.top + scrollY + (rect.height / 2) - (tooltipRect.height / 2);
			left = rect.left + scrollX - tooltipRect.width - 8;
			break;
		case 'right':
			top = rect.top + scrollY + (rect.height / 2) - (tooltipRect.height / 2);
			left = rect.right + scrollX + 8;
			break;
	}
	
	// Keep tooltip within viewport
	const padding = 8;
	left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));
	top = Math.max(padding, Math.min(top, window.innerHeight + scrollY - tooltipRect.height - padding));
	
	tooltip.style.left = `${left}px`;
	tooltip.style.top = `${top}px`;
}

function showTooltip(target: HTMLElement, config: TooltipConfig = {}) {
	const delay = config.delay ?? DEFAULT_DELAY;
	const position = config.position ?? DEFAULT_POSITION;
	
	// Clear any existing timeouts
	if (showTimeout) {
		clearTimeout(showTimeout);
		showTimeout = null;
	}
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}
	
	// If already showing for this target, don't show again
	if (currentTarget === target && tooltipElement?.classList.contains('visible')) {
		return;
	}
	
	showTimeout = window.setTimeout(() => {
		const text = getTooltipText(target);
		if (!text) return;
		
		const tooltip = createTooltipElement();
		tooltip.textContent = text;
		tooltip.className = 'custom-tooltip'; // Reset classes
		document.body.appendChild(tooltip); // Ensure it's in DOM
		
		// Force reflow to get accurate dimensions
		tooltip.style.visibility = 'hidden';
		tooltip.style.display = 'block';
		
		positionTooltip(tooltip, target, position);
		
		// Show tooltip
		tooltip.style.visibility = 'visible';
		tooltip.classList.add('visible');
		
		currentTarget = target;
		showTimeout = null;
	}, delay) as any as number;
}

function hideTooltip(immediate = false) {
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}
	
	if (showTimeout) {
		clearTimeout(showTimeout);
		showTimeout = null;
	}
	
	if (!tooltipElement) return;
	
	if (immediate) {
		tooltipElement.classList.remove('visible');
		currentTarget = null;
	} else {
		// Small delay before hiding to allow moving mouse to tooltip
		hideTimeout = window.setTimeout(() => {
			if (tooltipElement) {
				tooltipElement.classList.remove('visible');
			}
			currentTarget = null;
			hideTimeout = null;
		}, 100) as any as number;
	}
}

/**
 * Initialize tooltip for an element
 */
export function initTooltip(element: HTMLElement, config: TooltipConfig = {}) {
	// Remove title attribute to prevent native tooltip
	const title = element.getAttribute('title');
	if (title && !element.hasAttribute('data-tooltip')) {
		element.setAttribute('data-tooltip', title);
		element.removeAttribute('title');
	}
	
	element.addEventListener('mouseenter', () => {
		showTooltip(element, config);
	});
	
	element.addEventListener('mouseleave', () => {
		hideTooltip();
	});
	
	element.addEventListener('mousemove', () => {
		// Reset delay if mouse moves (user is exploring)
		if (currentTarget === element && !tooltipElement?.classList.contains('visible')) {
			showTooltip(element, config);
		}
	});
}

/**
 * Initialize tooltips for all elements with data-tooltip or title attribute
 */
export function initAllTooltips(selector: string = '[data-tooltip], [title]', config: TooltipConfig = {}) {
	const elements = document.querySelectorAll<HTMLElement>(selector);
	elements.forEach(el => initTooltip(el, config));
}

/**
 * Cleanup tooltip system
 */
export function cleanupTooltips() {
	if (tooltipElement) {
		tooltipElement.remove();
		tooltipElement = null;
	}
	if (showTimeout) {
		clearTimeout(showTimeout);
		showTimeout = null;
	}
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}
	currentTarget = null;
}

