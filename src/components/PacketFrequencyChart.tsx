import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PacketTelemetry } from '../types/bluetooth';

interface PacketFrequencyChartProps {
  packets: PacketTelemetry[];
}

type BucketResolution = 1 | 2 | 5;

interface FrequencyBucket {
  ts: number;
  label: string;
  total: number;
  adv: number;
  handshake: number;
  isSpike: boolean;
}

function formatUtcHms(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const PacketFrequencyChart: React.FC<PacketFrequencyChartProps> = ({
  packets,
}) => {
  const [resolutionSec, setResolutionSec] = useState<BucketResolution>(2);

  const { series, peakCount, peakLabel, avgRate, spikeThreshold, spikeCount } =
    useMemo(() => {
      if (packets.length === 0) {
        return {
          series: [] as FrequencyBucket[],
          peakCount: 0,
          peakLabel: '—',
          avgRate: 0,
          spikeThreshold: 3,
          spikeCount: 0,
        };
      }

      const stepMs = resolutionSec * 1000;
      const bucketCount = 24;

      let latestMs = 0;
      for (const pkt of packets) {
        const t = Date.parse(pkt.timestamp);
        if (!Number.isNaN(t) && t > latestMs) latestMs = t;
      }
      if (latestMs === 0) latestMs = Date.now();

      const endBucket = Math.floor(latestMs / stepMs) * stepMs;
      const startBucket = endBucket - (bucketCount - 1) * stepMs;

      const counts = new Map<number, { total: number; adv: number; handshake: number }>();
      for (let b = startBucket; b <= endBucket; b += stepMs) {
        counts.set(b, { total: 0, adv: 0, handshake: 0 });
      }

      for (const pkt of packets) {
        const t = Date.parse(pkt.timestamp);
        if (Number.isNaN(t)) continue;
        const b = Math.floor(t / stepMs) * stepMs;
        const entry = counts.get(b);
        if (!entry) continue;
        entry.total += 1;
        if (pkt.packet_type === 'ADV_IND') {
          entry.adv += 1;
        } else {
          entry.handshake += 1;
        }
      }

      const rawBuckets = Array.from(counts.entries()).map(([ts, val]) => ({
        ts,
        label: formatUtcHms(ts),
        total: val.total,
        adv: val.adv,
        handshake: val.handshake,
      }));

      const totals = rawBuckets.map((b) => b.total);
      const sum = totals.reduce((acc, n) => acc + n, 0);
      const mean = sum / rawBuckets.length;
      const variance =
        totals.reduce((acc, n) => acc + (n - mean) ** 2, 0) / rawBuckets.length;
      const stdDev = Math.sqrt(variance);
      const threshold = Math.max(3, Math.ceil(mean + stdDev * 1.5));

      let maxVal = 0;
      let maxLabel = '—';
      let spikes = 0;

      const finalSeries: FrequencyBucket[] = rawBuckets.map((b) => {
        const isSpike = b.total >= threshold && b.total > 0;
        if (isSpike) spikes += 1;
        if (b.total >= maxVal && b.total > 0) {
          maxVal = b.total;
          maxLabel = b.label;
        }
        return { ...b, isSpike };
      });

      return {
        series: finalSeries,
        peakCount: maxVal,
        peakLabel: maxLabel,
        avgRate: Number(mean.toFixed(1)),
        spikeThreshold: threshold,
        spikeCount: spikes,
      };
    }, [packets, resolutionSec]);

  return (
    <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
            Packet Frequency Over Time
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums text-zinc-400">
            <span>
              Peak: <strong className="text-zinc-100">{peakCount}</strong> pkt/{resolutionSec}s
              {peakLabel !== '—' ? ` at ${peakLabel} UTC` : ''}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Avg: <strong className="text-zinc-100">{avgRate}</strong> pkt/{resolutionSec}s
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Spike threshold:{' '}
              <strong className="text-amber-400">&ge;{spikeThreshold}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className={spikeCount > 0 ? 'text-amber-400 font-medium' : 'text-zinc-400'}>
              {spikeCount} {spikeCount === 1 ? 'spike' : 'spikes'} detected
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-sky-400" aria-hidden="true" />
              ADV_IND
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-emerald-400" aria-hidden="true" />
              GATT Handshake
            </span>
          </div>

          <div
            role="group"
            aria-label="Chart time bucket resolution"
            className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-0.5"
          >
            {([1, 2, 5] as BucketResolution[]).map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => setResolutionSec(sec)}
                className={`rounded px-2 py-1 font-mono text-[11px] font-medium transition-colors ${
                  resolutionSec === sec
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>
      </div>

      {series.length === 0 ? (
        <div className="flex h-[180px] items-center justify-center rounded border border-dashed border-zinc-800 text-xs text-zinc-500">
          Waiting for packet stream to plot frequency buckets...
        </div>
      ) : (
        <div className="h-[190px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={series}
              margin={{ top: 8, right: 10, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="advFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="handshakeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#27272a"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={{ stroke: '#27272a' }}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const data = payload[0]?.payload as FrequencyBucket | undefined;
                  if (!data) return null;
                  return (
                    <div className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs shadow-lg">
                      <div className="mb-1 flex items-center justify-between gap-4 font-mono text-zinc-200">
                        <span>{data.label} UTC</span>
                        {data.isSpike && (
                          <span className="font-semibold text-amber-400">SPIKE</span>
                        )}
                      </div>
                      <div className="space-y-0.5 font-mono tabular-nums text-zinc-400">
                        <div className="flex justify-between gap-4">
                          <span>Total packets</span>
                          <span className="font-semibold text-zinc-100">{data.total}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-sky-400">ADV_IND</span>
                          <span className="text-zinc-200">{data.adv}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-emerald-400">GATT Handshake</span>
                          <span className="text-zinc-200">{data.handshake}</span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              <ReferenceLine
                y={spikeThreshold}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeOpacity={0.75}
              />
              <Area
                type="monotone"
                dataKey="adv"
                stackId="1"
                stroke="#38bdf8"
                strokeWidth={1.75}
                fill="url(#advFill)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="handshake"
                stackId="1"
                stroke="#34d399"
                strokeWidth={1.75}
                fill="url(#handshakeFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
