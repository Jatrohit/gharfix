'use strict';
const { imageUrl, toNumber } = require('./helpers');

const mapUser = (u) =>
  u && {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    address: u.address,
    locality: u.locality,
    city: u.city,
    pincode: u.pincode,
    profile_image: imageUrl(u.profile_image),
    is_verified: !!u.is_verified,
    is_active: !!u.is_active,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };

const mapService = (s) =>
  s && {
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    icon: s.icon,
    starting_price: toNumber(s.starting_price),
    is_active: !!s.is_active,
    created_at: s.created_at,
  };

/**
 * Professional card/profile.
 * `scope: 'public'` hides contact details; `'owner'`/`'admin'` include them.
 */
const mapProfessional = (p, scope = 'public') => {
  if (!p) return p;
  const base = {
    id: p.id,
    name: p.name,
    profession: p.service_name,
    service: { id: p.service_id, name: p.service_name, slug: p.service_slug, icon: p.service_icon },
    bio: p.bio,
    experience_years: p.experience_years,
    starting_price: toNumber(p.effective_price ?? p.starting_price),
    service_area: p.service_area,
    city: p.city,
    pincode: p.pincode,
    rating: toNumber(p.rating),
    total_reviews: p.total_reviews,
    completed_jobs: p.completed_jobs,
    availability_status: p.availability_status,
    is_verified: p.verification_status === 'approved',
    profile_image: imageUrl(p.profile_image),
  };
  if (scope === 'public') return base;
  return {
    ...base,
    user_id: p.user_id,
    email: p.email,
    phone: p.phone,
    locality: p.locality,
    verification_status: p.verification_status,
    is_active: !!p.is_active,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
};

const CONTACT_VISIBLE = ['accepted', 'confirmed', 'in_progress', 'completed'];

/**
 * Booking view. Contact details are shared only once a professional has accepted:
 * - customers see the professional's phone after acceptance
 * - professionals see the customer's phone + full address after acceptance
 */
const mapBooking = (b, viewer = 'customer') => {
  if (!b) return b;
  const contactOpen = CONTACT_VISIBLE.includes(b.status);
  const out = {
    id: b.id,
    status: b.status,
    booking_source: b.booking_source,
    service: { id: b.service_id, name: b.service_name, slug: b.service_slug, icon: b.service_icon },
    professional: {
      id: b.professional_id,
      name: b.professional_name,
      profile_image: imageUrl(b.professional_image),
      phone: viewer === 'professional' || contactOpen || viewer === 'admin' ? b.professional_phone : null,
    },
    customer: {
      id: b.customer_id,
      name: b.customer_name,
      phone: viewer === 'customer' || viewer === 'admin' || contactOpen ? b.contact_phone || b.customer_phone : null,
    },
    address: viewer === 'professional' && !contactOpen ? null : b.address,
    locality: b.locality,
    city: b.city,
    pincode: b.pincode,
    preferred_date: b.preferred_date,
    preferred_time: b.preferred_time,
    problem_description: b.problem_description,
    customer_notes: b.customer_notes,
    estimated_price: toNumber(b.estimated_price),
    final_price: toNumber(b.final_price),
    price_status: b.final_price === null || b.final_price === undefined ? 'estimated' : 'final',
    can_review: b.status === 'completed' && !b.review_id,
    has_review: !!b.review_id,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
  return out;
};

const mapReview = (r) =>
  r && {
    id: r.id,
    booking_id: r.booking_id,
    professional_id: r.professional_id,
    rating: r.rating,
    review: r.review,
    customer_name: r.customer_name,
    created_at: r.created_at,
  };

module.exports = { mapUser, mapService, mapProfessional, mapBooking, mapReview };
