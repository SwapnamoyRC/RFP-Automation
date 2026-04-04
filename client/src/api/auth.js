import axios from 'axios';

const api = axios.create({
  baseURL: '/api/auth',
  timeout: 10000,
});

export async function login(email, password) {
  const { data } = await api.post('/login', { email, password });
  return data; // { user, token }
}

export async function register(email, password, name) {
  const { data } = await api.post('/register', { email, password, name });
  return data; // { user, token }
}
