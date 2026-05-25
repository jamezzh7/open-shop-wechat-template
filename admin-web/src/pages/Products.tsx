import { useEffect, useMemo, useState, useRef } from 'react';
import {
  listCatalog, createCatalogItem, updateCatalogItem, deleteCatalogItem,
  uploadProductImage, getImageUrl, setProductRecommendation,
  type Category, type Product, type Sku,
} from '../api/catalog';

type Tab = 'categories' | 'products' | 'skus';
const TABS: { key: Tab; label: string }[] = [
  { key: 'categories', label: '分类' },
  { key: 'products',   label: '商品' },
  { key: 'skus',       label: 'SKU' },
];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg border border-[#E5E5E5] w-[420px] max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
          <span className="font-medium text-[#1A1A1A]">{title}</span>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A1A] text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full border border-[#E5E5E5] rounded px-3 py-2 text-sm outline-none focus:border-primary transition-colors';
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type CatalogCacheKey = 'categories' | 'products' | 'skus';

const memoryCatalogCache: {
  categories: Category[] | null;
  products: Product[] | null;
  skus: Sku[] | null;
} = {
  categories: null,
  products: null,
  skus: null,
};

type CachedRowsPayload<T> = {
  savedAt: number;
  rows: T[];
};

function normalizeSearch(value: string | number | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCategory(value: unknown): value is Category {
  return isRecord(value)
    && typeof value.id === 'number'
    && typeof value.name === 'string'
    && typeof value.sort === 'number';
}

function isProduct(value: unknown): value is Product {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.category_id === 'number'
    && typeof value.title === 'string'
    && typeof value.description === 'string'
    && typeof value.image === 'string'
    && typeof value.sort === 'number'
    && typeof value.available === 'number'
    && (value.recommended === undefined || typeof value.recommended === 'number');
}

function isSku(value: unknown): value is Sku {
  return isRecord(value)
    && typeof value.id === 'number'
    && typeof value.product_id === 'string'
    && typeof value.name === 'string'
    && typeof value.price === 'number'
    && typeof value.available === 'number'
    && typeof value.sort === 'number';
}

function cacheKey(type: CatalogCacheKey) {
  return `vibe-admin-catalog-${type}`;
}

function readCachedRows<T>(type: CatalogCacheKey, guard: (value: unknown) => value is T): T[] | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(cacheKey(type));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - parsed.savedAt > CATALOG_CACHE_TTL_MS) return null;
    if (!parsed.rows.every(guard)) return null;

    return parsed.rows;
  } catch {
    return null;
  }
}

function writeCachedRows<T>(type: CatalogCacheKey, rows: T[]) {
  if (typeof window === 'undefined') return;

  const payload: CachedRowsPayload<T> = {
    savedAt: Date.now(),
    rows,
  };

  try {
    window.localStorage.setItem(cacheKey(type), JSON.stringify(payload));
  } catch {
    // Cache writes are best-effort; live CloudBase data remains the source of truth.
  }
}

function getCategoriesCache() {
  if (!memoryCatalogCache.categories) {
    memoryCatalogCache.categories = readCachedRows('categories', isCategory);
  }
  return memoryCatalogCache.categories;
}

function setCategoriesCache(rows: Category[]) {
  memoryCatalogCache.categories = rows;
  writeCachedRows('categories', rows);
}

function getProductsCache() {
  if (!memoryCatalogCache.products) {
    memoryCatalogCache.products = readCachedRows('products', isProduct);
  }
  return memoryCatalogCache.products;
}

function setProductsCache(rows: Product[]) {
  memoryCatalogCache.products = rows;
  writeCachedRows('products', rows);
}

function getSkusCache() {
  if (!memoryCatalogCache.skus) {
    memoryCatalogCache.skus = readCachedRows('skus', isSku);
  }
  return memoryCatalogCache.skus;
}

function setSkusCache(rows: Sku[]) {
  memoryCatalogCache.skus = rows;
  writeCachedRows('skus', rows);
}

function SearchBar({
  value,
  onChange,
  placeholder,
  resultCount,
  totalCount,
  loading = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  resultCount: number;
  totalCount: number;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-[360px]">
        <input
          className="w-full border border-[#E5E5E5] rounded px-3 py-2 pr-16 text-sm outline-none focus:border-primary transition-colors"
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-[#6B7280] hover:text-[#1A1A1A]"
          >
            清除
          </button>
        )}
      </div>
      <span className="text-xs text-[#6B7280]">
        {loading ? '加载中…' : value ? `筛选出 ${resultCount} / ${totalCount} 条` : `共 ${totalCount} 条`}
      </span>
    </div>
  );
}

function TableStateRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 px-4 text-center text-sm text-[#6B7280]">
        {children}
      </td>
    </tr>
  );
}

// ─── Categories ───────────────────────────────────────────────────────────

function CategoriesTab() {
  const cachedCategories = useMemo(() => getCategoriesCache(), []);
  const [rows, setRows] = useState<Category[]>(() => cachedCategories ?? []);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; row?: Category } | null>(null);
  const [form, setForm] = useState({ name: '', sort: '0' });
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await listCatalog('categories');
    const nextRows = data as Category[];
    setRows(nextRows);
    setCategoriesCache(nextRows);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRows() {
      const data = await listCatalog('categories');
      const nextRows = data as Category[];
      setCategoriesCache(nextRows);
      if (!cancelled) setRows(nextRows);
    }

    void loadRows();

    return () => { cancelled = true; };
  }, []);

  function openCreate() { setForm({ name: '', sort: '0' }); setModal({ mode: 'create' }); }
  function openEdit(row: Category) { setForm({ name: row.name, sort: String(row.sort) }); setModal({ mode: 'edit', row }); }

  async function save() {
    setSaving(true);
    try {
      const data = { name: form.name, sort: parseInt(form.sort) || 0 };
      if (modal?.mode === 'create') await createCatalogItem('categories', data);
      else await updateCatalogItem('categories', modal!.row!.id, data);
      setModal(null);
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setSaving(false); }
  }

  async function del(id: number) {
    if (!confirm('确认删除该分类？仅空分类可以删除；已有商品的分类请先把商品移到其他分类。')) return;
    try { await deleteCatalogItem('categories', id); await load(); }
    catch (e: unknown) { alert((e as Error).message); }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <button onClick={openCreate} className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover transition-colors">
          添加分类
        </button>
      </div>
      <div className="bg-white rounded-lg border border-[#E5E5E5] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#F9F9F9] border-b border-[#E5E5E5]">
            <tr>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">ID</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">名称</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">排序</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className="border-b border-[#E5E5E5]">
                <td className="py-3 px-4 text-sm text-[#6B7280]">{row.id}</td>
                <td className="py-3 px-4 text-sm">{row.name}</td>
                <td className="py-3 px-4 text-sm">{row.sort}</td>
                <td className="py-3 px-4 text-right space-x-2">
                  <button onClick={() => openEdit(row)} className="text-xs text-primary hover:underline">编辑</button>
                  <button onClick={() => del(row.id)} className="text-xs text-red-500 hover:underline">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? '添加分类' : '编辑分类'} onClose={() => setModal(null)}>
          <Field label="名称">
            <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="排序（数字越小越靠前）">
            <input className={inputCls} type="number" value={form.sort} onChange={e => setForm(f => ({ ...f, sort: e.target.value }))} />
          </Field>
          <div className="flex justify-end space-x-2 mt-2">
            <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#1A1A1A]">取消</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover disabled:opacity-60">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── Products (SPU) ───────────────────────────────────────────────────────

function ProductsTab() {
  const cachedProducts = useMemo(() => getProductsCache(), []);
  const cachedCategories = useMemo(() => getCategoriesCache(), []);
  const [rows, setRows] = useState<Product[]>(() => cachedProducts ?? []);
  const [categories, setCategories] = useState<Category[]>(() => cachedCategories ?? []);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(!cachedProducts || !cachedCategories);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; row?: Product } | null>(null);
  const [form, setForm] = useState({ category_id: '', title: '', description: '', image: '', sort: '0', available: '1' });
  const [imagePreview, setImagePreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recommendingId, setRecommendingId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const firstCategoryId = categories[0]?.id != null ? String(categories[0].id) : '';
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const filteredRows = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return rows;

    return rows.filter(row => {
      const cat = categoryById.get(row.category_id);
      const statusText = row.available ? '上架' : '下架';
      const recommendationText = row.recommended ? '每日推荐 已推荐' : '未推荐';
      return [
        row.id,
        row.title,
        row.description,
        row.category_id,
        cat?.name,
        statusText,
        recommendationText,
      ].some(value => normalizeSearch(value).includes(query));
    });
  }, [categoryById, rows, search]);

  async function load() {
    const [prods, cats] = await Promise.all([listCatalog('products'), listCatalog('categories')]);
    const nextProducts = prods as Product[];
    const nextCategories = cats as Category[];
    setRows(nextProducts);
    setCategories(nextCategories);
    setProductsCache(nextProducts);
    setCategoriesCache(nextCategories);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRows() {
      if (!cachedProducts || !cachedCategories) setLoading(true);
      try {
        const [prods, cats] = await Promise.all([listCatalog('products'), listCatalog('categories')]);
        const nextProducts = prods as Product[];
        const nextCategories = cats as Category[];
        setProductsCache(nextProducts);
        setCategoriesCache(nextCategories);
        if (!cancelled) {
          setRows(nextProducts);
          setCategories(nextCategories);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRows();

    return () => { cancelled = true; };
  }, [cachedCategories, cachedProducts]);

  function openCreate() {
    setForm({ category_id: firstCategoryId, title: '', description: '', image: '', sort: '0', available: '1' });
    setImagePreview('');
    setModal({ mode: 'create' });
  }

  async function openEdit(row: Product) {
    setForm({ ...row, category_id: String(row.category_id), sort: String(row.sort), available: String(row.available) });
    setImagePreview(row.image ? await getImageUrl(row.image) : '');
    setModal({ mode: 'edit', row });
  }

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileID = await uploadProductImage(file);
      const url = await getImageUrl(fileID);
      setForm(f => ({ ...f, image: fileID }));
      setImagePreview(url);
    } catch (err: unknown) { alert((err as Error).message); }
    finally { setUploading(false); }
  }

  async function save() {
    setSaving(true);
    try {
      const selectedCategoryId = form.category_id || firstCategoryId;
      const categoryId = Number(selectedCategoryId);
      if (!selectedCategoryId || !Number.isFinite(categoryId)) {
        alert('请选择分类');
        setSaving(false);
        return;
      }

      const data = {
        category_id: categoryId,
        title: form.title,
        description: form.description,
        image: form.image,
        sort: parseInt(form.sort) || 0,
        available: parseInt(form.available),
      };
      if (modal?.mode === 'create') {
        await createCatalogItem('products', data);
      } else {
        await updateCatalogItem('products', modal!.row!.id, data);
      }
      setModal(null);
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setSaving(false); }
  }

  async function toggleAvailable(row: Product) {
    try {
      await updateCatalogItem('products', row.id, { available: row.available ? 0 : 1 });
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
  }

  async function toggleRecommendation(row: Product) {
    setRecommendingId(row.id);
    try {
      await setProductRecommendation(row.id, !row.recommended);
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setRecommendingId(''); }
  }

  async function del(row: Product) {
    if (!confirm(`确认删除商品「${row.title}」？该操作会同时删除此商品下的 SKU，历史订单仍会保留商品快照。`)) return;
    try {
      await deleteCatalogItem('products', row.id);
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
  }

  return (
    <>
      <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-center lg:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="搜索商品名、ID、分类、描述或推荐状态"
          resultCount={filteredRows.length}
          totalCount={rows.length}
          loading={loading}
        />
        <button onClick={openCreate} className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover transition-colors">
          添加商品
        </button>
      </div>
      <div className="bg-white rounded-lg border border-[#E5E5E5] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#F9F9F9] border-b border-[#E5E5E5]">
            <tr>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">商品</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">分类</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">排序</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">状态</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">每日推荐</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableStateRow colSpan={6}>商品加载中…</TableStateRow>
            ) : filteredRows.map(row => {
              const cat = categoryById.get(row.category_id);
              return (
                <tr key={row.id} className="border-b border-[#E5E5E5]">
                  <td className="py-3 px-4">
                    <p className="text-sm font-medium">{row.title}</p>
                    <p className="text-xs text-[#6B7280]">{row.id}</p>
                  </td>
                  <td className="py-3 px-4 text-sm">{cat?.name ?? row.category_id}</td>
                  <td className="py-3 px-4 text-sm">{row.sort}</td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => toggleAvailable(row)}
                      className={`text-xs px-2 py-0.5 rounded ${row.available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {row.available ? '上架' : '下架'}
                    </button>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-block text-xs px-2 py-0.5 rounded ${
                      row.recommended ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {row.recommended ? '已加入' : '未加入'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <button
                      onClick={() => toggleRecommendation(row)}
                      disabled={recommendingId === row.id}
                      className="text-xs text-primary hover:underline disabled:opacity-60 disabled:no-underline"
                    >
                      {recommendingId === row.id ? '更新中…' : row.recommended ? '移除推荐' : '加入推荐'}
                    </button>
                    <button onClick={() => openEdit(row)} className="text-xs text-primary hover:underline">编辑</button>
                    <button onClick={() => del(row)} className="text-xs text-red-500 hover:underline">删除</button>
                  </td>
                </tr>
              );
            })}
            {!loading && filteredRows.length === 0 && (
              <TableStateRow colSpan={6}>没有找到匹配的商品</TableStateRow>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? '添加商品' : '编辑商品'} onClose={() => setModal(null)}>
          <Field label="分类">
            <select className={inputCls} value={form.category_id || firstCategoryId} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="名称">
            <input className={inputCls} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="描述">
            <textarea className={inputCls} rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="图片">
            <div className="space-y-2">
              {imagePreview && <img src={imagePreview} className="w-24 h-24 object-cover rounded border border-[#E5E5E5]" alt="" />}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="text-sm text-primary hover:underline disabled:opacity-60"
              >
                {uploading ? '上传中…' : '选择图片'}
              </button>
            </div>
          </Field>
          <Field label="排序">
            <input className={inputCls} type="number" value={form.sort} onChange={e => setForm(f => ({ ...f, sort: e.target.value }))} />
          </Field>
          <Field label="状态">
            <select className={inputCls} value={form.available} onChange={e => setForm(f => ({ ...f, available: e.target.value }))}>
              <option value="1">上架</option>
              <option value="0">下架</option>
            </select>
          </Field>
          <div className="flex justify-end space-x-2 mt-2">
            <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#1A1A1A]">取消</button>
            <button onClick={save} disabled={saving || uploading} className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover disabled:opacity-60">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── SKUs ─────────────────────────────────────────────────────────────────

function SkusTab() {
  const cachedSkus = useMemo(() => getSkusCache(), []);
  const cachedProducts = useMemo(() => getProductsCache(), []);
  const [rows, setRows] = useState<Sku[]>(() => cachedSkus ?? []);
  const [products, setProducts] = useState<Product[]>(() => cachedProducts ?? []);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(!cachedSkus || !cachedProducts);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; row?: Sku } | null>(null);
  const [form, setForm] = useState({ product_id: '', name: '', price: '', sort: '0', available: '1' });
  const [saving, setSaving] = useState(false);
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const filteredRows = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return rows;

    return rows.filter(row => {
      const prod = productById.get(row.product_id);
      const statusText = row.available ? '上架' : '下架';
      return [
        row.id,
        row.product_id,
        prod?.title,
        row.name || '无规格',
        row.price,
        row.sort,
        statusText,
      ].some(value => normalizeSearch(value).includes(query));
    });
  }, [productById, rows, search]);

  async function load() {
    const [skus, prods] = await Promise.all([listCatalog('skus'), listCatalog('products')]);
    const nextSkus = skus as Sku[];
    const nextProducts = prods as Product[];
    setRows(nextSkus);
    setProducts(nextProducts);
    setSkusCache(nextSkus);
    setProductsCache(nextProducts);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRows() {
      if (!cachedSkus || !cachedProducts) setLoading(true);
      try {
        const [skus, prods] = await Promise.all([listCatalog('skus'), listCatalog('products')]);
        const nextSkus = skus as Sku[];
        const nextProducts = prods as Product[];
        setSkusCache(nextSkus);
        setProductsCache(nextProducts);
        if (!cancelled) {
          setRows(nextSkus);
          setProducts(nextProducts);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRows();

    return () => { cancelled = true; };
  }, [cachedProducts, cachedSkus]);

  function openCreate() {
    setForm({ product_id: String(products[0]?.id ?? ''), name: '', price: '', sort: '0', available: '1' });
    setModal({ mode: 'create' });
  }

  function openEdit(row: Sku) {
    setForm({ product_id: row.product_id, name: row.name, price: String(row.price), sort: String(row.sort), available: String(row.available) });
    setModal({ mode: 'edit', row });
  }

  async function save() {
    setSaving(true);
    try {
      const data = {
        product_id: form.product_id,
        name: form.name,
        price: parseFloat(form.price),
        sort: parseInt(form.sort) || 0,
        available: parseInt(form.available),
      };
      if (modal?.mode === 'create') await createCatalogItem('skus', data);
      else await updateCatalogItem('skus', modal!.row!.id, data);
      setModal(null);
      await load();
    } catch (e: unknown) { alert((e as Error).message); }
    finally { setSaving(false); }
  }

  async function del(id: number) {
    if (!confirm('确认下架该SKU？')) return;
    try { await deleteCatalogItem('skus', id); await load(); }
    catch (e: unknown) { alert((e as Error).message); }
  }

  return (
    <>
      <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-center lg:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="搜索商品名、商品ID、规格、价格或状态"
          resultCount={filteredRows.length}
          totalCount={rows.length}
          loading={loading}
        />
        <button onClick={openCreate} className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover transition-colors">
          添加SKU
        </button>
      </div>
      <div className="bg-white rounded-lg border border-[#E5E5E5] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#F9F9F9] border-b border-[#E5E5E5]">
            <tr>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">商品</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">规格</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">价格</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[#6B7280]">状态</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableStateRow colSpan={5}>SKU 加载中…</TableStateRow>
            ) : filteredRows.map(row => {
              const prod = productById.get(row.product_id);
              return (
                <tr key={row.id} className="border-b border-[#E5E5E5]">
                  <td className="py-3 px-4 text-sm">{prod?.title ?? row.product_id}</td>
                  <td className="py-3 px-4 text-sm">{row.name || '—'}</td>
                  <td className="py-3 px-4 text-sm font-medium">¥{Number(row.price).toFixed(2)}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded ${row.available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {row.available ? '上架' : '下架'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <button onClick={() => openEdit(row)} className="text-xs text-primary hover:underline">编辑</button>
                    <button onClick={() => del(row.id)} className="text-xs text-red-500 hover:underline">下架</button>
                  </td>
                </tr>
              );
            })}
            {!loading && filteredRows.length === 0 && (
              <TableStateRow colSpan={5}>没有找到匹配的 SKU</TableStateRow>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? '添加SKU' : '编辑SKU'} onClose={() => setModal(null)}>
          <Field label="商品">
            <select className={inputCls} value={form.product_id} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}>
              {products.filter(p => p.available).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>
          <Field label="规格名（留空表示无规格）">
            <input className={inputCls} value={form.name} placeholder="如：单球、双球" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="价格（元）">
            <input className={inputCls} type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </Field>
          <Field label="排序">
            <input className={inputCls} type="number" value={form.sort} onChange={e => setForm(f => ({ ...f, sort: e.target.value }))} />
          </Field>
          <Field label="状态">
            <select className={inputCls} value={form.available} onChange={e => setForm(f => ({ ...f, available: e.target.value }))}>
              <option value="1">上架</option>
              <option value="0">下架</option>
            </select>
          </Field>
          <div className="flex justify-end space-x-2 mt-2">
            <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#1A1A1A]">取消</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover disabled:opacity-60">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── Products page root ───────────────────────────────────────────────────

export default function Products() {
  const [tab, setTab] = useState<Tab>('categories');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-[#1A1A1A]">商品管理</h1>
      <div className="flex border-b border-[#E5E5E5]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${
              tab === key ? 'border-primary text-primary font-medium' : 'border-transparent text-[#6B7280] hover:text-[#1A1A1A]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'products'   && <ProductsTab />}
      {tab === 'skus'       && <SkusTab />}
    </div>
  );
}
