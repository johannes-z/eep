import type { AppView } from '../ui/types';

const navigation = [
  { view: 'overview' as const, label: 'Devices', icon: '⌂' },
  { view: 'settings' as const, label: 'Transport', icon: '◫' },
  { view: 'mqtt' as const, label: 'MQTT', icon: '◌' },
  { view: 'homeassistant' as const, label: 'Home Assistant', icon: '⌘' },
];

const pageTitles: Record<AppView, string> = {
  overview: 'Devices',
  settings: 'Transport',
  mqtt: 'MQTT',
  homeassistant: 'Home Assistant',
};

export function Sidebar({ view, onView }: { view: AppView; onView: (view: AppView) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">E</div>
        <div>
          <strong>eep</strong>
          <span>EnOcean</span>
        </div>
      </div>
      <nav aria-label="Primary navigation">
        <p className="nav-heading">General</p>
        {navigation.slice(0, 1).map((item) => (
          <button
            className={`nav-item ${view === item.view ? 'selected' : ''}`}
            key={item.view}
            onClick={() => onView(item.view)}
            type="button"
          >
            <span
              aria-hidden="true"
              className="nav-icon"
            >
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
        <p className="nav-heading nav-heading-spaced">Settings</p>
        {navigation.slice(1).map((item) => (
          <button
            className={`nav-item ${view === item.view ? 'selected' : ''}`}
            key={item.view}
            onClick={() => onView(item.view)}
            type="button"
          >
            <span
              aria-hidden="true"
              className="nav-icon"
            >
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="status-dot online" />
        <span>ESP3 transport</span>
      </div>
    </aside>
  );
}

export function TopBar({
  view,
  pairing,
  onPairing,
}: {
  view: AppView;
  pairing: boolean;
  onPairing: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="breadcrumb">eep</span>
        <h1>{pageTitles[view]}</h1>
      </div>
      <div className="topbar-actions">
        <span className="connection-state">
          <span className="status-dot online" />
          Running
        </span>
        <button
          aria-pressed={pairing}
          className={`pair-button ${pairing ? 'active' : ''}`}
          onClick={onPairing}
          type="button"
        >
          {pairing ? 'Stop joining' : 'Permit join'}
        </button>
      </div>
    </header>
  );
}
