"""Additive MySQL 8 schema. Existing business tables are never changed."""

SCHEMA = """
CREATE TABLE IF NOT EXISTS auth_users (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    role VARCHAR(16) NOT NULL,
    phone VARCHAR(11) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
    username VARCHAR(80) COLLATE utf8mb4_bin UNIQUE,
    password_hash VARCHAR(255), created_at DOUBLE NOT NULL DEFAULT 0,
    CONSTRAINT auth_users_role CHECK (role IN ('user', 'admin')),
    INDEX auth_users_created (role, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS auth_sessions (
    digest CHAR(64) CHARACTER SET ascii PRIMARY KEY,
    user_id BIGINT NOT NULL, expires_at DOUBLE NOT NULL,
    INDEX auth_sessions_expiry (expires_at),
    FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS auth_codes (
    phone VARCHAR(11) CHARACTER SET ascii PRIMARY KEY,
    digest CHAR(64) CHARACTER SET ascii NOT NULL,
    nonce CHAR(32) CHARACTER SET ascii NOT NULL,
    expires_at DOUBLE NOT NULL, attempts SMALLINT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS auth_limits (
    bucket VARCHAR(255) COLLATE utf8mb4_bin PRIMARY KEY,
    count INT NOT NULL, resets_at DOUBLE NOT NULL,
    INDEX auth_limits_expiry (resets_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS auth_meta (
    name VARCHAR(64) CHARACTER SET ascii PRIMARY KEY, value VARCHAR(128) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS auth_mutex (id TINYINT PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS auth_profiles (
    user_id BIGINT PRIMARY KEY,
    nickname VARCHAR(30) NOT NULL DEFAULT '',
    signature VARCHAR(120) NOT NULL DEFAULT '',
    avatar MEDIUMBLOB,
    avatar_updated_at DOUBLE NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""
