'use strict';
/**
 * End-to-end smoke test against a RUNNING server with the demo data from database.sql.
 *   npm run dev            (in one terminal)
 *   npm run smoke          (in another)
 * It creates a few throw-away users/bookings, so run it on a development database only.
 */
const jwt = require('jsonwebtoken');
require('../config/env');
const config = require('../config/env');

const BASE = process.env.API_BASE || `http://localhost:${config.port}`;
let passed = 0;
const failures = [];

const check = (name, cond, detail) => {
  if (cond) { passed++; return; }
  failures.push(name);
  console.log(`  FAIL  ${name}${detail ? '  ->  ' + JSON.stringify(detail) : ''}`);
};

async function api(method, path, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  let json = null;
  try { json = await res.json(); } catch (_) { /* non-JSON */ }
  return { status: res.status, body: json, headers: res.headers };
}

const dateOffset = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(d);
};
const run = Date.now().toString().slice(-7);
const DEMO_PW = 'Demo@1234';

(async () => {
  // ---------- public data ----------
  let r = await api('GET', '/api/services');
  check('services list returns 14 active services', r.status === 200 && r.body.data.length === 14, r.body);
  r = await api('GET', '/api/services/ac-repair');
  check('service by slug', r.status === 200 && r.body.data.id === 3);
  r = await api('GET', '/api/services/3');
  check('service by id', r.status === 200 && r.body.data.slug === 'ac-repair');
  r = await api('GET', '/api/services/nope');
  check('unknown service -> 404', r.status === 404);

  r = await api('GET', '/api/professionals');
  check('professionals list hides pending professionals', r.status === 200 && r.body.pagination.total === 4 && !r.body.data.some((p) => p.name === 'Mohd Salim'), r.body.pagination);
  check('public professional hides phone/email', !('phone' in r.body.data[0]) && !('email' in r.body.data[0]));
  r = await api('GET', '/api/professionals/search?service=electrician&city=Delhi&pincode=110085');
  check('search electrician in 110085', r.status === 200 && r.body.data.length === 1 && r.body.data[0].name === 'Rajesh Kumar', r.body);
  r = await api('GET', '/api/professionals/search?service=Plumber&sort=price&order=asc&limit=1&page=1');
  check('search + sort + pagination', r.status === 200 && r.body.pagination.limit === 1 && r.body.data.length === 1);
  r = await api('GET', '/api/professionals/search?min_rating=4.8&availability=available');
  check('filter min_rating + availability', r.status === 200 && r.body.data.every((p) => p.rating >= 4.8));
  r = await api('GET', '/api/professionals/search?sort=password');
  check('invalid sort rejected (SQL-injection safe)', r.status === 422);
  r = await api('GET', "/api/professionals/search?service=' OR 1=1 --");
  check('injection string treated as plain text', r.status === 200 && r.body.data.length === 0, r.body);
  r = await api('GET', '/api/professionals/search?locality=' + encodeURIComponent('Rohini Sector 23'));
  check('locality search tolerates "Rohini Sector 23"', r.status === 200 && r.body.data.length === 2 && r.body.data.some((p) => p.name === 'Rajesh Kumar'), r.body);
  r = await api('GET', '/api/professionals/search?locality=Mumbai');
  check('locality with no match returns empty list', r.status === 200 && r.body.data.length === 0);
  r = await api('GET', '/api/professionals/service/2');
  check('professionals by service', r.status === 200 && r.body.data.length === 1 && r.body.data[0].profession === 'Plumber');
  r = await api('GET', '/api/professionals/1');
  check('professional by id', r.status === 200 && r.body.data.name === 'Rajesh Kumar');
  r = await api('GET', '/api/professionals/5');
  check('pending professional is not public', r.status === 404);
  r = await api('GET', '/api/professionals/abc');
  check('bad professional id -> 422', r.status === 422);
  r = await api('GET', '/api/professionals/3/reviews');
  check('professional reviews', r.status === 200 && r.body.data.length === 2 && r.body.pagination.total === 2);

  // ---------- auth ----------
  const cust = { name: 'Test Customer', email: `cust${run}@test.dev`, phone: `98${run}1`, password: 'Secret123', city: 'Delhi' };
  r = await api('POST', '/api/auth/register', { body: cust });
  check('customer register', r.status === 201 && r.body.data.token && !('password' in r.body.data.user), r.body);
  const custToken = r.body.data && r.body.data.token;
  check('registered role is customer', r.body.data.user.role === 'customer');
  r = await api('POST', '/api/auth/register', { body: { ...cust, phone: `97${run}2` } });
  check('duplicate email -> 409', r.status === 409, r.body);
  r = await api('POST', '/api/auth/register', { body: { ...cust, email: `x${run}@test.dev` } });
  check('duplicate phone -> 409', r.status === 409, r.body);
  r = await api('POST', '/api/auth/register', { body: { ...cust, email: `y${run}@test.dev`, phone: `96${run}3`, password: 'short' } });
  check('weak password -> 422', r.status === 422, r.body);
  r = await api('POST', '/api/auth/register', { body: { ...cust, email: `y${run}@test.dev`, phone: '12345' } });
  check('invalid phone -> 422', r.status === 422);
  r = await api('POST', '/api/auth/register', { body: { ...cust, email: `z${run}@test.dev`, phone: `95${run}4`, role: 'admin' } });
  check('role from client is ignored', r.status === 201 && r.body.data.user.role === 'customer', r.body);
  r = await api('POST', '/api/auth/register', { body: { name: 'A' } });
  check('missing fields -> 422', r.status === 422);

  r = await api('POST', '/api/auth/login', { body: { email: cust.email, password: 'wrongpass1' } });
  check('wrong password -> 401', r.status === 401);
  r = await api('POST', '/api/auth/login', { body: { email: 'nobody@test.dev', password: 'whatever1' } });
  check('unknown user -> 401 (same message)', r.status === 401 && r.body.message === 'Invalid email/phone or password');
  r = await api('POST', '/api/auth/login', { body: { email: cust.email, password: cust.password } });
  check('customer login by email', r.status === 200 && !!r.body.data.token);
  r = await api('POST', '/api/auth/login', { body: { phone: `+91 ${cust.phone}`, password: cust.password } });
  check('customer login by phone (+91 format)', r.status === 200, r.body);
  r = await api('POST', '/api/auth/professional/login', { body: { email: cust.email, password: cust.password } });
  check('customer cannot use professional login', r.status === 401);
  r = await api('POST', '/api/auth/login', { body: { email: 'rajesh@gharfix.demo', password: DEMO_PW } });
  check('professional cannot use customer login', r.status === 401);

  r = await api('POST', '/api/auth/login', { body: { email: 'admin@gharfix.demo', password: DEMO_PW } });
  const adminToken = r.body.data && r.body.data.token;
  check('admin login', r.status === 200 && r.body.data.user.role === 'admin');
  r = await api('POST', '/api/auth/professional/login', { body: { email: 'rajesh@gharfix.demo', password: DEMO_PW } });
  const rajeshToken = r.body.data && r.body.data.token;
  check('professional login returns profile', r.status === 200 && r.body.data.professional.verification_status === 'approved');
  r = await api('POST', '/api/auth/professional/login', { body: { email: 'imran@gharfix.demo', password: DEMO_PW } });
  const imranToken = r.body.data.token;
  r = await api('POST', '/api/auth/login', { body: { email: 'neha@gharfix.demo', password: DEMO_PW } });
  const nehaToken = r.body.data.token;

  r = await api('GET', '/api/auth/me', { token: custToken });
  check('GET /auth/me', r.status === 200 && r.body.data.user.email === cust.email);
  r = await api('GET', '/api/auth/me');
  check('no token -> 401', r.status === 401);
  r = await api('GET', '/api/auth/me', { token: 'garbage.token.value' });
  check('invalid token -> 401', r.status === 401 && r.body.code === 'INVALID_TOKEN');
  const expired = jwt.sign({ id: 2, role: 'customer' }, config.jwt.secret, { expiresIn: -10, issuer: 'gharfix' });
  r = await api('GET', '/api/auth/me', { token: expired });
  check('expired token -> 401 TOKEN_EXPIRED', r.status === 401 && r.body.code === 'TOKEN_EXPIRED', r.body);
  const forged = jwt.sign({ id: 2, role: 'admin' }, config.jwt.secret, { issuer: 'gharfix' });
  r = await api('GET', '/api/admin/dashboard', { token: forged });
  check('token claiming admin role but DB says customer -> rejected', r.status === 401, r.body);
  const wrongSecret = jwt.sign({ id: 1, role: 'admin' }, 'another-secret', { issuer: 'gharfix' });
  r = await api('GET', '/api/admin/dashboard', { token: wrongSecret });
  check('token signed with wrong secret -> 401', r.status === 401);

  // ---------- booking validation ----------
  const tomorrow = dateOffset(1);
  const base = { professional_id: 1, location: 'Rohini Sector 23', preferred_date: tomorrow, preferred_time: '9 AM – 12 PM', contact_phone: '9811122233', problem_description: 'Fan not working', estimated_price: 1 };
  r = await api('POST', '/api/bookings', { body: base });
  check('booking needs login', r.status === 401);
  r = await api('POST', '/api/bookings', { token: rajeshToken, body: base });
  check('professional cannot create bookings', r.status === 403);

  r = await api('POST', '/api/bookings', { token: custToken, body: base });
  check('create booking', r.status === 201 && r.body.data.status === 'pending', r.body);
  const b1 = r.body.data;
  check('price calculated by backend (client price ignored)', b1 && b1.estimated_price === 299 && b1.final_price === null && b1.price_status === 'estimated', b1);
  check('booking_source defaults to web', b1.booking_source === 'web');
  check('location mapped: locality + city fallback', b1.locality === 'Rohini Sector 23' && b1.city === 'Delhi', b1);
  check('professional phone hidden while pending', b1.professional.phone === null);

  r = await api('POST', '/api/bookings', { token: custToken, body: base });
  check('same slot requested twice -> 409', r.status === 409, r.body);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, preferred_date: dateOffset(-1) } });
  check('past date -> 422', r.status === 422, r.body);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, preferred_date: '2027-02-30' } });
  check('impossible date -> 422', r.status === 422);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, preferred_date: dateOffset(200) } });
  check('too far ahead -> 422', r.status === 422);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, preferred_time: '25:99' } });
  check('invalid time -> 422', r.status === 422);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, preferred_time: '03:00' } });
  check('outside service hours -> 422', r.status === 422);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, location: undefined, pincode: '12345' } });
  check('invalid pincode -> 422', r.status === 422);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, location: undefined } });
  check('missing location -> 422', r.status === 422, r.body);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, professional_id: 4, preferred_time: '12 PM – 3 PM' } });
  check('busy professional -> 409', r.status === 409, r.body);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, professional_id: 5, service_id: 6 } });
  check('unverified professional -> 409', r.status === 409 && r.body.code === 'PROFESSIONAL_NOT_VERIFIED', r.body);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, service_id: 2, preferred_time: '12 PM – 3 PM' } });
  check('professional does not provide that service -> 422', r.status === 422, r.body);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, professional_id: 999 } });
  check('unknown professional -> 404', r.status === 404);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, professional_id: undefined, service_id: 999 } });
  check('unknown service -> 404', r.status === 404);
  r = await api('POST', '/api/bookings', { token: custToken, body: { location: 'Rohini', preferred_date: tomorrow, preferred_time: '9 AM – 12 PM' } });
  check('no service and no professional -> 422', r.status === 422);

  r = await api('POST', '/api/bookings', { token: custToken, body: { service: 'Plumber', location: '110034', preferred_date: dateOffset(2), preferred_time: '3 PM – 6 PM' } });
  check('"any available professional" auto-assigns a plumber', r.status === 201 && r.body.data.professional.name === 'Suresh Yadav' && r.body.data.pincode === '110034', r.body);
  const b2 = r.body.data;
  r = await api('POST', '/api/bookings', { token: custToken, body: { service: 'CCTV', location: 'Rohini', preferred_date: dateOffset(2), preferred_time: '3 PM – 6 PM' } });
  check('no professionals for service -> 404', r.status === 404, r.body);

  // typed location must not be mixed with the pincode saved in the customer's profile
  r = await api('POST', '/api/auth/login', { body: { email: 'amit@gharfix.demo', password: DEMO_PW } });
  const amitToken = r.body.data.token; // profile: Dwarka, 110075
  r = await api('POST', '/api/bookings', { token: amitToken, body: { professional_id: 3, location: 'Pitampura', preferred_date: dateOffset(5), preferred_time: '9 AM - 12 PM' } });
  check('typed locality is not paired with profile pincode', r.status === 201 && r.body.data.locality === 'Pitampura' && r.body.data.pincode === null && r.body.data.address === 'Pitampura', r.body);
  check('slot label "9 AM - 12 PM" (hyphen) normalised to en dash', r.body.data && r.body.data.preferred_time === '9 AM – 12 PM', r.body.data);
  r = await api('POST', '/api/bookings', { token: amitToken, body: { professional_id: 3, preferred_date: dateOffset(6), preferred_time: '12 PM – 3 PM' } });
  check('no location in request -> falls back to saved profile address', r.status === 201 && r.body.data.pincode === '110075' && r.body.data.locality === 'Dwarka', r.body);

  // ---------- booking access control ----------
  r = await api('GET', '/api/bookings/my-bookings', { token: custToken });
  check('my-bookings lists own bookings', r.status === 200 && r.body.pagination.total === 2);
  r = await api('GET', `/api/bookings/${b1.id}`, { token: nehaToken });
  check("another customer cannot read someone's booking", r.status === 404);
  r = await api('GET', `/api/bookings/${b1.id}`, { token: imranToken });
  check("another professional cannot read the booking", r.status === 404);
  r = await api('PUT', `/api/bookings/${b1.id}/cancel`, { token: nehaToken });
  check("cannot cancel another customer's booking", r.status === 404);
  r = await api('PUT', `/api/bookings/${b1.id}/accept`, { token: imranToken });
  check('professional cannot accept a booking they do not own', r.status === 404);
  r = await api('PUT', `/api/bookings/${b1.id}/accept`, { token: custToken });
  check('customer cannot accept', r.status === 403);
  r = await api('PUT', `/api/bookings/${b1.id}/complete`, { token: rajeshToken });
  check('cannot complete a pending booking', r.status === 409, r.body);
  r = await api('GET', '/api/bookings/professional', { token: rajeshToken });
  check('professional sees own requests, address hidden while pending', r.status === 200 && r.body.data.some((b) => b.id === b1.id && b.address === null), r.body);

  // ---------- booking lifecycle ----------
  r = await api('POST', '/api/reviews', { token: custToken, body: { booking_id: b1.id, rating: 5 } });
  check('review before completion -> 409', r.status === 409, r.body);
  r = await api('PUT', `/api/bookings/${b1.id}/accept`, { token: rajeshToken });
  check('professional accepts', r.status === 200 && r.body.data.status === 'accepted', r.body);
  check('customer phone/address revealed after accept', r.body.data.address && r.body.data.customer.phone === '9811122233', r.body.data);
  r = await api('GET', `/api/bookings/${b1.id}`, { token: custToken });
  check('customer now sees professional phone', r.body.data.professional.phone === '9000000005');
  r = await api('PUT', `/api/bookings/${b1.id}/accept`, { token: rajeshToken });
  check('double accept -> 409', r.status === 409);
  r = await api('PUT', `/api/bookings/${b1.id}/start`, { token: rajeshToken });
  check('start work', r.status === 200 && r.body.data.status === 'in_progress');
  r = await api('PUT', `/api/bookings/${b1.id}/price`, { token: rajeshToken, body: { final_price: -5 } });
  check('negative price -> 422', r.status === 422);
  r = await api('PUT', `/api/bookings/${b1.id}/price`, { token: rajeshToken, body: { final_price: 450 } });
  check('professional sets final price', r.status === 200 && r.body.data.final_price === 450 && r.body.data.price_status === 'final', r.body);
  r = await api('PUT', `/api/bookings/${b1.id}/cancel`, { token: custToken });
  check('customer cannot cancel in-progress work', r.status === 409, r.body);
  r = await api('GET', '/api/professionals/1');
  const jobsBefore = r.body.data.completed_jobs;
  r = await api('PUT', `/api/bookings/${b1.id}/complete`, { token: rajeshToken, body: {} });
  check('complete booking', r.status === 200 && r.body.data.status === 'completed' && r.body.data.final_price === 450, r.body);
  r = await api('GET', '/api/professionals/1');
  check('completed_jobs incremented once', r.body.data.completed_jobs === jobsBefore + 1, r.body.data);
  r = await api('PUT', `/api/bookings/${b1.id}/complete`, { token: rajeshToken });
  check('double complete -> 409 (no double count)', r.status === 409);
  r = await api('GET', '/api/professionals/1');
  check('completed_jobs unchanged after rejected double-complete', r.body.data.completed_jobs === jobsBefore + 1);

  // ---------- reviews ----------
  r = await api('POST', '/api/reviews', { token: custToken, body: { booking_id: b1.id, rating: 6 } });
  check('rating 6 -> 422', r.status === 422);
  r = await api('POST', '/api/reviews', { token: nehaToken, body: { booking_id: b1.id, rating: 5 } });
  check("cannot review someone else's booking", r.status === 404);
  r = await api('POST', '/api/reviews', { token: rajeshToken, body: { booking_id: b1.id, rating: 5 } });
  check('professional cannot post reviews', r.status === 403);
  r = await api('POST', '/api/reviews', { token: custToken, body: { booking_id: b1.id, rating: 3, review: 'Okay service' } });
  check('create review', r.status === 201 && r.body.data.professional.total_reviews === 2, r.body);
  check('rating recalculated from DB (5 and 3 -> 4.0)', r.body.data.professional.rating === 4, r.body.data);
  r = await api('POST', '/api/reviews', { token: custToken, body: { booking_id: b1.id, rating: 5 } });
  check('duplicate review -> 409', r.status === 409);
  r = await api('GET', `/api/bookings/${b1.id}`, { token: custToken });
  check('booking shows has_review', r.body.data.has_review === true && r.body.data.can_review === false);

  // ---------- cancel ----------
  r = await api('PUT', `/api/bookings/${b2.id}/cancel`, { token: custToken });
  check('customer cancels pending booking', r.status === 200 && r.body.data.status === 'cancelled');
  r = await api('PUT', `/api/bookings/${b2.id}/cancel`, { token: custToken });
  check('cancelling twice -> 409', r.status === 409);
  r = await api('PUT', `/api/bookings/${b2.id}/accept`, { token: (await api('POST', '/api/auth/professional/login', { body: { email: 'suresh@gharfix.demo', password: DEMO_PW } })).body.data.token });
  check('cannot accept a cancelled booking', r.status === 409 && /cancelled/.test(r.body.message), r.body);

  // ---------- profiles ----------
  r = await api('GET', '/api/users/me', { token: custToken });
  check('GET /users/me', r.status === 200 && r.body.data.email === cust.email);
  r = await api('PUT', '/api/users/me', { token: custToken, body: { name: 'Test Customer Two', role: 'admin', is_verified: true } });
  check('update profile (role/is_verified ignored)', r.status === 200 && r.body.data.name === 'Test Customer Two' && r.body.data.role === 'customer' && r.body.data.is_verified === false, r.body);
  r = await api('PUT', '/api/users/me', { token: custToken, body: { phone: '9000000002' } });
  check('update to an existing phone -> 409', r.status === 409);
  r = await api('PUT', '/api/users/me/address', { token: custToken, body: { address: 'House 5, Sector 7', locality: 'Rohini', city: 'Delhi', pincode: '110085' } });
  check('update address', r.status === 200 && r.body.data.pincode === '110085');
  r = await api('PUT', '/api/users/me/address', { token: custToken, body: { address: 'House 5', city: 'Delhi', pincode: '0000' } });
  check('address with bad pincode -> 422', r.status === 422);

  // minimal valid PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let form = new FormData();
  form.append('name', 'Test Customer Two');
  form.append('profile_image', new Blob([png], { type: 'image/png' }), 'me.png');
  r = await api('PUT', '/api/users/me', { token: custToken, form });
  check('profile image upload', r.status === 200 && /\/uploads\/profiles\/[a-f0-9]{32}\.png$/.test(r.body.data.profile_image || ''), r.body);
  if (r.body.data && r.body.data.profile_image) {
    const img = await fetch(r.body.data.profile_image);
    check('uploaded image is served', img.status === 200 && img.headers.get('content-type') === 'image/png');
  }
  form = new FormData();
  form.append('profile_image', new Blob(['<?php echo 1; ?>'], { type: 'image/png' }), 'evil.php');
  r = await api('PUT', '/api/users/me', { token: custToken, form });
  check('fake image (wrong content) -> 422', r.status === 422, r.body);
  form = new FormData();
  form.append('profile_image', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  r = await api('PUT', '/api/users/me', { token: custToken, form });
  check('non-image upload -> 422', r.status === 422, r.body);

  // professional profile
  r = await api('PUT', '/api/professionals/me/profile', { token: imranToken, body: { bio: 'Updated bio', starting_price: 549, availability_status: 'busy', rating: 5, completed_jobs: 9999, verification_status: 'rejected', total_reviews: 50 } });
  check('professional updates own profile', r.status === 200 && r.body.data.bio === 'Updated bio' && r.body.data.availability_status === 'busy', r.body);
  check('protected fields cannot be changed by professional', r.body.data.verification_status === 'approved' && r.body.data.rating === 5 && r.body.data.completed_jobs === 1 && r.body.data.total_reviews === 1, r.body.data);
  r = await api('PUT', '/api/professionals/me/profile', { token: imranToken, body: { availability_status: 'available' } });
  check('availability toggle', r.body.data.availability_status === 'available');
  r = await api('PUT', '/api/professionals/me/profile', { token: imranToken, body: { availability_status: 'on_holiday' } });
  check('invalid availability -> 422', r.status === 422);
  r = await api('PUT', '/api/professionals/me/profile', { token: custToken, body: { bio: 'x' } });
  check('customer cannot use professional profile route', r.status === 403);

  // professional registration -> pending -> admin approval
  const pro = { name: 'New Pro', email: `pro${run}@test.dev`, phone: `94${run}5`, password: 'Secret123', service_id: 1, experience_years: 3, starting_price: 249, service_area: 'Rohini, Pitampura', city: 'Delhi', pincode: '110085', bio: 'Test electrician' };
  form = new FormData();
  Object.entries(pro).forEach(([k, v]) => form.append(k, String(v)));
  form.append('profile_image', new Blob([png], { type: 'image/png' }), 'pro.png');
  r = await api('POST', '/api/auth/professional/register', { form });
  check('professional register (multipart + image)', r.status === 201 && r.body.data.professional.verification_status === 'pending' && r.body.data.user.role === 'professional', r.body);
  const newProId = r.body.data.professional.id;
  const newProToken = r.body.data.token;
  r = await api('POST', '/api/auth/professional/register', { body: { ...pro, service_id: 999, email: `q${run}@test.dev`, phone: `93${run}6` } });
  check('professional register with invalid service -> 404', r.status === 404);
  r = await api('POST', '/api/auth/professional/register', { body: { ...pro } });
  check('professional duplicate email -> 409', r.status === 409);
  r = await api('GET', `/api/professionals/${newProId}`);
  check('pending professional hidden from public', r.status === 404);
  r = await api('POST', '/api/bookings', { token: custToken, body: { ...base, professional_id: newProId, preferred_date: dateOffset(3) } });
  check('cannot book a pending professional', r.status === 409, r.body);
  r = await api('PUT', `/api/admin/professionals/${newProId}/approve`, { token: newProToken });
  check('professional cannot approve themselves', r.status === 403);

  // ---------- admin ----------
  r = await api('GET', '/api/admin/dashboard', { token: custToken });
  check('customer cannot open admin dashboard', r.status === 403);
  r = await api('GET', '/api/admin/dashboard');
  check('admin dashboard needs login', r.status === 401);
  r = await api('GET', '/api/admin/dashboard', { token: adminToken });
  const dash = r.body.data;
  check('admin dashboard stats', r.status === 200 && dash.total_services === 14 && dash.pending_professionals >= 2 && dash.total_bookings >= 7 && dash.completed_bookings >= 5, dash);
  r = await api('GET', '/api/admin/professionals?status=pending', { token: adminToken });
  check('admin lists pending professionals', r.status === 200 && r.body.data.length >= 2 && r.body.data[0].phone);
  r = await api('GET', '/api/admin/users?role=customer&search=neha', { token: adminToken });
  check('admin lists/searches users', r.status === 200 && r.body.data.length === 1 && !('password' in r.body.data[0]));
  r = await api('PUT', `/api/admin/professionals/${newProId}/approve`, { token: adminToken });
  check('admin approves professional', r.status === 200 && r.body.data.verification_status === 'approved' && r.body.data.is_verified === true);
  r = await api('GET', `/api/professionals/${newProId}`);
  check('approved professional is now public', r.status === 200);
  r = await api('PUT', `/api/admin/professionals/${newProId}/suspend`, { token: adminToken });
  check('admin suspends professional', r.status === 200 && r.body.data.is_active === false && r.body.data.availability_status === 'offline');
  r = await api('GET', '/api/auth/me', { token: newProToken });
  check('suspended user is blocked immediately', r.status === 403 && r.body.code === 'ACCOUNT_SUSPENDED', r.body);
  r = await api('POST', '/api/auth/professional/login', { body: { email: pro.email, password: pro.password } });
  check('suspended user cannot login', r.status === 403);
  r = await api('GET', `/api/professionals/${newProId}`);
  check('suspended professional hidden from public', r.status === 404);
  r = await api('PUT', `/api/admin/professionals/${newProId}/reinstate`, { token: adminToken });
  check('admin reinstates professional', r.status === 200 && r.body.data.is_active === true);
  r = await api('PUT', `/api/admin/professionals/${newProId}/reject`, { token: adminToken });
  check('admin rejects professional', r.status === 200 && r.body.data.verification_status === 'rejected');
  r = await api('PUT', '/api/admin/professionals/99999/approve', { token: adminToken });
  check('approve unknown professional -> 404', r.status === 404);

  r = await api('GET', '/api/admin/bookings?status=pending', { token: adminToken });
  check('admin lists bookings', r.status === 200 && r.body.data.length >= 1);
  const seedPending = r.body.data.find((b) => b.booking_source === 'phone');
  check('phone-source booking visible to admin', !!seedPending, r.body.data.map((b) => b.booking_source));
  r = await api('PUT', `/api/admin/bookings/${seedPending.id}`, { token: adminToken, body: { status: 'confirmed' } });
  check('admin confirms booking', r.status === 200 && r.body.data.status === 'confirmed', r.body);
  r = await api('PUT', `/api/admin/bookings/${seedPending.id}`, { token: adminToken, body: { status: 'pending' } });
  check('admin cannot move backwards to pending', r.status === 403 || r.status === 409 || r.status === 422);
  r = await api('PUT', `/api/admin/bookings/${seedPending.id}`, { token: adminToken, body: { status: 'bogus' } });
  check('admin invalid status -> 422', r.status === 422);

  r = await api('GET', '/api/admin/reviews', { token: adminToken });
  const mine = r.body.data.find((x) => x.review === 'Okay service');
  check('admin lists reviews', r.status === 200 && !!mine);
  r = await api('DELETE', `/api/admin/reviews/${mine.id}`, { token: adminToken });
  check('admin removes review', r.status === 200);
  r = await api('GET', '/api/professionals/1');
  check('rating recalculated after review removal (back to 5.0)', r.body.data.rating === 5 && r.body.data.total_reviews === 1, r.body.data);

  const svc = { name: `Test Service ${run}`, starting_price: 123, icon: '🧪', description: 'temp' };
  r = await api('POST', '/api/services', { token: adminToken, body: svc });
  check('admin creates service', r.status === 201 && r.body.data.slug === `test-service-${run}`, r.body);
  const sid = r.body.data.id;
  r = await api('POST', '/api/services', { token: custToken, body: svc });
  check('customer cannot create service', r.status === 403);
  r = await api('POST', '/api/services', { token: adminToken, body: svc });
  check('duplicate service -> 409', r.status === 409, r.body);
  r = await api('PUT', `/api/services/${sid}`, { token: adminToken, body: { starting_price: 150, is_active: false } });
  check('admin updates service', r.status === 200 && r.body.data.starting_price === 150 && r.body.data.is_active === false);
  r = await api('GET', `/api/services/${sid}`);
  check('inactive service hidden from public', r.status === 404);
  r = await api('DELETE', `/api/services/${sid}`, { token: adminToken });
  check('admin deletes unused service', r.status === 200 && r.body.data.deactivated === false, r.body);
  r = await api('DELETE', '/api/services/1', { token: adminToken });
  check('service in use is deactivated, not deleted', r.status === 200 && r.body.data.deactivated === true, r.body);
  await api('PUT', '/api/services/1', { token: adminToken, body: { is_active: true } });

  // ---------- platform behaviour ----------
  r = await api('GET', '/api/does-not-exist');
  check('unknown route -> 404 JSON', r.status === 404 && r.body.success === false);
  r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  check('malformed JSON -> 400', r.status === 400);
  r = await fetch(`${BASE}/api/services`, { headers: { Origin: 'http://evil.example' } });
  check('CORS: unknown origin gets no CORS header', !r.headers.get('access-control-allow-origin'));
  r = await fetch(`${BASE}/api/services`, { headers: { Origin: config.cors.origins[0] } });
  check('CORS: allowed origin is echoed (not *)', r.headers.get('access-control-allow-origin') === config.cors.origins[0]);
  check('helmet headers present', !!r.headers.get('x-content-type-options') && !r.headers.get('x-powered-by'));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('Failed:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error('Test run crashed:', e); process.exit(2); });
