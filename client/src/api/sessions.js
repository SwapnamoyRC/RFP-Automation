import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 900000, // 15 min for processing (SigLIP + GPT reranking + verification per item)
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login on 401 (only if not already on login page)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !window.location.pathname.includes('/login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export async function createSession(clientName) {
  const { data } = await api.post('/sessions');
  if (clientName) {
    const { data: updated } = await api.patch(`/sessions/${data.id}`, {
      client_name: clientName,
    });
    return updated;
  }
  return data;
}

export async function processSession(sessionId, file, options = {}) {
  const reader = new FileReader();
  const base64 = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const body = { fileBase64: base64, fileName: file.name };
  if (options.threshold !== undefined) body.threshold = options.threshold;
  if (options.imageWeight !== undefined) body.imageWeight = options.imageWeight;

  const { data } = await api.post(`/sessions/${sessionId}/process`, body);
  return data;
}

export async function getSessionItems(sessionId) {
  const { data } = await api.get(`/sessions/${sessionId}/items`);
  return data;
}

export async function reviewItem(sessionId, itemId, action) {
  // Backend expects 'approved'/'rejected', frontend sends 'approve'/'reject'
  const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action;
  const { data } = await api.post(`/sessions/${sessionId}/items/${itemId}/review`, {
    status,
  });
  return data;
}

export async function selectAlternative(sessionId, itemId, alternativeIndex) {
  const { data } = await api.post(`/sessions/${sessionId}/items/${itemId}/select-alternative`, {
    alternativeIndex,
  });
  return data;
}

export async function generatePPT(sessionId) {
  const response = await api.post(`/sessions/${sessionId}/generate`, {}, {
    responseType: 'blob',
  });
  return response.data;
}

export async function getSession(sessionId) {
  const { data } = await api.get(`/sessions/${sessionId}`);
  return data;
}

export async function getProgress(sessionId) {
  const { data } = await api.get(`/sessions/${sessionId}/progress`);
  return data;
}

export async function listSessions({ status, limit } = {}) {
  const params = {};
  if (status) params.status = status;
  if (limit) params.limit = limit;
  const { data } = await api.get('/sessions', { params });
  return data;
}

export async function overrideItem(sessionId, itemId, { productUrl, productName, productBrand, productImageUrl, note }) {
  const { data } = await api.post(`/sessions/${sessionId}/items/${itemId}/override`, {
    productUrl, productName, productBrand, productImageUrl, note,
  });
  return data;
}

// Products (catalog browse & search)
export async function listBrands() {
  const { data } = await api.get('/products/brands');
  return data.brands || [];
}

export async function listProducts(params = {}) {
  const { data } = await api.get('/products', { params });
  return data;
}

// Catalog / product submissions
export async function submitProduct(payload) {
  const { data } = await api.post('/catalog/submit', payload);
  return data;
}

export async function listSubmissions(params = {}) {
  const { data } = await api.get('/catalog/submissions', { params });
  return data;
}

export async function updateSubmission(id, payload) {
  const { data } = await api.patch(`/catalog/submissions/${id}`, payload);
  return data;
}

export async function deleteSubmission(id) {
  const { data } = await api.delete(`/catalog/submissions/${id}`);
  return data;
}

export async function importSubmission(id) {
  const { data } = await api.post(`/catalog/submissions/${id}/import`);
  return data;
}
