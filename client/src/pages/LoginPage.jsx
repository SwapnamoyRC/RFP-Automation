import { useState } from 'react';
import { LogIn, UserPlus, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function validateEmail(email) {
  if (!email.trim()) return 'Email is required';
  if (!EMAIL_REGEX.test(email.trim())) return 'Please enter a valid email address';
  return null;
}

function validatePassword(password, isRegister) {
  if (!password) return 'Password is required';
  if (!isRegister) return null; // login only checks presence
  if (password.length < 8) return 'Must be at least 8 characters';
  if (!/[a-z]/.test(password)) return 'Must contain at least one lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Must contain at least one uppercase letter';
  if (!/\d/.test(password)) return 'Must contain at least one number';
  if (!/[@$!%*?&]/.test(password)) return 'Must contain at least one special character (@$!%*?&)';
  return null;
}

function validateConfirm(password, confirmPassword) {
  if (!confirmPassword) return 'Please confirm your password';
  if (confirmPassword !== password) return 'Passwords do not match';
  return null;
}

function PasswordInput({ value, onChange, onBlur, placeholder, error, id }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        required
        className={`w-full px-3 py-2.5 pr-10 border rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none ${error ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function LoginPage({ onLogin, onRegister, loading, error }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({}); // track which fields user has interacted with

  // Live validation on change
  const handleEmailChange = (e) => {
    const val = e.target.value;
    setEmail(val);
    if (touched.email) {
      setFieldErrors(f => ({ ...f, email: validateEmail(val) }));
    }
  };

  const handlePasswordChange = (e) => {
    const val = e.target.value;
    setPassword(val);
    if (touched.password) {
      setFieldErrors(f => ({ ...f, password: validatePassword(val, isRegister) }));
    }
    // Also revalidate confirm if it's been touched
    if (touched.confirmPassword && isRegister) {
      setFieldErrors(f => ({ ...f, confirmPassword: validateConfirm(val, confirmPassword) }));
    }
  };

  const handleConfirmChange = (e) => {
    const val = e.target.value;
    setConfirmPassword(val);
    if (touched.confirmPassword) {
      setFieldErrors(f => ({ ...f, confirmPassword: validateConfirm(password, val) }));
    }
  };

  // Validate on blur (first touch)
  const handleBlur = (field) => {
    setTouched(t => ({ ...t, [field]: true }));
    if (field === 'email') setFieldErrors(f => ({ ...f, email: validateEmail(email) }));
    if (field === 'password') setFieldErrors(f => ({ ...f, password: validatePassword(password, isRegister) }));
    if (field === 'confirmPassword') setFieldErrors(f => ({ ...f, confirmPassword: validateConfirm(password, confirmPassword) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Validate all fields
    const errs = {
      email: validateEmail(email),
      password: validatePassword(password, isRegister),
      ...(isRegister ? { confirmPassword: validateConfirm(password, confirmPassword) } : {}),
    };
    // Remove nulls
    const filtered = Object.fromEntries(Object.entries(errs).filter(([, v]) => v));
    setFieldErrors(filtered);
    setTouched({ email: true, password: true, confirmPassword: true });
    if (Object.keys(filtered).length > 0) return;

    try {
      if (isRegister) {
        await onRegister(email.trim().toLowerCase(), password, name.trim());
      } else {
        await onLogin(email.trim().toLowerCase(), password);
      }
    } catch {
      // error is handled by useAuth
    }
  };

  const resetForm = () => {
    setIsRegister(!isRegister);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setName('');
    setFieldErrors({});
    setTouched({});
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center mx-auto mb-3">
            <span className="text-white text-lg font-bold">RF</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">RFP Automation </h1>
          <p className="text-sm text-gray-500 mt-1">Product Matching Dashboard </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">
            {isRegister ? 'Create Account' : 'Sign In'}
          </h2>

          {isRegister && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={handleEmailChange}
              onBlur={() => handleBlur('email')}
              placeholder="you@company.com"
              required
              className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none ${fieldErrors.email ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
            />
            {fieldErrors.email && <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={handlePasswordChange}
              onBlur={() => handleBlur('password')}
              placeholder="Min 8 characters"
              error={fieldErrors.password}
            />
            {fieldErrors.password && <p className="text-xs text-red-600 mt-1">{fieldErrors.password}</p>}
            {isRegister && !fieldErrors.password && (
              <p className="text-[10px] text-gray-400 mt-1">Min 8 chars: uppercase, lowercase, number, and special character (@$!%*?&)</p>
            )}
          </div>

          {isRegister && (
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <PasswordInput
                id="confirmPassword"
                value={confirmPassword}
                onChange={handleConfirmChange}
                onBlur={() => handleBlur('confirmPassword')}
                placeholder="Re-enter password"
                error={fieldErrors.confirmPassword}
              />
              {fieldErrors.confirmPassword && <p className="text-xs text-red-600 mt-1">{fieldErrors.confirmPassword}</p>}
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isRegister ? (
              <UserPlus className="w-4 h-4" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            {isRegister ? 'Create Account' : 'Sign In'}
          </button>

          <p className="text-center text-xs text-gray-500 mt-4">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={resetForm}
              className="text-primary-600 font-medium hover:underline"
            >
              {isRegister ? 'Sign In' : 'Create one'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
