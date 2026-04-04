import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, XCircle, ChevronDown, ChevronUp, ArrowRight,
  Search, Filter, Package, Loader2, RefreshCw, ImageOff,
  Check, X, Link, PenLine, AlertTriangle, Database,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import ConfidenceMeter from '../components/ConfidenceMeter';
import ImageCompare from '../components/ImageCompare';
import { listProducts } from '../api/sessions';

// ── Parse plain-text explanation into structured matched/mismatched points ─────
// Used as a fallback when the DB doesn't have structured points yet
// (sessions processed before the verifier was updated).
function parseExplanation(explanation) {
  if (!explanation || explanation.length < 10) return { matched: [], mismatched: [] };

  // Strip leading rating prefix: "Excellent match - ", "High-confidence match: ", etc.
  const stripped = explanation
    .replace(/^(excellent|good|strong|perfect|decent|fair|poor|partial|high.confidence|great)\s+(match|visual match)\s*[-–:]\s*/i, '')
    .replace(/^(same|similar|matching)\s*[-–:]\s*/i, '')
    .trim();

  // Split on ", " / "; " / " and " / ". "
  const parts = stripped
    .split(/[,;]|\s+and\s+|\.\s+/)
    .map(p => p.replace(/\.$/, '').trim())
    .filter(p => p.length >= 6 && p.length <= 90);

  const mismatchWords = /\b(different|unlike|does\s+not|doesn'?t|no\s+match|different\s+color|color\s+differ|colour|variation|distinct|instead|however|but\s+|mismatch|not\s+match|slight\s+diff)\b/i;

  const matched = [];
  const mismatched = [];

  for (const part of parts) {
    const clean = part.charAt(0).toUpperCase() + part.slice(1);
    if (mismatchWords.test(part)) {
      mismatched.push(clean);
    } else {
      matched.push(clean);
    }
  }

  return { matched, mismatched };
}

// ── Match Breakdown ────────────────────────────────────────────────────────────
function MatchBreakdown({ matchedPoints = [], mismatchedPoints = [], explanation }) {
  // If structured points exist, use them; otherwise parse the explanation text
  let matched = matchedPoints;
  let mismatched = mismatchedPoints;

  if (matched.length === 0 && mismatched.length === 0 && explanation) {
    const parsed = parseExplanation(explanation);
    matched = parsed.matched;
    mismatched = parsed.mismatched;
  }

  if (matched.length === 0 && mismatched.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      {matched.map((pt, i) => (
        <div key={`m-${i}`} className="flex items-start gap-1.5">
          <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <Check className="w-2.5 h-2.5 text-emerald-600" />
          </span>
          <span className="text-xs text-gray-700">{pt}</span>
        </div>
      ))}
      {mismatched.map((pt, i) => (
        <div key={`mm-${i}`} className="flex items-start gap-1.5">
          <span className="mt-0.5 w-4 h-4 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <X className="w-2.5 h-2.5 text-red-500" />
          </span>
          <span className="text-xs text-gray-500">{pt}</span>
        </div>
      ))}
    </div>
  );
}

// ── Manual Override Panel ─────────────────────────────────────────────────────
function OverridePanel({ item, sessionId, onOverride, loading }) {
  const [url, setUrl] = useState(item.overrideProductUrl || '');
  const [name, setName] = useState(item.overrideProductName || '');
  const [brand, setBrand] = useState(item.overrideProductBrand || '');
  const [imageUrl, setImageUrl] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!url.trim()) return;
    setSaving(true);
    try {
      await onOverride(sessionId, item.id, {
        productUrl: url.trim(),
        productName: name.trim() || undefined,
        productBrand: brand.trim() || undefined,
        productImageUrl: imageUrl.trim() || undefined,
        note: note.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (item.isOverridden) {
    return (
      <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
        <div className="flex items-center gap-1.5 mb-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-xs font-semibold text-amber-800">Manually overridden</span>
        </div>
        {item.overrideProductName && (
          <p className="text-xs text-amber-700">{item.overrideProductBrand} {item.overrideProductName}</p>
        )}
        {item.overrideProductUrl && (
          <a
            href={item.overrideProductUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-amber-600 hover:underline truncate block mt-0.5"
          >
            {item.overrideProductUrl}
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
      <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
        <PenLine className="w-3.5 h-3.5 text-gray-500" />
        Submit Correct Product
      </p>
      <div>
        <label className="text-[10px] text-gray-500 mb-0.5 block">Product URL *</label>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://..."
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 outline-none bg-white"
          disabled={loading || saving}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">Product Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Eames Chair"
            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 outline-none bg-white"
            disabled={loading || saving}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">Brand</label>
          <input
            type="text"
            value={brand}
            onChange={e => setBrand(e.target.value)}
            placeholder="e.g. Herman Miller"
            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 outline-none bg-white"
            disabled={loading || saving}
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-gray-500 mb-0.5 block">Product Image URL (optional)</label>
        <input
          type="url"
          value={imageUrl}
          onChange={e => setImageUrl(e.target.value)}
          placeholder="https://example.com/image.jpg"
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 outline-none bg-white"
          disabled={loading || saving}
        />
        <p className="text-[9px] text-gray-400 mt-0.5">If provided, enables visual search matching with SigLIP embeddings</p>
      </div>
      <div>
        <label className="text-[10px] text-gray-500 mb-0.5 block">Note (optional)</label>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Reason for override..."
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 outline-none bg-white"
          disabled={loading || saving}
        />
      </div>
      <button
        onClick={handleSave}
        disabled={!url.trim() || loading || saving}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
        Mark as Final Match
      </button>
    </div>
  );
}

// ── Search Product Modal ─────────────────────────────────────────────────────
function SearchProductModal({ open, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      // Load initial products
      fetchProducts('', 1);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open]);

  const fetchProducts = async (searchTerm, pg) => {
    setLoading(true);
    try {
      const data = await listProducts({ search: searchTerm || undefined, page: pg, limit: 20 });
      setProducts(data.products || []);
      setTotal(data.pagination?.total || 0);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = (val) => {
    setQuery(val);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchProducts(val, 1), 300);
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchProducts(query, newPage);
  };

  if (!open) return null;

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-primary-600" />
              Search Catalog Products
            </h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search by product name, brand, or description..."
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">{total} products found</p>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
              <p className="text-sm text-gray-500">Searching products...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3">
              <Package className="w-8 h-8 text-gray-200" />
              <p className="text-sm text-gray-500">No products found</p>
              <p className="text-xs text-gray-400">Try a different search term</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {products.map(product => (
                <button
                  key={product.id}
                  onClick={() => onSelect(product)}
                  className="w-full px-6 py-3 flex items-start gap-4 hover:bg-primary-50 transition-colors text-left"
                >
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-14 h-14 rounded-lg object-contain bg-gray-50 border border-gray-100 shrink-0"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                      <Package className="w-6 h-6 text-gray-300" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{product.name}</p>
                    <p className="text-xs text-primary-600 font-medium">{product.brand_name}</p>
                    {product.description && (
                      <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{product.description}</p>
                    )}
                    {product.dimensions && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{product.dimensions}</p>
                    )}
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-gray-300 shrink-0 mt-1" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Alternatives Panel ────────────────────────────────────────────────────────
function AlternativesPanel({ alternatives, onSelect, loading }) {
  if (!alternatives || alternatives.length === 0) {
    return <p className="text-xs text-gray-400 italic py-2">No alternatives available</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
      {alternatives.map((alt, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(idx + 1)}
          disabled={loading}
          className="group p-3 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-all text-left"
        >
          <div className="flex items-start gap-3">
            {alt.imageUrl ? (
              <img
                src={alt.imageUrl}
                alt={alt.name}
                className="w-14 h-14 rounded-lg object-contain bg-gray-50 border border-gray-100"
                onError={e => { e.target.style.display = 'none'; }}
              />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center">
                <ImageOff className="w-5 h-5 text-gray-300" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate">{alt.brand} {alt.name}</p>
              {alt.explanation && (
                <p className="text-[10px] text-blue-600 mt-0.5 line-clamp-2 italic">{alt.explanation}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <ConfidenceMeter score={alt.similarity} className="flex-1" />
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Review Card ───────────────────────────────────────────────────────────────
function ReviewCard({ item, sessionId, onApprove, onReject, onSelectAlt, onOverride }) {
  const [expanded, setExpanded] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const match = item.matchedProduct || {};
  const alts = item.alternatives || [];
  const isReviewed = item.status === 'approved' || item.status === 'rejected';

  const handleAction = async (action) => {
    setActionLoading(true);
    try {
      if (action === 'approve') await onApprove(sessionId, item.id);
      else await onReject(sessionId, item.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSelectAlt = async (altIndex) => {
    setActionLoading(true);
    try {
      await onSelectAlt(sessionId, item.id, altIndex);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className={`bg-white rounded-2xl border transition-all duration-200 animate-slide-up ${
      item.status === 'approved' ? 'border-emerald-200' :
      item.status === 'rejected' ? 'border-red-200' :
      'border-gray-200 hover:border-gray-300'
    } ${item.isOverridden ? 'ring-1 ring-amber-300' : ''}`}>
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-bold text-gray-900 truncate">{item.rfpItem || item.description || 'Unnamed Item'}</h3>
              <StatusBadge status={item.status || 'pending'} />
              {item.isOverridden && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Overridden</span>
              )}
            </div>
            {item.dimensions && (
              <p className="text-xs text-gray-500">Dimensions: {item.dimensions}</p>
            )}
            {item.quantity && (
              <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
            )}
          </div>
          {match.confidence && (
            <div className="w-24 shrink-0 ml-4">
              <ConfidenceMeter score={match.confidence || match.similarity} />
            </div>
          )}
        </div>

        {/* Image Comparison */}
        <ImageCompare
          rfpImage={item.rfpImage || item.imageBase64}
          matchImage={match.imageUrl || match.image_url}
          rfpLabel="RFP Image"
          matchLabel="Best Match"
        />

        {/* Match Details */}
        {match.name && (
          <div className="mt-4 p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-gray-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{match.brand} {match.name}</p>
              </div>
            </div>

            {/* AI Match Breakdown — ticks/crosses from structured points or parsed explanation */}
            <MatchBreakdown
              matchedPoints={match.matchedPoints}
              mismatchedPoints={match.mismatchedPoints}
              explanation={match.explanation}
            />
          </div>
        )}

        {/* Actions */}
        {!isReviewed && (
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => handleAction('approve')}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve
            </button>
            <button
              onClick={() => handleAction('reject')}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white text-red-600 text-sm font-semibold border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Reject
            </button>
          </div>
        )}

        {/* Approved/Rejected toggle */}
        {isReviewed && (
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => handleAction(item.status === 'approved' ? 'reject' : 'approve')}
              disabled={actionLoading}
              className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
            >
              {item.status === 'approved' ? 'Change to Rejected' : 'Change to Approved'}
            </button>
          </div>
        )}

        {/* Search & Override buttons */}
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-primary-600 transition-colors"
          >
            <Database className="w-3 h-3" />
            Search catalog
          </button>
          <button
            onClick={() => setShowOverride(v => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 transition-colors"
          >
            <PenLine className="w-3 h-3" />
            {item.isOverridden ? 'Override active' : showOverride ? 'Hide override' : 'Override match'}
          </button>
        </div>

        {/* Search Product Modal */}
        <SearchProductModal
          open={showSearch}
          onClose={() => setShowSearch(false)}
          onSelect={async (product) => {
            setShowSearch(false);
            setActionLoading(true);
            try {
              await onOverride(sessionId, item.id, {
                productUrl: product.source_url || product.image_url || '',
                productName: product.name,
                productBrand: product.brand_name,
                productImageUrl: product.image_url || '',
                note: `Selected from catalog (Product ID: ${product.id})`,
              });
            } finally {
              setActionLoading(false);
            }
          }}
        />

        {/* Override Panel */}
        {(showOverride || item.isOverridden) && (
          <OverridePanel
            item={item}
            sessionId={sessionId}
            onOverride={onOverride}
            loading={actionLoading}
          />
        )}

        {/* Alternatives toggle */}
        {alts.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 w-full flex items-center justify-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-800 py-1.5"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? 'Hide' : 'Show'} {alts.length} Alternative{alts.length > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Alternatives Panel */}
      {expanded && alts.length > 0 && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">Alternative Matches</p>
          <AlternativesPanel
            alternatives={alts}
            onSelect={handleSelectAlt}
            loading={actionLoading}
          />
        </div>
      )}
    </div>
  );
}

// ── Review Page ───────────────────────────────────────────────────────────────
export default function ReviewPage({ items, session, onApprove, onReject, onSelectAlt, onOverride, onRefresh, onResumePolling, processing, progress }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  // Resume polling if user comes back while session is still processing
  useEffect(() => {
    if (session?.id && onResumePolling) {
      onResumePolling(session.id);
    }
  }, [session?.id, onResumePolling]);

  const filtered = useMemo(() => {
    let result = items || [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(item =>
        (item.rfpItem || item.description || '').toLowerCase().includes(q) ||
        (item.matchedProduct?.name || '').toLowerCase().includes(q) ||
        (item.matchedProduct?.brand || '').toLowerCase().includes(q)
      );
    }
    if (filter !== 'all') {
      result = result.filter(item => (item.status || 'pending') === filter);
    }
    return result;
  }, [items, search, filter]);

  const stats = useMemo(() => {
    const all = items || [];
    return {
      total: all.length,
      approved: all.filter(i => i.status === 'approved').length,
      rejected: all.filter(i => i.status === 'rejected').length,
      pending: all.filter(i => !i.status || i.status === 'pending' || i.status === 'matched').length,
    };
  }, [items]);

  if ((!items || items.length === 0) && !processing) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <Package className="w-8 h-8 text-gray-300" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">No Items to Review</h2>
        <p className="text-sm text-gray-500 mb-6">Upload and process an RFP file first.</p>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
        >
          Go to Upload
        </button>
      </div>
    );
  }

  if ((!items || items.length === 0) && processing) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="w-10 h-10 text-primary-600 animate-spin mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Processing Your RFP</h2>
        <p className="text-sm text-gray-500 mb-4">
          {progress
            ? `${progress.processed_items} of ${progress.total_items} items matched...`
            : 'Starting AI matching pipeline...'}
        </p>
        {progress && progress.total_items > 0 && (
          <div className="w-64">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full transition-all duration-700"
                style={{ width: `${(progress.processed_items / progress.total_items) * 100}%` }}
              />
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">Items will appear here as they are matched.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Matches</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {stats.total} items &middot; {stats.approved} approved &middot; {stats.pending} pending
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={() => onRefresh(session?.id)}
              className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          {stats.approved > 0 && (
            <button
              onClick={() => navigate('/summary')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
            >
              Summary
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${stats.total ? ((stats.approved + stats.rejected) / stats.total) * 100 : 0}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {stats.approved + stats.rejected} of {stats.total} reviewed
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items..."
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
          />
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1">
          {[
            { key: 'all', label: 'All' },
            { key: 'pending', label: 'Pending' },
            { key: 'approved', label: 'Approved' },
            { key: 'rejected', label: 'Rejected' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === key ? 'bg-primary-100 text-primary-700' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
              {key !== 'all' && (
                <span className="ml-1 text-[10px] opacity-70">
                  {key === 'pending' ? stats.pending : key === 'approved' ? stats.approved : stats.rejected}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Processing Progress Banner */}
      {processing && progress && (
        <div className="mb-5 p-4 rounded-xl bg-primary-50 border border-primary-200">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
            <p className="text-sm font-semibold text-primary-900">
              Processing items... {progress.processed_items} of {progress.total_items} complete
            </p>
          </div>
          <div className="h-2 bg-primary-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-700"
              style={{ width: `${progress.total_items ? (progress.processed_items / progress.total_items) * 100 : 0}%` }}
            />
          </div>
          <p className="text-xs text-primary-600 mt-1.5">
            Items appear below as they are matched. You can start reviewing while processing continues.
          </p>
        </div>
      )}

      {/* Items Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map((item, idx) => (
          <ReviewCard
            key={item.id || idx}
            item={item}
            sessionId={session?.id}
            onApprove={onApprove}
            onReject={onReject}
            onSelectAlt={onSelectAlt}
            onOverride={onOverride}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <Filter className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No items match your filter</p>
        </div>
      )}
    </div>
  );
}
