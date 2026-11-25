SCHEMA = """
CREATE TABLE IF NOT EXISTS billing_accounts (
 user_id BIGINT PRIMARY KEY, trials_remaining INT NOT NULL,
 FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS billing_plans (
 id VARCHAR(32) CHARACTER SET ascii PRIMARY KEY, data JSON NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS billing_orders (
 id VARCHAR(48) CHARACTER SET ascii PRIMARY KEY, user_id BIGINT NOT NULL,
 request_id VARCHAR(80) CHARACTER SET ascii NOT NULL, plan JSON NOT NULL,
 amount_fen BIGINT NOT NULL, status VARCHAR(16) NOT NULL,
 receipt VARCHAR(128) COLLATE utf8mb4_bin UNIQUE,
 refund_receipt VARCHAR(128) COLLATE utf8mb4_bin UNIQUE,
 confirmed_by BIGINT, created_at DOUBLE NOT NULL, paid_at DOUBLE,
 UNIQUE KEY billing_order_request(user_id, request_id),
 FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS billing_grants (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL,
 source_id VARCHAR(128) CHARACTER SET ascii NOT NULL UNIQUE,
 kind VARCHAR(16) NOT NULL, conversation_seconds INT NOT NULL,
 video_seconds INT NOT NULL, max_session_seconds INT NOT NULL,
 expires_at DOUBLE NOT NULL, note VARCHAR(255) NOT NULL DEFAULT '',
 granted_by BIGINT,
 INDEX billing_grant_user(user_id, expires_at),
 FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS billing_reservations (
 id VARCHAR(80) CHARACTER SET ascii PRIMARY KEY, user_id BIGINT NOT NULL,
 kind VARCHAR(16) NOT NULL, model VARCHAR(80) NOT NULL,
 seconds INT NOT NULL, allocations JSON NOT NULL, trial BOOLEAN NOT NULL,
 state VARCHAR(16) NOT NULL, created_at DOUBLE NOT NULL,
 started_at DOUBLE NOT NULL DEFAULT 0, expires_at DOUBLE NOT NULL,
 used_seconds INT NOT NULL DEFAULT 0,
 INDEX billing_reservation_user(user_id, state),
 FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS billing_usage (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL,
 resource_id VARCHAR(80) CHARACTER SET ascii NOT NULL,
 category VARCHAR(16) NOT NULL, model VARCHAR(160) NOT NULL,
 quantities JSON NOT NULL, measured BOOLEAN NOT NULL,
 cost_fen DECIMAL(20,8), created_at DOUBLE NOT NULL,
 INDEX billing_usage_user(user_id, created_at),
 FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""
