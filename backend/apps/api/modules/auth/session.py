"""Choose independent browser sessions for the user and administrator portals."""
from collections.abc import Mapping

USER_COOKIE = "opentalking_session"
ADMIN_COOKIE = "opentalking_admin_session"


def session_cookie(path: str, headers: Mapping[str, str]) -> str:
    admin_path = path == "/admin" or path.startswith("/admin/") or path.startswith("/auth/admin/")
    return ADMIN_COOKIE if admin_path or headers.get("x-opentalking-portal") == "admin" else USER_COOKIE
