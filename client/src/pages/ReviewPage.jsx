import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, XCircle, ChevronDown, ChevronUp, ArrowRight,
  Search, Filter, Package, Loader2, RefreshCw, ImageOff,
  Check, X, Link, PenLine, AlertTriangle, Database, Square, CheckSquare, Images,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import ConfidenceMeter from '../components/ConfidenceMeter';
import ImageCompare from '../components/ImageCompare';
import { listProducts, getProductImages, selectProductImage } from '../api/sessions';

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
  const [imageUrl, setImageUrl] = useState(item.overrideProductImageUrl || '');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [materials, setMaterials] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const handleSave = async () => {
    if (!url.trim()) return;
    setSaving(true);
    try {
      await onOverride(sessionId, item.id, {
        productUrl: url.trim(),
        productName: name.trim() || undefined,
        productBrand: brand.trim() || undefined,
        productImageUrl: imageUrl.trim() || undefined,
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        dimensions: dimensions.trim() || undefined,
        materials: materials.trim() || undefined,
        note: note.trim() || undefined,
      });
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  if (item.isOverridden && !editMode) {
    return (
      <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-xs font-semibold text-amber-800">Override active</span>
          </div>
          <button
            onClick={() => setEditMode(true)}
            className="text-[10px] px-2 py-1 rounded bg-amber-200 text-amber-700 hover:bg-amber-300 font-semibold transition-colors"
          >
            Edit
          </button>
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
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
          <PenLine className="w-3.5 h-3.5 text-gray-500" />
          {editMode ? 'Edit Override' : 'Submit Correct Product'}
        </p>
        {editMode && (
          <button
            onClick={() => setEditMode(false)}
            className="text-[10px] px-2 py-1 rounded bg-gray-200 text-gray-600 hover:bg-gray-300 font-semibold transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">Category (optional)</label>
          <input
            type="text"
            value={category}
            onChange={e => setCategory(e.target.value)}
            placeholder="e.g. Office Chair"
            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 outline-none bg-white"
            disabled={loading || saving}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">Materials (optional)</label>
          <input
            type="text"
            value={materials}
            onChange={e => setMaterials(e.target.value)}
            placeholder="e.g. Leather, Aluminum"
            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 outline-none bg-white"
            disabled={loading || saving}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">Dimensions (optional)</label>
          <input
            type="text"
            value={dimensions}
            onChange={e => setDimensions(e.target.value)}
            placeholder="e.g. 80 x 60 x 100 cm"
            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-primary-500 outline-none bg-white"
            disabled={loading || saving}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Product description..."
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
        {editMode ? 'Update Override' : 'Mark as Final Match'}
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

// ── Image Picker Modal (shared by main product + alternatives) ────────────────
function ImagePickerModal({ open, onClose, images, selected, onSelect, productName, productBrand, loading }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Images className="w-4 h-4 text-primary-600" />
              Select PPT Image
            </h2>
            {(productBrand || productName) && (
              <p className="text-xs text-gray-500 mt-0.5">
                {productBrand && <span className="font-medium text-primary-600">{productBrand}</span>}
                {productBrand && productName && ' · '}
                {productName}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
              <p className="text-sm text-gray-500">Loading images...</p>
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <ImageOff className="w-8 h-8 text-gray-200" />
              <p className="text-sm text-gray-500">No images found in catalog</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-4">
                Click an image to select it for the PPT slide. {selected ? '1 image selected.' : ''}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {images.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => { onSelect(url); onClose(); }}
                    className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                      selected === url
                        ? 'border-primary-600 ring-2 ring-primary-200'
                        : 'border-gray-200 hover:border-primary-400'
                    }`}
                  >
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-contain bg-gray-50 p-1"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                    {selected === url && (
                      <div className="absolute inset-0 bg-primary-600/10 flex items-end justify-center pb-2">
                        <span className="bg-primary-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                          ✓ Selected
                        </span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Alternatives Panel ────────────────────────────────────────────────────────
// ── Alt Image Picker button → opens modal ─────────────────────────────────────
function AltImagePickerStrip({ sessionId, itemId, alt, altIndex, onImageSelected }) {
  const productKey = `${alt.name}|||${alt.brand}`;
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState(alt.selectedImageUrl || alt.imageUrl);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const prevKeyRef = useRef(productKey);

  useEffect(() => {
    if (prevKeyRef.current !== productKey) {
      prevKeyRef.current = productKey;
      setImages([]);
      setSelected(alt.selectedImageUrl || alt.imageUrl);
      setModalOpen(false);
    }
  }, [productKey, alt.selectedImageUrl, alt.imageUrl]);

  const openModal = async () => {
    setModalOpen(true);
    if (images.length > 0) return;
    setLoading(true);
    try {
      const data = await getProductImages(sessionId, itemId, { name: alt.name || alt.product_name, brand: alt.brand || alt.product_brand, altIndex });
      setImages(data.images || []);
      setSelected(data.selected_image_url || alt.imageUrl);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const handleSelect = (url) => {
    setSelected(url);
    onImageSelected && onImageSelected(altIndex, url);
  };

  const isPicked = selected && selected !== alt.imageUrl;

  return (
    <>
      <button
        onClick={openModal}
        className={`flex items-center gap-1 text-[10px] transition-colors mt-1.5 ${
          isPicked ? 'text-primary-600 font-medium' : 'text-gray-400 hover:text-primary-600'
        }`}
      >
        <Images className="w-2.5 h-2.5" />
        {isPicked ? '✓ Image picked' : 'Pick PPT image'}
      </button>
      <ImagePickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        images={images}
        selected={selected}
        onSelect={handleSelect}
        productName={alt.name || alt.product_name}
        productBrand={alt.brand || alt.product_brand}
        loading={loading}
      />
    </>
  );
}

function AlternativesPanel({ alternatives, approvedIndices = [], isMainApproved = false, mainProduct = {}, onSelect, onApproveMultiple, loading, sessionId, itemId, onSelectAltImage }) {
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState(new Set(approvedIndices));
  // Track locally picked images per altIndex so card thumbnail updates immediately
  const [altPickedImages, setAltPickedImages] = useState({});

  const handleAltImageSelected = (altIndex, url) => {
    setAltPickedImages(prev => ({ ...prev, [altIndex]: url }));
    onSelectAltImage && onSelectAltImage(altIndex, url);
  };

  // Filter out the main product from alternatives to prevent duplicate selection
  // Keep track of original indices to send correct indices to backend
  const altIndexMap = []; // Maps filtered index to original index
  const filteredAlternatives = (alternatives || []).reduce((acc, alt, originalIdx) => {
    const mainName = (mainProduct.name || '').toLowerCase().trim();
    const mainBrand = (mainProduct.brand || '').toLowerCase().trim();
    const altName = (alt.name || alt.product_name || '').toLowerCase().trim();
    const altBrand = (alt.brand || alt.product_brand || '').toLowerCase().trim();

    if (!(mainName && mainBrand && mainName === altName && mainBrand === altBrand)) {
      altIndexMap.push(originalIdx); // Store the original 0-based index
      acc.push(alt);
    }
    return acc;
  }, []);

  if (!filteredAlternatives || filteredAlternatives.length === 0) {
    return <p className="text-xs text-gray-400 italic py-2">No other alternatives available</p>;
  }

  const handleToggleSelect = (filteredIdx) => {
    const originalIdx = altIndexMap[filteredIdx] + 1; // Convert to 1-based for database
    const newSelected = new Set(selectedIndices);
    if (newSelected.has(originalIdx)) {
      newSelected.delete(originalIdx);
    } else {
      newSelected.add(originalIdx);
    }
    setSelectedIndices(newSelected);
  };

  const handleApproveMultiple = async () => {
    if (selectedIndices.size === 0) return;
    const indices = Array.from(selectedIndices).sort((a, b) => a - b);
    await onApproveMultiple(indices);
    setMultiSelectMode(false);
    setSelectedIndices(new Set());
  };

  return (
    <div className="space-y-3 mt-3">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-100">
        <button
          onClick={() => {
            setMultiSelectMode(!multiSelectMode);
            // Reset to just approved indices when exiting multi-select
            if (multiSelectMode) {
              setSelectedIndices(new Set(approvedIndices));
            }
          }}
          className="text-xs font-medium text-gray-600 hover:text-primary-600 transition-colors flex items-center gap-1.5"
        >
          {multiSelectMode ? '✕ Cancel' : '✓ Approve Multiple'}
        </button>
        {multiSelectMode && (
          <div className="flex items-center gap-2">
            {isMainApproved && (
              <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full font-medium">
                Main ✓
              </span>
            )}
            {selectedIndices.size > 0 && (
              <span className="text-xs text-gray-500 font-medium">
                +{selectedIndices.size} alt{selectedIndices.size !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Alternatives Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredAlternatives.map((alt, idx) => (
          <div key={idx}>
            {multiSelectMode ? (
              // Multi-select mode
              <div className={`w-full p-3 rounded-xl border-2 transition-all ${
                selectedIndices.has(altIndexMap[idx] + 1)
                  ? 'border-primary-400 bg-primary-50'
                  : 'border-gray-200 bg-white'
              }`}>
                <button
                  onClick={() => handleToggleSelect(idx)}
                  disabled={loading}
                  className="w-full text-left disabled:opacity-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {selectedIndices.has(altIndexMap[idx] + 1) ? (
                        <CheckSquare className="w-4 h-4 text-primary-600" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-300" />
                      )}
                    </div>
                    {(altPickedImages[altIndexMap[idx] + 1] || alt.selectedImageUrl || alt.imageUrl) ? (
                      <img
                        src={altPickedImages[altIndexMap[idx] + 1] || alt.selectedImageUrl || alt.imageUrl}
                        alt={alt.name}
                        className="w-12 h-12 rounded-lg object-contain bg-gray-50 border border-gray-100"
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                        <ImageOff className="w-4 h-4 text-gray-300" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{alt.brand} {alt.name}</p>
                      {alt.explanation && (
                        <p className="text-[10px] text-blue-600 mt-0.5 line-clamp-1 italic">{alt.explanation}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <ConfidenceMeter score={alt.similarity} className="flex-1" />
                      </div>
                    </div>
                  </div>
                </button>
                {sessionId && itemId && (
                  <AltImagePickerStrip
                    sessionId={sessionId}
                    itemId={itemId}
                    alt={alt}
                    altIndex={altIndexMap[idx] + 1}
                    onImageSelected={handleAltImageSelected}
                  />
                )}
              </div>
            ) : (
              // Single select mode
              (() => {
                const originalIdx1Based = altIndexMap[idx] + 1;
                const isApproved = approvedIndices.includes(originalIdx1Based);
                return (
                  <div className={`w-full p-3 rounded-xl border transition-all text-left ${
                    isApproved ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'
                  }`}>
                    <button
                      onClick={() => !isApproved && onSelect(originalIdx1Based)}
                      disabled={loading || isApproved}
                      className="w-full text-left disabled:cursor-default"
                    >
                      <div className="flex items-start gap-3">
                        {(altPickedImages[originalIdx1Based] || alt.selectedImageUrl || alt.imageUrl) ? (
                          <img
                            src={altPickedImages[originalIdx1Based] || alt.selectedImageUrl || alt.imageUrl}
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
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold text-gray-900 truncate">{alt.brand} {alt.name}</p>
                            {isApproved && <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />}
                          </div>
                          {alt.explanation && (
                            <p className="text-[10px] text-blue-600 mt-0.5 line-clamp-2 italic">{alt.explanation}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5">
                            <ConfidenceMeter score={alt.similarity} className="flex-1" />
                          </div>
                        </div>
                      </div>
                    </button>
                    {sessionId && itemId && (
                      <AltImagePickerStrip
                        sessionId={sessionId}
                        itemId={itemId}
                        alt={alt}
                        altIndex={originalIdx1Based}
                        onImageSelected={handleAltImageSelected}
                      />
                    )}
                  </div>
                );
              })()
            )}
          </div>
        ))}
      </div>

      {/* Approve Multiple Button */}
      {multiSelectMode && selectedIndices.size > 0 && (
        <div className="pt-2 border-t border-gray-100 space-y-2">
          <button
            onClick={handleApproveMultiple}
            disabled={loading}
            className="w-full px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Approving {selectedIndices.size} Option{selectedIndices.size > 1 ? 's' : ''}...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Approve {selectedIndices.size} Option{selectedIndices.size > 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Image Picker (main product) → opens modal ────────────────────────────────
function ImagePickerStrip({ sessionId, item, onImageSelected }) {
  const productKey = `${item.matchedProduct?.name}|||${item.matchedProduct?.brand}`;
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState(item.selectedImageUrl || item.matchedProduct?.imageUrl);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const prevKeyRef = useRef(productKey);

  useEffect(() => {
    if (prevKeyRef.current !== productKey) {
      prevKeyRef.current = productKey;
      setImages([]);
      setSelected(item.selectedImageUrl || item.matchedProduct?.imageUrl);
      setModalOpen(false);
    }
  }, [productKey, item.selectedImageUrl, item.matchedProduct?.imageUrl]);

  const openModal = async () => {
    setModalOpen(true);
    if (images.length > 0) return;
    setLoading(true);
    try {
      const data = await getProductImages(sessionId, item.id);
      setImages(data.images || []);
      setSelected(data.selected_image_url || item.matchedProduct?.imageUrl);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (url) => {
    setSelected(url);
    try {
      await selectProductImage(sessionId, item.id, url);
      onImageSelected(url);
    } catch { /* ignore */ }
  };

  const isPicked = selected && selected !== item.matchedProduct?.imageUrl;

  return (
    <>
      <button
        onClick={openModal}
        disabled={loading}
        className={`flex items-center gap-1 text-xs transition-colors mt-2 ${
          isPicked ? 'text-primary-600 font-medium' : 'text-gray-400 hover:text-primary-600'
        }`}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Images className="w-3 h-3" />}
        {isPicked ? '✓ Image picked' : 'Pick PPT image'}
      </button>
      <ImagePickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        images={images}
        selected={selected}
        onSelect={handleSelect}
        productName={item.matchedProduct?.name}
        productBrand={item.matchedProduct?.brand}
        loading={loading}
      />
    </>
  );
}

// ── Override Image Picker — picks catalog image for an overridden item ─────────
function OverrideImagePickerStrip({ sessionId, item, onImageSelected }) {
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState(item.selectedImageUrl || item.overrideProductImageUrl || null);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const overrideName = item.overrideProductName;
  const overrideBrand = item.overrideProductBrand;
  const productKey = `${overrideName}|||${overrideBrand}`;
  const prevKeyRef = useRef(productKey);

  useEffect(() => {
    if (prevKeyRef.current !== productKey) {
      prevKeyRef.current = productKey;
      setImages([]);
      setSelected(item.selectedImageUrl || item.overrideProductImageUrl || null);
      setModalOpen(false);
    }
  }, [productKey, item.selectedImageUrl, item.overrideProductImageUrl]);

  // Parse catalog product UUID stored in override note — used for direct siglip lookup
  const catalogProductId = (() => {
    const m = (item.overrideNote || '').match(/Product ID:\s*([\w-]+)/);
    return m ? m[1] : null;
  })();

  const openModal = async () => {
    setModalOpen(true);
    if (images.length > 0) return;
    setLoading(true);
    try {
      const data = await getProductImages(sessionId, item.id, {
        name: overrideName,
        brand: overrideBrand,
        productId: catalogProductId,
      });
      setImages(data.images || []);
      setSelected(data.selected_image_url || item.overrideProductImageUrl || null);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (url) => {
    setSelected(url);
    try {
      await selectProductImage(sessionId, item.id, url);
      onImageSelected(url);
    } catch { /* ignore */ }
  };

  const isPicked = selected && selected !== item.overrideProductImageUrl;

  return (
    <>
      <button
        onClick={openModal}
        disabled={loading}
        className={`flex items-center gap-1 text-xs transition-colors mt-2 ${
          isPicked ? 'text-primary-600 font-medium' : 'text-gray-400 hover:text-primary-600'
        }`}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Images className="w-3 h-3" />}
        {isPicked ? '✓ Image picked' : 'Pick PPT image'}
      </button>
      <ImagePickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        images={images}
        selected={selected}
        onSelect={handleSelect}
        productName={overrideName}
        productBrand={overrideBrand}
        loading={loading}
      />
    </>
  );
}

// ── Review Card ───────────────────────────────────────────────────────────────
function ReviewCard({ item, sessionId, onApprove, onReject, onSelectAlt, onApproveMultiple, onOverride, onRetryItem, onSelectImage, onSelectAltImage }) {
  const [expanded, setExpanded] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pickedImage, setPickedImage] = useState(item.selectedImageUrl || null);

  const match = item.matchedProduct || {};

  // Reset picked image when the matched product changes (alternative selected)
  const matchKey = `${match.name}|||${match.brand}`;
  const prevMatchKeyRef = useRef(matchKey);
  useEffect(() => {
    if (prevMatchKeyRef.current !== matchKey) {
      prevMatchKeyRef.current = matchKey;
      setPickedImage(item.selectedImageUrl || null);
    }
  }, [matchKey, item.selectedImageUrl]);
  const alts = item.alternatives || [];
  const isReviewed = item.status === 'approved' || item.status === 'rejected';
  const approvedIndices = item.approvedAlternativeIndices || [];
  const totalApproved = (isReviewed ? 1 : 0) + approvedIndices.length;

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

  const handleApproveMultiple = async (altIndices) => {
    setActionLoading(true);
    try {
      await onApproveMultiple(sessionId, item.id, altIndices);
      setExpanded(false);
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
          matchImage={pickedImage || (item.isOverridden && item.overrideProductImageUrl ? item.overrideProductImageUrl : (match.imageUrl || match.image_url))}
          rfpLabel="RFP Image"
          matchLabel={item.isOverridden ? "Overridden Match" : "Best Match"}
        />

        {/* Image Picker — non-overridden items with a matched product */}
        {!item.isOverridden && match.name && (
          <ImagePickerStrip
            sessionId={sessionId}
            item={item}
            onImageSelected={(url) => {
              setPickedImage(url);
              onSelectImage && onSelectImage(sessionId, item.id, url);
            }}
          />
        )}

        {/* Image Picker — overridden items: pick catalog image for PPT */}
        {item.isOverridden && (
          <OverrideImagePickerStrip
            sessionId={sessionId}
            item={item}
            onImageSelected={(url) => {
              setPickedImage(url);
              onSelectImage && onSelectImage(sessionId, item.id, url);
            }}
          />
        )}

        {/* Match Details */}
        {match.name && (
          <div className={`mt-4 p-3 rounded-xl border ${
            isReviewed ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
          }`}>
            <div className="flex items-center gap-2">
              {isReviewed && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
              {!isReviewed && <Package className="w-4 h-4 text-gray-400" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{match.brand} {match.name}</p>
              </div>
              {totalApproved > 1 && (
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-emerald-200 text-emerald-800">
                  +{totalApproved - 1} alt
                </span>
              )}
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

        {/* Failed item retry */}
        {item.matchSource === 'error' && onRetryItem && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-xs text-red-700 mb-2 font-semibold">Match failed - please retry</p>
            <button
              onClick={async () => {
                setActionLoading(true);
                try {
                  await onRetryItem(sessionId, item.id);
                } finally {
                  setActionLoading(false);
                }
              }}
              disabled={actionLoading}
              className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {actionLoading ? 'Retrying...' : 'Retry Match'}
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
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-700">Alternative Matches</p>
            {isReviewed && (
              <p className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                Main product already approved
              </p>
            )}
          </div>
          <AlternativesPanel
            alternatives={alts}
            approvedIndices={item.approvedAlternativeIndices || []}
            isMainApproved={isReviewed}
            mainProduct={match}
            onSelect={handleSelectAlt}
            onApproveMultiple={handleApproveMultiple}
            loading={actionLoading}
            sessionId={sessionId}
            itemId={item.id}
            onSelectAltImage={(altIndex, url) => onSelectAltImage && onSelectAltImage(sessionId, item.id, altIndex, url)}
          />
        </div>
      )}
    </div>
  );
}

// ── Review Page ───────────────────────────────────────────────────────────────
export default function ReviewPage({ items, session, onApprove, onReject, onSelectAlt, onApproveMultiple, onOverride, onSelectImage, onSelectAltImage, onRefresh, onResumePolling, onStop, onResume, onRetryItem, processing, progress }) {
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
          <div className="flex items-center gap-3 mb-2 justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
              <p className="text-sm font-semibold text-primary-900">
                Processing items... {progress.processed_items} of {progress.total_items} complete
              </p>
            </div>
            {onStop && (
              <button
                onClick={() => onStop(session?.id)}
                className="px-3 py-1 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Stop Processing
              </button>
            )}
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

      {/* Resume Processing Banner */}
      {!processing && session?.total_items && items.length < session.total_items && (
        <div className="mb-5 p-4 rounded-xl bg-blue-50 border border-blue-200">
          <div className="flex items-center gap-3 justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-blue-600" />
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  Processing was stopped
                </p>
                <p className="text-xs text-blue-700 mt-0.5">
                  {items.length} of {session.total_items} items processed. {session.total_items - items.length} items remaining.
                </p>
              </div>
            </div>
            {onResume && (
              <button
                onClick={() => onResume(session?.id)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
              >
                Resume Processing
              </button>
            )}
          </div>
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
            onApproveMultiple={onApproveMultiple}
            onOverride={onOverride}
            onSelectImage={onSelectImage}
            onSelectAltImage={onSelectAltImage}
            onRetryItem={onRetryItem}
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
