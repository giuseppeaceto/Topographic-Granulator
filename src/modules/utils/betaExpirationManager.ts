/**
 * Beta Expiration Manager - Gestisce i warning per versioni beta scadenti
 * Soft expiration: mostra warning ma non blocca l'app
 */

export interface BetaExpirationInfo {
  daysRemaining: number;
  expirationDate: string;
}

export function createBetaExpirationManager() {
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

  if (!isElectron) {
    return {
      init: () => {},
      showWarning: () => {},
      showInfo: () => {},
    };
  }

  const electronAPI = (window as any).electronAPI;
  let warningBanner: HTMLElement | null = null;

  function showWarningBanner(message: string, type: 'warning' | 'info' = 'warning') {
    // Remove existing banner if present
    if (warningBanner) {
      warningBanner.remove();
    }

    // Create banner element
    warningBanner = document.createElement('div');
    warningBanner.className = `beta-expiration-banner ${type}`;
    warningBanner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10000;
      padding: 12px 20px;
      background: ${type === 'warning' ? 'linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'};
      color: white;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    `;

    const icon = document.createElement('span');
    icon.textContent = type === 'warning' ? '⚠️' : 'ℹ️';
    icon.style.fontSize = '18px';

    const text = document.createElement('span');
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
      background: rgba(255,255,255,0.2);
      border: none;
      color: white;
      font-size: 20px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      margin-left: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    `;
    closeBtn.onmouseover = () => { closeBtn.style.background = 'rgba(255,255,255,0.3)'; };
    closeBtn.onmouseout = () => { closeBtn.style.background = 'rgba(255,255,255,0.2)'; };
    closeBtn.onclick = () => {
      if (warningBanner) {
        warningBanner.remove();
        warningBanner = null;
      }
    };

    warningBanner.appendChild(icon);
    warningBanner.appendChild(text);
    warningBanner.appendChild(closeBtn);

    document.body.appendChild(warningBanner);
  }

  function showWarning(info: BetaExpirationInfo) {
    const days = info.daysRemaining;
    const date = new Date(info.expirationDate).toLocaleDateString('it-IT', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
    
    const message = days === 1 
      ? `⚠️ Versione BETA - Scade domani (${date}). Aggiorna l'app per continuare a ricevere nuove versioni.`
      : `⚠️ Versione BETA - Scade tra ${days} giorni (${date}). Aggiorna l'app per continuare a ricevere nuove versioni.`;
    
    showWarningBanner(message, 'warning');
  }

  function showInfo(info: BetaExpirationInfo) {
    const date = new Date(info.expirationDate).toLocaleDateString('it-IT', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
    
    const message = `ℹ️ Questa è una versione BETA che era prevista scadere il ${date}. Considera di aggiornare l'app per ricevere nuove versioni.`;
    
    showWarningBanner(message, 'info');
  }

  function init() {
    if (!electronAPI?.onBetaExpirationWarning || !electronAPI?.onBetaExpirationInfo) {
      return;
    }

    // Listen for warning (30 days or less remaining)
    electronAPI.onBetaExpirationWarning((info: BetaExpirationInfo) => {
      showWarning(info);
    });

    // Listen for info (expired but still works)
    electronAPI.onBetaExpirationInfo((info: BetaExpirationInfo) => {
      showInfo(info);
    });
  }

  return {
    init,
    showWarning,
    showInfo,
  };
}

