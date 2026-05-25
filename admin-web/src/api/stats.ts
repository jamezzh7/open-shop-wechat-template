import { callFn } from './base';

export interface Stats {
  todayOrders: number;
  todayRevenue: number;
  pending: { paid: number; refunding: number };
  weeklyRevenue: number[];
}

export async function fetchStats(): Promise<Stats> {
  const res = await callFn<Stats>('vibe_web_stats', {});
  return res;
}
