import { useEffect, useState } from 'react';
import { listOrders, shipOrder, approveRefund, type Order, type OrderStatus } from '../api/orders';

const ERROR_TEXT: Record<string, string> = {
  FORBIDDEN: '权限不足',
  INVALID_STATUS_TRANSITION: '订单状态已变更，请刷新',
  ORDER_NOT_FOUND: '订单不存在',
  INVALID_REFUND_AMOUNT: '退款金额异常',
  MISSING_TRANSACTION_ID: '缺少支付交易号',
  WXPAY_REFUND_FAILED: '微信退款失败，请稍后重试',
  EMPTY_REFUND_RESPONSE: '退款返回异常，请稍后重试',
  WALLET_NOT_FOUND: '会员钱包不存在',
};

const TABS: { label: string; status?: OrderStatus }[] = [
  { label: '全部' },
  { label: '待发货',   status: 'paid' },
  { label: '退款处理', status: 'refunding' },
  { label: '已完成',   status: 'completed' },
];

const STATUS_TEXT: Record<string, string> = {
  pending_payment: '待付款', paid: '已付款', preparing: '备货中',
  ready: '备货完成', shipped: '已发货', completed: '已完成',
  refunding: '退款中', refunded: '已退款',
};

function fmt(dt: string | null) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function OrderRow({ order, onAction }: { order: Order; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(false);

  const addr = order.addressInfo
    ? `${order.addressInfo.provinceName}${order.addressInfo.cityName}${order.addressInfo.countyName} ${order.addressInfo.detailInfo}`
    : null;

  async function act(fn: () => Promise<void>) {
    setActing(true);
    try {
      await fn();
      onAction();
    } catch (e: unknown) {
      const err = e as Error & { code?: string };
      alert(ERROR_TEXT[err.code || ''] || err.message);
    }
    finally { setActing(false); }
  }

  return (
    <>
      <tr
        className="border-b border-[#E5E5E5] hover:bg-[#F5F5F5] cursor-pointer transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <td className="py-3 px-4 text-xs text-[#6B7280] font-mono">{order.id.slice(0, 8)}…</td>
        <td className="py-3 px-4 text-sm">{fmt(order.createdAt)}</td>
        <td className="py-3 px-4 text-sm">{order.fulfillmentMode === 'delivery' ? '配送' : '自提'}</td>
        <td className="py-3 px-4 text-sm font-medium">¥{order.totalAmount.toFixed(2)}</td>
        <td className="py-3 px-4">
          <span className="inline-block px-2 py-0.5 rounded text-xs bg-primary-light text-primary">
            {STATUS_TEXT[order.status] ?? order.status}
          </span>
        </td>
        <td className="py-3 px-4 text-right space-x-2" onClick={e => e.stopPropagation()}>
          {order.status === 'paid' && (
            <button
              disabled={acting}
              onClick={() => act(() => shipOrder(order.id))}
              className="text-xs px-3 py-1.5 bg-primary text-white rounded hover:bg-primary-hover transition-colors disabled:opacity-60"
            >
              发货
            </button>
          )}
          {order.status === 'refunding' && (
            <button
              disabled={acting}
              onClick={() => act(() => approveRefund(order.id))}
              className="text-xs px-3 py-1.5 border border-red-400 text-red-500 rounded hover:bg-red-50 transition-colors disabled:opacity-60"
            >
              同意退款
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[#F9F9F9] border-b border-[#E5E5E5]">
          <td colSpan={6} className="px-4 py-3">
            <div className="text-xs text-[#6B7280] space-y-1">
              {addr && <p><span className="font-medium text-[#1A1A1A]">地址：</span>{addr} {order.addressInfo?.userName} {order.addressInfo?.telNumber}</p>}
              {order.remark && <p><span className="font-medium text-[#1A1A1A]">备注：</span>{order.remark}</p>}
              <div className="mt-2 space-y-0.5">
                {order.items.map((item, i) => (
                  <p key={i}>{item.title}{item.flavor ? ` · ${item.flavor}` : ''} × {item.quantity}  ¥{item.subtotal.toFixed(2)}</p>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Orders() {
  const [tab, setTab] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await listOrders(TABS[tab].status, 50);
      setOrders(data);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadTab() {
      try {
        const data = await listOrders(TABS[tab].status, 50);
        if (!cancelled) {
          setOrders(data);
          setError('');
        }
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTab();

    return () => { cancelled = true; };
  }, [tab]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-[#1A1A1A]">订单管理</h1>

      {/* Tabs */}
      <div className="flex border-b border-[#E5E5E5]">
        {TABS.map(({ label }, i) => (
          <button
            key={i}
            onClick={() => { setLoading(true); setError(''); setTab(i); }}
            className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${
              tab === i ? 'border-primary text-primary font-medium' : 'border-transparent text-[#6B7280] hover:text-[#1A1A1A]'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center pb-2">
          <button onClick={load} className="text-xs text-[#6B7280] hover:text-primary transition-colors">刷新</button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-[#E5E5E5] overflow-hidden">
          <table className="w-full">
            <thead className="bg-[#F9F9F9] border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">订单号</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">时间</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">方式</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">金额</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">状态</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-[#6B7280]">暂无订单</td>
                </tr>
              ) : (
                orders.map(order => <OrderRow key={order.id} order={order} onAction={load} />)
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
