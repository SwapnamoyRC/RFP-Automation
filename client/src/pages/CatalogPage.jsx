import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, ExternalLink, Trash2, CheckCircle2, XCircle, Clock,
  Package, Loader2, BookOpen, RefreshCw, Download, Search,
  ChevronLeft, ChevronRight, ImageOff, ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import * as api from '../api/sessions';
import { extractError } from '../utils/extractError';
import ConfirmDialog from '../components/ConfirmDialog';

const CATEGORIES = ['Seating', 'Tables', 'Storage', 'Lighting', 'Accessories', 'Outdoor', 'Other'];

// ── Product Card (catalog browse) ────────────────────────────────────────────
function ProductCard({ product }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all overflow-hidden">
      {product.image_url ? (
        <img
          src={product.image_url}
          alt={product.name}
          className="w-full h-40 object-contain bg-gray-50 border-b border-gray-100"
          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
        />
      ) : null}
      {!product.image_url && (
        <div className="w-full h-40 bg-gray-50 border-b border-gray-100 flex items-center justify-center">
          <ImageOff className="w-10 h-10 text-gray-200" />
        </div>
      )}
      {/* Hidden fallback for broken images */}
      <div className="w-full h-40 bg-gray-50 border-b border-gray-100 items-center justify-center hidden">
        <ImageOff className="w-10 h-10 text-gray-200" />
      </div>
      <div className="p-4">
        <p className="text-sm font-semibold text-gray-900 truncate">{product.name}</p>
        <p className="text-xs text-primary-600 font-medium">{product.brand_name}</p>
        {product.category && (
          <span className="inline-block mt-1 text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {product.category}
          </span>
        )}
        {product.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mt-1.5">{product.description}</p>
        )}
        {product.dimensions && (
          <p className="text-[10px] text-gray-400 mt-1">{product.dimensions}</p>
        )}
        {product.source_url && (
          <a
            href={product.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-[10px] text-primary-600 hover:underline mt-1.5 truncate"
          >
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
            View source
          </a>
        )}
      </div>
    </div>
  );
}

// ── Catalog Browse (all DB products) ─────────────────────────────────────────
function CatalogBrowse({ onAddMore }) {
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [selectedBrand, setSelectedBrand] = useState(null); // null = All
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const debounceRef = useRef(null);

  const fetchProducts = useCallback(async (searchTerm, pg, brand) => {
    setLoading(true);
    try {
      const params = { page: pg, limit: 24 };
      if (searchTerm) params.search = searchTerm;
      if (brand) params.brand = brand;
      const data = await api.listProducts(params);
      setProducts(data.products || []);
      setTotal(data.pagination?.total || 0);
    } catch (err) {
      toast.error(extractError(err, 'Failed to load products'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load brands on mount
  useEffect(() => {
    api.listBrands().then(setBrands).catch(() => {});
    fetchProducts('', 1, null);
  }, [fetchProducts]);

  const handleSearchChange = (val) => {
    setSearch(val);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchProducts(val, 1, selectedBrand), 300);
  };

  const handleBrandChange = (brandSlug) => {
    setSelectedBrand(brandSlug);
    setPage(1);
    setSearch('');
    fetchProducts('', 1, brandSlug);
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchProducts(search, newPage, selectedBrand);
  };

  const totalPages = Math.ceil(total / 24);

  return (
    <div>
      {/* Search bar + Add button */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search products by name, brand, or description..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
          />
        </div>
        <button
          onClick={onAddMore}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add More Products
        </button>
      </div>

      {/* Brand filter tabs */}
      {brands.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button
            onClick={() => handleBrandChange(null)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              !selectedBrand
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Brands
          </button>
          {brands.map(brand => (
            <button
              key={brand.id}
              onClick={() => handleBrandChange(brand.slug)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                selectedBrand === brand.slug
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {brand.name}
            </button>
          ))}
        </div>
      )}

      {/* Stats */}
      <p className="text-xs text-gray-400 mb-4">
        {total} products{selectedBrand ? ` in ${brands.find(b => b.slug === selectedBrand)?.name || selectedBrand}` : ' in catalog'}
      </p>

      {/* Product Grid */}
      {loading ? (
        <div className="py-20 flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
          <p className="text-sm text-gray-500">Loading products...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="py-20 flex flex-col items-center gap-3">
          <Package className="w-10 h-10 text-gray-200" />
          <p className="text-sm text-gray-500">No products found</p>
          <p className="text-xs text-gray-400">
            {search ? 'Try a different search term' : 'Add products to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-40"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Submission Form ──────────────────────────────────────────────────────────
function SubmissionForm({ onSubmit, loading }) {
  const [form, setForm] = useState({
    productUrl: '', productName: '', brand: '', category: '',
    description: '', dimensions: '', materials: '', imageUrl: '', notes: '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.productUrl.trim()) return;
    await onSubmit(form);
    setForm({ productUrl: '', productName: '', brand: '', category: '', description: '', dimensions: '', materials: '', imageUrl: '', notes: '' });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Plus className="w-4 h-4 text-primary-600" />
        Submit New Product
      </h2>

      <div className="space-y-4">
        {/* URL – required */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Product URL <span className="text-red-500">*</span>
          </label>
          <input
            type="url"
            value={form.productUrl}
            onChange={e => set('productUrl', e.target.value)}
            placeholder="https://www.brand.com/product-page"
            required
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Product Name</label>
            <input
              type="text"
              value={form.productName}
              onChange={e => set('productName', e.target.value)}
              placeholder="e.g. About a Chair AAC22"
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Brand</label>
            <input
              type="text"
              value={form.brand}
              onChange={e => set('brand', e.target.value)}
              placeholder="e.g. Hay"
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
            <select
              value={form.category}
              onChange={e => set('category', e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
            >
              <option value="">Select...</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Dimensions</label>
            <input
              type="text"
              value={form.dimensions}
              onChange={e => set('dimensions', e.target.value)}
              placeholder="e.g. W60 × D55 × H82 cm"
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Brief product description..."
            rows={2}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Materials</label>
            <input
              type="text"
              value={form.materials}
              onChange={e => set('materials', e.target.value)}
              placeholder="e.g. Polypropylene, beech wood"
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Image URL</label>
            <input
              type="url"
              value={form.imageUrl}
              onChange={e => set('imageUrl', e.target.value)}
              placeholder="https://..."
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <input
            type="text"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Why are you submitting this? (optional)"
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
          />
        </div>

        <button
          type="submit"
          disabled={!form.productUrl.trim() || loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Submit Product
        </button>
      </div>
    </form>
  );
}

// ── Submission Row ───────────────────────────────────────────────────────────
const STATUS_STYLES = {
  pending:  { icon: Clock,        text: 'Pending',  bg: 'bg-amber-100 text-amber-700' },
  approved: { icon: CheckCircle2, text: 'Approved', bg: 'bg-emerald-100 text-emerald-700' },
  rejected: { icon: XCircle,      text: 'Rejected', bg: 'bg-red-100 text-red-700' },
  imported: { icon: Package,      text: 'Imported', bg: 'bg-primary-100 text-primary-700' },
};

function SubmissionRow({ item, isAdmin, onStatusChange, onDelete, onImport, onConfirmRequest }) {
  const [actionLoading, setActionLoading] = useState(false);
  const s = STATUS_STYLES[item.status] || STATUS_STYLES.pending;
  const StatusIcon = s.icon;

  const handleStatus = async (status) => {
    setActionLoading(true);
    try { await onStatusChange(item.id, status); } finally { setActionLoading(false); }
  };
  const handleDelete = () => {
    onConfirmRequest({
      title: 'Delete submission?',
      message: `"${item.product_name || item.product_url}" will be permanently removed.`,
      variant: 'danger',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setActionLoading(true);
        try { await onDelete(item.id); } finally { setActionLoading(false); }
      },
    });
  };
  const handleImport = () => {
    onConfirmRequest({
      title: 'Import into catalog?',
      message: `"${item.product_name || item.product_url}" will be added to the live catalog. AI embeddings will be generated now.`,
      variant: 'info',
      confirmLabel: 'Import',
      onConfirm: async () => {
        setActionLoading(true);
        try { await onImport(item.id); } finally { setActionLoading(false); }
      },
    });
  };

  return (
    <div className="px-6 py-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
      {/* Thumbnail */}
      {item.image_url ? (
        <img
          src={item.image_url}
          alt={item.product_name}
          className="w-12 h-12 rounded-lg object-contain bg-gray-50 border border-gray-100 shrink-0"
          onError={e => { e.target.style.display = 'none'; }}
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
          <Package className="w-5 h-5 text-gray-300" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {item.product_name || 'Unnamed Product'}
              {item.brand && <span className="ml-1.5 text-xs font-normal text-gray-500">by {item.brand}</span>}
            </p>
            {item.category && (
              <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{item.category}</span>
            )}
          </div>
          <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.bg}`}>
            <StatusIcon className="w-2.5 h-2.5" />
            {s.text}
          </span>
        </div>

        {item.description && (
          <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{item.description}</p>
        )}
        {item.dimensions && (
          <p className="text-[10px] text-gray-400 mt-0.5">Dimensions: {item.dimensions}</p>
        )}

        <div className="flex items-center gap-3 mt-1.5">
          <a
            href={item.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-[10px] text-primary-600 hover:underline truncate max-w-[200px]"
          >
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
            {item.product_url}
          </a>
          {item.submitted_by_name || item.submitted_by_email ? (
            <span className="text-[10px] text-gray-400">
              by {item.submitted_by_name || item.submitted_by_email}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isAdmin && item.status === 'pending' && (
          <>
            <button
              onClick={() => handleStatus('approved')}
              disabled={actionLoading}
              title="Approve"
              className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => handleStatus('rejected')}
              disabled={actionLoading}
              title="Reject"
              className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        {isAdmin && item.status === 'approved' && (
          <button
            onClick={handleImport}
            disabled={actionLoading}
            title="Import into catalog"
            className="p-1.5 rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 transition-colors disabled:opacity-50"
          >
            {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={actionLoading}
          title="Delete"
          className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Add Products View (submissions) ──────────────────────────────────────────
function AddProductsView({ user, onBack }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialog, setDialog] = useState(null);

  const openDialog = (opts) => setDialog(opts);
  const closeDialog = () => setDialog(null);
  const handleDialogConfirm = async () => {
    const fn = dialog?.onConfirm;
    closeDialog();
    if (fn) await fn();
  };

  const isAdmin = user?.role === 'admin';

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? { status: statusFilter } : {};
      const data = await api.listSubmissions(params);
      setSubmissions(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(extractError(err, 'Failed to load submissions'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

  const handleSubmit = async (form) => {
    setSubmitLoading(true);
    try {
      await api.submitProduct(form);
      toast.success('Product submitted! It will be reviewed by the team.');
      fetchSubmissions();
    } catch (err) {
      toast.error(extractError(err, 'Failed to submit'));
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await api.updateSubmission(id, { status });
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    } catch (err) {
      toast.error(extractError(err, 'Failed to update submission'));
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.deleteSubmission(id);
      setSubmissions(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      toast.error(extractError(err, 'Failed to delete'));
    }
  };

  const handleImport = async (id) => {
    try {
      const result = await api.importSubmission(id);
      toast.success(`"${result.productName}" imported into catalog. AI embeddings generated.`);
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'imported' } : s));
    } catch (err) {
      toast.error(extractError(err, 'Import failed'));
    }
  };

  const counts = {
    all: submissions.length,
    pending: submissions.filter(s => s.status === 'pending').length,
    approved: submissions.filter(s => s.status === 'approved').length,
    rejected: submissions.filter(s => s.status === 'rejected').length,
  };

  const filtered = statusFilter === 'all' ? submissions : submissions.filter(s => s.status === statusFilter);

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Catalog
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Form */}
        <div className="xl:col-span-2">
          <SubmissionForm onSubmit={handleSubmit} loading={submitLoading} />

          {/* Info panel */}
          <div className="mt-4 p-4 rounded-xl bg-primary-50 border border-primary-100">
            <h3 className="text-xs font-semibold text-primary-800 mb-2">How it works</h3>
            <ul className="space-y-1.5">
              {[
                'Submit a product URL from any furniture brand website',
                'Include as much detail as possible (name, brand, dimensions)',
                'Admin reviews and approves submissions',
                'Approved products are imported into the catalog for AI matching',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-primary-700">
                  <span className="w-4 h-4 rounded-full bg-primary-200 text-primary-800 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Submissions List */}
        <div className="xl:col-span-3">
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                Submissions
              </h2>
              <div className="flex items-center gap-2">
                {/* Status filter */}
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  {['all', 'pending', 'approved', 'rejected'].map(s => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                        statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                      <span className="ml-1 opacity-60">{counts[s]}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={fetchSubmissions}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                  title="Refresh"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {loading && filtered.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
                <p className="text-sm text-gray-500">Loading submissions...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-3">
                <Package className="w-8 h-8 text-gray-200" />
                <p className="text-sm text-gray-500">No submissions yet.</p>
                <p className="text-xs text-gray-400">Be the first to submit a product!</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {filtered.map(item => (
                  <SubmissionRow
                    key={item.id}
                    item={item}
                    isAdmin={isAdmin}
                    onStatusChange={handleStatusChange}
                    onDelete={handleDelete}
                    onImport={handleImport}
                    onConfirmRequest={openDialog}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!dialog}
        title={dialog?.title}
        message={dialog?.message}
        variant={dialog?.variant}
        confirmLabel={dialog?.confirmLabel}
        onConfirm={handleDialogConfirm}
        onCancel={closeDialog}
      />
    </div>
  );
}

// ── Main Catalog Page ────────────────────────────────────────────────────────
export default function CatalogPage({ user }) {
  const [view, setView] = useState('browse'); // 'browse' or 'add'

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-5 h-5 text-primary-600" />
          <h1 className="text-2xl font-bold text-gray-900">Product Catalog</h1>
        </div>
        <p className="text-sm text-gray-500">
          {view === 'browse'
            ? 'Browse all products available for AI matching.'
            : 'Submit product links and data to help improve AI matching accuracy.'}
        </p>
      </div>

      {view === 'browse' ? (
        <CatalogBrowse onAddMore={() => setView('add')} />
      ) : (
        <AddProductsView user={user} onBack={() => setView('browse')} />
      )}
    </div>
  );
}
