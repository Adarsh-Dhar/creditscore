"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type ScorePoint = {
  timestamp: string;
  score: number;
  eventName: string;
  delta: number;
  reasoning: string;
};

type ChartPoint = ScorePoint & { label: string };

// Custom tooltip so each data point surfaces the event name and AI reasoning.
function ScoreTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p: ChartPoint = payload[0].payload;
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        maxWidth: 260,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <p style={{ margin: 0, fontWeight: 600, color: "#4f46e5" }}>
        Score: {p.score}
      </p>
      <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
        {new Date(p.timestamp).toLocaleString()}
      </p>
      <p style={{ margin: "4px 0 0" }}>
        <strong>Event:</strong> {p.eventName}
        {p.delta !== null && p.delta !== undefined && (
          <span style={{ color: p.delta >= 0 ? "#16a34a" : "#dc2626", marginLeft: 6 }}>
            ({p.delta >= 0 ? "+" : ""}
            {p.delta} pts)
          </span>
        )}
      </p>
      {p.reasoning && (
        <p style={{ margin: "4px 0 0", color: "#374151", fontStyle: "italic" }}>
          {p.reasoning}
        </p>
      )}
    </div>
  );
}

export default function ScoreHistoryChart({ wallet }: { wallet: string }) {
  const [points, setPoints] = useState<ScorePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const apiBase =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
        const res = await fetch(
          `${apiBase}/api/wallets/${wallet}/score-history`
        );
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setPoints(data.points ?? []);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  if (loading) return <p style={{ color: "#6b7280" }}>Loading score history…</p>;
  if (error)
    return <p style={{ color: "#dc2626" }}>Couldn't load score history: {error}</p>;
  if (points.length === 0)
    return <p style={{ color: "#6b7280" }}>No score changes recorded yet for this wallet.</p>;

  // recharts needs a flat label for the x-axis tick
  const chartData: ChartPoint[] = points.map((p) => ({
    ...p,
    label: new Date(p.timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <LineChart
          data={chartData}
          margin={{ top: 10, right: 20, bottom: 0, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "#6b7280" }}
            tickLine={false}
          />
          <YAxis
            domain={[300, 850]}
            tick={{ fontSize: 12, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ScoreTooltip />} />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#4f46e5"
            strokeWidth={2}
            dot={{ r: 3, fill: "#4f46e5", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
