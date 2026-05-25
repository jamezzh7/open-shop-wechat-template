import { callFn } from './base';

export interface ShippingRule {
  id: number;
  province: string;
  city: string;
  district: string;
  shipping_fee: number | string;
  free_shipping_threshold: number | string | null;
  enabled: number;
  sort: number;
}

export interface ShippingRulePayload {
  province: string;
  city: string;
  district: string;
  shipping_fee: number;
  free_shipping_threshold: number | null;
  enabled: number;
  sort: number;
}

export interface PickupConfig {
  storeName: string;
  pickupAddress: string;
  pickupNote: string;
}

export async function listShippingRules() {
  const res = await callFn<{ rows: ShippingRule[] }>('vibe_web_shipping', { action: 'list' });
  return res.rows;
}

export async function getPickupConfig() {
  const res = await callFn<{ pickupConfig: PickupConfig }>('vibe_web_shipping', { action: 'getPickupConfig' });
  return res.pickupConfig;
}

export async function updatePickupConfig(data: PickupConfig) {
  const res = await callFn<{ pickupConfig: PickupConfig }>('vibe_web_shipping', {
    action: 'updatePickupConfig',
    data,
  });
  return res.pickupConfig;
}

export async function createShippingRule(data: ShippingRulePayload) {
  await callFn('vibe_web_shipping', { action: 'create', data });
}

export async function updateShippingRule(id: number, data: ShippingRulePayload) {
  await callFn('vibe_web_shipping', { action: 'update', id, data });
}

export async function deleteShippingRule(id: number) {
  await callFn('vibe_web_shipping', { action: 'delete', id });
}
