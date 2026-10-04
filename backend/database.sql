-- =====================================================================
--  GharFix  |  database.sql   (MySQL 8.x / MariaDB 10.5+)
--  Creates the database, tables, indexes, foreign keys and DEMO data.
--
--  Import:   mysql -u root -p < database.sql
--  Safe to re-run: tables use IF NOT EXISTS and seed rows use INSERT IGNORE.
--  To wipe everything and start fresh, run the RESET block below first.
-- =====================================================================

-- ---- RESET (optional, DESTROYS ALL DATA) -----------------------------
-- DROP DATABASE IF EXISTS home_services;
-- -----------------------------------------------------------------------

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS home_services
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE home_services;

-- ---------------------------------------------------------------------
-- 1. users  (customers, professionals, admins)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  phone         VARCHAR(15)  NOT NULL,                -- stored as 10 digits, e.g. 9876543210
  password      VARCHAR(255) NOT NULL,                -- bcrypt hash, never plain text
  role          ENUM('customer','professional','admin') NOT NULL DEFAULT 'customer',
  address       VARCHAR(255) NULL,
  locality      VARCHAR(100) NULL,
  city          VARCHAR(80)  NULL,
  pincode       CHAR(6)      NULL,
  profile_image VARCHAR(255) NULL,
  is_verified   TINYINT(1)   NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,      -- 0 = suspended by admin
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_phone (phone),
  KEY idx_users_role (role),
  KEY idx_users_city_pincode (city, pincode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. services
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(80)  NOT NULL,
  slug           VARCHAR(100) NOT NULL,
  description    VARCHAR(500) NULL,
  icon           VARCHAR(16)  NULL,                   -- emoji (matches the frontend cards)
  starting_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_services_name (name),
  UNIQUE KEY uq_services_slug (slug),
  CONSTRAINT chk_services_price CHECK (starting_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. professionals  (profile of users with role = 'professional')
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS professionals (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             INT UNSIGNED NOT NULL,
  service_id          INT UNSIGNED NOT NULL,
  bio                 TEXT NULL,
  experience_years    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  starting_price      DECIMAL(10,2) NOT NULL DEFAULT 0,  -- 0 = use the service's base price
  service_area        VARCHAR(255) NOT NULL,
  city                VARCHAR(80)  NOT NULL,
  pincode             CHAR(6)      NOT NULL,
  rating              DECIMAL(2,1) NOT NULL DEFAULT 0,   -- computed from reviews by the backend
  total_reviews       INT UNSIGNED NOT NULL DEFAULT 0,   -- computed by the backend
  completed_jobs      INT UNSIGNED NOT NULL DEFAULT 0,   -- incremented by the backend
  availability_status ENUM('available','busy','offline') NOT NULL DEFAULT 'available',
  verification_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending', -- admin only
  profile_image       VARCHAR(255) NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_professionals_user (user_id),
  KEY idx_pro_service_status (service_id, verification_status, availability_status),
  KEY idx_pro_city_pincode (city, pincode),
  KEY idx_pro_rating (rating),
  CONSTRAINT fk_pro_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_pro_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pro_rating CHECK (rating BETWEEN 0 AND 5),
  CONSTRAINT chk_pro_price  CHECK (starting_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. bookings
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id         INT UNSIGNED NOT NULL,
  professional_id     INT UNSIGNED NOT NULL,
  service_id          INT UNSIGNED NOT NULL,
  address             VARCHAR(255) NOT NULL,
  locality            VARCHAR(100) NULL,
  city                VARCHAR(80)  NOT NULL,
  pincode             CHAR(6)      NULL,
  preferred_date      DATE         NOT NULL,
  preferred_time      VARCHAR(20)  NOT NULL,           -- slot label ("9 AM – 12 PM") or "HH:MM"
  problem_description TEXT NULL,
  estimated_price     DECIMAL(10,2) NOT NULL,          -- calculated by the backend
  final_price         DECIMAL(10,2) NULL,              -- set after the work is done
  status              ENUM('pending','accepted','rejected','confirmed','in_progress','completed','cancelled')
                      NOT NULL DEFAULT 'pending',
  customer_notes      TEXT NULL,
  contact_phone       VARCHAR(15) NULL,                -- phone entered in the booking form
  booking_source      ENUM('web','admin','phone','whatsapp') NOT NULL DEFAULT 'web',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bookings_customer (customer_id, created_at),
  KEY idx_bookings_professional (professional_id, status),
  KEY idx_bookings_slot (professional_id, preferred_date, preferred_time),
  KEY idx_bookings_status (status),
  KEY idx_bookings_service (service_id),
  CONSTRAINT fk_bookings_customer     FOREIGN KEY (customer_id)     REFERENCES users(id)         ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_professional FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_service      FOREIGN KEY (service_id)      REFERENCES services(id)      ON DELETE RESTRICT,
  CONSTRAINT chk_bookings_prices CHECK (estimated_price >= 0 AND (final_price IS NULL OR final_price >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. reviews  (one per booking)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id      INT UNSIGNED NOT NULL,
  customer_id     INT UNSIGNED NOT NULL,
  professional_id INT UNSIGNED NOT NULL,
  rating          TINYINT UNSIGNED NOT NULL,
  review          TEXT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_booking (booking_id),
  KEY idx_reviews_professional (professional_id, created_at),
  KEY idx_reviews_customer (customer_id),
  CONSTRAINT fk_reviews_booking      FOREIGN KEY (booking_id)      REFERENCES bookings(id)      ON DELETE CASCADE,
  CONSTRAINT fk_reviews_customer     FOREIGN KEY (customer_id)     REFERENCES users(id)         ON DELETE CASCADE,
  CONSTRAINT fk_reviews_professional FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
--  SEED DATA
-- =====================================================================

-- Services (names match the cards in the existing frontend; prices are demo starting prices in INR)
INSERT IGNORE INTO services (id, name, slug, description, icon, starting_price) VALUES
 (1,  'Electrician',        'electrician',        'Wiring, switches, fans, MCB & fittings',            '⚡', 149),
 (2,  'Plumber',            'plumber',            'Leakage, taps, pipes & bathroom fittings',          '🚰', 199),
 (3,  'AC Repair',          'ac-repair',          'Cooling, gas filling, installation & servicing',    '❄️', 499),
 (4,  'Carpenter',          'carpenter',          'Furniture, doors, repairs & custom work',           '🪚', 349),
 (5,  'Appliance Repair',   'appliance-repair',   'Microwave, mixer, oven & other appliances',         '🔌', 249),
 (6,  'RO Repair',          'ro-repair',          'Filter change, servicing & leakage fixes',          '💧', 299),
 (7,  'Painter',            'painter',            'Interior, exterior & touch-up painting',            '🎨', 799),
 (8,  'Washing Machine',    'washing-machine',    'Top & front load repair, drain & drum issues',      '🧺', 349),
 (9,  'CCTV',               'cctv',               'Camera installation, setup & repair',               '📹', 999),
 (10, 'Geyser',             'geyser',             'Heating element, thermostat & installation',        '🔥', 299),
 (11, 'TV Repair',          'tv-repair',          'Display, sound & wall-mount help',                  '📺', 299),
 (12, 'Refrigerator',       'refrigerator',       'Cooling issues, gas & compressor check',            '🧊', 349),
 (13, 'Inverter & Battery', 'inverter-battery',   'Battery check, servicing & replacement',            '🔋', 299),
 (14, 'Home Maintenance',   'home-maintenance',   'Small fixes around the house in one visit',         '🛠️', 199);

-- ---------------------------------------------------------------------
-- DEMO USERS  --  *** DEMO CREDENTIALS - DELETE BEFORE GOING LIVE ***
-- Every demo account uses the password:  Demo@1234
-- Phone numbers / emails below are fictional sample data.
--   Admin         admin@gharfix.demo            (login: POST /api/auth/login)
--   Customers     neha@gharfix.demo, amit@gharfix.demo, sunita@gharfix.demo
--   Professionals rajesh@gharfix.demo, imran@gharfix.demo, suresh@gharfix.demo,
--                 deepak@gharfix.demo, salim@gharfix.demo (pending approval)
--                                                (login: POST /api/auth/professional/login)
-- ---------------------------------------------------------------------
INSERT IGNORE INTO users (id, name, email, phone, password, role, address, locality, city, pincode, is_verified) VALUES
 (1, 'GharFix Admin (demo)', 'admin@gharfix.demo',  '9000000001', '$2b$10$CnwsfQoLx2OvaSL9ApxFyOVIMio2cwp/dNfJIe3h3BtqsvlP2d3LG', 'admin',        NULL, NULL, 'Delhi', NULL, 1),
 (2, 'Neha Verma',           'neha@gharfix.demo',   '9000000002', '$2b$10$CnwsfQoLx2OvaSL9ApxFyOVIMio2cwp/dNfJIe3h3BtqsvlP2d3LG', 'customer',     'Flat 12, Sector 23, Rohini', 'Rohini', 'Delhi', '110085', 0),
 (3, 'Amit Chauhan',         'amit@gharfix.demo',   '9000000003', '$2b$10$CnwsfQoLx2OvaSL9ApxFyOVIMio2cwp/dNfJIe3h3BtqsvlP2d3LG', 'customer',     'B-45, Sector 12, Dwarka',    'Dwarka', 'Delhi', '110075', 0),
 (4, 'Sunita Malhotra',      'sunita@gharfix.demo', '9000000004', '$2b$10$CnwsfQoLx2OvaSL9ApxFyOVIMio2cwp/dNfJIe3h3BtqsvlP2d3LG', 'customer',     'C-Block, Janakpuri',         'Janakpuri', 'Delhi', '110058', 0),
 (5, 'Rajesh Kumar',         'rajesh@gharfix.demo', '9000000005', '$2b$10$CnwsfQoLx2OvaSL9ApxFyOVIMio2cwp/dNfJIe3h3BtqsvlP2d3LG', 'professional', NULL, 'Rohini',    'Delhi', '110085', 1),
 (6, 'Imran Ali',            'imran@gharfix.demo',  '9000000006', '$2b$10$CnwsfQoLx2OvaSL9ApxFyOVIMio2cwp/dNfJIe3h3BtqsvlP2d3LG', 'professional', NULL, 'Dwarka',    'Delhi', '110075', 1),
 (7, 'Suresh Yadav',         'suresh@gharfix.demo', '9000000007', '$2b$10$CnwsfQoLx2OvaSL9ApxFyOVIMio2cwp/dNfJIe3h3BtqsvlP2d3LG', 'professional', NULL, 'Pitampura', 'Delhi', '110034', 1),
 (8, 'Deepak Sharma',        'deepak@gharfix.demo', '9000000008', '$2b$10$CnwsfQoLx2OvaSL9ApxFyOVIMio2cwp/dNfJIe3h3BtqsvlP2d3LG', 'professional', NULL, 'Janakpuri', 'Delhi', '110058', 1),
 (9, 'Mohd Salim',           'salim@gharfix.demo',  '9000000009', '$2b$10$CnwsfQoLx2OvaSL9ApxFyOVIMio2cwp/dNfJIe3h3BtqsvlP2d3LG', 'professional', NULL, 'Laxmi Nagar','Delhi', '110092', 0);

INSERT IGNORE INTO professionals
 (id, user_id, service_id, bio, experience_years, starting_price, service_area, city, pincode, availability_status, verification_status) VALUES
 (1, 5, 1, 'Demo profile. Home wiring, fan and switchboard repairs.',        8, 299, 'Rohini, Pitampura, Shalimar Bagh', 'Delhi', '110085', 'available', 'approved'),
 (2, 6, 3, 'Demo profile. AC servicing, gas filling and installation.',      6, 499, 'Dwarka, Uttam Nagar, Janakpuri',   'Delhi', '110075', 'available', 'approved'),
 (3, 7, 2, 'Demo profile. Leakage, tap and bathroom fitting specialist.',   10, 199, 'Pitampura, Rohini, Saraswati Vihar','Delhi','110034', 'available', 'approved'),
 (4, 8, 4, 'Demo profile. Furniture repair, doors and modular work.',        7, 349, 'Janakpuri, Vikaspuri, Tilak Nagar', 'Delhi', '110058', 'busy',      'approved'),
 (5, 9, 6, 'Demo profile (pending admin approval). RO service and filters.', 4, 299, 'Laxmi Nagar, Preet Vihar',          'Delhi', '110092', 'available', 'pending');

-- Demo bookings: 4 completed (with reviews) + 1 pending phone-source booking
INSERT IGNORE INTO bookings
 (id, customer_id, professional_id, service_id, address, locality, city, pincode, preferred_date, preferred_time,
  problem_description, estimated_price, final_price, status, contact_phone, booking_source) VALUES
 (1, 2, 1, 1, 'Flat 12, Sector 23, Rohini', 'Rohini',    'Delhi', '110085', DATE_SUB(CURDATE(), INTERVAL 20 DAY), '9 AM – 12 PM', 'Fan not working',        299, 349,  'completed', '9000000002', 'web'),
 (2, 3, 2, 3, 'B-45, Sector 12, Dwarka',    'Dwarka',    'Delhi', '110075', DATE_SUB(CURDATE(), INTERVAL 15 DAY), '12 PM – 3 PM', 'AC water leakage',      499, 499,  'completed', '9000000003', 'web'),
 (3, 4, 3, 2, 'C-Block, Janakpuri',         'Janakpuri', 'Delhi', '110058', DATE_SUB(CURDATE(), INTERVAL 10 DAY), '3 PM – 6 PM',  'Kitchen tap leaking',   199, 249,  'completed', '9000000004', 'web'),
 (4, 2, 3, 2, 'Flat 12, Sector 23, Rohini', 'Rohini',    'Delhi', '110085', DATE_SUB(CURDATE(), INTERVAL 5 DAY),  '9 AM – 12 PM', 'Bathroom pipe seepage',  199, 299,  'completed', '9000000002', 'web'),
 (5, 3, 1, 1, 'B-45, Sector 12, Dwarka',    'Dwarka',    'Delhi', '110075', DATE_ADD(CURDATE(), INTERVAL 3 DAY),  '9 AM – 12 PM', 'Switchboard sparking',  299, NULL, 'pending',   '9000000003', 'phone');

INSERT IGNORE INTO reviews (id, booking_id, customer_id, professional_id, rating, review) VALUES
 (1, 1, 2, 1, 5, 'Electrician same day mil gaya aur kaam bhi properly kiya. (demo review)'),
 (2, 2, 3, 2, 5, 'AC service ka price pehle hi pata tha, koi extra charge nahi. (demo review)'),
 (3, 3, 4, 3, 5, 'Leakage ek visit mein theek ho gayi. (demo review)'),
 (4, 4, 2, 3, 4, 'Kaam achha tha, thoda late aaye. (demo review)');

-- Keep the denormalised counters consistent with the seeded rows above
UPDATE professionals p SET
  p.rating         = COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.professional_id = p.id), 0),
  p.total_reviews  = (SELECT COUNT(*) FROM reviews r WHERE r.professional_id = p.id),
  p.completed_jobs = (SELECT COUNT(*) FROM bookings b WHERE b.professional_id = p.id AND b.status = 'completed');
