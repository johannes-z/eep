import { Link } from '@tanstack/react-router';
import { Activity, Cable, Cpu, House, Menu, Network, Radio, Settings2, X } from 'lucide-react';
import { appRoutes } from '../ui/routes';
import type { MqttForm, TransportResponse } from '../ui/types';

const icons = {
  overview: Cpu,
  pairing: Radio,
  'packet-listener': Activity,
  settings: Cable,
  mqtt: Network,
  homeassistant: House,
  general: Settings2,
};

export function Sidebar({
  mqtt,
  transport,
  onNavigate,
}: {
  mqtt: MqttForm | null;
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
        to="/"
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
        <p className="nav-heading">Workspace</p>
        {appRoutes
          .filter((item) => item.section === 'general')
          .map((item) => (
            <Link
              activeOptions={{ exact: true }}
              activeProps={{
                'aria-current': 'page',
                className: 'nav-item selected',
              }}
              className="nav-item"
              key={item.path}
              to={item.path}
              onClick={onNavigate}
            >
              <span
                aria-hidden="true"
                className="nav-icon"
              >
                {(() => {
                  const Icon = icons[item.view];
                  return <Icon size={18} />;
                })()}
              </span>
              {item.label}
            </Link>
          ))}
        <p className="nav-heading nav-heading-spaced">Configuration</p>
        {appRoutes
          .filter((item) => item.section === 'settings')
          .map((item) => (
            <Link
              activeOptions={{ exact: true }}
              activeProps={{
                'aria-current': 'page',
                className: 'nav-item selected',
              }}
              className="nav-item"
              key={item.path}
              to={item.path}
              onClick={onNavigate}
            >
              <span
                aria-hidden="true"
                className="nav-icon"
              >
                {(() => {
                  const Icon = icons[item.view];
                  return <Icon size={18} />;
                })()}
              </span>
              {item.label}
            </Link>
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
