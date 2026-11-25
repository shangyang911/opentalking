"""Private account profile and password management; all operations use the session owner."""
from __future__ import annotations

import hashlib
import time
import warnings
from io import BytesIO
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, field_validator

from apps.api.modules.auth.session import USER_COOKIE
from apps.api.modules.auth.store import AuthError, check_password, password_hash

router = APIRouter(prefix='/account', tags=['account'])
MAX_AVATAR_BYTES = 2 * 1024 * 1024


def user_id(request: Request) -> int:
    identity = getattr(request.state, 'identity', None)
    if identity is None:
        raise HTTPException(401, '请先登录。')
    if identity.role != 'user':
        raise HTTPException(403, '个人中心仅供用户账号使用。')
    return identity.id


UserId = Annotated[int, Depends(user_id)]


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    nickname: str = Field(max_length=30)
    signature: str = Field(max_length=120)

    @field_validator('nickname', 'signature')
    @classmethod
    def clean_text(cls, value: str) -> str:
        if any(ord(char) < 32 for char in value):
            raise ValueError('资料中不能包含控制字符。')
        return value


class PasswordInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


def profile_payload(request: Request, uid: int) -> dict:
    with request.app.state.auth_store.connect() as db:
        row = db.execute(
            'SELECT u.id,u.phone,u.created_at,COALESCE(p.nickname,\'\') AS nickname,'
            'COALESCE(p.signature,\'\') AS signature,p.avatar_updated_at,'
            'p.avatar IS NOT NULL AS has_avatar FROM auth_users u '
            'LEFT JOIN auth_profiles p ON p.user_id=u.id WHERE u.id=%s', (uid,),
        ).fetchone()
    return dict(id=row['id'], phone=row['phone'], created_at=row['created_at'],
                nickname=row['nickname'], signature=row['signature'],
                avatar_url=f"/account/avatar?v={row['avatar_updated_at']}" if row['has_avatar'] else None)


@router.get('/profile')
def get_profile(request: Request, response: Response, uid: UserId) -> dict:
    response.headers['Cache-Control'] = 'no-store'
    return profile_payload(request, uid)


@router.put('/profile')
def update_profile(payload: ProfileInput, request: Request, uid: UserId) -> dict:
    with request.app.state.auth_store.connect() as db:
        db.execute('INSERT INTO auth_profiles(user_id,nickname,signature) VALUES(%s,%s,%s) '
                   'ON DUPLICATE KEY UPDATE nickname=%s,signature=%s',
                   (uid, payload.nickname, payload.signature, payload.nickname, payload.signature))
    return profile_payload(request, uid)


def normalize_avatar(data: bytes) -> bytes:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in {'JPEG', 'PNG', 'WEBP'} or image.width * image.height > 16_000_000:
                    raise ValueError('invalid image format or dimensions')
                image.load()
                normalized = ImageOps.fit(ImageOps.exif_transpose(image).convert('RGB'), (256, 256))
                # A fresh pixel image prevents metadata from being copied to output.
                clean = Image.new('RGB', normalized.size)
                clean.paste(normalized)
                output = BytesIO()
                clean.save(output, format='WEBP', quality=85)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(400, '请选择有效的 JPG、PNG 或 WebP 图片，图片不得超过 1600 万像素。') from exc


@router.post('/avatar')
def upload_avatar(request: Request, uid: UserId, file: Annotated[UploadFile, File()]) -> dict:
    data = file.file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(413, '头像文件不能超过 2 MB。')
    avatar = normalize_avatar(data)
    updated = time.time()
    with request.app.state.auth_store.connect() as db:
        db.execute('INSERT INTO auth_profiles(user_id,avatar,avatar_updated_at) VALUES(%s,%s,%s) '
                   'ON DUPLICATE KEY UPDATE avatar=%s,avatar_updated_at=%s',
                   (uid, avatar, updated, avatar, updated))
    return profile_payload(request, uid)


@router.get('/avatar')
def get_avatar(request: Request, uid: UserId) -> Response:
    with request.app.state.auth_store.connect() as db:
        row = db.execute('SELECT avatar FROM auth_profiles WHERE user_id=%s', (uid,)).fetchone()
    if not row or row['avatar'] is None:
        raise HTTPException(404, '尚未设置头像。')
    return Response(row['avatar'], media_type='image/webp', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.delete('/avatar')
def remove_avatar(request: Request, uid: UserId) -> dict:
    with request.app.state.auth_store.connect() as db:
        db.execute('UPDATE auth_profiles SET avatar=NULL,avatar_updated_at=0 WHERE user_id=%s', (uid,))
    return profile_payload(request, uid)


@router.post('/password')
def change_password(payload: PasswordInput, request: Request, uid: UserId) -> dict:
    store = request.app.state.auth_store
    # Commit attempts before checking the password so failed checks cannot reset the limit.
    with store.connect() as db:
        db.execute('SELECT id FROM auth_users WHERE id=%s FOR UPDATE', (uid,))
        store._limit(db, f'password-change:{uid}', 5, 900)
    with store.connect() as db:
        row = db.execute('SELECT password_hash FROM auth_users WHERE id=%s FOR UPDATE', (uid,)).fetchone()
        if not check_password(payload.current_password, row['password_hash'] or ''):
            raise AuthError('当前密码不正确。', 400)
        if payload.current_password == payload.new_password:
            raise AuthError('新密码不能与当前密码相同。', 400)
        db.execute('UPDATE auth_users SET password_hash=%s WHERE id=%s', (password_hash(payload.new_password), uid))
        current = hashlib.sha256(request.cookies[USER_COOKIE].encode()).hexdigest()
        db.execute('DELETE FROM auth_sessions WHERE user_id=%s AND digest<>%s', (uid, current))
    return {'ok': True}
