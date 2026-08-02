import { useState, useRef, useCallback } from 'react';
import { Search, Upload, X, ImageIcon, Type, Loader2, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';
import { visualSearch } from '../api/sessions';

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 8) return 'bg-emerald-100 text-emerald-700';
  if (score >= 6) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

function scoreLabel(score) {
  if (score >= 8) return 'Strong match';
  if (score >= 6) return 'Good match';
  return 'Possible match';
}

// ── Product detail modal ──────────────────────────────────────────────────────

function ProductModal({ product, onClose }) {
  if (!product) return null;
  const [imgFailed, setImgFailed] = useState(false);
  const score = typeof product.score === 'number' ? Math.round(product.score * 10) / 10 : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-2 rounded-lg hover:bg-gray-100 transition-colors z-10"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        <div className="p-8">
          {/* Image */}
          {product.image_url && !imgFailed ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-72 object-contain bg-gray-50 rounded-xl border border-gray-100 mb-6"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="w-full h-72 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-center mb-6">
              <ImageIcon className="w-16 h-16 text-gray-200" />
            </div>
          )}

          {/* Name & brand */}
          <div className="mb-4">
            <h2 className="text-2xl font-bold text-gray-900">{product.name}</h2>
            {product.brand_name && (
              <p className="text-base text-primary-600 font-semibold mt-1">{product.brand_name}</p>
            )}
          </div>

          {/* Match score */}
          {score !== null && (
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl mb-5 ${scoreColor(score)}`}>
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-sm font-semibold">{score}/10 — {scoreLabel(score)}</span>
            </div>
          )}

          {/* Explanation */}
          {product.explanation && (
            <div className="mb-5 p-4 bg-primary-50 rounded-xl border border-primary-100">
              <p className="text-xs font-semibold text-primary-700 mb-1">Why this matched</p>
              <p className="text-sm text-gray-700 leading-relaxed">{product.explanation}</p>
            </div>
          )}

          {/* Category */}
          {product.category && (
            <span className="inline-block text-xs font-semibold text-gray-600 bg-gray-100 px-3 py-1 rounded-full mb-5">
              {product.category}
            </span>
          )}

          {/* Description */}
          {product.description && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-1.5">Description</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{product.description}</p>
            </div>
          )}

          {/* Dimensions */}
          {product.dimensions && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-1.5">Dimensions</h3>
              <p className="text-sm text-gray-600">{product.dimensions}</p>
            </div>
          )}

          {/* Materials */}
          {product.materials && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-1.5">Materials</h3>
              <p className="text-sm text-gray-600">{product.materials}</p>
            </div>
          )}

          {/* Source link */}
          {product.source_url && (
            <div className="pt-4 border-t border-gray-100">
              <a
                href={product.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                <ExternalLink className="w-4 h-4" />
                View product page
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Product result card ───────────────────────────────────────────────────────

function ProductCard({ product, onClick }) {
  const [imgFailed, setImgFailed] = useState(false);
  const score = typeof product.score === 'number' ? Math.round(product.score * 10) / 10 : null;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-md hover:border-primary-200 hover:scale-[1.02] transition-all cursor-pointer group"
    >
      {/* Image */}
      <div className="aspect-square bg-gray-50 relative overflow-hidden">
        {product.image_url && !imgFailed ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-12 h-12 text-gray-200" />
          </div>
        )}
        {score !== null && (
          <div className={`absolute top-2 right-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${scoreColor(score)}`}>
            {score}/10
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">{product.brand_name || '—'}</p>
        <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{product.name}</p>
        {score !== null && (
          <p className={`mt-1.5 text-[10px] font-medium inline-flex px-2 py-0.5 rounded-full ${scoreColor(score)}`}>
            {scoreLabel(score)}
          </p>
        )}
        {product.explanation && (
          <p className="mt-2 text-[11px] text-gray-500 line-clamp-3 leading-relaxed">{product.explanation}</p>
        )}
        {(product.dimensions || product.materials) && (
          <div className="mt-2 space-y-0.5">
            {product.dimensions && (
              <p className="text-[10px] text-gray-400"><span className="font-medium">Size:</span> {product.dimensions}</p>
            )}
            {product.materials && (
              <p className="text-[10px] text-gray-400"><span className="font-medium">Material:</span> {product.materials}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function VisualSearchPage() {
  const [mode, setMode] = useState('image'); // 'image' | 'text'
  const [image, setImage] = useState(null);   // { base64, mimeType, preview }
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null); // { products, meta }
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const fileRef = useRef(null);

  // ── Image handling ──────────────────────────────────────────────────────────

  const loadFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      setImage({ base64, mimeType: file.type, preview: dataUrl });
      setResults(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const clearImage = () => { setImage(null); setResults(null); setError(null); };

  // ── Search ──────────────────────────────────────────────────────────────────

  const handleSearch = async () => {
    if (mode === 'image' && !image) return;
    if (mode === 'text' && !query.trim()) return;

    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await visualSearch({
        imageBase64: mode === 'image' ? image?.base64 : undefined,
        mimeType: mode === 'image' ? image?.mimeType : undefined,
        query: query.trim() || undefined,
        limit: 12,
      });
      setResults(data);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const canSearch = !loading && (mode === 'image' ? !!image : query.trim().length >= 2);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-primary-600" />
          <h1 className="text-xl font-bold text-gray-900">Visual Search</h1>
        </div>
        <p className="text-sm text-gray-500">Find products by uploading a reference image or describing what you're looking for</p>
      </div>

      {/* Search panel */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-2">
          {[
            { key: 'image', icon: ImageIcon, label: 'Search by Image' },
            { key: 'text',  icon: Type,      label: 'Search by Text'  },
          ].map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => { setMode(key); setResults(null); setError(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                mode === key
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Image mode */}
        {mode === 'image' && (
          <div className="space-y-3">
            {image ? (
              <div className="relative w-48 h-48 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                <img src={image.preview} alt="uploaded" className="w-full h-full object-contain p-2" />
                <button
                  onClick={clearImage}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/90 shadow flex items-center justify-center text-gray-600 hover:text-red-600 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileRef.current?.click()}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors ${
                  dragging
                    ? 'border-primary-400 bg-primary-50'
                    : 'border-gray-200 bg-gray-50 hover:border-primary-300 hover:bg-gray-100'
                }`}
              >
                <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-primary-600" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700">Drop an image or click to upload</p>
                  <p className="text-xs text-gray-400 mt-0.5">JPG, PNG, WEBP</p>
                </div>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => loadFile(e.target.files[0])}
            />

            {/* Optional description refinement */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Add a description to refine results <span className="text-gray-400">(optional)</span>
              </label>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && canSearch && handleSearch()}
                placeholder="e.g. lounge chair in grey fabric"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
            </div>
          </div>
        )}

        {/* Text mode */}
        {mode === 'text' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Describe the product</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && canSearch && handleSearch()}
              placeholder="e.g. stackable outdoor chair in white polypropylene with metal legs"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none"
            />
          </div>
        )}

        {/* Search button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSearch}
            disabled={!canSearch}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Searching…</>
            ) : (
              <><Search className="w-4 h-4" /> Search Catalog</>
            )}
          </button>
          {results && (
            <p className="text-xs text-gray-500">{results.products.length} results</p>
          )}
        </div>
      </div>

      {/* AI query label */}
      {results?.meta?.query && results.meta.query !== query && (
        <div className="flex items-start gap-2 px-4 py-3 bg-primary-50 rounded-xl border border-primary-100">
          <Sparkles className="w-4 h-4 text-primary-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-primary-700">AI interpreted your image as:</p>
            <p className="text-sm text-primary-900 mt-0.5">{results.meta.query}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 rounded-xl border border-red-100 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse">
              <div className="aspect-square bg-gray-100" />
              <div className="p-3 space-y-2">
                <div className="h-2.5 bg-gray-100 rounded w-16" />
                <div className="h-3 bg-gray-100 rounded w-full" />
                <div className="h-3 bg-gray-100 rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {!loading && results && (
        results.products.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No matching products found. Try a different image or description.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {results.products.map((product, i) => (
              <ProductCard
                key={product.id || i}
                product={product}
                onClick={() => setSelectedProduct(product)}
              />
            ))}
          </div>
        )
      )}

      {/* Detail modal */}
      <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />

      {/* Empty state */}
      {!loading && !results && !error && (
        <div className="text-center py-20 text-gray-300">
          <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-gray-300" />
          </div>
          <p className="text-sm text-gray-400">Upload an image or describe a product to find catalog matches</p>
        </div>
      )}
    </div>
  );
}
