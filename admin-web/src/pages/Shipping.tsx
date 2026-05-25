import { useEffect, useState } from 'react';
import { regionData, type DataItem } from 'element-china-area-data';
import {
  createShippingRule,
  deleteShippingRule,
  getPickupConfig,
  listShippingRules,
  updatePickupConfig,
  updateShippingRule,
  type PickupConfig,
  type ShippingRule,
  type ShippingRulePayload,
} from '../api/shipping';

type ModalState = { mode: 'create' | 'edit'; row?: ShippingRule } | null;
type AreaLevel = 'default' | 'province' | 'city' | 'district';
type ShippingForm = ReturnType<typeof initialForm>;
type PickupForm = PickupConfig;

const inputCls = 'w-full border border-[#E5E5E5] rounded px-3 py-2 text-sm outline-none focus:border-primary transition-colors';
const disabledInputCls = `${inputCls} disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF] disabled:cursor-not-allowed`;
const MUNICIPALITIES = new Set(['北京市', '天津市', '上海市', '重庆市']);
const SHOP_NAME = import.meta.env.VITE_SHOP_NAME || 'Open Shop';

function provinceOptions() {
  return regionData;
}

function findProvince(province: string) {
  return regionData.find(item => item.label === province);
}

function cityOptions(province: string): DataItem[] {
  const provinceNode = findProvince(province);
  if (!provinceNode?.children) return [];

  if (MUNICIPALITIES.has(province)) {
    return [{
      value: provinceNode.value,
      label: province,
      children: provinceNode.children.flatMap(city => city.children ?? []),
    }];
  }

  return provinceNode.children;
}

function districtOptions(province: string, city: string): DataItem[] {
  const cityNode = cityOptions(province).find(item => item.label === city);
  return cityNode?.children ?? [];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg border border-[#E5E5E5] w-[480px] max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
          <span className="font-medium text-[#1A1A1A]">{title}</span>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A1A] text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function fmtMoney(value: number | string | null) {
  if (value == null || value === '') return '不设置';
  return `¥${Number(value).toFixed(2)}`;
}

function areaLabel(row: ShippingRule) {
  const parts = [row.province, row.city, row.district].filter(Boolean);
  return parts.length ? parts.join(' / ') : '默认规则';
}

function initialForm(row?: ShippingRule) {
  const areaLevel: AreaLevel = row?.district
    ? 'district'
    : row?.city
      ? 'city'
      : row?.province
        ? 'province'
        : 'default';

  return {
    areaLevel,
    province: row?.province ?? '',
    city: row?.city ?? '',
    district: row?.district ?? '',
    shipping_fee: row ? String(row.shipping_fee) : '10',
    free_shipping_threshold: row?.free_shipping_threshold == null ? '' : String(row.free_shipping_threshold),
    enabled: String(row?.enabled ?? 1),
    sort: String(row?.sort ?? 0),
  };
}

function areaLevelLabel(level: AreaLevel) {
  if (level === 'province') return '省级规则';
  if (level === 'city') return '城市规则';
  if (level === 'district') return '区县规则';
  return '默认规则';
}

function resolvePayloadArea(form: ShippingForm) {
  if (form.areaLevel === 'default') {
    return { province: '', city: '', district: '' };
  }

  if (!form.province) {
    alert('请选择省份');
    return null;
  }

  if (form.areaLevel === 'province') {
    return { province: form.province, city: '', district: '' };
  }

  if (!form.city) {
    alert('请选择城市');
    return null;
  }

  if (form.areaLevel === 'city') {
    return { province: form.province, city: form.city, district: '' };
  }

  if (!form.district) {
    alert('请选择区县');
    return null;
  }

  return { province: form.province, city: form.city, district: form.district };
}

export default function Shipping() {
  const [rows, setRows] = useState<ShippingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pickupForm, setPickupForm] = useState<PickupForm>({ storeName: SHOP_NAME, pickupAddress: '', pickupNote: '' });
  const [pickupLoading, setPickupLoading] = useState(true);
  const [pickupSaving, setPickupSaving] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [form, setForm] = useState(initialForm());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await listShippingRules();
      setRows(data);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRows() {
      try {
        const [shippingRows, pickupConfig] = await Promise.all([
          listShippingRules(),
          getPickupConfig(),
        ]);
        if (!cancelled) {
          setRows(shippingRows);
          setPickupForm(pickupConfig);
          setError('');
        }
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPickupLoading(false);
        }
      }
    }

    void loadRows();

    return () => { cancelled = true; };
  }, []);

  function openCreate() {
    setForm(initialForm());
    setModal({ mode: 'create' });
  }

  function openEdit(row: ShippingRule) {
    setForm(initialForm(row));
    setModal({ mode: 'edit', row });
  }

  function toPayload(): ShippingRulePayload | null {
    const shippingFee = Number(form.shipping_fee);
    const threshold = form.free_shipping_threshold.trim() ? Number(form.free_shipping_threshold) : null;
    const sort = Number(form.sort || 0);
    const area = resolvePayloadArea(form);

    if (!Number.isFinite(shippingFee) || shippingFee < 0) {
      alert('请输入有效运费');
      return null;
    }
    if (threshold != null && (!Number.isFinite(threshold) || threshold < 0)) {
      alert('请输入有效满免门槛');
      return null;
    }
    if (!area) return null;

    return {
      province: area.province,
      city: area.city,
      district: area.district,
      shipping_fee: Number(shippingFee.toFixed(2)),
      free_shipping_threshold: threshold == null ? null : Number(threshold.toFixed(2)),
      enabled: Number(form.enabled),
      sort: Number.isFinite(sort) ? sort : 0,
    };
  }

  async function save() {
    const payload = toPayload();
    if (!payload) return;

    setSaving(true);
    try {
      if (modal?.mode === 'create') {
        await createShippingRule(payload);
      } else if (modal?.row) {
        await updateShippingRule(modal.row.id, payload);
      }
      setModal(null);
      await load();
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function savePickupConfig() {
    if (!pickupForm.pickupAddress.trim()) {
      alert('请填写自提地址');
      return;
    }

    setPickupSaving(true);
    try {
      const nextConfig = await updatePickupConfig({
        storeName: pickupForm.storeName.trim() || SHOP_NAME,
        pickupAddress: pickupForm.pickupAddress.trim(),
        pickupNote: pickupForm.pickupNote.trim(),
      });
      setPickupForm(nextConfig);
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setPickupSaving(false);
    }
  }

  async function remove(row: ShippingRule) {
    if (!confirm(`确认删除「${areaLabel(row)}」运费规则？`)) return;
    try {
      await deleteShippingRule(row.id);
      await load();
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  }

  function updateAreaLevel(areaLevel: AreaLevel) {
    setForm(f => ({
      ...f,
      areaLevel,
      province: areaLevel === 'default' ? '' : f.province,
      city: areaLevel === 'default' || areaLevel === 'province' ? '' : f.city,
      district: areaLevel === 'district' ? f.district : '',
    }));
  }

  function updateProvince(province: string) {
    const city = MUNICIPALITIES.has(province) ? province : '';
    setForm(f => ({
      ...f,
      province,
      city: f.areaLevel === 'province' ? '' : city,
      district: '',
    }));
  }

  function updateCity(city: string) {
    setForm(f => ({
      ...f,
      city,
      district: '',
    }));
  }

  const cities = cityOptions(form.province);
  const districts = districtOptions(form.province, form.city);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[#1A1A1A]">运费管理</h1>
          <p className="text-sm text-[#6B7280] mt-1">设置自提地址，并按中国省、市、区县配置配送费。</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover transition-colors">
          添加规则
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="bg-white rounded-lg border border-[#E5E5E5] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[0.8fr_1.6fr_1fr]">
            <Field label="自提名称">
              <input
                className={inputCls}
                value={pickupForm.storeName}
                disabled={pickupLoading}
                onChange={e => setPickupForm(f => ({ ...f, storeName: e.target.value }))}
              />
            </Field>
            <Field label="自提地址">
              <input
                className={inputCls}
                value={pickupForm.pickupAddress}
                disabled={pickupLoading}
                placeholder="例如：上海市徐汇区..."
                onChange={e => setPickupForm(f => ({ ...f, pickupAddress: e.target.value }))}
              />
            </Field>
            <Field label="补充说明">
              <input
                className={inputCls}
                value={pickupForm.pickupNote}
                disabled={pickupLoading}
                placeholder="营业时间、取餐提示等"
                onChange={e => setPickupForm(f => ({ ...f, pickupNote: e.target.value }))}
              />
            </Field>
          </div>
          <button
            onClick={savePickupConfig}
            disabled={pickupLoading || pickupSaving}
            className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover transition-colors disabled:opacity-60"
          >
            {pickupSaving ? '保存中…' : '保存自提设置'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E5E5] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#F9F9F9] border-b border-[#E5E5E5]">
            <tr>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">地区</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">运费</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">满免</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">排序</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">状态</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-[#6B7280]">加载中…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-[#6B7280]">暂无运费规则</td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id} className="border-b border-[#E5E5E5]">
                  <td className="py-3 px-4">
                    <p className="text-sm font-medium text-[#1A1A1A]">{areaLabel(row)}</p>
                    <p className="text-xs text-[#6B7280]">{areaLevelLabel(initialForm(row).areaLevel)} · ID {row.id}</p>
                  </td>
                  <td className="py-3 px-4 text-sm">{fmtMoney(row.shipping_fee)}</td>
                  <td className="py-3 px-4 text-sm">{fmtMoney(row.free_shipping_threshold)}</td>
                  <td className="py-3 px-4 text-sm">{row.sort}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded ${row.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {row.enabled ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <button onClick={() => openEdit(row)} className="text-xs text-primary hover:underline">编辑</button>
                    <button onClick={() => remove(row)} className="text-xs text-red-500 hover:underline">删除</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? '添加运费规则' : '编辑运费规则'} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="规则范围">
              <select className={inputCls} value={form.areaLevel} onChange={e => updateAreaLevel(e.target.value as AreaLevel)}>
                <option value="default">默认规则（全国兜底）</option>
                <option value="province">省级规则</option>
                <option value="city">城市规则</option>
                <option value="district">区县规则</option>
              </select>
            </Field>

            {form.areaLevel !== 'default' && (
              <div className="grid grid-cols-3 gap-3">
                <Field label="省份">
                  <select className={inputCls} value={form.province} onChange={e => updateProvince(e.target.value)}>
                    <option value="">选择省份</option>
                    {provinceOptions().map(item => (
                      <option key={item.value} value={item.label}>{item.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="城市">
                  <select
                    className={disabledInputCls}
                    value={form.city}
                    disabled={form.areaLevel === 'province' || !form.province}
                    onChange={e => updateCity(e.target.value)}
                  >
                    <option value="">{form.areaLevel === 'province' ? '省级规则不选择城市' : '选择城市'}</option>
                    {cities.map(item => (
                      <option key={item.value} value={item.label}>{item.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="区县">
                  <select
                    className={disabledInputCls}
                    value={form.district}
                    disabled={form.areaLevel !== 'district' || !form.city}
                    onChange={e => setForm(f => ({ ...f, district: e.target.value }))}
                  >
                    <option value="">{form.areaLevel === 'district' ? '选择区县' : '区县规则时选择'}</option>
                    {districts.map(item => (
                      <option key={item.value} value={item.label}>{item.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            <p className="text-xs text-[#6B7280]">
              {form.areaLevel === 'default'
                ? '默认规则用于没有命中具体地区时的全国兜底运费。'
                : '地区名称按微信收货地址字段保存，例如：广东省 / 深圳市 / 南山区。'}
            </p>

            {form.province && form.areaLevel !== 'default' && !findProvince(form.province) && (
              <p className="text-xs text-amber-600">当前规则地区不在中国行政区选项中，建议重新选择后保存。</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="运费">
                <input className={inputCls} type="number" min="0" step="0.01" value={form.shipping_fee} onChange={e => setForm(f => ({ ...f, shipping_fee: e.target.value }))} />
              </Field>
              <Field label="满免门槛">
                <input className={inputCls} type="number" min="0" step="0.01" value={form.free_shipping_threshold} placeholder="留空表示不满免" onChange={e => setForm(f => ({ ...f, free_shipping_threshold: e.target.value }))} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="排序">
                <input className={inputCls} type="number" value={form.sort} onChange={e => setForm(f => ({ ...f, sort: e.target.value }))} />
              </Field>
              <Field label="状态">
                <select className={inputCls} value={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.value }))}>
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
              </Field>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#1A1A1A]">取消</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover disabled:opacity-60">
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
