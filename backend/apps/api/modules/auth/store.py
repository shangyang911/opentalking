from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor

from opentalking.core.identity import Identity
from apps.api.modules.auth.schema import SCHEMA


class AuthError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def password_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return f"scrypt${salt}${digest.hex()}"


def check_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt, expected = encoded.split("$")
        if algorithm != "scrypt":
            return False
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


class _Transaction:
    """Own all cursors for one short database transaction."""

    def __init__(self, connection):
        self.connection = connection
        self.cursors = []

    def execute(self, sql: str, parameters=None):
        cursor = self.connection.cursor()
        self.cursors.append(cursor)
        cursor.execute(sql, parameters)
        return cursor

    def close(self):
        for cursor in self.cursors:
            cursor.close()


class AuthStore:
    def __init__(self, settings):
        self.settings = settings
        self._ready = False
        self._lock = threading.Lock()

    def _open(self):
        if not getattr(self.settings, "mysql_user", ""):
            raise AuthError("数据库尚未配置，请联系管理员。", 503)
        return pymysql.connect(
            host=self.settings.mysql_host, port=self.settings.mysql_port,
            user=self.settings.mysql_user, password=self.settings.mysql_password,
            database=self.settings.mysql_database, charset="utf8mb4",
            cursorclass=DictCursor, connect_timeout=5, read_timeout=10,
            write_timeout=10, autocommit=False,
        )

    def initialize(self) -> None:
        with self._lock:
            if self._ready:
                return
            connection = self._open()
            try:
                with connection.cursor() as cursor:
                    # MySQL DDL commits implicitly; a named lock protects multi-worker startup.
                    lock_name = "opentalking_auth_" + hashlib.sha256(self.settings.mysql_database.encode()).hexdigest()[:32]
                    cursor.execute("SELECT GET_LOCK(%s, 10) AS acquired", (lock_name,))
                    if cursor.fetchone()["acquired"] != 1:
                        raise AuthError("数据库正在初始化，请稍后重试。", 503)
                    try:
                        schema = SCHEMA
                        if getattr(self.settings, 'billing_enabled', False):
                            from apps.api.modules.billing.schema import SCHEMA as BILLING_SCHEMA
                            schema += BILLING_SCHEMA
                        for statement in schema.split(";"):
                            if statement.strip():
                                cursor.execute(statement)
                        cursor.execute("INSERT IGNORE INTO auth_users(id, role) VALUES(1, 'admin')")
                        cursor.execute("INSERT IGNORE INTO auth_mutex VALUES(1)")
                        cursor.execute("INSERT IGNORE INTO auth_meta VALUES('otp_secret', %s)", (secrets.token_hex(32),))
                        connection.commit()
                    finally:
                        cursor.execute("SELECT RELEASE_LOCK(%s)", (lock_name,))
                self._ready = True
            finally:
                connection.close()

    @contextmanager
    def connect(self):
        self.initialize()
        connection = self._open()
        db = _Transaction(connection)
        try:
            yield db
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            db.close()
            connection.close()

    def provision_admin(self, username: str, password: str, *, replace: bool = False) -> None:
        if not username.strip() or len(username) > 80 or not 6 <= len(password) <= 128:
            raise ValueError("管理员账号需为 1～80 个字符，密码需为 6～128 个字符。")
        with self.connect() as db:
            db.execute("SELECT id FROM auth_mutex WHERE id=1 FOR UPDATE")
            existing = db.execute("SELECT * FROM auth_users WHERE id = 1").fetchone()
            if existing["password_hash"] and not replace:
                return
            db.execute("UPDATE auth_users SET username=%s, password_hash=%s, created_at=%s WHERE id=1",
                       (username, password_hash(password), time.time()))
            if replace:
                db.execute("DELETE FROM auth_sessions WHERE user_id=1")

    def bootstrap(self, settings) -> None:
        username = getattr(settings, "admin_username", "")
        password = getattr(settings, "admin_password", "")
        if username and password:
            self.provision_admin(username, password)

    @staticmethod
    def _limit(db, bucket: str, maximum: int, seconds: int) -> None:
        now = time.time()
        row = db.execute("SELECT * FROM auth_limits WHERE bucket=%s", (bucket,)).fetchone()
        if row and row["resets_at"] > now:
            if row["count"] >= maximum:
                raise AuthError("操作过于频繁，请稍后重试。", 429)
            db.execute("UPDATE auth_limits SET count=count+1 WHERE bucket=%s", (bucket,))
        else:
            db.execute("REPLACE INTO auth_limits VALUES(%s, 1, %s)", (bucket, now + seconds))

    def prepare_code(self, phone: str, ip: str, daily_limit: int) -> tuple[str, str]:
        code, nonce = f"{secrets.randbelow(1000000):06d}", secrets.token_hex(16)
        with self.connect() as db:
            db.execute("SELECT id FROM auth_mutex WHERE id=1 FOR UPDATE")
            self._limit(db, f"cooldown:{phone}", 1, 60)
            self._limit(db, f"phone:{phone}", 10, 86400)
            self._limit(db, f"sms-ip:{ip}", 10, 600)
            self._limit(db, "sms-global", daily_limit, 86400)
            secret = db.execute("SELECT value FROM auth_meta WHERE name='otp_secret'").fetchone()["value"]
            digest = hmac.new(secret.encode(), f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()
            db.execute("REPLACE INTO auth_codes VALUES(%s, %s, %s, %s, 0, 0)",
                       (phone, digest, nonce, time.time() + 300))
            db.execute("DELETE FROM auth_sessions WHERE expires_at < %s", (time.time(),))
            db.execute("DELETE FROM auth_limits WHERE resets_at < %s", (time.time(),))
        return code, nonce

    def activate_code(self, phone: str, nonce: str) -> None:
        with self.connect() as db:
            db.execute("UPDATE auth_codes SET active=1 WHERE phone=%s AND nonce=%s", (phone, nonce))

    @staticmethod
    def _identity(row) -> Identity:
        return Identity(id=row["id"], role=row["role"], phone=row["phone"], username=row["username"])

    @staticmethod
    def _new_session(db, user_id: int, hours: int) -> str:
        token = secrets.token_urlsafe(32)
        db.execute("INSERT INTO auth_sessions VALUES(%s, %s, %s)",
                   (hashlib.sha256(token.encode()).hexdigest(), user_id, time.time() + hours * 3600))
        return token

    def phone_login(self, phone: str, code: str, hours: int, password: str) -> tuple[Identity, str]:
        if not 6 <= len(password) <= 128:
            raise AuthError("密码需为 6～128 个字符。", 422)
        result = None
        already_registered = False
        with self.connect() as db:
            db.execute("SELECT id FROM auth_mutex WHERE id=1 FOR UPDATE")
            row = db.execute("SELECT * FROM auth_codes WHERE phone=%s", (phone,)).fetchone()
            if row and row["active"] and row["expires_at"] > time.time() and row["attempts"] < 5:
                secret = db.execute("SELECT value FROM auth_meta WHERE name='otp_secret'").fetchone()["value"]
                digest = hmac.new(secret.encode(), f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()
                if hmac.compare_digest(digest, row["digest"]):
                    db.execute("DELETE FROM auth_codes WHERE phone=%s", (phone,))
                    user = db.execute("SELECT * FROM auth_users WHERE phone=%s", (phone,)).fetchone()
                    if user and (user["role"] != "user" or user["password_hash"]):
                        already_registered = True
                    else:
                        encoded = password_hash(password)
                        if user:
                            db.execute("UPDATE auth_users SET password_hash=%s WHERE id=%s", (encoded, user["id"]))
                            db.execute("DELETE FROM auth_sessions WHERE user_id=%s", (user["id"],))
                        else:
                            db.execute("INSERT INTO auth_users(role, phone, password_hash, created_at) VALUES('user', %s, %s, %s)", (phone, encoded, time.time()))
                            user = db.execute("SELECT * FROM auth_users WHERE phone=%s", (phone,)).fetchone()
                        result = self._identity(user), self._new_session(db, user["id"], hours)
                else:
                    db.execute("UPDATE auth_codes SET attempts=attempts+1 WHERE phone=%s", (phone,))
        # Raise after committing failed-attempt counters.
        if already_registered:
            raise AuthError("该手机号已注册，请使用账号密码登录。", 409)
        if result is None:
            raise AuthError("验证码错误或已失效，请重新获取。")
        return result

    def admin_login(self, username: str, password: str, ip: str, hours: int) -> tuple[Identity, str]:
        return self._password_login(username, password, ip, hours, "admin")

    def user_login(self, phone: str, password: str, ip: str, hours: int) -> tuple[Identity, str]:
        return self._password_login(phone, password, ip, hours, "user")

    def _password_login(self, username: str, password: str, ip: str, hours: int, role: str) -> tuple[Identity, str]:
        with self.connect() as db:
            db.execute("SELECT id FROM auth_mutex WHERE id=1 FOR UPDATE")
            self._limit(db, f"{role}-ip:{ip}", 10, 900)
            self._limit(db, f"{role}-name:{username}", 10, 900)
        with self.connect() as db:
            column = "phone" if role == "user" else "username"
            row = db.execute(f"SELECT * FROM auth_users WHERE role=%s AND {column}=%s FOR UPDATE", (role, username)).fetchone()
            # Perform an equally expensive check for unknown usernames.
            encoded = row["password_hash"] if row else "scrypt$00000000000000000000000000000000$" + "0" * 128
            if not check_password(password, encoded or ""):
                raise AuthError("账号或密码错误。", 401)
            return self._identity(row), self._new_session(db, row["id"], hours)

    def resolve(self, token: str | None) -> Identity | None:
        if not token or len(token) > 200:
            return None
        with self.connect() as db:
            row = db.execute("SELECT u.* FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.digest=%s AND s.expires_at>%s",
                             (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
            return self._identity(row) if row else None

    def logout(self, token: str | None) -> None:
        if token:
            with self.connect() as db:
                db.execute("DELETE FROM auth_sessions WHERE digest=%s", (hashlib.sha256(token.encode()).hexdigest(),))

    def overview(self) -> dict:
        with self.connect() as db:
            count = db.execute("SELECT COUNT(*) AS total FROM auth_users WHERE role='user'").fetchone()["total"]
            today = db.execute("SELECT COUNT(*) AS total FROM auth_users WHERE role='user' AND created_at>=%s", (time.time() - 86400,)).fetchone()["total"]
        return {"user_count": count, "new_users_24h": today,
                "revenue": {"status": "not_connected", "amount_fen": None, "currency": "CNY"}}
