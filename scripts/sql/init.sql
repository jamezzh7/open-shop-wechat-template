CREATE TABLE IF NOT EXISTS vibe_categories (
  id   INT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  sort INT         NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vibe_products (
  id          VARCHAR(50)  NOT NULL PRIMARY KEY,
  category_id INT          NOT NULL,
  title       VARCHAR(100) NOT NULL,
  description TEXT,
  image       VARCHAR(500),
  sort        INT          NOT NULL DEFAULT 0,
  available   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES vibe_categories(id)
);

CREATE TABLE IF NOT EXISTS vibe_skus (
  id         INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id VARCHAR(50)    NOT NULL,
  name       VARCHAR(100)   NOT NULL DEFAULT '',
  price      DECIMAL(10,2)  NOT NULL,
  stock      INT            NOT NULL DEFAULT -1,
  available  TINYINT(1)     NOT NULL DEFAULT 1,
  sort       INT            NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES vibe_products(id)
);

CREATE TABLE IF NOT EXISTS vibe_product_recommendations (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  _openid     VARCHAR(64)  NOT NULL DEFAULT '',
  category_id INT          NOT NULL,
  product_id  VARCHAR(50)  NOT NULL,
  sort        INT          NOT NULL DEFAULT 0,
  available   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_recommendation_category_product (category_id, product_id),
  INDEX idx_recommendation_category_sort (category_id, available, sort),
  FOREIGN KEY (category_id) REFERENCES vibe_categories(id),
  FOREIGN KEY (product_id) REFERENCES vibe_products(id)
);

CREATE TABLE IF NOT EXISTS vibe_orders (
  id                  VARCHAR(32)   NOT NULL PRIMARY KEY,
  openid              VARCHAR(100)  NOT NULL,
  status              ENUM('pending_payment','paid','preparing','ready','shipped','completed','refunding','refunded') NOT NULL DEFAULT 'pending_payment',
  subtotal            DECIMAL(10,2) NOT NULL,
  shipping_fee        DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount        DECIMAL(10,2) NOT NULL,
  fulfillment_mode    ENUM('pickup','delivery') NOT NULL DEFAULT 'pickup',
  addr_province       VARCHAR(50),
  addr_city           VARCHAR(50),
  addr_district       VARCHAR(50),
  addr_detail         VARCHAR(200),
  addr_phone          VARCHAR(30),
  addr_name           VARCHAR(50),
  remark              VARCHAR(500),
  transaction_id      VARCHAR(100),
  tracking_carrier    VARCHAR(100),
  tracking_carrier_code VARCHAR(50),
  tracking_number     VARCHAR(100),
  auto_completed      TINYINT(1)    NOT NULL DEFAULT 0,
  created_at          DATETIME      NOT NULL,
  paid_at             DATETIME,
  shipped_at          DATETIME,
  completed_at        DATETIME,
  refund_requested_at DATETIME,
  refunded_at         DATETIME,
  merchant_notified_at DATETIME,
  merchant_notify_error VARCHAR(255),
  updated_at          DATETIME,
  INDEX idx_openid  (openid),
  INDEX idx_status  (status),
  INDEX idx_created (created_at)
);

CREATE TABLE IF NOT EXISTS vibe_shipping_rules (
  id                      INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  province                VARCHAR(50)   NOT NULL DEFAULT '',
  city                    VARCHAR(50)   NOT NULL DEFAULT '',
  district                VARCHAR(50)   NOT NULL DEFAULT '',
  shipping_fee            DECIMAL(10,2) NOT NULL DEFAULT 0,
  free_shipping_threshold DECIMAL(10,2),
  enabled                 TINYINT(1)    NOT NULL DEFAULT 1,
  sort                    INT           NOT NULL DEFAULT 0,
  created_at              TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shipping_area (province, city, district),
  INDEX idx_shipping_enabled_sort (enabled, sort)
);

CREATE TABLE IF NOT EXISTS vibe_store_settings (
  setting_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
  _openid       VARCHAR(64)  NOT NULL DEFAULT '',
  setting_value TEXT         NOT NULL,
  created_at    DATETIME     NOT NULL,
  updated_at    DATETIME     NOT NULL
);

CREATE TABLE IF NOT EXISTS vibe_order_items (
  id            INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id      VARCHAR(32)    NOT NULL,
  product_id    VARCHAR(50)    NOT NULL,
  sku_id        INT,
  product_title VARCHAR(100)   NOT NULL,
  sku_name      VARCHAR(100)   NOT NULL DEFAULT '',
  price         DECIMAL(10,2)  NOT NULL,
  quantity      INT            NOT NULL,
  subtotal      DECIMAL(10,2)  NOT NULL,
  FOREIGN KEY (order_id) REFERENCES vibe_orders(id)
);

CREATE TABLE IF NOT EXISTS vibe_order_payments (
  id             VARCHAR(32)    NOT NULL PRIMARY KEY,
  _openid        VARCHAR(64)    NOT NULL DEFAULT '',
  order_id       VARCHAR(32)    NOT NULL,
  amount         DECIMAL(10,2)  NOT NULL,
  status         VARCHAR(20)    NOT NULL DEFAULT 'pending',
  transaction_id VARCHAR(128),
  created_at     DATETIME       NOT NULL,
  paid_at        DATETIME,
  updated_at     DATETIME,
  INDEX idx_vibe_order_payments_order_id (order_id),
  FOREIGN KEY (order_id) REFERENCES vibe_orders(id)
);

CREATE TABLE IF NOT EXISTS vibe_member_wallets (
  openid           VARCHAR(100)   NOT NULL PRIMARY KEY,
  _openid          VARCHAR(64)    NOT NULL DEFAULT '',
  balance          DECIMAL(10,2)  NOT NULL DEFAULT 0,
  total_stored     DECIMAL(10,2)  NOT NULL DEFAULT 0,
  total_bonus      DECIMAL(10,2)  NOT NULL DEFAULT 0,
  total_spent      DECIMAL(10,2)  NOT NULL DEFAULT 0,
  last_recharge_at DATETIME,
  created_at       DATETIME       NOT NULL,
  updated_at       DATETIME       NOT NULL,
  INDEX idx_vibe_member_wallets_openid (openid)
);

CREATE TABLE IF NOT EXISTS vibe_recharge_orders (
  id              VARCHAR(32)    NOT NULL PRIMARY KEY,
  _openid         VARCHAR(64)    NOT NULL DEFAULT '',
  openid          VARCHAR(100)   NOT NULL,
  amount          DECIMAL(10,2)  NOT NULL,
  bonus           DECIMAL(10,2)  NOT NULL DEFAULT 0,
  credited_amount DECIMAL(10,2)  NOT NULL,
  status          VARCHAR(20)    NOT NULL DEFAULT 'pending',
  transaction_id  VARCHAR(128),
  created_at      DATETIME       NOT NULL,
  paid_at         DATETIME,
  updated_at      DATETIME       NOT NULL,
  INDEX idx_vibe_recharge_orders_openid (openid),
  INDEX idx_vibe_recharge_orders_status (status)
);

CREATE TABLE IF NOT EXISTS vibe_wallet_ledger (
  id            INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  _openid       VARCHAR(64)    NOT NULL DEFAULT '',
  openid        VARCHAR(100)   NOT NULL,
  change_type   VARCHAR(32)    NOT NULL,
  amount        DECIMAL(10,2)  NOT NULL,
  balance_after DECIMAL(10,2)  NOT NULL,
  ref_type      VARCHAR(32)    NOT NULL DEFAULT '',
  ref_id        VARCHAR(64)    NOT NULL DEFAULT '',
  note          VARCHAR(255)   NOT NULL DEFAULT '',
  created_at    DATETIME       NOT NULL,
  UNIQUE KEY uniq_vibe_wallet_ledger_ref (ref_type, ref_id),
  INDEX idx_vibe_wallet_ledger_openid_created (openid, created_at),
  INDEX idx_vibe_wallet_ledger_type (change_type)
);

CREATE TABLE IF NOT EXISTS vibe_admins (
  id                         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  openid                     VARCHAR(100) UNIQUE,
  web_uid                    VARCHAR(128) UNIQUE,
  order_notify_enabled       TINYINT(1)   NOT NULL DEFAULT 0,
  order_notify_template_id   VARCHAR(128) NOT NULL DEFAULT '',
  order_notify_subscribed_at DATETIME,
  last_order_notify_at       DATETIME,
  last_order_notify_error    VARCHAR(255),
  created_at                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vibe_admins_web_uid (web_uid)
);
