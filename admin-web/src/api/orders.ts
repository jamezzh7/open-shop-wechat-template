import { callFn } from './base';

export interface OrderItem {
  productId: string;
  skuId: number;
  title: string;
  flavor: string;
  price: number;
  quantity: number;
  subtotal: number;
}

export interface Order {
  id: string;
  openid: string;
  status: string;
  subtotal: number;
  shippingFee: number;
  totalAmount: number;
  fulfillmentMode: 'pickup' | 'delivery';
  addressInfo: {
    provinceName: string;
    cityName: string;
    countyName: string;
    detailInfo: string;
    telNumber: string;
    userName: string;
  } | null;
  remark: string | null;
  transactionId: string | null;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  refundRequestedAt: string | null;
  refundedAt: string | null;
  items: OrderItem[];
}

export type OrderStatus =
  | 'pending_payment' | 'paid' | 'preparing' | 'ready'
  | 'shipped' | 'completed' | 'refunding' | 'refunded';

export async function listOrders(status?: OrderStatus, limit = 20, offset = 0) {
  const res = await callFn<{ orders: Order[] }>('vibe_web_orders', {
    action: 'list', status, limit, offset,
  });
  return res.orders;
}

export async function shipOrder(orderId: string) {
  await callFn('vibe_web_orders', { action: 'SHIP_ORDER', orderId });
}

export async function approveRefund(orderId: string) {
  await callFn('vibe_web_orders', { action: 'APPROVE_REFUND', orderId });
}
