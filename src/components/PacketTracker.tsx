import React, { useMemo, useState } from 'react';
import { Download, Filter, Pause, Play, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { PacketTelemetry } from '../types/bluetooth';
import { RssiText, formatHexBytes, formatUtcTime } from './RssiText';
import { PacketFrequencyChart } from './PacketFrequencyChart';

interface PacketTrackerProps {
  packetHistory: PacketTelemetry[];
  isPaused: boolean;
  onTogglePause: () => void;
  onClearBuffer: () => void;
}

const PACKET_TYPE_COLORS: Record<string, string> = {
  ADV_IND: 'text-indigo-300',
  CONN_REQ_SENT: 'text-amber-300',
  CONN_ESTABLISHED: 'text-emerald-400',
  CONN_TERMINATED: 'text-red-400',
  CONN_FAILED: 'text-red-400',
  READ: 'text-cyan-300',
  WRITE: 'text-violet-300',
  NOTIFY: 'text-emerald-300',
};

function decodeAdStructures(hex: string): Array<{ length: number; typeHex: string; typeName: string; dataHex: string }> {
  const bytes = formatHexBytes(hex).split(' ').filter(Boolean);
  const structures: Array<{ length: number; typeHex: string; typeName: string; dataHex: string }> = [];
  let i = 0;

  while (i < bytes.length) {
    const len = parseInt(bytes[i], 16);
    if (!len || i + len >= bytes.length && i + 1 >= bytes.length) break;
    const typeByte = bytes[i + 1] ?? '00';
    const dataSlice = bytes.slice(i + 2, i + 1 + len);

    const typeNames: Record<string, string> = {
      '01': 'Flags',
      '03': 'Complete 16-bit Service UUIDs',
      '09': 'Complete Local Name',
      '16': 'Service Data (16-bit UUID)',
      '19': 'Appearance',
      '21': 'Service Data (128-bit UUID)',
      'FF': 'Manufacturer Specific Data',
    };

    structures.push({
      length: len,
      typeHex: `0x${typeByte}`,
      typeName: typeNames[typeByte] || 'AD Structure',
      dataHex: dataSlice.join(' ') || '—',
    });

    i += 1 + len;
  }

  return structures;
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const isSignedNumeric = /^-?\d+(\.\d+)?$/.test(str);
  const safe =
    !isSignedNumeric && /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function buildPacketCsv(packets: PacketTelemetry[]): string {
  const headers = [
    'packet_id',
    'timestamp_utc',
    'packet_type',
    'device_id',
    'device_name',
    'mac_address',
    'rssi_dbm',
    'is_connected',
    'signal_quality_pct',
    'latency_ms',
    'packet_loss_pct',
    'link_stability',
    'battery_pct',
    'mtu_size',
    'gatt_services',
    'payload_hex',
  ];

  const rows = packets.map((pkt) => {
    const h = pkt.device_health;
    return [
      pkt.packet_id,
      pkt.timestamp,
      pkt.packet_type,
      pkt.device_id,
      pkt.device_name,
      pkt.mac_address,
      pkt.rssi,
      pkt.is_connected,
      h?.signal_quality_pct ?? '',
      h?.latency_ms ?? '',
      h?.packet_loss_pct ?? '',
      h?.link_stability ?? '',
      h?.battery_pct ?? '',
      h?.mtu_size ?? '',
      (pkt.gatt_services || []).join(';'),
      formatHexBytes(pkt.payload_hex),
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

export const PacketTracker: React.FC<PacketTrackerProps> = ({
  packetHistory,
  isPaused,
  onTogglePause,
  onClearBuffer,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeOrDeviceFilter, setTypeOrDeviceFilter] = useState('');
  const [packetType, setPacketType] = useState('ALL');
  const [selectedPacket, setSelectedPacket] = useState<PacketTelemetry | null>(null);

  const filteredPackets = useMemo(() => {
    const trimmed = searchTerm.trim().toLowerCase();
    const compactSearch = trimmed.replace(/[\s-]+/g, '');
    const typeDevTrimmed = typeOrDeviceFilter.trim().toLowerCase();

    return packetHistory.filter((pkt) => {
      const matchesTypeDropdown = packetType === 'ALL' || pkt.packet_type === packetType;
      if (!matchesTypeDropdown) return false;

      if (typeDevTrimmed) {
        const pType = (pkt.packet_type || '').toLowerCase();
        const devId = (pkt.device_id || '').toLowerCase();
        const matchesTypeOrDevice =
          pType.includes(typeDevTrimmed) || devId.includes(typeDevTrimmed);
        if (!matchesTypeOrDevice) return false;
      }

      if (!trimmed) return true;

      const name = (pkt.device_name || '').toLowerCase();
      const mac = (pkt.mac_address || '').toLowerCase();
      const packetUuid = (pkt.packet_id || '').toLowerCase();
      const deviceId = (pkt.device_id || '').toLowerCase();
      const gattServices = (pkt.gatt_services || []).map((u) => u.toLowerCase());
      const hexRaw = (pkt.payload_hex || '').toLowerCase();
      const hexCompact = hexRaw.replace(/\s+/g, '');

      const matchesUuid =
        packetUuid.includes(trimmed) ||
        deviceId.includes(trimmed) ||
        gattServices.some(
          (uuid) =>
            uuid.includes(trimmed) ||
            (compactSearch.length > 0 && uuid.replace(/-/g, '').includes(compactSearch))
        ) ||
        (compactSearch.length > 0 && packetUuid.replace(/-/g, '').includes(compactSearch));

      return (
        name.includes(trimmed) ||
        matchesUuid ||
        mac.includes(trimmed) ||
        hexRaw.includes(trimmed) ||
        (compactSearch.length > 0 && hexCompact.includes(compactSearch))
      );
    });
  }, [packetHistory, searchTerm, typeOrDeviceFilter, packetType]);

  const decodedAd = useMemo(
    () => (selectedPacket ? decodeAdStructures(selectedPacket.payload_hex) : []),
    [selectedPacket]
  );

  const handleDownloadCsv = () => {
    if (filteredPackets.length === 0) return;
    const csvContent = buildPacketCsv(filteredPackets);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ble-packet-history-${stamp}Z.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">
            Real-Time BLE Packet Sniffer &amp; Telemetry
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Live HCI/ATT event stream captured from the active Bluetooth controller. Click any row to inspect AD framing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={filteredPackets.length === 0}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-950 disabled:text-blue-300/40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download CSV ({filteredPackets.length})
          </button>
          <button
            type="button"
            onClick={onTogglePause}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
          >
            {isPaused ? (
              <>
                <Play className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                Resume Stream
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                Pause Stream
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              onClearBuffer();
              setSelectedPacket(null);
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear Buffer ({packetHistory.length})
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search packet logs by UUID or device name"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by UUID, device name, MAC, or hex..."
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="relative flex-1 min-w-[240px]">
          <Filter
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Filter packets by type or device ID"
            value={typeOrDeviceFilter}
            onChange={(e) => setTypeOrDeviceFilter(e.target.value)}
            placeholder="Filter by type (READ, WRITE, NOTIFY, ADV_IND) or device ID..."
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <select
          value={packetType}
          onChange={(e) => setPacketType(e.target.value)}
          aria-label="Filter by packet type"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
        >
          <option value="ALL">All Packet Types</option>
          <option value="READ">READ</option>
          <option value="WRITE">WRITE</option>
          <option value="NOTIFY">NOTIFY</option>
          <option value="ADV_IND">ADV_IND (Advertising)</option>
          <option value="CONN_REQ_SENT">CONN_REQ_SENT</option>
          <option value="CONN_ESTABLISHED">CONN_ESTABLISHED</option>
          <option value="CONN_TERMINATED">CONN_TERMINATED</option>
          <option value="CONN_FAILED">CONN_FAILED</option>
        </select>

        {(searchTerm || typeOrDeviceFilter || packetType !== 'ALL') && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setTypeOrDeviceFilter('');
              setPacketType('ALL');
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </button>
        )}

        <span className="font-mono text-xs tabular-nums text-zinc-400">
          {filteredPackets.length} of {packetHistory.length} packets
        </span>
      </div>

      <PacketFrequencyChart packets={filteredPackets} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div
          className={`overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 ${
            selectedPacket ? 'lg:col-span-2' : 'lg:col-span-3'
          }`}
        >
          <div className="max-h-[520px] overflow-y-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950 text-xs text-zinc-400">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Timestamp (UTC)</th>
                  <th className="px-3 py-2.5 font-medium">Packet Type</th>
                  <th className="px-3 py-2.5 font-medium">Peripheral</th>
                  <th className="px-3 py-2.5 font-medium">Signal</th>
                  <th className="px-3 py-2.5 font-medium">Raw Hex Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {filteredPackets.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-500">
                      {packetHistory.length === 0
                        ? 'Waiting for live BLE telemetry packets...'
                        : 'No packets match the active filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredPackets.map((pkt) => {
                    const isSelected = selectedPacket?.packet_id === pkt.packet_id;
                    const typeTone = PACKET_TYPE_COLORS[pkt.packet_type] || 'text-zinc-300';
                    return (
                      <tr
                        key={pkt.packet_id}
                        onClick={() => setSelectedPacket(isSelected ? null : pkt)}
                        className={`cursor-pointer transition-colors hover:bg-zinc-900/70 ${
                          isSelected ? 'bg-zinc-900' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums text-zinc-300">
                          {formatUtcTime(pkt.timestamp)}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2.5 font-mono text-xs font-semibold ${typeTone}`}>
                          {pkt.packet_type}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="text-xs font-medium text-zinc-100">
                            {pkt.device_name || 'Unnamed Peripheral'}
                          </div>
                          <div className="font-mono text-[11px] text-zinc-500">
                            {pkt.mac_address}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <RssiText rssi={pkt.rssi} />
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2.5 font-mono text-xs text-sky-400">
                          {formatHexBytes(pkt.payload_hex)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedPacket && (
          <aside className="flex flex-col justify-between rounded-md border border-zinc-800 bg-zinc-950 p-4">
            <div>
              <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">
                    Packet Frame Inspector
                  </h2>
                  <p className="font-mono text-[11px] text-zinc-500">
                    {selectedPacket.packet_id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPacket(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Close
                </button>
              </div>

              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Peripheral</dt>
                  <dd className="text-right font-medium text-zinc-100">
                    {selectedPacket.device_name}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Device ID</dt>
                  <dd className="max-w-[190px] truncate font-mono text-[11px] text-zinc-300" title={selectedPacket.device_id}>
                    {selectedPacket.device_id}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">MAC Address</dt>
                  <dd className="font-mono text-zinc-200">{selectedPacket.mac_address}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">UTC Timestamp</dt>
                  <dd className="font-mono tabular-nums text-zinc-200">
                    {formatUtcTime(selectedPacket.timestamp)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Signal</dt>
                  <dd>
                    <RssiText rssi={selectedPacket.rssi} />
                  </dd>
                </div>
              </dl>

              <div className="mt-4 border-t border-zinc-800 pt-3">
                <h3 className="mb-2 text-xs font-medium text-zinc-300">
                  Raw AD Payload Bytes
                </h3>
                <div className="rounded border border-zinc-800 bg-zinc-900 p-2.5 font-mono text-xs leading-relaxed text-sky-400 break-all">
                  {formatHexBytes(selectedPacket.payload_hex)}
                </div>
              </div>

              <div className="mt-4 border-t border-zinc-800 pt-3">
                <h3 className="mb-2 text-xs font-medium text-zinc-300">
                  Decoded BLE AD Structures ({decodedAd.length})
                </h3>
                {decodedAd.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    Raw vendor payload (no standard TLV AD framing).
                  </p>
                ) : (
                  <div className="space-y-2">
                    {decodedAd.map((item, idx) => (
                      <div
                        key={`${item.typeHex}-${idx}`}
                        className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between text-zinc-300">
                          <span className="font-medium">{item.typeName}</span>
                          <span className="font-mono text-[11px] text-zinc-500">
                            {item.typeHex} · Len {item.length}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-sky-400 break-all">
                          {item.dataHex}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-zinc-800 pt-3">
                <h3 className="mb-2 text-xs font-medium text-zinc-300">
                  GATT Service UUIDs ({selectedPacket.gatt_services?.length || 0})
                </h3>
                {!selectedPacket.gatt_services?.length ? (
                  <p className="text-xs text-zinc-500">
                    No GATT services attached to this packet frame.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {selectedPacket.gatt_services.map((uuid) => (
                      <li
                        key={uuid}
                        className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-[11px] text-sky-400 break-all"
                      >
                        {uuid}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
};
