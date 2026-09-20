import { Link } from '@tanstack/react-router';
import { appRoutes } from '../ui/routes';
import type { MqttForm, TransportResponse } from '../ui/types';

export function Sidebar({
  mqtt,
  transport,
}: {
  mqtt: MqttForm | null;
  transport: TransportResponse | null;
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
            >
              <span
                aria-hidden="true"
                className="nav-icon"
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        <p className="nav-heading nav-heading-spaced">Settings</p>
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
            >
              <span
                aria-hidden="true"
                className="nav-icon"
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-status">
          <span className={`status-dot ${transportStatusTone}`} />
          <span>ESP3 transport {transportStatus}</span>
        </div>
        <div className="sidebar-status">
          <span className={`status-dot ${mqttStatusTone}`} />
          <span>MQTT {mqttStatus}</span>
        </div>
      </div>
    </aside>
  );
}

export function TopBar({ title }: { title: string }) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="breadcrumb">eep</span>
        <h1>{title}</h1>
      </div>
      <div className="topbar-actions">
        <span className="connection-state">
          <span className="status-dot online" />
          Running
        </span>
      </div>
    </header>
  );
}
