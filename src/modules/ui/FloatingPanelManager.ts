export interface FloatingPanelConfig {
	id: string;
	element: HTMLElement;
	defaultPosition?: { x: number; y: number };
	defaultSize?: { width: number; height: number };
	minSize?: { width: number; height: number };
	maxSize?: { width: number; height: number };
	resizable?: boolean;
}

export function createFloatingPanelManager() {
	const panels = new Map<string, FloatingPanelConfig>();
	let activePanel: HTMLElement | null = null;
	let dragState: {
		panel: HTMLElement;
		startX: number;
		startY: number;
		startLeft: number;
		startTop: number;
	} | null = null;
	let resizeState: {
		panel: HTMLElement;
		handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
		startX: number;
		startY: number;
		startWidth: number;
		startHeight: number;
		startLeft: number;
		startTop: number;
		config: FloatingPanelConfig;
	} | null = null;

	function registerPanel(config: FloatingPanelConfig) {
		panels.set(config.id, config);
		setupPanel(config);
		loadPanelState(config);
	}

	function setupPanel(config: FloatingPanelConfig) {
		const { element, defaultPosition, defaultSize, resizable = true } = config;
		
		// Make panel positionable
		element.style.position = 'fixed';
		element.style.zIndex = '100';
		
		// Set default position
		if (defaultPosition) {
			element.style.left = `${defaultPosition.x}px`;
			element.style.top = `${defaultPosition.y}px`;
		}
		
		// Set default size
		if (defaultSize) {
			element.style.width = `${defaultSize.width}px`;
			element.style.height = `${defaultSize.height}px`;
		}

		// Add drag handle (header)
		const header = element.querySelector('.panel-header') as HTMLElement;
		if (header) {
			header.style.cursor = 'move';
			header.addEventListener('mousedown', (e) => startDrag(e, element));
			header.addEventListener('touchstart', (e) => {
				e.preventDefault();
				startDrag(e as any, element);
			}, { passive: false });
		}

		// Add resize handles if resizable
		if (resizable) {
			addResizeHandles(element, config);
		}

		// Bring to front on click
		element.addEventListener('mousedown', () => bringToFront(element));
	}

	function addResizeHandles(element: HTMLElement, config: FloatingPanelConfig) {
		const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
		handles.forEach(handle => {
			const div = document.createElement('div');
			div.className = `resize-handle resize-handle-${handle}`;
			div.addEventListener('mousedown', (e) => {
				e.stopPropagation();
				startResize(e, element, handle as any, config);
			});
			div.addEventListener('touchstart', (e) => {
				e.preventDefault();
				e.stopPropagation();
				startResize(e as any, element, handle as any, config);
			}, { passive: false });
			element.appendChild(div);
		});
	}

	function startDrag(e: MouseEvent | TouchEvent, panel: HTMLElement) {
		e.stopPropagation();
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
		
		const rect = panel.getBoundingClientRect();
		dragState = {
			panel,
			startX: clientX,
			startY: clientY,
			startLeft: rect.left,
			startTop: rect.top
		};
		
		bringToFront(panel);
		document.addEventListener('mousemove', onDragMove);
		document.addEventListener('mouseup', onDragEnd);
		document.addEventListener('touchmove', onDragMove);
		document.addEventListener('touchend', onDragEnd);
	}

	function onDragMove(e: MouseEvent | TouchEvent) {
		if (!dragState) return;
		e.preventDefault();
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
		
		const deltaX = clientX - dragState.startX;
		const deltaY = clientY - dragState.startY;
		
		const newLeft = dragState.startLeft + deltaX;
		const newTop = dragState.startTop + deltaY;
		
		// Constrain to viewport with margins
		const rightMargin = 20; // Minimum margin from right edge
		const leftMargin = 0; // Minimum margin from left edge
		const topMargin = 0; // Minimum margin from top edge
		const maxLeft = window.innerWidth - dragState.panel.offsetWidth - rightMargin;
		const maxTop = window.innerHeight - dragState.panel.offsetHeight - 60; // Account for toolbar
		
		dragState.panel.style.left = `${Math.max(leftMargin, Math.min(newLeft, maxLeft))}px`;
		dragState.panel.style.top = `${Math.max(topMargin, Math.min(newTop, maxTop))}px`;
	}

	function onDragEnd() {
		if (dragState) {
			savePanelState(dragState.panel);
			dragState = null;
		}
		document.removeEventListener('mousemove', onDragMove);
		document.removeEventListener('mouseup', onDragEnd);
		document.removeEventListener('touchmove', onDragMove);
		document.removeEventListener('touchend', onDragEnd);
	}

	function startResize(
		e: MouseEvent | TouchEvent,
		panel: HTMLElement,
		handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
		config: FloatingPanelConfig
	) {
		e.stopPropagation();
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
		
		const rect = panel.getBoundingClientRect();
		resizeState = {
			panel,
			handle,
			startX: clientX,
			startY: clientY,
			startWidth: rect.width,
			startHeight: rect.height,
			startLeft: rect.left,
			startTop: rect.top,
			config
		};
		
		bringToFront(panel);
		document.addEventListener('mousemove', onResizeMove);
		document.addEventListener('mouseup', onResizeEnd);
		document.addEventListener('touchmove', onResizeMove);
		document.addEventListener('touchend', onResizeEnd);
	}

	function onResizeMove(e: MouseEvent | TouchEvent) {
		if (!resizeState) return;
		const config = resizeState.config;
		e.preventDefault();
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
		
		const deltaX = clientX - resizeState.startX;
		const deltaY = clientY - resizeState.startY;
		
		let newWidth = resizeState.startWidth;
		let newHeight = resizeState.startHeight;
		let newLeft = resizeState.startLeft;
		let newTop = resizeState.startTop;
		
		const { minSize, maxSize } = config;
		const minW = minSize?.width ?? 200;
		const minH = minSize?.height ?? 150;
		const maxW = maxSize?.width ?? window.innerWidth;
		const maxH = maxSize?.height ?? window.innerHeight - 60;
		
		// Handle resize based on handle position
		if (resizeState.handle.includes('e')) {
			newWidth = Math.max(minW, Math.min(maxW, resizeState.startWidth + deltaX));
		}
		if (resizeState.handle.includes('w')) {
			newWidth = Math.max(minW, Math.min(maxW, resizeState.startWidth - deltaX));
			newLeft = resizeState.startLeft + (resizeState.startWidth - newWidth);
		}
		if (resizeState.handle.includes('s')) {
			newHeight = Math.max(minH, Math.min(maxH, resizeState.startHeight + deltaY));
		}
		if (resizeState.handle.includes('n')) {
			newHeight = Math.max(minH, Math.min(maxH, resizeState.startHeight - deltaY));
			newTop = resizeState.startTop + (resizeState.startHeight - newHeight);
		}
		
		// Constrain position with margins
		const rightMargin = 20; // Minimum margin from right edge
		const leftMargin = 0;
		const topMargin = 0;
		const maxLeft = window.innerWidth - newWidth - rightMargin;
		const maxTop = window.innerHeight - newHeight - 60;
		newLeft = Math.max(leftMargin, Math.min(newLeft, maxLeft));
		newTop = Math.max(topMargin, Math.min(newTop, maxTop));
		
		resizeState.panel.style.width = `${newWidth}px`;
		resizeState.panel.style.height = `${newHeight}px`;
		resizeState.panel.style.left = `${newLeft}px`;
		resizeState.panel.style.top = `${newTop}px`;
	}

	function onResizeEnd() {
		if (resizeState) {
			savePanelState(resizeState.panel);
			resizeState = null;
		}
		document.removeEventListener('mousemove', onResizeMove);
		document.removeEventListener('mouseup', onResizeEnd);
		document.removeEventListener('touchmove', onResizeMove);
		document.removeEventListener('touchend', onResizeEnd);
	}

	function bringToFront(panel: HTMLElement) {
		// Increase z-index of all panels
		let maxZ = 100;
		panels.forEach(config => {
			const z = parseInt(config.element.style.zIndex || '100');
			maxZ = Math.max(maxZ, z);
		});
		panel.style.zIndex = String(maxZ + 1);
		activePanel = panel;
	}

	function savePanelState(panel: HTMLElement) {
		const rect = panel.getBoundingClientRect();
		const state = {
			x: rect.left,
			y: rect.top,
			width: rect.width,
			height: rect.height
		};
		const panelId = panel.dataset.panelId || '';
		if (panelId) {
			localStorage.setItem(`panel-${panelId}`, JSON.stringify(state));
		}
	}

	function loadPanelState(config: FloatingPanelConfig) {
		const panelId = config.id;
		const saved = localStorage.getItem(`panel-${panelId}`);
		if (saved) {
			try {
				const state = JSON.parse(saved);
				config.element.style.left = `${state.x}px`;
				config.element.style.top = `${state.y}px`;
				if (state.width) config.element.style.width = `${state.width}px`;
				if (state.height) config.element.style.height = `${state.height}px`;
			} catch (e) {
				console.warn('Failed to load panel state:', e);
			}
		}
		config.element.dataset.panelId = panelId;
	}

	return {
		registerPanel
	};
}

