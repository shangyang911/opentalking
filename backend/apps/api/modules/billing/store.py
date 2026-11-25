from __future__ import annotations

import json
import math
import time
import uuid
from contextlib import contextmanager
from decimal import Decimal

import pymysql

from apps.api.modules.auth.store import AuthError


def decoded(value):
    return json.loads(value) if isinstance(value, (str, bytes)) else value


class BillingStore:
    def __init__(self, auth):
        self.auth, self.settings = auth, auth.settings

    @property
    def payment_mode(self):
        return 'demo' if getattr(self.settings, 'billing_demo_enabled', False) else 'manual'

    def _check_order_mode(self, row, demo):
        if demo and self.payment_mode != 'demo':
            raise AuthError('会员演示模式未启用。', 409)
        if (decoded(row['plan']).get('payment_mode') == 'demo') != demo:
            raise AuthError('演示订单与实际收款订单不能混用。', 409)

    @contextmanager
    def connect(self):
        with self.auth.connect() as db:
            # Refresh each post-lock read; a pre-lock repeatable-read snapshot
            # must never decide whether another task/order exists.
            db.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
            yield db

    def _account(self, db, uid):
        user = db.execute(
            "SELECT id FROM auth_users WHERE id=%s AND role='user' FOR UPDATE", (uid,)
        ).fetchone()
        if not user:
            raise AuthError("用户不存在。", 404)
        db.execute(
            "INSERT IGNORE INTO billing_accounts VALUES(%s,%s)",
            (uid, getattr(self.settings, "billing_trial_count", 2)),
        )
        db.execute(
            "SELECT user_id FROM billing_accounts WHERE user_id=%s FOR UPDATE", (uid,)
        ).fetchone()
        db.execute(
            "INSERT IGNORE INTO billing_grants(user_id,source_id,kind,conversation_seconds,video_seconds,max_session_seconds,expires_at) VALUES(%s,%s,'free',%s,0,60,%s)",
            (uid, f"free:{uid}", getattr(self.settings, "billing_free_seconds", 180), 32503680000),
        )
        expired = db.execute(
            "SELECT * FROM billing_reservations WHERE user_id=%s AND state IN ('reserved','running') AND expires_at<=%s FOR UPDATE",
            (uid, time.time()),
        ).fetchall()
        for row in expired:
            self._finish(db, row, row["seconds"] if row["started_at"] else 0)

    def _grants(self, db, uid, *, demo=None):
        grants = db.execute(
            "SELECT g.*,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.plan,'$.payment_mode')),'manual') AS payment_mode, "
            "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.plan,'$.unlimited')),'false')='true' AS unlimited "
            "FROM billing_grants g LEFT JOIN billing_orders o ON o.id=g.source_id "
            "WHERE g.user_id=%s AND g.expires_at>%s ORDER BY g.expires_at,g.id",
            (uid, time.time()),
        ).fetchall()
        if demo is not None:
            mode = 'demo' if demo else 'manual'
            grants = [g for g in grants if g['payment_mode'] == mode or g['kind'] in ('free', 'gift')]
        elif self.payment_mode != 'demo':
            grants = [g for g in grants if g['payment_mode'] != 'demo']
        vip = any(g["kind"] == "vip" for g in grants)
        return [g for g in grants if g["kind"] != "pack" or vip]

    def account(self, uid):
        with self.connect() as db:
            self._account(db, uid)
            grants = self._grants(db, uid)
            trials = db.execute(
                "SELECT trials_remaining FROM billing_accounts WHERE user_id=%s", (uid,)
            ).fetchone()["trials_remaining"]
            active = db.execute(
                "SELECT id,kind,seconds,state,started_at,expires_at,allocations FROM billing_reservations WHERE user_id=%s AND state IN ('reserved','running')",
                (uid,),
            ).fetchone()
        vip_until = max((g["expires_at"] for g in grants if g["kind"] == "vip"), default=0)
        unlimited_until = max(
            (g['expires_at'] for g in grants if g['kind'] == 'vip' and g['unlimited']), default=0
        )
        if active:
            allocation = decoded(active.pop('allocations'))
            active['unlimited'] = bool(allocation) and all(amount == 0 for _, amount in allocation)
        return dict(
            vip=vip_until > time.time(),
            vip_until=vip_until or None,
            unlimited=unlimited_until > time.time(),
            unlimited_until=unlimited_until or None,
            trials_remaining=trials,
            trial_seconds=getattr(self.settings, "billing_trial_seconds", 60),
            conversation_seconds=sum(g["conversation_seconds"] for g in grants),
            quicktalk_seconds=sum(g["conversation_seconds"] for g in grants if g["kind"] != "free"),
            video_seconds=sum(g["video_seconds"] for g in grants),
            max_session_seconds=max((g["max_session_seconds"] for g in grants), default=60),
            active=active,
            grants=[dict(id=g['id'], kind=g['kind'], conversation_seconds=g['conversation_seconds'],
                         video_seconds=g['video_seconds'], expires_at=g['expires_at'],
                         unlimited=bool(g['kind'] == 'vip' and g['unlimited'])) for g in grants],
        )

    def plans(self, all_plans=False):
        with self.connect() as db:
            for kind, name in [("vip", "VIP 月度套餐"), ("pack", "用量加量包")]:
                data = dict(
                    id=kind,
                    name=name,
                    kind=kind,
                    price_fen=0,
                    conversation_seconds=0,
                    video_seconds=0,
                    max_session_seconds=60,
                    valid_days=30,
                    active=False,
                )
                db.execute(
                    "INSERT IGNORE INTO billing_plans VALUES(%s,%s)",
                    (kind, json.dumps(data, ensure_ascii=False)),
                )
            rows = db.execute("SELECT data FROM billing_plans ORDER BY id").fetchall()
        plans = [decoded(r["data"]) for r in rows]
        return [p for p in plans if all_plans or p["active"]]

    def save_plan(self, plan_id, data):
        data = dict(data, id=plan_id)
        if data['kind'] == 'vip' and data['valid_days'] != 30:
            raise AuthError('VIP 月度套餐有效期固定为 30 天。', 422)
        if plan_id not in ("vip", "pack") or data["kind"] != plan_id:
            raise AuthError("套餐类型不匹配。", 422)
        if data.get('unlimited') and plan_id != 'vip':
            raise AuthError('仅月度 VIP 支持有效期内不限总使用时长。', 422)
        if data["active"] and (
            data["price_fen"] <= 0 or (
                not data.get('unlimited') and data["conversation_seconds"] + data["video_seconds"] <= 0
            )
        ):
            raise AuthError("上架套餐需设置正数价格，并设置使用额度或月度不限时长权益。", 422)
        with self.connect() as db:
            db.execute(
                "REPLACE INTO billing_plans VALUES(%s,%s)",
                (plan_id, json.dumps(data, ensure_ascii=False)),
            )
        return data

    def create_order(self, uid, plan_id, request_id):
        self.plans()
        with self.connect() as db:
            self._account(db, uid)
            old = db.execute(
                "SELECT * FROM billing_orders WHERE user_id=%s AND request_id=%s", (uid, request_id)
            ).fetchone()
            if old:
                self._check_order_mode(old, self.payment_mode == 'demo')
                if decoded(old["plan"])["id"] != plan_id:
                    raise AuthError("该请求编号已用于其他套餐。", 409)
                return self._order(old)
            row = db.execute("SELECT data FROM billing_plans WHERE id=%s", (plan_id,)).fetchone()
            plan = decoded(row["data"]) if row else None
            if not plan or not plan["active"]:
                raise AuthError("套餐尚未上架，请联系管理员。", 409)
            if self.payment_mode == 'demo':
                plan = dict(plan, payment_mode='demo')
            if plan["kind"] == "pack" and not any(
                g["kind"] == "vip" for g in self._grants(db, uid)
            ):
                raise AuthError("加量包需要有效 VIP，请先开通 VIP。", 409)
            pending = db.execute(
                "SELECT COUNT(*) AS n FROM billing_orders WHERE user_id=%s AND status IN ('pending','demo_submitted')",
                (uid,),
            ).fetchone()["n"]
            if pending >= 5:
                raise AuthError("待确认订单过多，请先取消或联系管理员核实。", 409)
            oid = "ord_" + uuid.uuid4().hex
            db.execute(
                "INSERT INTO billing_orders(id,user_id,request_id,plan,amount_fen,status,created_at) VALUES(%s,%s,%s,%s,%s,'pending',%s)",
                (
                    oid,
                    uid,
                    request_id,
                    json.dumps(plan, ensure_ascii=False),
                    plan["price_fen"],
                    time.time(),
                ),
            )
            return self._order(
                db.execute("SELECT * FROM billing_orders WHERE id=%s", (oid,)).fetchone()
            )

    @staticmethod
    def _order(row):
        return dict(row, plan=decoded(row["plan"]))

    def orders(self, uid=None, before=None):
        with self.connect() as db:
            clauses, args = [], []
            if uid is not None:
                clauses.append("o.user_id=%s")
                args.append(uid)
            if before is not None:
                clauses.append("o.created_at<%s")
                args.append(before)
            where = " WHERE " + " AND ".join(clauses) if clauses else ""
            rows = db.execute(
                "SELECT o.*,u.phone FROM billing_orders o JOIN auth_users u ON u.id=o.user_id"
                + where
                + " ORDER BY o.created_at DESC LIMIT 100",
                args,
            ).fetchall()
        # Receipt references are administrative audit data.
        if uid is not None:
            for row in rows:
                for key in ("receipt", "refund_receipt", "confirmed_by", "phone"):
                    row.pop(key, None)
        return [self._order(r) for r in rows]

    def _locked_order(self, db, oid):
        row = db.execute("SELECT * FROM billing_orders WHERE id=%s", (oid,)).fetchone()
        if not row:
            raise AuthError("订单不存在。", 404)
        self._account(db, row["user_id"])
        return db.execute("SELECT * FROM billing_orders WHERE id=%s FOR UPDATE", (oid,)).fetchone()

    def submit_demo_payment(self, oid, uid):
        if self.payment_mode != 'demo':
            raise AuthError('会员演示模式未启用。', 409)
        with self.connect() as db:
            row = self._locked_order(db, oid)
            if row['user_id'] != uid:
                raise AuthError('订单不存在。', 404)
            self._check_order_mode(row, True)
            if row['status'] not in ('pending', 'demo_submitted'):
                raise AuthError('当前订单不能模拟付款。', 409)
            db.execute("UPDATE billing_orders SET status='demo_submitted' WHERE id=%s", (oid,))
            return self._order(dict(row, status='demo_submitted'))

    def confirm(self, oid, admin_id, receipt, *, demo=False):
        receipt = receipt.strip()
        if not receipt:
            raise AuthError("请填写核实到账的收款流水号。", 422)
        try:
            with self.connect() as db:
                row = self._locked_order(db, oid)
                self._check_order_mode(row, demo)
                if row["status"] == "paid" and row["receipt"] == receipt:
                    return self._order(row)
                if row["status"] != ('demo_submitted' if demo else 'pending'):
                    raise AuthError("订单状态已变化，不能确认到账。", 409)
                plan = decoded(row["plan"])
                grants = self._grants(
                    db, row["user_id"], demo=None if demo and plan['kind'] == 'pack' else demo
                )
                vip_until = max(
                    (g["expires_at"] for g in grants if g["kind"] == "vip"), default=time.time()
                )
                if plan["kind"] == "pack" and vip_until <= time.time():
                    raise AuthError("VIP 已到期，请先开通 VIP 再确认加量包。", 409)
                expiry = (
                    max(time.time(), vip_until) + plan["valid_days"] * 86400
                    if plan["kind"] == "vip"
                    else min(vip_until, time.time() + plan["valid_days"] * 86400)
                )
                db.execute(
                    "UPDATE billing_orders SET status='paid',receipt=%s,confirmed_by=%s,paid_at=%s WHERE id=%s",
                    (receipt, admin_id, time.time(), oid),
                )
                db.execute(
                    "INSERT INTO billing_grants(user_id,source_id,kind,conversation_seconds,video_seconds,max_session_seconds,expires_at,granted_by) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        row["user_id"],
                        oid,
                        plan["kind"],
                        plan["conversation_seconds"],
                        plan["video_seconds"],
                        plan["max_session_seconds"],
                        expiry,
                        admin_id,
                    ),
                )
                return self._order(
                    db.execute("SELECT * FROM billing_orders WHERE id=%s", (oid,)).fetchone()
                )
        except pymysql.IntegrityError as exc:
            raise AuthError("收款流水号已用于其他订单。", 409) from exc

    def cancel(self, oid, uid):
        with self.connect() as db:
            row = self._locked_order(db, oid)
            if row["user_id"] != uid:
                raise AuthError("订单不存在。", 404)
            if row["status"] not in ("pending", "demo_submitted", "cancelled"):
                raise AuthError("仅待确认订单可以取消。", 409)
            db.execute("UPDATE billing_orders SET status='cancelled' WHERE id=%s", (oid,))

    def refund(self, oid, admin_id, receipt, *, demo=False):
        try:
            with self.connect() as db:
                row = self._locked_order(db, oid)
                self._check_order_mode(row, demo)
                if row["status"] == "refunded" and row["refund_receipt"] == receipt:
                    return
                if row["status"] != "paid":
                    raise AuthError("仅已到账订单可以登记全额退款。", 409)
                active = db.execute(
                    "SELECT id FROM billing_reservations WHERE user_id=%s AND state IN ('reserved','running')",
                    (row["user_id"],),
                ).fetchone()
                if active:
                    raise AuthError("请等待用户当前任务结束后再登记退款。", 409)
                db.execute(
                    "UPDATE billing_orders SET status='refunded',refund_receipt=%s,confirmed_by=%s WHERE id=%s",
                    (receipt, admin_id, oid),
                )
                db.execute(
                    "UPDATE billing_grants SET expires_at=0,conversation_seconds=0,video_seconds=0 WHERE source_id=%s",
                    (oid,),
                )
                # Rebuild renewal validity from paid orders so refunding an
                # earlier month cannot leave a later renewal with free months.
                renewals = db.execute(
                    "SELECT id,plan,paid_at FROM billing_orders WHERE user_id=%s AND status='paid' "
                    "AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(plan,'$.payment_mode')),'manual')=%s ORDER BY paid_at,id",
                    (row["user_id"], 'demo' if demo else 'manual'),
                ).fetchall()
                until = 0
                for renewal in renewals:
                    plan = decoded(renewal["plan"])
                    if plan["kind"] == "vip":
                        until = max(until, renewal["paid_at"]) + plan["valid_days"] * 86400
                        db.execute(
                            "UPDATE billing_grants SET expires_at=%s WHERE source_id=%s",
                            (until, renewal["id"]),
                        )
                if demo:
                    # Real VIP also qualifies for demo packs, without extending real VIP.
                    until = max(until, max(
                        (g['expires_at'] for g in self._grants(db, row['user_id'], demo=False)
                         if g['kind'] == 'vip'), default=0,
                    ))
                db.execute(
                    "UPDATE billing_grants g JOIN billing_orders o ON o.id=g.source_id "
                    "SET g.expires_at=LEAST(g.expires_at,%s) WHERE g.user_id=%s AND g.kind='pack' "
                    "AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.plan,'$.payment_mode')),'manual')=%s",
                    (until, row["user_id"], 'demo' if demo else 'manual'),
                )
        except pymysql.IntegrityError as exc:
            raise AuthError("退款流水号已使用。", 409) from exc

    def gift(self, uid, admin_id, conversation, video, days, note, request_id):
        with self.connect() as db:
            self._account(db, uid)
            db.execute(
                "INSERT IGNORE INTO billing_grants(user_id,source_id,kind,conversation_seconds,video_seconds,max_session_seconds,expires_at,note,granted_by) VALUES(%s,%s,'gift',%s,%s,300,%s,%s,%s)",
                (
                    uid,
                    f"gift:{admin_id}:{request_id}",
                    conversation,
                    video,
                    time.time() + days * 86400,
                    note,
                    admin_id,
                ),
            )

    def reserve(self, uid, resource_id, kind, model, max_seconds=None):
        with self.connect() as db:
            self._account(db, uid)
            if db.execute(
                "SELECT id FROM billing_reservations WHERE user_id=%s AND state IN ('reserved','running')",
                (uid,),
            ).fetchone():
                raise AuthError("已有进行中的任务，请先结束当前任务。", 409)
            grants = self._grants(db, uid)
            vip = any(g["kind"] == "vip" for g in grants)
            unlimited = [g for g in grants if g['kind'] == 'vip' and g['unlimited']]
            trials = db.execute(
                "SELECT trials_remaining FROM billing_accounts WHERE user_id=%s", (uid,)
            ).fetchone()["trials_remaining"]
            paid = [g for g in grants if g["kind"] != "free"]
            trial = (
                kind == "conversation"
                and model == "quicktalk"
                and not vip
                and not any(g["conversation_seconds"] > 0 for g in paid)
            )
            allocations = []
            if unlimited:
                grant = max(unlimited, key=lambda g: g['expires_at'])
                cap = (
                    getattr(self.settings, 'billing_video_max_seconds', 60) if kind == 'video'
                    else max(g['max_session_seconds'] for g in unlimited)
                )
                if max_seconds is not None:
                    cap = min(cap, max_seconds)
                seconds = min(cap, max(0, math.floor(grant['expires_at'] - time.time())))
                if seconds <= 0:
                    raise AuthError('VIP 即将到期，请续费后重试。', 402)
                # Retain the funding grant for expiry/demo checks without reserving a balance.
                allocations = [[grant['id'], 0]]
            elif trial:
                if trials <= 0:
                    raise AuthError("QuickTalk 体验额度已用完，请开通 VIP 或联系管理员。", 402)
                seconds = getattr(self.settings, "billing_trial_seconds", 60)
                db.execute(
                    "UPDATE billing_accounts SET trials_remaining=trials_remaining-1 WHERE user_id=%s",
                    (uid,),
                )
            else:
                eligible = paid if model == "quicktalk" else grants
                column = "video_seconds" if kind == "video" else "conversation_seconds"
                cap = (
                    getattr(self.settings, "billing_video_max_seconds", 60)
                    if kind == "video"
                    else max(
                        (g["max_session_seconds"] for g in eligible if g[column] > 0), default=60
                    )
                )
                if max_seconds is not None:
                    cap = min(cap, max_seconds)
                seconds = min(cap, sum(g[column] for g in eligible))
                if seconds <= 0:
                    raise AuthError("可用额度不足，请开通 VIP、购买加量包或联系管理员。", 402)
                remaining = seconds
                for grant in eligible:
                    amount = min(
                        remaining,
                        grant[column],
                        max(0, math.floor(grant["expires_at"] - time.time())),
                    )
                    if amount:
                        db.execute(
                            f"UPDATE billing_grants SET {column}={column}-%s WHERE id=%s",
                            (amount, grant["id"]),
                        )
                        allocations.append([grant["id"], amount])
                        remaining -= amount
                seconds -= remaining
                if not seconds:
                    raise AuthError("额度即将到期，请重新开通。", 402)
            expires = time.time() + 600
            db.execute(
                "INSERT INTO billing_reservations(id,user_id,kind,model,seconds,allocations,trial,state,created_at,expires_at) VALUES(%s,%s,%s,%s,%s,%s,%s,'reserved',%s,%s)",
                (
                    resource_id,
                    uid,
                    kind,
                    model,
                    seconds,
                    json.dumps(allocations),
                    trial,
                    time.time(),
                    expires,
                ),
            )
            return dict(id=resource_id, seconds=seconds, expires_at=expires)

    def reservation(self, resource_id):
        with self.connect() as db:
            return db.execute(
                "SELECT * FROM billing_reservations WHERE id=%s", (resource_id,)
            ).fetchone()

    def start(self, resource_id):
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM billing_reservations WHERE id=%s FOR UPDATE", (resource_id,)
            ).fetchone()
            if (
                not row
                or row["state"] not in ("reserved", "running")
                or row["expires_at"] <= time.time()
            ):
                raise AuthError("任务额度已到期，请重新开始。", 402)
            if row["state"] == "reserved":
                expiry = time.time() + (600 if row["kind"] == "video" else row["seconds"])
                ids = [a[0] for a in decoded(row["allocations"])]
                if ids:
                    allocated = db.execute(
                        "SELECT g.expires_at,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.plan,'$.payment_mode')),'manual') AS payment_mode "
                        "FROM billing_grants g LEFT JOIN billing_orders o ON o.id=g.source_id WHERE g.id IN ("
                        + ",".join(["%s"] * len(ids)) + ")", ids,
                    ).fetchall()
                    if self.payment_mode != 'demo' and any(g['payment_mode'] == 'demo' for g in allocated):
                        raise AuthError('演示模式已关闭，请重新开始任务。', 402)
                    expiry = min(expiry, min(g['expires_at'] for g in allocated))
                if expiry <= time.time():
                    raise AuthError("所用额度已到期，请重新开始。", 402)
                db.execute(
                    "UPDATE billing_reservations SET state='running',started_at=%s,expires_at=%s WHERE id=%s",
                    (time.time(), expiry, resource_id),
                )
        return self.reservation(resource_id)

    def limit_action(self, uid, action):
        with self.connect() as db:
            self._account(db, uid)
            if action == "clone":
                grants = self._grants(db, uid)
                if not any(
                    g["kind"] == "vip" or g["kind"] == "gift" and g["conversation_seconds"] > 0
                    for g in grants
                ):
                    raise AuthError("专属声音需要有效 VIP 或管理员赠送的内测权益。", 402)
                self.auth._limit(db, f"billing:{uid}:clone", 3, 86400)
            elif action == "video":
                self.auth._limit(db, f"billing:{uid}:video", 10, 3600)
            else:
                self.auth._limit(db, f"billing:{uid}:{action}", 1, 2)

    @staticmethod
    def _finish(db, row, used):
        used = min(row["seconds"], max(0, math.ceil(used)))
        remaining_used = used
        column = "video_seconds" if row["kind"] == "video" else "conversation_seconds"
        for gid, amount in decoded(row["allocations"]):
            charged = min(amount, remaining_used)
            remaining_used -= charged
            db.execute(
                f"UPDATE billing_grants SET {column}={column}+%s WHERE id=%s AND expires_at>%s",
                (amount - charged, gid, time.time()),
            )
        if row["trial"] and not row["started_at"]:
            db.execute(
                "UPDATE billing_accounts SET trials_remaining=trials_remaining+1 WHERE user_id=%s",
                (row["user_id"],),
            )
        db.execute(
            "UPDATE billing_reservations SET state='finished',used_seconds=%s WHERE id=%s",
            (used, row["id"]),
        )

    def finish(self, resource_id, used=None):
        with self.connect() as db:
            row = db.execute(
                "SELECT user_id FROM billing_reservations WHERE id=%s", (resource_id,)
            ).fetchone()
            if not row:
                return
            db.execute(
                "SELECT user_id FROM billing_accounts WHERE user_id=%s FOR UPDATE",
                (row["user_id"],),
            )
            row = db.execute(
                "SELECT * FROM billing_reservations WHERE id=%s FOR UPDATE", (resource_id,)
            ).fetchone()
            if row["state"] == "finished":
                return
            actual = max(0, time.time() - row["started_at"]) if row["started_at"] else 0
            self._finish(db, row, actual if used is None else used)

    def record_usage(self, uid, resource_id, category, model, quantities, measured):
        rates = getattr(self.settings, "billing_cost_rates", {}).get(f"{category}:{model}")
        cost = None
        if measured and rates is not None:
            if category == "llm" and all(
                k in rates for k in ("input_per_million", "output_per_million")
            ):
                cost = (
                    Decimal(str(quantities.get("input_tokens", 0)))
                    * Decimal(str(rates["input_per_million"]))
                    + Decimal(str(quantities.get("output_tokens", 0)))
                    * Decimal(str(rates["output_per_million"]))
                ) / 10000
            elif category == "tts" and "per_million_chars" in rates:
                cost = (
                    Decimal(str(quantities.get("characters", 0)))
                    * Decimal(str(rates["per_million_chars"]))
                    / 10000
                )
            elif "per_minute" in rates:
                cost = (
                    Decimal(str(quantities.get("seconds", 0)))
                    * Decimal(str(rates["per_minute"]))
                    * 100
                    / 60
                )
        with self.connect() as db:
            db.execute(
                "INSERT INTO billing_usage(user_id,resource_id,category,model,quantities,measured,cost_fen,created_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    uid,
                    resource_id,
                    category,
                    model,
                    json.dumps(quantities),
                    measured,
                    cost,
                    time.time(),
                ),
            )

    def activity(self, uid):
        with self.connect() as db:
            self._account(db, uid)
            rows = list(db.execute(
                'SELECT id,kind,model,seconds,trial,state,created_at,started_at,used_seconds,allocations '
                'FROM billing_reservations WHERE user_id=%s ORDER BY created_at DESC,id DESC LIMIT 100', (uid,),
            ).fetchall())
        for row in rows:
            allocation = decoded(row.pop('allocations'))
            row['unlimited'] = bool(allocation) and all(amount == 0 for _, amount in allocation)
            if row['id'].startswith('aux_'):
                row['kind'] = 'preview' if row['id'].startswith('aux_preview_') else 'clone' if row['id'].startswith('aux_clone_') else 'audio'
        return rows

    def usage(self, uid=None):
        with self.connect() as db:
            where, args = (" WHERE user_id=%s", (uid,)) if uid is not None else ("", ())
            rows = db.execute(
                "SELECT * FROM billing_usage" + where + " ORDER BY id DESC LIMIT 100", args
            ).fetchall()
        return [dict(r, quantities=decoded(r["quantities"])) for r in rows]

    def overview(self):
        with self.connect() as db:
            revenue = db.execute(
                "SELECT COALESCE(SUM(IF(status IN ('paid','refunded'),amount_fen,0)),0) AS paid_fen, COALESCE(SUM(IF(status='refunded',amount_fen,0)),0) AS refund_fen, COUNT(DISTINCT IF(status='paid',user_id,NULL)) AS paying_users FROM billing_orders "
                "WHERE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(plan,'$.payment_mode')),'manual')<>'demo'"
            ).fetchone()
            usage = db.execute(
                "SELECT COUNT(*) AS usage_count, COALESCE(SUM(cost_fen IS NULL),0) AS unknown_cost_count, COALESCE(SUM(cost_fen),0) AS estimated_cost_fen FROM billing_usage"
            ).fetchone()
        return dict(
            status="manual",
            currency="CNY",
            amount_fen=int(revenue["paid_fen"] - revenue["refund_fen"]),
            paid_fen=int(revenue["paid_fen"]),
            refund_fen=int(revenue["refund_fen"]),
            paying_users=revenue["paying_users"],
            usage_count=usage["usage_count"],
            unknown_cost_count=int(usage["unknown_cost_count"]),
            estimated_cost_fen=float(usage["estimated_cost_fen"]),
        )
