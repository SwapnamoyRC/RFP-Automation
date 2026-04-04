import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { Upload, FileSpreadsheet, ArrowRight, Loader2, Sparkles, SlidersHorizontal, ImageIcon, FileText, HelpCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { extractError } from '../utils/extractError';

export default function UploadPage({ onProcess }) {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [clientName, setClientName] = useState('');
  // imageWeight: 0.0 = full text, 1.0 = full image. Default 0.7 (70% image / 30% text)
  const [imageWeight, setImageWeight] = useState(0.7);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [showGuidelines, setShowGuidelines] = useState(false);
  const onDrop = useCallback((acceptedFiles) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
  });

  const handleSubmit = async () => {
    if (!file) return;
    setProcessing(true);
    setProgress('Creating session...');

    try {
      setProgress('Uploading RFP...');
      await onProcess(clientName || 'Web Client', file, { imageWeight });
      setProgress('Processing started! Redirecting to review...');
      setTimeout(() => navigate('/review'), 1000);
    } catch (err) {
      toast.error(extractError(err, 'Processing failed'));
      setProcessing(false);
    }
  };

  const imgPct = Math.round(imageWeight * 100);
  const txtPct = 100 - imgPct;

  return (
    <div className="max-w-2xl mx-auto pt-12">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-50 text-primary-700 text-xs font-medium mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          AI-Powered Product Matching
        </div>
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-3xl font-bold text-gray-900">Upload RFP Spreadsheet</h1>
          <button
            onClick={() => setShowGuidelines(true)}
            className="p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
            title="View Excel format guidelines"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
        <p className="text-gray-500 text-sm mt-2">
          Upload your Excel file with furniture requirements. Our AI will match each item to the best products in our catalog.
        </p>
      </div>

      {/* Client Name */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Client Name</label>
        <input
          type="text"
          value={clientName}
          onChange={e => setClientName(e.target.value)}
          placeholder="e.g., Acme Corporation"
          className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-shadow bg-white"
          disabled={processing}
        />
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200 ${
          isDragActive
            ? 'border-primary-500 bg-primary-50'
            : file
            ? 'border-emerald-400 bg-emerald-50'
            : 'border-gray-300 bg-white hover:border-primary-400 hover:bg-gray-50'
        } ${processing ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input {...getInputProps()} />
        {file ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center">
              <FileSpreadsheet className="w-7 h-7 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            {!processing && (
              <p className="text-xs text-gray-400">Click or drag to replace</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
              <Upload className="w-7 h-7 text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                {isDragActive ? 'Drop your file here' : 'Drag & drop your Excel file'}
              </p>
              <p className="text-xs text-gray-400 mt-1">or click to browse &middot; .xlsx, .xls</p>
            </div>
          </div>
        )}
      </div>

      {/* Advanced Settings Toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        disabled={processing}
        className="mt-4 flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        {showAdvanced ? 'Hide' : 'Show'} advanced settings
      </button>

      {/* Advanced: Image vs Text Weight */}
      {showAdvanced && (
        <div className="mt-3 p-4 rounded-xl bg-gray-50 border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-700">Search Weightage</label>
            <span className="text-xs text-gray-500">
              {imgPct === 100 ? 'Image only' : txtPct === 100 ? 'Text only' : 'Mixed'}
            </span>
          </div>

          {/* Weight bars */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5 w-28 shrink-0">
              <ImageIcon className="w-3.5 h-3.5 text-violet-500" />
              <span className="text-xs font-semibold text-violet-700">Image</span>
              <span className="ml-auto text-xs font-bold text-violet-700">{imgPct}%</span>
            </div>
            <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${imgPct}%`,
                  background: `linear-gradient(to right, #7c3aed ${imgPct}%, #2563eb ${100}%)`
                }}
              />
            </div>
            <div className="flex items-center gap-1.5 w-24 shrink-0 justify-end">
              <span className="text-xs font-bold text-blue-700">{txtPct}%</span>
              <span className="text-xs font-semibold text-blue-700">Text</span>
              <FileText className="w-3.5 h-3.5 text-blue-500" />
            </div>
          </div>

          {/* Single slider */}
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={imgPct}
            onChange={e => setImageWeight(parseInt(e.target.value) / 100)}
            disabled={processing}
            className="w-full accent-violet-600"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            <span>100% Text</span>
            <span className="text-gray-500 font-medium">Default: 70% Image / 30% Text</span>
            <span>100% Image</span>
          </div>
          <p className="text-xs text-gray-500 mt-2.5">
            <span className="font-medium text-violet-700">Image</span> — visual similarity via SigLIP embeddings (shape, silhouette, base style).
            <span className="font-medium text-blue-700 ml-1">Text</span> — semantic similarity via description and specs.
            Increase image weight when your RFP has clear product photos. Increase text weight for vague images or text-heavy RFPs.
          </p>
        </div>
      )}


      {/* Processing Progress */}
      {processing && (
        <div className="mt-6 flex items-center justify-center gap-3 p-4 rounded-xl bg-primary-50 border border-primary-100">
          <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
          <div>
            <p className="text-sm font-medium text-primary-900">{progress}</p>
            <p className="text-xs text-primary-600 mt-0.5">
              Each item goes through: image description → SigLIP + text search → AI reranking → AI verification.
            </p>
          </div>
        </div>
      )}

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={!file || processing}
        className={`mt-6 w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
          !file || processing
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-primary-600 text-white hover:bg-primary-700 shadow-lg shadow-primary-600/25'
        }`}
      >
        {processing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            Process RFP
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>

      {/* Steps */}
      <div className="mt-10 grid grid-cols-3 gap-4">
        {[
          { step: '1', title: 'Upload', desc: 'Drop your RFP Excel file' },
          { step: '2', title: 'Review', desc: 'Approve or swap AI matches' },
          { step: '3', title: 'Export', desc: 'Download your proposal PPT' },
        ].map(({ step, title, desc }) => (
          <div key={step} className="p-4 rounded-xl bg-white border border-gray-100 text-center">
            <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center mx-auto mb-2">
              {step}
            </div>
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
          </div>
        ))}
      </div>

      {/* Guidelines Modal */}
      {showGuidelines && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 flex items-center justify-between p-6 border-b border-gray-200 bg-white">
              <h2 className="text-xl font-bold text-gray-900">Excel Format Guidelines</h2>
              <button
                onClick={() => setShowGuidelines(false)}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Required Columns */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Required Columns</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</div>
                    <div>
                      <p className="font-medium text-gray-900">Sr. No / S.No / Sl. No</p>
                      <p className="text-xs text-gray-600 mt-0.5">Serial number or item number (can be numeric or text like i, ii, iii)</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</div>
                    <div>
                      <p className="font-medium text-gray-900">Product Name / Description</p>
                      <p className="text-xs text-gray-600 mt-0.5">Item name (e.g., "Meeting Table", "Dining Chair", "Coffee Table 1200x800mm")</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</div>
                    <div>
                      <p className="font-medium text-gray-900">Quantity / Qty</p>
                      <p className="text-xs text-gray-600 mt-0.5">Number of items required (numeric value)</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Optional Columns */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Optional Columns</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                    <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">+</div>
                    <div>
                      <p className="font-medium text-gray-900">Images / Photos</p>
                      <p className="text-xs text-gray-600 mt-0.5">Embedded product images (improves AI matching accuracy)</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                    <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">+</div>
                    <div>
                      <p className="font-medium text-gray-900">Specifications / Notes</p>
                      <p className="text-xs text-gray-600 mt-0.5">Dimensions, materials, colors, finishes, or other requirements</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                    <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">+</div>
                    <div>
                      <p className="font-medium text-gray-900">Location / Space</p>
                      <p className="text-xs text-gray-600 mt-0.5">Where the item will be placed (e.g., "Meeting Room A", "Office Lobby")</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Supported Formats */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Supported File Formats</h3>
                <div className="flex gap-2 flex-wrap">
                  <span className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">.xlsx</span>
                  <span className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">.xls</span>
                </div>
              </div>

              {/* Best Practices */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Best Practices for Accurate Matching</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                    <span className="text-gray-700"><span className="font-medium">Include product images</span> — they significantly improve matching accuracy</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                    <span className="text-gray-700"><span className="font-medium">Be specific with descriptions</span> — e.g., "4-Seater Meeting Table" instead of just "Table"</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                    <span className="text-gray-700"><span className="font-medium">Include dimensions</span> — e.g., "1200mm x 800mm x 750mm" (Length x Width x Height)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                    <span className="text-gray-700"><span className="font-medium">Use consistent column naming</span> — headers are detected automatically but should be clear</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                    <span className="text-gray-700"><span className="font-medium">Start data from row 2</span> — row 1 should contain headers only</span>
                  </li>
                </ul>
              </div>

              {/* Common Issues */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Common Issues</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
                    <span className="text-orange-600 font-bold mt-0.5">⚠</span>
                    <div>
                      <p className="font-medium text-gray-900">Empty header rows</p>
                      <p className="text-xs text-gray-600 mt-0.5">Make sure your header row (with "Sr.No", "Product Name", etc.) is continuous without empty cells between columns</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
                    <span className="text-orange-600 font-bold mt-0.5">⚠</span>
                    <div>
                      <p className="font-medium text-gray-900">Multiple sheets</p>
                      <p className="text-xs text-gray-600 mt-0.5">All sheets with valid product data will be processed. Make sure each sheet has the required format.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
                    <span className="text-orange-600 font-bold mt-0.5">⚠</span>
                    <div>
                      <p className="font-medium text-gray-900">Totals or summary rows</p>
                      <p className="text-xs text-gray-600 mt-0.5">Rows containing "Total", "Grand Total", or "GST" will be automatically skipped</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                onClick={() => setShowGuidelines(false)}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
