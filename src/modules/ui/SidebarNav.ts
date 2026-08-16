export type SidebarViewId = 'pads' | 'fx' | 'seq' | 'motion' | 'io';

const VIEWS: SidebarViewId[] = ['pads', 'fx', 'seq', 'motion', 'io'];
const STORAGE_KEY = 'undergrain_sidebar_view';

export type SidebarNav = {
	setView: (id: SidebarViewId) => void;
	getView: () => SidebarViewId;
	setLive: (id: SidebarViewId, live: boolean) => void;
};

function isViewId(value: string | null): value is SidebarViewId {
	return VIEWS.includes(value as SidebarViewId);
}

export function initSidebarNav(): SidebarNav {
	const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-rail-btn'));
	const views = Array.from(document.querySelectorAll<HTMLElement>('.sidebar-view'));
	let current: SidebarViewId = 'pads';

	function setView(id: SidebarViewId) {
		current = id;
		buttons.forEach((btn) => {
			const on = btn.dataset.view === id;
			btn.classList.toggle('is-active', on);
			btn.setAttribute('aria-selected', String(on));
		});
		views.forEach((view) => {
			const on = view.dataset.view === id;
			view.classList.toggle('is-active', on);
			view.hidden = !on;
		});
		try {
			localStorage.setItem(STORAGE_KEY, id);
		} catch {
			/* ignore quota / private mode */
		}
	}

	function getView() {
		return current;
	}

	function setLive(id: SidebarViewId, live: boolean) {
		const btn = buttons.find((b) => b.dataset.view === id);
		btn?.classList.toggle('is-live', live);
	}

	buttons.forEach((btn) => {
		btn.addEventListener('click', () => {
			if (isViewId(btn.dataset.view)) setView(btn.dataset.view);
		});
	});

	let initial: SidebarViewId = 'pads';
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (isViewId(stored)) initial = stored;
	} catch {
		/* ignore */
	}
	setView(initial);

	return { setView, getView, setLive };
}
