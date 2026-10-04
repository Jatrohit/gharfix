/*!
 * gharfix-api.js  -  tiny client for the GharFix backend.
 * Load it BEFORE your main script with a script tag whose src is "gharfix-api.js".
 * Change the base URL with:         window.GHARFIX_API_URL = "https://api.yourdomain.com/api";
 *
 * The JWT is kept in localStorage (key: gharfix_token). Logging out = deleting it.
 */
(function (global) {
  'use strict';
  const BASE = (global.GHARFIX_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');
  const TOKEN_KEY = 'gharfix_token';
  const USER_KEY = 'gharfix_user';

  const store = {
    get(k) { try { return global.localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { global.localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del(k) { try { global.localStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };

  class ApiError extends Error {
    constructor(message, status, code, errors) {
      super(message);
      this.name = 'ApiError';
      this.status = status; // 0 = network error
      this.code = code || null;
      this.errors = errors || [];
    }
  }

  async function request(method, path, { body, query, auth = true } = {}) {
    let url = BASE + path;
    if (query) {
      const qs = new URLSearchParams();
      Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
      if ([...qs].length) url += '?' + qs.toString();
    }
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = api.token;
    if (auth && token) headers.Authorization = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (_) {
      throw new ApiError('Server se connect nahi ho paaya. Internet ya backend check karein.', 0, 'NETWORK');
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* empty / non-JSON */ }
    if (!res.ok || !json || json.success === false) {
      if (res.status === 401 && api.token) api.logout(); // expired / invalid token -> clean up
      throw new ApiError((json && json.message) || 'Something went wrong', res.status, json && json.code, json && json.errors);
    }
    return json; // { success, message, data, pagination? }
  }

  function saveSession(data) {
    store.set(TOKEN_KEY, data.token);
    store.set(USER_KEY, JSON.stringify(data.user));
    return data;
  }

  const api = {
    BASE,
    ApiError,
    get token() { return store.get(TOKEN_KEY); },
    get user() { try { return JSON.parse(store.get(USER_KEY) || 'null'); } catch (_) { return null; } },
    isLoggedIn() { return !!api.token; },
    logout() { store.del(TOKEN_KEY); store.del(USER_KEY); },

    // ---- auth ----
    async login(emailOrPhone, password) {
      const r = await request('POST', '/auth/login', { body: { email: emailOrPhone, password }, auth: false });
      return saveSession(r.data);
    },
    async register({ name, email, phone, password, ...rest }) {
      const r = await request('POST', '/auth/register', { body: { name, email, phone, password, ...rest }, auth: false });
      return saveSession(r.data);
    },
    async professionalLogin(emailOrPhone, password) {
      const r = await request('POST', '/auth/professional/login', { body: { email: emailOrPhone, password }, auth: false });
      return saveSession(r.data);
    },
    async me() {
      const r = await request('GET', '/auth/me');
      store.set(USER_KEY, JSON.stringify(r.data.user));
      return r.data;
    },

    // ---- public catalogue ----
    async services() { return (await request('GET', '/services', { auth: false })).data; },
    /** filters: service, city, locality, pincode, min_rating, availability, experience, price, sort, order, page, limit */
    professionals(filters = {}) { return request('GET', '/professionals/search', { query: filters, auth: false }); },
    async professional(id) { return (await request('GET', `/professionals/${id}`, { auth: false })).data; },
    reviews(id, query) { return request('GET', `/professionals/${id}/reviews`, { query, auth: false }); },

    // ---- customer ----
    async createBooking(payload) { return (await request('POST', '/bookings', { body: payload })).data; },
    myBookings(query) { return request('GET', '/bookings/my-bookings', { query }); },
    async cancelBooking(id) { return (await request('PUT', `/bookings/${id}/cancel`)).data; },
    async createReview({ booking_id, rating, review }) {
      return (await request('POST', '/reviews', { body: { booking_id, rating, review } })).data;
    },
  };

  global.GharFixAPI = api;
})(typeof window !== 'undefined' ? window : globalThis);
