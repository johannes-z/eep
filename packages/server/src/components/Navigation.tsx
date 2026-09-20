import { Link } from '@tanstack/react-router';
import { Activity, Cable, Cpu, House, Menu, Network, Radio, X } from 'lucide-react';
import { appRoutes } from '../ui/routes';
import type { MqttResponse, TransportResponse } from '../ui/types';

const icons = {
  devices: Cpu,
  pairing: Radio,
  'packet-listener': Activity,
  settings: Cable,
  mqtt: Network,
  homeassistant: House,
};

export function Sidebar({
  mqtt,
  transport,
  onNavigate,
}: {
  mqtt: MqttResponse | null;
  transport: TransportResponse | null;
  onNavigate: () => void;
}) {
  const mqttStatus = mqtt?.connected
    ? 'Connected'
    : mqtt?.error
      ? 'Error'
      : mqtt?.configured
        ? 'Connecting'
        : mqtt
          ? 'Not configured'
          : 'Loading';
  const mqttStatusTone = mqtt?.connected ? 'online' : mqtt?.error ? 'error' : 'warning';
  const transportStatus = transport
    ? transport.connected
      ? 'Connected'
      : transport.type === 'none'
        ? 'Disabled'
        : 'Disconnected'
    : 'Loading';
  const transportStatusTone = !transport
    ? 'warning'
    : transport.connected
      ? 'online'
      : transport.type === 'none'
        ? 'neutral'
        : 'error';

  return (
    <aside
      className="sidebar"
      id="primary-navigation"
    >
      <Link
        className="brand"
        to="/devices"
        onClick={onNavigate}
      >
        <Radio
          className="brand-mark"
          size={30}
          aria-hidden="true"
        />
        <div>
          <strong>
            EnOcean<span>2MQTT</span>
          </strong>
          <small>Network console</small>
        </div>
      </Link>
      <nav aria-label="Primary navigation">
        {(['general', 'settings'] as const).map((section) => (
          <div key={section}>
            <p className={`nav-heading ${section === 'settings' ? 'nav-heading-spaced' : ''}`}>
              {section === 'general' ? 'Workspace' : 'Configuration'}
            </p>
            {appRoutes
              .filter((item) => item.section === section)
              .map((item) => {
                const Icon = icons[item.view];
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={onNavigate}
                    activeOptions={{ exact: true }}
                    className="nav-item"
                    activeProps={{ 'aria-current': 'page', className: 'nav-item selected' }}
                  >
                    <Icon
                      size={18}
                      aria-hidden="true"
                    />
                    {item.label}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <p className="nav-heading">Connections</p>
        <Link
          to="/settings/transport"
          className="sidebar-status"
          onClick={onNavigate}
        >
          <Cable
            size={16}
            aria-hidden="true"
          />
          <span>
            Transport<small>{transportStatus}</small>
          </span>
          <span className={`status-dot ${transportStatusTone}`} />
        </Link>
        <Link
          to="/settings/mqtt"
          className="sidebar-status"
          onClick={onNavigate}
        >
          <Network
            size={16}
            aria-hidden="true"
          />
          <span>
            MQTT<small>{mqttStatus}</small>
          </span>
          <span className={`status-dot ${mqttStatusTone}`} />
        </Link>
      </div>
    </aside>
  );
}

export function TopBar({
  title,
  connectionStatus,
  navigationOpen,
  onToggleNavigation,
}: {
  title: string;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  navigationOpen: boolean;
  onToggleNavigation: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button
          className="icon-button navigation-toggle"
          type="button"
          onClick={onToggleNavigation}
          aria-label={navigationOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navigationOpen}
          aria-controls="primary-navigation"
          title="Navigation"
        >
          {navigationOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <span className="breadcrumb">Workspace /</span>
        <h1>{title}</h1>
      </div>
      <div className="topbar-actions">
        <span
          className="connection-state"
          role="status"
        >
          <span
            className={`status-dot ${connectionStatus === 'connected' ? 'online' : 'warning'}`}
          />
          {connectionStatus === 'connected'
            ? 'Live'
            : connectionStatus === 'connecting'
              ? 'Connecting'
              : 'Reconnecting'}
        </span>
      </div>
    </header>
  );
}
