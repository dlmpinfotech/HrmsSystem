import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/primitives';

/** Series colours resolve from the theme tokens, so charts follow light/dark and branding. */
export const SERIES = ['hsl(var(--primary))', 'hsl(var(--brand-secondary))', 'hsl(var(--brand-accent))', 'hsl(var(--success))', 'hsl(var(--destructive))', 'hsl(var(--muted-foreground))'];

const axis = { stroke: 'hsl(var(--muted-foreground))', fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 10, color: 'hsl(var(--popover-foreground))', fontSize: 12 },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
  cursor: { fill: 'hsl(var(--muted) / 0.6)' },
};

export function ChartCard({ title, action, children, loading, className, empty }: { title: string; action?: ReactNode; children: ReactNode; loading?: boolean; className?: string; empty?: boolean }) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-64" /> : empty ? <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">—</div> : <div className="h-64">{children}</div>}
      </CardContent>
    </Card>
  );
}

interface Datum { name: string; value: number }

export function TrendChart({ data, format, label }: { data: { key: string; value: number; label?: string }[]; format?: (n: number) => string; label: string }) {
  const reduce = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis dataKey={(d: { key: string; label?: string }) => d.label ?? d.key} {...axis} minTickGap={24} />
        <YAxis {...axis} width={48} tickFormatter={(v: number) => (format ? format(v) : String(v))} allowDecimals={false} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [format ? format(v) : v, label]} />
        <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} fill={`url(#grad-${label})`} isAnimationActive={!reduce} animationDuration={900} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarList({ data, format, label, horizontal = true }: { data: Datum[]; format?: (n: number) => string; label: string; horizontal?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 12, left: horizontal ? 8 : -8, bottom: 0 }}>
        <CartesianGrid horizontal={!horizontal} vertical={horizontal} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        {horizontal ? (
          <>
            <XAxis type="number" {...axis} allowDecimals={false} tickFormatter={(v: number) => (format ? format(v) : String(v))} />
            <YAxis type="category" dataKey="name" {...axis} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" {...axis} interval={0} angle={-25} textAnchor="end" height={56} />
            <YAxis {...axis} width={40} allowDecimals={false} />
          </>
        )}
        <Tooltip {...tooltipStyle} formatter={(v: number) => [format ? format(v) : v, label]} />
        <Bar dataKey="value" radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]} fill="hsl(var(--primary))" isAnimationActive={!reduce} animationDuration={800} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, label }: { data: Datum[]; label: string }) {
  const reduce = useReducedMotion();
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex h-full flex-col items-center gap-3 sm:flex-row">
      <div className="h-44 w-full sm:h-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip {...tooltipStyle} formatter={(v: number) => [v, label]} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={2} isAnimationActive={!reduce} stroke="hsl(var(--card))">
              {data.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1.5 text-sm sm:w-1/2">
        {data.slice(0, 6).map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: SERIES[i % SERIES.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <span className="tabular font-semibold">{d.value}</span>
            <span className="w-10 text-right text-xs text-muted-foreground tabular">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
