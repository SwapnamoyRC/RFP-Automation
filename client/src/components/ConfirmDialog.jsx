import { AlertTriangle, Info, X } from 'lucide-react';

/**
 * Modal confirmation / alert dialog.
 *
 * Props:
 *   open        — boolean, controls visibility
 *   title       — string
 *   message     — string
 *   variant     — 'danger' | 'warning' | 'info'  (default: 'warning')
 *   confirmLabel — string (default: 'Confirm')
 *   cancelLabel  — string (default: 'Cancel') — omit to show alert-only (no cancel)
 *   onConfirm   — () => void
 *   onCancel    — () => void
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  variant = 'warning',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const styles = {
    danger:  { icon: AlertTriangle, iconBg: 'bg-red-100',    iconColor: 'text-red-600',    btn: 'bg-red-600 hover:bg-red-700 text-white' },
    warning: { icon: AlertTriangle, iconBg: 'bg-amber-100',  iconColor: 'text-amber-600',  btn: 'bg-amber-600 hover:bg-amber-700 text-white' },
    info:    { icon: Info,          iconBg: 'bg-primary-100', iconColor: 'text-primary-600', btn: 'bg-primary-600 hover:bg-primary-700 text-white' },
  };
  const s = styles[variant] || styles.warning;
  const Icon = s.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
        {/* Close button */}
        {onCancel && (
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Icon + title */}
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl ${s.iconBg} shrink-0`}>
            <Icon className={`w-5 h-5 ${s.iconColor}`} />
          </div>
          <div className="pt-1">
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            {message && (
              <p className="mt-1 text-sm text-gray-500 leading-relaxed">{message}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${s.btn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
