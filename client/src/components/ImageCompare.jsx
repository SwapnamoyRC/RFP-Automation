import { useState } from 'react';
import { ImageOff } from 'lucide-react';

function SafeImage({ src, alt, className }) {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <ImageOff className="w-8 h-8 text-gray-300" />
      </div>
    );
  }

  const imgSrc = src.startsWith('data:') ? src : src.startsWith('http') ? src : `data:image/png;base64,${src}`;

  return (
    <img
      src={imgSrc}
      alt={alt}
      className={`object-contain ${className}`}
      onError={() => setError(true)}
    />
  );
}

export default function ImageCompare({ rfpImage, matchImage, rfpLabel = 'RFP Image', matchLabel = 'Match' }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5">{rfpLabel}</p>
        <div className="aspect-square rounded-lg overflow-hidden border border-gray-200 bg-white">
          <SafeImage src={rfpImage} alt="RFP" className="w-full h-full" />
        </div>
      </div>
      <div>
        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5">{matchLabel}</p>
        <div className="aspect-square rounded-lg overflow-hidden border border-gray-200 bg-white">
          <SafeImage src={matchImage} alt="Match" className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}
