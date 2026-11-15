import React from 'react';

interface RssiTextProps {
  rssi: number;
}

export const RssiText: React.FC<RssiTextProps> = ({ rssi }) => {
  const isValid =
    typeof rssi === 'number' && !Number.isNaN(rssi) && rssi >= -127 && rssi <= 20;

  if (!isValid) {
    return (
      <span className="font-mono text-xs tabular-nums text-zinc-400">
        N/A <span aria-hidden="true">·</span> Unknown
      </span>
    );
  }

  let tone = 'text-red-400';
  let label = 'Far';
  if (rssi >= -55) {
    tone = 'text-emerald-400';
    label = 'Immediate';
  } else if (rssi >= -75) {
    tone = 'text-amber-400';
    label = 'Nearby';
  }

  return (
    <span className={`font-mono text-xs font-medium tabular-nums ${tone}`}>
      {rssi} dBm <span aria-hidden="true">·</span> {label}
    </span>
  );
};

export function formatHexBytes(value: string | null | undefined): string {
  if (!value) return '00';
  const cleaned = value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (!cleaned) return '00';
  const padded = cleaned.length % 2 === 1 ? `0${cleaned}` : cleaned;
  return padded.match(/.{1,2}/g)?.join(' ') ?? '00';
}

export function formatUtcTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--.---';
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}
