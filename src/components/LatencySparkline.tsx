import React, { useMemo } from 'react';
import { Area, AreaChart, YAxis } from 'recharts';

interface LatencySparklineProps {
  samples: number[];
  isActive: boolean;
  currentLatency: number | null;
  deviceId: string;
}

export const LatencySparkline: React.FC<LatencySparklineProps> = ({
  samples,
  isActive,
  currentLatency,
  deviceId,
}) => {
  const { chartData, strokeColor, gradientId, minMs, maxMs } = useMemo(() => {
    const safeSamples =
      samples.length >= 2
        ? samples
        : samples.length === 1
        ? [samples[0], samples[0]]
        : currentLatency !== null
        ? [currentLatency, currentLatency]
        : [];

    const latest =
      currentLatency ?? (safeSamples.length > 0 ? safeSamples[safeSamples.length - 1] : 0);

    let color = '#22c55e';
    if (latest > 55) color = '#ef4444';
    else if (latest > 35) color = '#f59e0b';
    else if (latest > 25) color = '#38bdf8';

    const minVal = safeSamples.length > 0 ? Math.min(...safeSamples) : 0;
    const maxVal = safeSamples.length > 0 ? Math.max(...safeSamples) : 0;

    const cleanId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '');

    return {
      chartData: safeSamples.map((ms, idx) => ({ idx, ms })),
      strokeColor: color,
      gradientId: `latSpark-${cleanId}`,
      minMs: minVal,
      maxMs: maxVal,
    };
  }, [samples, currentLatency, deviceId]);

  if (!isActive || chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-between gap-2 rounded border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-1.5"
        aria-label="Latency history inactive"
      >
        <span className="text-[11px] text-zinc-500">Latency History</span>
        <div className="flex items-center gap-2">
          <div className="h-0 w-16 border-t border-dashed border-zinc-700" />
          <span className="font-mono text-[11px] text-zinc-500">Idle</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-2 rounded border border-zinc-800/80 bg-zinc-900/60 px-2.5 py-1.5"
      aria-label={`Latency history sparkline, min ${minMs}ms, max ${maxMs}ms`}
    >
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          Latency Trend
        </span>
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">
          {minMs}–{maxMs}ms
        </span>
      </div>

      <div className="shrink-0">
        <AreaChart
          width={96}
          height={26}
          data={chartData}
          margin={{ top: 3, right: 2, left: 2, bottom: 2 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={strokeColor} stopOpacity={0.38} />
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, 'dataMax + 10']} />
          <Area
            type="monotone"
            dataKey="ms"
            stroke={strokeColor}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </div>
    </div>
  );
};
