import { PARAMS, type ParamId } from './ParamRegistry';

export interface SelectOption {
	value: string;
	label: string;
	icon?: string;
}

export interface CustomSelectConfig {
	element: HTMLElement;
	options: SelectOption[];
	value: string;
	onChange: (value: string) => void;
}

// Icon mappings for parameters
const PARAM_ICONS: Record<string, string> = {
	grainSizeMs: '●',
	density: '▦',
	randomStartMs: '↻',
	pitchSemitones: '♪',
	filterCutoffHz: '◐',
	delayTimeSec: '⏱',
	delayMix: '⟲',
	reverbMix: '◉',
	masterGain: '◉',
	selectionPos: '▬',
	filterQ: '◐'
};

// Icon for pads
const PAD_ICON = '▦';

export function createCustomSelect(config: CustomSelectConfig) {
	const { element, options, value, onChange } = config;
	
	// Clear existing content but preserve existing classes
	const existingClasses = element.className.split(' ').filter(c => c && c !== 'custom-select');
	element.innerHTML = '';
	element.className = ['custom-select', ...existingClasses].filter(Boolean).join(' ');
	
	// Create button (visible element)
	const button = document.createElement('button');
	button.className = 'custom-select-button';
	button.type = 'button';
	button.setAttribute('aria-haspopup', 'listbox');
	button.setAttribute('aria-expanded', 'false');
	
	// Create dropdown menu
	const dropdown = document.createElement('div');
	dropdown.className = 'custom-select-dropdown';
	dropdown.setAttribute('role', 'listbox');
	
	// Find current option
	const currentOption = options.find(opt => opt.value === value) || options[0];
	
	function updateButton() {
		const selected = options.find(opt => opt.value === button.dataset.value) || options[0];
		const icon = selected.icon || (selected.value.startsWith('pad:') ? PAD_ICON : PARAM_ICONS[selected.value] || '○');
		button.innerHTML = `<span class="custom-select-icon">${icon}</span><span class="custom-select-label">${selected.label}</span><span class="custom-select-arrow">▼</span>`;
		button.dataset.value = selected.value;
		button.setAttribute('aria-label', selected.label);
	}
	
	// Populate dropdown
	options.forEach(option => {
		const item = document.createElement('div');
		item.className = 'custom-select-option';
		item.setAttribute('role', 'option');
		item.dataset.value = option.value;
		const icon = option.icon || (option.value.startsWith('pad:') ? PAD_ICON : PARAM_ICONS[option.value] || '○');
		item.innerHTML = `<span class="custom-select-icon">${icon}</span><span class="custom-select-label">${option.label}</span>`;
		
		if (option.value === value) {
			item.classList.add('selected');
			item.setAttribute('aria-selected', 'true');
		}
		
		item.addEventListener('click', () => {
			const newValue = option.value;
			button.dataset.value = newValue;
			updateButton();
			closeDropdown();
			onChange(newValue);
			
			// Update selected state
			dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
				opt.classList.remove('selected');
				opt.removeAttribute('aria-selected');
			});
			item.classList.add('selected');
			item.setAttribute('aria-selected', 'true');
		});
		
		dropdown.appendChild(item);
	});
	
	function openDropdown() {
		button.classList.add('active');
		button.setAttribute('aria-expanded', 'true');
		dropdown.style.display = 'block';
		// Position dropdown
		const rect = button.getBoundingClientRect();
		const dropdownHeight = 200; // max-height from CSS
		const spaceBelow = window.innerHeight - rect.bottom;
		const spaceAbove = rect.top;
		
		// Open upward if not enough space below but enough space above
		if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
			dropdown.classList.add('open-up');
			dropdown.style.bottom = `${window.innerHeight - rect.top + 2}px`;
			dropdown.style.top = 'auto';
		} else {
			dropdown.classList.remove('open-up');
			dropdown.style.top = `${rect.bottom + 2}px`;
			dropdown.style.bottom = 'auto';
		}
		dropdown.style.left = `${rect.left}px`;
		dropdown.style.minWidth = `${rect.width}px`;
	}
	
	function closeDropdown() {
		button.classList.remove('active');
		button.setAttribute('aria-expanded', 'false');
		dropdown.style.display = 'none';
	}
	
	button.addEventListener('click', (e) => {
		e.stopPropagation();
		if (button.classList.contains('active')) {
			closeDropdown();
		} else {
			openDropdown();
		}
	});
	
	// Close on outside click
	document.addEventListener('click', (e) => {
		if (!element.contains(e.target as Node)) {
			closeDropdown();
		}
	});
	
	// Keyboard navigation
	button.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (!button.classList.contains('active')) {
				openDropdown();
			}
		} else if (e.key === 'Escape') {
			closeDropdown();
		}
	});
	
	dropdown.addEventListener('keydown', (e) => {
		const items = Array.from(dropdown.querySelectorAll('.custom-select-option')) as HTMLElement[];
		const currentIndex = items.findIndex(item => item.classList.contains('selected'));
		
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
			items[nextIndex].click();
			items[nextIndex].focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
			items[prevIndex].click();
			items[prevIndex].focus();
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			items[currentIndex]?.click();
		} else if (e.key === 'Escape') {
			closeDropdown();
			button.focus();
		}
	});
	
	// Set initial value
	button.dataset.value = value;
	updateButton();
	
	element.appendChild(button);
	element.appendChild(dropdown);
	
	// Make options focusable
	dropdown.querySelectorAll('.custom-select-option').forEach(item => {
		(item as HTMLElement).setAttribute('tabindex', '0');
	});
	
	return {
		setValue: (newValue: string) => {
			button.dataset.value = newValue;
			updateButton();
			// Update selected state in dropdown
			dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
				const optEl = opt as HTMLElement;
				optEl.classList.remove('selected');
				optEl.removeAttribute('aria-selected');
				if (optEl.dataset.value === newValue) {
					optEl.classList.add('selected');
					optEl.setAttribute('aria-selected', 'true');
				}
			});
		},
		getValue: () => button.dataset.value || '',
		setOptions: (newOptions: SelectOption[]) => {
			dropdown.innerHTML = '';
			newOptions.forEach(option => {
				const item = document.createElement('div');
				item.className = 'custom-select-option';
				item.setAttribute('role', 'option');
				item.dataset.value = option.value;
				const icon = option.icon || (option.value.startsWith('pad:') ? PAD_ICON : PARAM_ICONS[option.value] || '○');
				item.innerHTML = `<span class="custom-select-icon">${icon}</span><span class="custom-select-label">${option.label}</span>`;
				
				if (option.value === button.dataset.value) {
					item.classList.add('selected');
					item.setAttribute('aria-selected', 'true');
				}
				
				item.addEventListener('click', () => {
					const newValue = option.value;
					button.dataset.value = newValue;
					updateButton();
					closeDropdown();
					onChange(newValue);
					
					dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
						opt.classList.remove('selected');
						opt.removeAttribute('aria-selected');
					});
					item.classList.add('selected');
					item.setAttribute('aria-selected', 'true');
				});
				
				(item as HTMLElement).setAttribute('tabindex', '0');
				dropdown.appendChild(item);
			});
		}
	};
}

