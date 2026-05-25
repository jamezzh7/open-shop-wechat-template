import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchStats, type Stats } from '../api/stats';

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E5E5] p-6">
      <p className="text-sm text-[#6B7280] mb-1">{label}</p>
      <p className="text-2xl font-semibold text-[#1A1A1A]">{value}</p>
      {sub && <p className="text-xs text-[#6B7280] mt-1">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStats().then(setStats).catch(e => setError(e.message));
  }, []);

  if (error) return <p className="text-red-500 text-sm">{error}</p>;
  if (!stats) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const chartData = stats.weeklyRevenue.map((v, i) => ({ day: DAYS[i], revenue: v }));

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-[#1A1A1A]">仪表板</h1>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="今日订单" value={stats.todayOrders} />
        <StatCard label="今日营收" value={`¥${stats.todayRevenue.toFixed(2)}`} />
        <StatCard label="待发货" value={stats.pending.paid} />
        <StatCard label="待处理退款" value={stats.pending.refunding} />
      </div>

      <div className="bg-white rounded-lg border border-[#E5E5E5] p-6">
        <p className="text-sm font-medium text-[#1A1A1A] mb-4">本周营收（元）</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ border: '1px solid #E5E5E5', borderRadius: '8px', fontSize: 12 }}
              formatter={(v) => [`¥${Number(v ?? 0).toFixed(2)}`, '营收']}
            />
            <Line type="monotone" dataKey="revenue" stroke="#8F6BE9" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
